"""Flying ambulances, the emergencies they serve, and where they may land.

Each ambulance works alone from its own rooftop helipad. It flies straight over the
city, so it is not on the street graph and buildings never block it. It only touches
the road when it lands next to an emergency, and it reserves that road cell first.

The reservation follows the reservation table of Silver (2005), "Cooperative
Pathfinding", simplified to space only: a reserved cell is blocked for every car
until the ambulance releases it, with no time dimension. Cars never enter a reserved
cell (one already on it may leave) and treat it like a car ahead: wait, then reroute.
"""

import math

from mesa import Agent
from mesa.discrete_space import FixedAgent

from .city_graph import DIRECTION_VECTORS, step

EMERGENCY_INTERVAL = 25  # steps between chances to open an emergency
MAX_OPEN_EMERGENCIES = 2  # waiting or being served; keeps the backlog bounded
ROOF_ALTITUDE = 1.0  # a helipad sits on a one-cell-tall building
CRUISE_ALTITUDE = 3.0
CLIMB_RATE = 0.5  # altitude change per step while taking off or landing
FLIGHT_SPEED = 1.5  # cells per step while cruising
SERVICE_STEPS = 10  # steps on the ground at an emergency

# The eight headings, counter-clockwise from +x, for the frame's heading field.
OCTANTS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def choose_helipads(buildings, width, height):
    """
    Picks the building nearest the bottom-left corner and the one nearest the
    top-right corner, so the two pads sit far apart. Ties go to the lower (x, y).
    Args:
        buildings: Cells that can hold a helipad
        width: Width of the map
        height: Height of the map
    """
    remaining = sorted(buildings)
    pads = []
    for ax, ay in [(0, 0), (width - 1, height - 1)]:
        if not remaining:
            break
        pad = min(remaining, key=lambda b: (math.hypot(b[0] - ax, b[1] - ay), b))
        remaining.remove(pad)
        pads.append(pad)
    return pads


def is_intersection(pos, drivable):
    """A drivable cell next to a drivable cell that points across it: where a crossing
    street meets this one, or the corner cells of a turn. Cars change lanes and cross
    here, so an ambulance must not land on it."""
    own = drivable[pos]
    for move in DIRECTION_VECTORS.values():
        other = drivable.get(step(pos, move))
        if other is not None and own[0] * other[0] + own[1] * other[1] == 0:
            return True
    return False


def static_landing_spots(building, drivable, lights, spawns):
    """
    Road cells next to a building where an ambulance may land: not a light, an
    intersection or a spawn point. Reservations and cars are checked later, when an
    ambulance takes the job and when it touches down.
    Args:
        building: The building cell
        drivable: Dictionary of every road or light cell -> its direction vector
        lights: Set of light cells
        spawns: Set of spawn cells
    """
    spots = []
    for move in DIRECTION_VECTORS.values():
        spot = step(building, move)
        if (
            spot in drivable
            and spot not in lights
            and spot not in spawns
            and not is_intersection(spot, drivable)
        ):
            spots.append(spot)
    return tuple(spots)


def nearest_octant(dx, dz):
    """The one of the eight OCTANTS closest to the direction (dx, dz)."""
    angle = math.atan2(dz, dx)
    return OCTANTS[round(angle / (math.pi / 4)) % len(OCTANTS)]


class Emergency(FixedAgent):
    """
    A building that needs an ambulance. Removed once an ambulance has served it.
    """

    def __init__(self, model, cell):
        """
        Creates a new emergency.
        Args:
            model: Model reference for the agent
            cell: The building cell that needs help
        """
        super().__init__(model)
        self.cell = cell
        self.assigned = False  # True once an ambulance has taken it

    @property
    def position(self):
        return self.cell.coordinate


def open_emergencies(model):
    return list(model.agents_by_type.get(Emergency, []))


def maybe_open_emergency(model):
    """Opens an emergency at a random building that still has a free landing spot,
    unless MAX_OPEN_EMERGENCIES are already open."""
    current = open_emergencies(model)
    if len(current) >= MAX_OPEN_EMERGENCIES:
        return None

    taken = set()
    for emergency in current:
        taken.add(emergency.position)

    candidates = []
    for building, spots in model.landing_spots.items():
        if building in taken:
            continue
        if any(spot not in model.reserved for spot in spots):
            candidates.append(building)
    if not candidates:
        return None

    emergency = Emergency(model, model.grid[model.random.choice(candidates)])
    model.emit("emergency", emergency.unique_id, emergency.position)
    return emergency


