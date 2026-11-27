from mesa.discrete_space import CellAgent, FixedAgent

# Steps a car waits behind something before it looks for a way around it.
PATIENCE = 3
# Last steps of a green that show yellow, on the lights that have a yellow phase
YELLOW_STEPS = 2


def vehicle_frame(agent, x, y, z):
    """What /step sends for a car or an ambulance. y is the altitude, 0 on the road."""
    heading = {"x": agent.heading[0], "z": agent.heading[1]}
    return {
        "id": str(agent.unique_id),
        "kind": agent.kind,
        "x": x,
        "y": y,
        "z": z,
        "heading": heading,
        "state": agent.state,
    }


class Car(CellAgent):
    """
    Car that drives an A* route to its destination. Each step it stops at a red
    light, waits behind a car or a reserved cell (rerouting after PATIENCE steps),
    or drives one cell.
    """

    kind = "car"

    def __init__(self, model, cell, destination, heading):
        """
        Creates a new car and plans its route.
        Args:
            model: Model reference for the agent
            cell: The initial position of the agent
            destination: The cell (x, y) the car drives to
            heading: The direction (dx, dy) the car is facing
        """
        super().__init__(model)
        self.cell = cell
        self.destination = destination
        self.heading = heading
        self.route = model.route(cell.coordinate, destination)
        self.age = 0
        self.wait_steps = 0
        self.blocked_for = 0
        self.state = "driving"

    def try_drive(self):
        """Moves one cell along the route if the way is clear. Returns True if the
        car moved. The model calls this until no car can move, so a queue advances
        together."""
        if not self.route:
            return False
        next_cell = self.route[0]
        if self.red_light_ahead(next_cell) or self.is_yellow_light_ahead(next_cell):
            return False
        if self.is_blocked(next_cell):
            return False

        here = self.cell.coordinate
        self.heading = (next_cell[0] - here[0], next_cell[1] - here[1])
        self.cell = self.model.grid[next_cell]
        self.route = self.route[1:]
        self.blocked_for = 0
        self.state = "driving"
        if next_cell == self.destination:
            self.model.record_arrival(self)
            self.remove()
        return True

    def hold(self):
        """Waits this step. A car stuck behind something reroutes after a while."""
        stopped_by_light = self.route and (
            self.red_light_ahead(self.route[0])
            or self.is_yellow_light_ahead(self.route[0])
        )
        if self.route and not stopped_by_light:
            self.blocked_for += 1
            if self.blocked_for >= PATIENCE:
                here = self.cell.coordinate
                detour = self.model.route(here, self.destination, avoid={self.route[0]})
                if detour:
                    self.route = detour
                self.blocked_for = 0
        self.wait_steps += 1
        self.state = "waiting"

    def red_light_ahead(self, next_cell):
        """Stop before a red light. A car that is already on a light keeps going."""
        if self.model.light_at(self.cell.coordinate) is not None:
            return False
        light = self.model.light_at(next_cell)
        return light is not None and not light.state

    def is_yellow_light_ahead(self, next_cell):
        """Stop before a yellow light. A car that is already on a light keeps going."""
        if self.model.light_at(self.cell.coordinate) is not None:
            return False
        light = self.model.light_at(next_cell)
        return light is not None and light.yellow

    def is_blocked(self, pos):
        """A car is there, or an ambulance reserved the cell to land."""
        return pos in self.model.reserved or self.model.has_car(pos)

    def frame(self):
        x, y = self.cell.coordinate
        return vehicle_frame(self, x, 0, y)


class Motorcycle(Car):
    """Same rules as a car; only the frontend draws it differently."""

    kind = "motorcycle"


class Traffic_Light(FixedAgent):
    """
    Traffic light, green for `green_steps` of every `cycle` steps starting at
    `offset`. The 's' and 'S' lights get back-to-back slots of the same cycle, so
    they are never green at the same time.
    """

    def __init__(self, model, cell, offset, green_steps, cycle, has_yellow=False):
        super().__init__(model)
        self.cell = cell
        self.offset = offset
        self.green_steps = green_steps
        self.cycle = cycle
        self.has_yellow = has_yellow
        self.state = self.is_green(0)  # True is green (or yellow)
        self.yellow = self.is_yellow(0)

    def is_green(self, t):
        return (t - self.offset) % self.cycle < self.green_steps

    def is_yellow(self, t):
        """The last YELLOW_STEPS of the green, only on lights with a yellow phase."""
        time_in_cycle = (t - self.offset) % self.cycle
        last_steps = self.green_steps - YELLOW_STEPS <= time_in_cycle < self.green_steps
        return self.has_yellow and last_steps

    def step(self):
        self.state = self.is_green(self.model.steps)
        self.yellow = self.is_yellow(self.model.steps)


class Destination(FixedAgent):
    """Where each car should go. Cars are removed when they reach it."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell


class Obstacle(FixedAgent):
    """A building. Cars never enter it."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell


class Monument(FixedAgent):
    """A landmark on the diamond glorieta, like Mexico City's Angel of Independence."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell


class Road(FixedAgent):
    """Determines where the cars can move, and in which direction."""

    def __init__(self, model, cell, direction="Left"):
        super().__init__(model)
        self.cell = cell
        self.direction = direction
