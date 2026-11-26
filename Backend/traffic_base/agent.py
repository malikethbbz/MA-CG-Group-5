from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from mesa.discrete_space import Cell, CellAgent, FixedAgent

from .city_graph import Direction, Position, Vector
from .vehicle import VehicleFrame

if TYPE_CHECKING:
    from .model import CityModel

logger = logging.getLogger(__name__)

# Blocked steps before a car looks for a way around the car in front. If there is
# none, it looks again after another PATIENCE steps.
PATIENCE = 3


class Car(CellAgent):
    """Drives an A* route to its destination. Each step runs the first rule that
    applies: no route -> wait; red light ahead -> stop; car or ambulance reservation
    ahead -> wait or reroute; otherwise drive.
    """

    kind = "car"

    def __init__(
        self, model: CityModel, cell: Cell, destination: Position, heading: Vector
    ) -> None:
        super().__init__(model)
        self.cell = cell
        self.destination = destination
        self.heading = heading
        self.route = model.route(cell.coordinate, destination)
        self.age = 0
        self.wait_steps = 0
        self.blocked_for = 0
        self.state = "driving"
        if not self.route:
            logger.warning(
                "car %s at %s has no route to %s",
                self.unique_id,
                cell.coordinate,
                destination,
            )

    def step(self) -> None:
        """One car on its own. The model moves cars with begin_step, try_drive and
        hold instead, so a whole queue can advance in one step."""
        self.begin_step()
        if not self.try_drive():
            self.hold()

    def begin_step(self) -> None:
        self.age += 1

    def try_drive(self) -> bool:
        """Moves one cell if the way is clear; True if the car moved."""
        if not self.route:
            return False
        nxt = self.route[0]
        if self._red_light_ahead(nxt) or self._blocked(nxt):
            return False
        self._drive()
        return True

    def hold(self) -> None:
        """Waits this step, for the reason that stopped try_drive."""
        if not self.route or self._red_light_ahead(self.route[0]):
            self._wait()
        else:
            self._handle_blocked()

    def _red_light_ahead(self, nxt: Position) -> bool:
        """Stop before a red light; a car already on a light keeps going."""
        if self._light_at(self.cell.coordinate) is not None:
            return False
        light = self._light_at(nxt)
        return light is not None and not light.state

    def _light_at(self, pos: Position) -> Traffic_Light | None:
        agents = self.model.grid[pos].agents
        return next((a for a in agents if isinstance(a, Traffic_Light)), None)

    def _blocked(self, pos: Position) -> bool:
        """A car is there, or an ambulance reserved it to land (see ambulance.py)."""
        if pos in self.model.reserved:
            return True
        return any(isinstance(a, Car) for a in self.model.grid[pos].agents)

    def _handle_blocked(self) -> None:
        self.blocked_for += 1
        if self.blocked_for >= PATIENCE:
            self._reroute_around(self.route[0])
        self._wait()

    def _reroute_around(self, blocked: Position) -> None:
        here = self.cell.coordinate
        detour = self.model.route(here, self.destination, avoid={blocked})
        if detour:
            self.route = detour
        self.blocked_for = 0

    def frame(self) -> VehicleFrame:
        x, y = self.cell.coordinate
        return {
            "id": str(self.unique_id),
            "kind": self.kind,
            "x": x,
            "y": 0,
            "z": y,
            "heading": {"x": self.heading[0], "z": self.heading[1]},
            "state": self.state,
        }

    def _wait(self) -> None:
        self.wait_steps += 1
        self.state = "waiting"

    def _drive(self) -> None:
        nxt, *self.route = self.route
        here = self.cell.coordinate
        self.heading = (nxt[0] - here[0], nxt[1] - here[1])
        self.cell = self.model.grid[nxt]
        self.blocked_for = 0
        self.state = "driving"
        if nxt == self.destination:
            self.model.record_arrival(self, self.age, self.wait_steps)
            self.remove()


class Motorcycle(Car):
    """Follows the same rules as a car; only the frontend draws it differently."""

    kind = "motorcycle"


class Traffic_Light(FixedAgent):
    """Green for `green_steps` of every `cycle` steps, starting at `offset`.

    The model gives the 's' and 'S' groups back-to-back slots in one cycle, so the two
    groups are never green at the same time.
    """

    def __init__(
        self, model: CityModel, cell: Cell, offset: int, green_steps: int, cycle: int
    ) -> None:
        if not 0 < green_steps <= cycle:
            raise ValueError(f"green_steps must be in 1..{cycle}, got {green_steps}")
        super().__init__(model)
        self.cell = cell
        self.offset = offset
        self.green_steps = green_steps
        self.cycle = cycle
        self.state = self._is_green(0)  # True is green; the API sends it as "state"

    def _is_green(self, t: int) -> bool:
        return (t - self.offset) % self.cycle < self.green_steps

    def step(self) -> None:
        self.state = self._is_green(self.model.steps)


class Destination(FixedAgent):
    """A cell cars drive to. Cars are removed when they reach it."""

    def __init__(self, model: CityModel, cell: Cell) -> None:
        super().__init__(model)
        self.cell = cell


class Obstacle(FixedAgent):
    """A building cell. Cars never enter it."""

    def __init__(self, model: CityModel, cell: Cell) -> None:
        super().__init__(model)
        self.cell = cell


class Monument(FixedAgent):
    """A landmark on a roundabout island, like Mexico City's Angel of Independence.
    Cars never enter it, and it is not a building: no emergency opens there and no
    helipad sits on it."""

    def __init__(self, model: CityModel, cell: Cell) -> None:
        super().__init__(model)
        self.cell = cell


class Road(FixedAgent):
    """A road cell and the direction traffic flows on it."""

    def __init__(self, model: CityModel, cell: Cell, direction: Direction) -> None:
        super().__init__(model)
        self.cell = cell
        self.direction = direction
