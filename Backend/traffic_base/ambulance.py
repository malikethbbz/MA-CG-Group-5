"""Flying ambulances and the emergencies they serve.

The ambulances wait on the roof of the hospital. When an emergency opens, one of them
reserves a road cell next to the building, flies straight there at cruise height,
lands, serves the emergency and flies back. Cars never drive into a reserved cell
(like the reservation table of Silver 2005, "Cooperative Pathfinding", without time).
"""

import math

from mesa import Agent
from mesa.discrete_space import FixedAgent

from .agent import vehicle_frame

EMERGENCY_INTERVAL = 25  # steps between chances to open an emergency
MAX_OPEN_EMERGENCIES = 2
ROOF_ALTITUDE = 1.0  # buildings are one cell tall
CRUISE_ALTITUDE = 3.0
FLIGHT_SPEED = 1.5  # cells per step
SERVICE_STEPS = 10  # steps on the ground at an emergency

# The eight headings, counter-clockwise from +x.
OCTANTS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


class Emergency(FixedAgent):
    """A building that needs an ambulance. Removed once it has been served."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell
        self.assigned = False


class Ambulance(Agent):
    """
    Ambulance that flies from the hospital roof to an emergency and back. Its state
    goes idle -> cruise -> on_scene -> return -> idle.
    """

    kind = "ambulance"

    def __init__(self, model, home):
        """
        Creates a new ambulance parked on a roof.
        Args:
            model: Model reference for the agent
            home: The roof cell (x, y) it starts on and returns to
        """
        super().__init__(model)
        self.home = home
        self.x, self.z = float(home[0]), float(home[1])  # it flies between cells
        self.altitude = ROOF_ALTITUDE
        self.heading = (0, 1)
        self.state = "idle"
        self.emergency = None
        self.spot = None  # the road cell it reserved to land on
        self.service_left = 0

    def step(self):
        if self.state == "idle":
            self.find_emergency()

        elif self.state == "cruise" and self.fly_towards(self.spot):
            # Over the spot: land, unless a car is still leaving it.
            if not self.model.has_car(self.spot):
                self.altitude = 0.0
                self.service_left = SERVICE_STEPS
                self.state = "on_scene"
                self.model.emit("landed", self.unique_id, self.spot)

        elif self.state == "on_scene":
            self.service_left -= 1
            if self.service_left == 0:
                building = self.emergency.cell.coordinate
                self.model.emit("served", self.emergency.unique_id, building)
                self.model.emergencies_served += 1
                self.emergency.remove()
                self.emergency = None
                self.altitude = CRUISE_ALTITUDE
                self.state = "return"

        elif self.state == "return":
            # The ambulance has left the road, so the cars may use the spot again.
            if self.spot is not None:
                self.model.reserved.discard(self.spot)
                self.spot = None
            if self.fly_towards(self.home):
                self.altitude = ROOF_ALTITUDE
                self.state = "idle"

    def find_emergency(self):
        """Takes the nearest emergency nobody serves that has a free landing cell."""
        here = (self.x, self.z)
        best = None
        for emergency in self.model.agents_by_type.get(Emergency, []):
            spots = self.model.free_landing_spots(emergency.cell.coordinate)
            if emergency.assigned or not spots:
                continue
            distance = math.dist(here, emergency.cell.coordinate)
            if best is None or distance < best[0]:
                best = (distance, emergency, spots[0])
        if best is None:
            return
        _, self.emergency, self.spot = best
        self.emergency.assigned = True
        self.model.reserved.add(self.spot)
        self.model.emit("dispatched", self.unique_id, self.spot)
        self.altitude = CRUISE_ALTITUDE
        self.state = "cruise"

    def fly_towards(self, target):
        """Moves FLIGHT_SPEED cells straight at `target`. Returns True once above it."""
        dx, dz = target[0] - self.x, target[1] - self.z
        distance = math.hypot(dx, dz)
        if distance > 0:
            angle = math.atan2(dz, dx)
            self.heading = OCTANTS[round(angle / (math.pi / 4)) % 8]
        if distance <= FLIGHT_SPEED:
            self.x, self.z = float(target[0]), float(target[1])
            return True
        self.x += dx / distance * FLIGHT_SPEED
        self.z += dz / distance * FLIGHT_SPEED
        return False

    def frame(self):
        return vehicle_frame(self, self.x, self.altitude, self.z)
