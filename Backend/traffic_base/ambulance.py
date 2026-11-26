"""Flying ambulances, the emergencies they serve, and where they may land.

Each ambulance works alone from its own rooftop helipad. It flies straight over the
city, so it is not on the street graph and buildings never block it. It only touches
the road when it lands next to an emergency, and it reserves that road cell first.

The reservation follows the reservation table of Silver (2005), "Cooperative
Pathfinding", simplified to space only: a reserved cell is blocked for every car
until the ambulance releases it, with no time dimension. Cars never enter a reserved
cell (one already on it may leave) and treat it like a car ahead: wait, then reroute.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Set
from typing import TYPE_CHECKING

from mesa import Agent
from mesa.discrete_space import Cell, FixedAgent

from .agent import Car
from .city_graph import DIRECTION_VECTORS, Drivable, Position, Vector, step
from .vehicle import VehicleFrame

if TYPE_CHECKING:
    from .model import CityModel

EMERGENCY_INTERVAL = 25  # steps between chances to open an emergency
MAX_OPEN_EMERGENCIES = 2  # waiting or being served; keeps the backlog bounded
ROOF_ALTITUDE = 1.0  # a helipad sits on a one-cell-tall building
CRUISE_ALTITUDE = 3.0
CLIMB_RATE = 0.5  # altitude change per step while taking off or landing
FLIGHT_SPEED = 1.5  # cells per step while cruising
SERVICE_STEPS = 10  # steps on the ground at an emergency

ORTHOGONAL: list[Vector] = list(DIRECTION_VECTORS.values())
# The eight headings, counter-clockwise from +x, for the frame's heading field.
OCTANTS: list[Vector] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
]


def choose_helipads(
    buildings: Iterable[Position], width: int, height: int
) -> list[Position]:
    """The building nearest the bottom-left corner and the one nearest the top-right
    corner, so the two pads sit far apart. Ties go to the lower (x, y)."""
    remaining = sorted(buildings)
    anchors = [(0, 0), (width - 1, height - 1)]
    pads: list[Position] = []
    for ax, ay in anchors:
        if not remaining:
            break
        pad = min(remaining, key=lambda b: (math.hypot(b[0] - ax, b[1] - ay), b))
        remaining.remove(pad)
        pads.append(pad)
    return pads


def is_intersection(pos: Position, drivable: Drivable) -> bool:
    """A drivable cell with an orthogonal drivable neighbour whose direction is
    perpendicular to its own: where a crossing street meets this one, or the corner
    cells of a turn. Cars change lanes and cross here, so an ambulance must not."""
    own = drivable[pos]
    for move in ORTHOGONAL:
        other = drivable.get(step(pos, move))
        if other is not None and own[0] * other[0] + own[1] * other[1] == 0:
            return True
    return False


def static_landing_spots(
    building: Position, drivable: Drivable, lights: Set[Position], spawns: Set[Position]
) -> tuple[Position, ...]:
    """Road cells orthogonally next to `building` that are not a light, an
    intersection or a spawn corner. Reservations and cars are checked later, when an
    ambulance commits and when it touches down."""
    spots = (step(building, move) for move in ORTHOGONAL)
    return tuple(
        spot
        for spot in spots
        if spot in drivable
        and spot not in lights
        and spot not in spawns
        and not is_intersection(spot, drivable)
    )


def car_on(model: CityModel, pos: Position) -> bool:
    return any(isinstance(a, Car) for a in model.grid[pos].agents)


def nearest_octant(dx: float, dz: float) -> Vector:
    angle = math.atan2(dz, dx)
    return OCTANTS[round(angle / (math.pi / 4)) % len(OCTANTS)]


class Emergency(FixedAgent):
    """A building that needs an ambulance. Removed once an ambulance has served it."""

    def __init__(self, model: CityModel, cell: Cell) -> None:
        super().__init__(model)
        self.cell = cell
        self.assigned = False

    @property
    def position(self) -> Position:
        return self.cell.coordinate


def open_emergencies(model: CityModel) -> list[Emergency]:
    return list(model.agents_by_type.get(Emergency, []))


def maybe_open_emergency(model: CityModel) -> Emergency | None:
    """Opens an emergency at a random building that still has a free landing spot,
    unless MAX_OPEN_EMERGENCIES are already open."""
    current = open_emergencies(model)
    if len(current) >= MAX_OPEN_EMERGENCIES:
        return None
    taken = {e.position for e in current}
    candidates = [
        building
        for building, spots in model.landing_spots.items()
        if building not in taken and any(s not in model.reserved for s in spots)
    ]
    if not candidates:
        return None
    emergency = Emergency(model, model.grid[model.random.choice(candidates)])
    model.emit("emergency", emergency.unique_id, emergency.position)
    return emergency


class Ambulance(Agent):
    """Flies from its helipad to an emergency and back. Each step runs the handler of
    its current state:

    idle -> takeoff -> cruise -> landing -> on_scene -> takeoff -> return -> landing
    -> idle.
    """

    kind = "ambulance"

    def __init__(self, model: CityModel, helipad: Position) -> None:
        super().__init__(model)
        self.home = helipad
        self.x, self.z = float(helipad[0]), float(helipad[1])
        self.altitude = ROOF_ALTITUDE
        self.heading: Vector = (0, 1)
        self.state = "idle"
        self.emergency: Emergency | None = None
        self.spot: Position | None = None
        self.service_left = 0
        self.handlers: dict[str, Callable[[], None]] = {
            "idle": self._idle,
            "takeoff": self._takeoff,
            "cruise": self._cruise,
            "landing": self._landing,
            "on_scene": self._on_scene,
            "return": self._return,
        }

    def step(self) -> None:
        self.handlers[self.state]()

    def frame(self) -> VehicleFrame:
        return {
            "id": str(self.unique_id),
            "kind": self.kind,
            "x": self.x,
            "y": self.altitude,
            "z": self.z,
            "heading": {"x": self.heading[0], "z": self.heading[1]},
            "state": self.state,
        }

    def _idle(self) -> None:
        job = self._nearest_job()
        if job is None:
            return
        self.emergency, self.spot = job
        self.emergency.assigned = True
        self.model.reserved.add(self.spot)
        self.model.emit("dispatched", self.unique_id, self.spot)
        self.state = "takeoff"

    def _nearest_job(self) -> tuple[Emergency, Position] | None:
        """The nearest unassigned emergency with a free spot, and that spot. A spot
        without a car right now beats a nearer one, so the landing hovers less."""
        here = (self.x, self.z)
        jobs = [
            (math.dist(here, emergency.position), emergency, spots)
            for emergency in open_emergencies(self.model)
            if not emergency.assigned
            and (spots := self._free_spots(emergency.position))
        ]
        if not jobs:
            return None
        _, emergency, spots = min(jobs, key=lambda job: (job[0], job[1].position))
        spot = min(spots, key=lambda s: (car_on(self.model, s), math.dist(here, s), s))
        return emergency, spot

    def _free_spots(self, building: Position) -> list[Position]:
        spots = self.model.landing_spots[building]
        return [s for s in spots if s not in self.model.reserved]

    def _takeoff(self) -> None:
        reached = self._climb_to(CRUISE_ALTITUDE)
        if self.emergency is None:
            self._release_spot()  # served: the road is ours no longer
        if reached:
            self.state = "cruise" if self.emergency else "return"

    def _cruise(self) -> None:
        assert self.spot is not None
        if self._fly_towards(self.spot):
            self.state = "landing"

    def _return(self) -> None:
        if self._fly_towards(self.home):
            self.state = "landing"

    def _landing(self) -> None:
        if self.emergency is None:
            if self._climb_to(ROOF_ALTITUDE):
                self.state = "idle"
            return
        assert self.spot is not None
        if car_on(self.model, self.spot):
            return  # hover; the reservation keeps new cars out while this one leaves
        if self._climb_to(0.0):
            self.model.emit("landed", self.unique_id, self.spot)
            self.service_left = SERVICE_STEPS
            self.state = "on_scene"

    def _on_scene(self) -> None:
        self.service_left -= 1
        if self.service_left > 0:
            return
        assert self.emergency is not None
        self.model.emit("served", self.emergency.unique_id, self.emergency.position)
        self.model.emergencies_served += 1
        self.emergency.remove()
        self.emergency = None
        self.state = "takeoff"

    def _release_spot(self) -> None:
        if self.spot is not None:
            self.model.reserved.discard(self.spot)
            self.spot = None

    def _climb_to(self, altitude: float) -> bool:
        """Moves CLIMB_RATE towards `altitude`; True once there."""
        gap = altitude - self.altitude
        self.altitude = (
            altitude
            if abs(gap) <= CLIMB_RATE
            else self.altitude + math.copysign(CLIMB_RATE, gap)
        )
        return self.altitude == altitude

    def _fly_towards(self, target: Position) -> bool:
        """Moves FLIGHT_SPEED cells straight at `target`; True once above it."""
        dx, dz = target[0] - self.x, target[1] - self.z
        distance = math.hypot(dx, dz)
        if distance > 0:
            self.heading = nearest_octant(dx, dz)
        if distance <= FLIGHT_SPEED:
            self.x, self.z = float(target[0]), float(target[1])
            return True
        self.x += dx / distance * FLIGHT_SPEED
        self.z += dz / distance * FLIGHT_SPEED
        return False
