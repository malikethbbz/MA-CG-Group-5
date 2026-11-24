from mesa.discrete_space import CellAgent, FixedAgent

from .city_graph import Position

# Steps a car waits behind a stopped car before planning a route around it.
PATIENCE = 3


class Car(CellAgent):
    """Drives an A* route to its destination, respecting lights and other cars.

    Each step runs the first behavior whose condition holds (subsumption, highest first):
    no route -> wait, red light ahead -> stop, car ahead -> wait or reroute, else drive.
    """

    def __init__(self, model, cell, destination: Position, heading: Position):
        super().__init__(model)
        self.cell = cell
        self.destination = destination
        self.heading = heading
        self.route = model.route(cell.coordinate, destination)
        self.age = 0
        self.wait_steps = 0
        self.blocked_for = 0

    def step(self):
        self.age += 1
        if not self.route:
            self._wait()
        elif self._red_light_ahead(self.route[0]):
            self._wait()
        elif self._car_at(self.route[0]):
            self._handle_blocked()
        else:
            self._drive()

    def _red_light_ahead(self, nxt: Position) -> bool:
        """Stop before a red light; a car already on the light keeps going."""
        if self._light_at(self.cell.coordinate) is not None:
            return False
        light = self._light_at(nxt)
        return light is not None and not light.state

    def _light_at(self, pos: Position):
        return next(
            (a for a in self.model.grid[pos].agents if isinstance(a, Traffic_Light)), None
        )

    def _car_at(self, pos: Position) -> bool:
        return any(isinstance(a, Car) for a in self.model.grid[pos].agents)

    def _handle_blocked(self):
        self.blocked_for += 1
        if self.blocked_for >= PATIENCE:
            self._reroute_around(self.route[0])
        self._wait()

    def _reroute_around(self, blocked: Position):
        detour = self.model.route(self.cell.coordinate, self.destination, avoid={blocked})
        if detour:
            self.route = detour
        self.blocked_for = 0  # with no detour, try again after another PATIENCE steps

    def _wait(self):
        self.wait_steps += 1

    def _drive(self):
        nxt = self.route.pop(0)
        here = self.cell.coordinate
        self.heading = (nxt[0] - here[0], nxt[1] - here[1])
        self.cell = self.model.grid[nxt]
        self.blocked_for = 0
        if nxt == self.destination:
            self.model.car_arrived(self)


class Traffic_Light(FixedAgent):
    """Green during its slot of a cycle shared with the crossing street's lights.

    The map has two light groups: 's' and 'S'. Their durations from mapDictionary.json
    (7 and 15) are their green times within one cycle, so the two groups are never
    green together at the same intersection.
    """

    def __init__(self, model, cell, offset: int, green_steps: int, cycle: int):
        super().__init__(model)
        self.cell = cell
        self.offset = offset
        self.green_steps = green_steps
        self.cycle = cycle
        self.state = self._is_green(0)

    def _is_green(self, t: int) -> bool:
        return (t - self.offset) % self.cycle < self.green_steps

    def step(self):
        self.state = self._is_green(self.model.steps)


class Destination(FixedAgent):
    """Destination agent. Where each car should go."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell


class Obstacle(FixedAgent):
    """Obstacle agent. Buildings and other cells cars cannot enter."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell


class Road(FixedAgent):
    """Road agent. Determines where the cars can move, and in which direction."""

    def __init__(self, model, cell, direction="Left"):
        super().__init__(model)
        self.cell = cell
        self.direction = direction
