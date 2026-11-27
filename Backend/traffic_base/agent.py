import logging

from mesa.discrete_space import CellAgent, FixedAgent

logger = logging.getLogger(__name__)

# Steps a car waits behind another car before it looks for a way around it. If there
# is none, it looks again after another PATIENCE steps.
PATIENCE = 3


class Car(CellAgent):
    """
    Car that drives an A* route to its destination. Each step it follows the first
    rule that applies:
    no route -> wait; red light ahead -> stop; a car or an ambulance reservation
    ahead -> wait, and after PATIENCE steps look for a detour; otherwise drive.
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
        self.age = 0  # steps since the car spawned
        self.wait_steps = 0  # steps it spent waiting
        self.blocked_for = 0  # steps in a row stuck behind something
        self.state = "driving"
        if not self.route:
            logger.warning(
                "car %s at %s has no route to %s",
                self.unique_id,
                cell.coordinate,
                destination,
            )

    def step(self):
        """
        Moves the car on its own. The model does not call this: it calls begin_step,
        try_drive and hold so a whole queue of cars can advance in one step.
        """
        self.begin_step()
        if not self.try_drive():
            self.hold()

    def begin_step(self):
        self.age += 1

    def try_drive(self):
        """Moves one cell along the route if the way is clear. Returns True if the
        car moved."""
        if not self.route:
            return False
        next_cell = self.route[0]
        if self.red_light_ahead(next_cell) or self.is_blocked(next_cell):
            return False
        self.drive()
        return True

    def hold(self):
        """Waits this step, for whatever reason stopped try_drive."""
        if not self.route or self.red_light_ahead(self.route[0]):
            self.wait()
            return

        # Something is in the way. After waiting long enough, look for a detour.
        self.blocked_for += 1
        if self.blocked_for >= PATIENCE:
            self.reroute_around(self.route[0])
        self.wait()

    def light_at(self, pos):
        """Returns the traffic light on a cell, or None if there is no light."""
        for agent in self.model.grid[pos].agents:
            if isinstance(agent, Traffic_Light):
                return agent
        return None

    def red_light_ahead(self, next_cell):
        """Stop before a red light. A car that is already on a light keeps going."""
        if self.light_at(self.cell.coordinate) is not None:
            return False
        light = self.light_at(next_cell)
        return light is not None and not light.state

    def is_blocked(self, pos):
        """A car is on the cell, or an ambulance reserved it to land (ambulance.py)."""
        return pos in self.model.reserved or self.model.has_car(pos)

    def reroute_around(self, blocked_cell):
        """Plans a new route that avoids the blocked cell, if there is one."""
        detour = self.model.route(
            self.cell.coordinate, self.destination, avoid={blocked_cell}
        )
        if detour:
            self.route = detour
        self.blocked_for = 0

    def wait(self):
        self.wait_steps += 1
        self.state = "waiting"

    def drive(self):
        """Moves to the next cell of the route. Leaves the city at its destination."""
        next_cell = self.route[0]
        self.route = self.route[1:]
        here = self.cell.coordinate
        self.heading = (next_cell[0] - here[0], next_cell[1] - here[1])
        self.cell = self.model.grid[next_cell]
        self.blocked_for = 0
        self.state = "driving"
        if next_cell == self.destination:
            self.model.record_arrival(self, self.age, self.wait_steps)
            self.remove()

    def frame(self):
        """What /step sends for this car. Grid (x, y) is world (x, z); y is the
        altitude, 0 on the road."""
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


class Motorcycle(Car):
    """Follows the same rules as a car. Only the frontend draws it differently."""

    kind = "motorcycle"


class Traffic_Light(FixedAgent):
    """
    Traffic light. It is green for `green_steps` of every `cycle` steps, starting at
    `offset`. The model gives the 's' and 'S' lights back-to-back slots in one cycle,
    so the two groups are never green at the same time.
    """

    def __init__(self, model, cell, offset, green_steps, cycle):
        """
        Creates a new traffic light.
        Args:
            model: Model reference for the agent
            cell: The initial position of the agent
            offset: Step of the cycle when the light turns green
            green_steps: How many steps of the cycle the light stays green
            cycle: Length of the whole cycle in steps
        """
        if not 0 < green_steps <= cycle:
            raise ValueError(f"green_steps must be in 1..{cycle}, got {green_steps}")
        super().__init__(model)
        self.cell = cell
        self.offset = offset
        self.green_steps = green_steps
        self.cycle = cycle
        self.state = self.is_green(0)  # True is green, False is red

    def is_green(self, t):
        """Whether the light is green at step t."""
        return (t - self.offset) % self.cycle < self.green_steps

    def step(self):
        """Changes the color for the current step."""
        self.state = self.is_green(self.model.steps)


class Destination(FixedAgent):
    """
    Destination agent. Where each car should go. Cars are removed when they reach it.
    """

    def __init__(self, model, cell):
        """
        Creates a new destination agent.
        Args:
            model: Model reference for the agent
            cell: The initial position of the agent
        """
        super().__init__(model)
        self.cell = cell


class Obstacle(FixedAgent):
    """
    Obstacle agent. A building cell; cars never enter it.
    """

    def __init__(self, model, cell):
        """
        Creates a new obstacle.
        Args:
            model: Model reference for the agent
            cell: The initial position of the agent
        """
        super().__init__(model)
        self.cell = cell


class Monument(FixedAgent):
    """
    A landmark on a roundabout island, like Mexico City's Angel of Independence.
    Cars never enter it, and it is not a building: no emergency opens there and no
    helipad sits on it.
    """

    def __init__(self, model, cell):
        """
        Creates a new monument.
        Args:
            model: Model reference for the agent
            cell: The initial position of the agent
        """
        super().__init__(model)
        self.cell = cell


class Road(FixedAgent):
    """
    Road agent. Determines where the cars can move, and in which direction.
    """

    def __init__(self, model, cell, direction="Left"):
        """
        Creates a new road.
        Args:
            model: Model reference for the agent
            cell: The initial position of the agent
            direction: "Up", "Down", "Left" or "Right"
        """
        super().__init__(model)
        self.cell = cell
        self.direction = direction
