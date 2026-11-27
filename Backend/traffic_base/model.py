import json
import math
from pathlib import Path

import networkx as nx
from mesa import Model
from mesa.discrete_space import OrthogonalMooreGrid

from .agent import Car, Destination, Monument, Motorcycle, Obstacle, Road, Traffic_Light
from .ambulance import EMERGENCY_INTERVAL, MAX_OPEN_EMERGENCIES, Ambulance, Emergency
from .city_graph import (
    DIRECTION_VECTORS,
    build_street_graph,
    infer_light_directions,
    shortest_route,
    step,
)

CITY_FILES = Path(__file__).resolve().parent.parent / "city_files"
DEFAULT_MAP = "2025_base.txt"
SPAWN_INTERVAL = 10
MAX_SPAWN_INTERVAL = 10
MOTORCYCLE_SHARE = 0.3  # chance a spawned vehicle is a motorcycle


class CityModel(Model):
    """
    Creates a model based on a city map. Every spawn_interval steps a car appears on
    each free corner of the map, and cars are removed at their destination. The run
    stops when a spawn step cannot place any car. Ambulances serve emergencies that
    may open every EMERGENCY_INTERVAL steps.

    Args:
        map_name: Map file inside map_dir
        seed: Random seed for the model
        map_dir: Folder with the map files and mapDictionary.json
        spawn_interval: Steps between spawns, 1 to 10
        cars_per_spawn: Most cars a spawn step places, 1 to 4
        ambulances: Number of ambulances, 0 to 2
        emergency_chance: Chance, 0 to 1, that an emergency opens when it can
    """

    def __init__(
        self,
        map_name=DEFAULT_MAP,
        seed=42,
        map_dir=CITY_FILES,
        spawn_interval=SPAWN_INTERVAL,
        cars_per_spawn=4,
        ambulances=2,
        emergency_chance=1.0,
    ):
        if not 1 <= spawn_interval <= MAX_SPAWN_INTERVAL:
            raise ValueError(f"spawn_interval must be 1..{MAX_SPAWN_INTERVAL}")
        if not 1 <= cars_per_spawn <= 4:
            raise ValueError("cars_per_spawn must be 1..4")
        if not 0 <= ambulances <= 2:
            raise ValueError("ambulances must be 0..2")
        if not 0 <= emergency_chance <= 1:
            raise ValueError("emergency_chance must be 0..1")
        super().__init__(rng=seed)
        self.spawn_interval = spawn_interval
        self.cars_per_spawn = cars_per_spawn
        self.emergency_chance = emergency_chance

        self.traffic_lights = []
        self.destinations = []
        self.buildings = []
        self.monuments = []
        self.reserved = set()  # road cells held by a landing ambulance
        self.events = []  # what happened during the latest step
        self.spawned = 0
        self.arrived = 0
        self.arrived_trip_steps = 0
        self.arrived_wait_steps = 0
        self.emergencies_served = 0
        self.stop_reason = None

        self.load_map(map_dir, map_name)
        self.graph = build_street_graph(self.drivable, set(self.destinations))

        # Cars spawn on the map corners that are roads.
        corners = [(0, 0), (self.width - 1, 0), (0, self.height - 1)]
        corners.append((self.width - 1, self.height - 1))
        self.reachable = {}
        for corner in corners:
            if corner in self.drivable:
                goals = nx.descendants(self.graph, corner)
                self.reachable[corner] = [d for d in self.destinations if d in goals]
        self.spawn_points = list(self.reachable)

        self.place_ambulances(ambulances)
        self.running = True
        self.spawn_cars()

    def load_map(self, map_dir, map_name):
        """
        Reads the map file and creates the agent for each character. Lights are
        created last, since they point the way of the road that feeds them.
        """
        with open(map_dir / "mapDictionary.json") as dictionary_file:
            symbols = json.load(dictionary_file)
        with open(map_dir / map_name) as map_file:
            lines = [line.strip() for line in map_file if line.strip()]

        self.width = len(lines[0])
        self.height = len(lines)
        self.grid = OrthogonalMooreGrid(
            [self.width, self.height], capacity=100, torus=False, random=self.random
        )

        road_dirs = {}
        light_cells = {}
        for r, row in enumerate(lines):
            for c, char in enumerate(row):
                pos = (c, self.height - r - 1)  # file row 0 is the top of the grid
                cell = self.grid[pos]
                if char not in symbols:
                    raise ValueError(
                        f"map symbol {char!r} at row {r}, column {c} is not in "
                        "mapDictionary.json"
                    )
                if char in "<>^v":
                    Road(self, cell, symbols[char])
                    road_dirs[pos] = DIRECTION_VECTORS[symbols[char]]
                elif char in "sS":
                    light_cells[pos] = char
                elif char == "#":
                    Obstacle(self, cell)
                    self.buildings.append(pos)
                elif char == "D":
                    Destination(self, cell)
                    self.destinations.append(pos)
                elif char == "A":
                    Monument(self, cell)
                    self.monuments.append(pos)

        light_dirs = infer_light_directions(road_dirs, list(light_cells))
        self.drivable = {**road_dirs, **light_dirs}
        self.place_lights(light_cells, int(symbols["s"]), int(symbols["S"]))

    def place_lights(self, light_cells, short_green, long_green):
        """'s' lights are green for the first s steps of the cycle, 'S' for the rest."""
        cycle = short_green + long_green
        for pos, char in light_cells.items():
            if char == "s":
                offset, green = 0, short_green
            else:
                offset, green = short_green, long_green
            light = Traffic_Light(self, self.grid[pos], offset, green, cycle)
            self.traffic_lights.append(light)

    def place_ambulances(self, count):
        """
        Picks the hospital, the building nearest the map centre. The ambulances park
        on its roof and on the building next to it. Also finds the road cells next
        to every other building where an ambulance may land.
        """
        # The island around a monument is a garden, not a building.
        buildings = []
        for x, y in self.buildings:
            if all(abs(x - mx) > 2 or abs(y - my) > 2 for mx, my in self.monuments):
                buildings.append((x, y))

        centre = ((self.width - 1) / 2, (self.height - 1) / 2)
        self.hospital = min(
            buildings, key=lambda b: (math.dist(b, centre), b), default=None
        )
        self.helipads = []
        if self.hospital is not None:
            by_distance = sorted(
                buildings, key=lambda b: (math.dist(b, self.hospital), b)
            )
            self.helipads = by_distance[:count]
        self.ambulances = [Ambulance(self, pad) for pad in self.helipads]

        # Landing cells are plain roads (not lights or spawn corners).
        not_allowed = set(self.spawn_points)
        for light in self.traffic_lights:
            not_allowed.add(light.cell.coordinate)
        self.landing_spots = {}
        for building in buildings:
            if building == self.hospital or building in self.helipads:
                continue
            spots = []
            for move in DIRECTION_VECTORS.values():
                spot = step(building, move)
                if spot in self.drivable and spot not in not_allowed:
                    spots.append(spot)
            if spots:
                self.landing_spots[building] = tuple(spots)

    def free_landing_spots(self, building):
        return [
            s for s in self.landing_spots.get(building, ()) if s not in self.reserved
        ]

    def route(self, start, goal, avoid=frozenset()):
        return shortest_route(self.graph, start, goal, avoid)

    def has_car(self, pos):
        return any(isinstance(agent, Car) for agent in self.grid[pos].agents)

    def light_at(self, pos):
        for agent in self.grid[pos].agents:
            if isinstance(agent, Traffic_Light):
                return agent
        return None

    @property
    def cars(self):
        """Cars and motorcycles."""
        return self.agents.select(agent_type=Car)

    @property
    def active_cars(self):
        return len(self.cars)

    def spawn_cars(self):
        """Puts a car on each free corner, up to cars_per_spawn. Returns how many."""
        free = [
            s for s in self.spawn_points if self.reachable[s] and not self.has_car(s)
        ]
        starts = free[: self.cars_per_spawn]
        for start in starts:
            destination = self.random.choice(self.reachable[start])
            vehicle = Motorcycle if self.random.random() < MOTORCYCLE_SHARE else Car
            vehicle(self, self.grid[start], destination, self.drivable[start])
        self.spawned += len(starts)
        return len(starts)

    def move_cars(self):
        """Every car moves at most one cell, in random order. A car blocked by the car
        ahead tries again once that car has moved, so a whole queue can advance."""
        waiting = list(self.cars)
        self.random.shuffle(waiting)
        for car in waiting:
            car.age += 1
        while waiting:
            still_waiting = [car for car in waiting if not car.try_drive()]
            if len(still_waiting) == len(waiting):
                break  # nobody moved, so nobody else will
            waiting = still_waiting
        for car in waiting:
            car.hold()

    def open_emergency(self):
        """Opens an emergency at a random building with a free landing cell."""
        current = self.agents_by_type.get(Emergency, [])
        if len(current) >= MAX_OPEN_EMERGENCIES:
            return
        taken = {e.cell.coordinate for e in current}
        candidates = []
        for building in self.landing_spots:
            if building not in taken and self.free_landing_spots(building):
                candidates.append(building)
        if candidates:
            emergency = Emergency(self, self.grid[self.random.choice(candidates)])
            self.emit("emergency", emergency.unique_id, emergency.cell.coordinate)

    def emit(self, event_type, agent_id, at=None):
        """Adds an event for /step, with the cell it happened at as (x, z)."""
        event = {"type": event_type, "id": str(agent_id)}
        if at is not None:
            event["x"], event["z"] = at
        self.events.append(event)

    def record_arrival(self, car):
        self.emit("arrived", car.unique_id)
        self.arrived += 1
        self.arrived_trip_steps += car.age
        self.arrived_wait_steps += car.wait_steps

    def vehicles(self):
        return [a.frame() for a in self.agents if isinstance(a, (Car, Ambulance))]

    def stats(self):
        """Averages cover arrived cars only, and are None until one arrives."""
        avg_trip = avg_wait = None
        if self.arrived:
            avg_trip = self.arrived_trip_steps / self.arrived
            avg_wait = self.arrived_wait_steps / self.arrived
        return {
            "step": self.steps,
            "running": self.running,
            "stopReason": self.stop_reason,
            "spawned": self.spawned,
            "arrived": self.arrived,
            "active": self.active_cars,
            "avgTripSteps": avg_trip,
            "avgWaitSteps": avg_wait,
            "emergenciesServed": self.emergencies_served,
        }

    def step(self):
        """Lights change first, then ambulances move (so cars see their reservations),
        then cars move, then new cars and emergencies appear."""
        self.events = []
        for light in self.traffic_lights:
            light.step()
        for ambulance in self.ambulances:
            ambulance.step()
        self.move_cars()

        if self.steps % self.spawn_interval == 0 and self.spawn_cars() == 0:
            self.running = False
            if any(self.reachable.values()):
                self.stop_reason = "every spawn corner is occupied"
            else:
                self.stop_reason = "no spawn corner can reach a destination"

        if self.steps % EMERGENCY_INTERVAL == 0:
            chance = self.emergency_chance
            if chance >= 1 or self.random.random() < chance:
                self.open_emergency()