class Ambulance(Agent):
    """
    Ambulance that flies from its helipad to an emergency and back. Its state goes:
    idle -> takeoff -> cruise -> landing -> on_scene -> takeoff -> return -> landing
    -> idle.
    """

    kind = "ambulance"

    def __init__(self, model, helipad):
        """
        Creates a new ambulance resting on its helipad.
        Args:
            model: Model reference for the agent
            helipad: The building cell (x, y) it starts on and returns to
        """
        super().__init__(model)
        self.home = helipad
        self.x = float(helipad[0])  # floats, since it flies in straight lines
        self.z = float(helipad[1])
        self.altitude = ROOF_ALTITUDE
        self.heading = (0, 1)
        self.state = "idle"
        self.emergency = None  # the emergency it is serving
        self.spot = None  # the road cell it reserved to land on
        self.service_left = 0

    def step(self):
        """Runs what the ambulance does in its current state."""
        if self.state == "idle":
            self.idle()
        elif self.state == "takeoff":
            self.takeoff()
        elif self.state == "cruise":
            if self.fly_towards(self.spot):
                self.state = "landing"
        elif self.state == "return":
            if self.fly_towards(self.home):
                self.state = "landing"
        elif self.state == "landing":
            self.land()
        elif self.state == "on_scene":
            self.serve()

    def frame(self):
        """What /step sends for this ambulance."""
        return {
            "id": str(self.unique_id),
            "kind": self.kind,
            "x": self.x,
            "y": self.altitude,
            "z": self.z,
            "heading": {"x": self.heading[0], "z": self.heading[1]},
            "state": self.state,
        }

    def idle(self):
        """Takes the nearest job, if any, and reserves its landing spot."""
        job = self.nearest_job()
        if job is None:
            return
        self.emergency, self.spot = job
        self.emergency.assigned = True
        self.model.reserved.add(self.spot)
        self.model.emit("dispatched", self.unique_id, self.spot)
        self.state = "takeoff"

    def nearest_job(self):
        """The nearest unassigned emergency with a free spot, and that spot. A spot
        without a car on it right now beats a nearer one, so the landing hovers
        less."""
        here = (self.x, self.z)
        best = None
        best_key = None
        for emergency in open_emergencies(self.model):
            if emergency.assigned:
                continue
            spots = self.free_spots(emergency.position)
            if not spots:
                continue
            key = (math.dist(here, emergency.position), emergency.position)
            if best is None or key < best_key:
                best = (emergency, spots)
                best_key = key
        if best is None:
            return None

        emergency, spots = best
        spot = min(spots, key=lambda s: (self.model.has_car(s), math.dist(here, s), s))
        return emergency, spot

    def free_spots(self, building):
        free = []
        for spot in self.model.landing_spots[building]:
            if spot not in self.model.reserved:
                free.append(spot)
        return free

    def takeoff(self):
        reached = self.climb_to(CRUISE_ALTITUDE)
        if self.emergency is None and self.spot is not None:
            # Already served: give the road cell back to the cars.
            self.model.reserved.discard(self.spot)
            self.spot = None
        if reached:
            self.state = "cruise" if self.emergency else "return"

    def land(self):
        # Back home: land on the roof and wait for the next job.
        if self.emergency is None:
            if self.climb_to(ROOF_ALTITUDE):
                self.state = "idle"
            return
        # At the emergency: hover while a car is still on the spot. The reservation
        # keeps new cars out while this one leaves.
        if self.model.has_car(self.spot):
            return
        if self.climb_to(0.0):
            self.model.emit("landed", self.unique_id, self.spot)
            self.service_left = SERVICE_STEPS
            self.state = "on_scene"

    def serve(self):
        """Stays on the road SERVICE_STEPS steps, then closes the emergency."""
        self.service_left -= 1
        if self.service_left > 0:
            return
        self.model.emit("served", self.emergency.unique_id, self.emergency.position)
        self.model.emergencies_served += 1
        self.emergency.remove()
        self.emergency = None
        self.state = "takeoff"

    def climb_to(self, altitude):
        """Moves CLIMB_RATE towards `altitude`. Returns True once there."""
        gap = altitude - self.altitude
        if abs(gap) <= CLIMB_RATE:
            self.altitude = altitude
        else:
            self.altitude += math.copysign(CLIMB_RATE, gap)
        return self.altitude == altitude

    def fly_towards(self, target):
        """Moves FLIGHT_SPEED cells straight at `target`. Returns True once above
        it."""
        dx = target[0] - self.x
        dz = target[1] - self.z
        distance = math.hypot(dx, dz)
        if distance > 0:
            self.heading = nearest_octant(dx, dz)
        if distance <= FLIGHT_SPEED:
            self.x = float(target[0])
            self.z = float(target[1])
            return True
        self.x += dx / distance * FLIGHT_SPEED
        self.z += dz / distance * FLIGHT_SPEED
        return False
