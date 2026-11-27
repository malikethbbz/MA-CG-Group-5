import json
import logging
from pathlib import Path

import networkx as nx
from mesa import Model
from mesa.discrete_space import OrthogonalMooreGrid

from .agent import Car, Destination, Monument, Motorcycle, Obstacle, Road, Traffic_Light
from .ambulance import (
    EMERGENCY_INTERVAL,
    Ambulance,
    choose_helipads,
    maybe_open_emergency,
    static_landing_spots,
)
from .city_graph import (
    DIRECTION_VECTORS,
    build_street_graph,
    infer_light_directions,
    shortest_route,
)

logger = logging.getLogger(__name__)

CITY_FILES = Path(__file__).resolve().parent.parent / "city_files"
DEFAULT_MAP = "2025_base.txt"  # the assignment's map; 2025_reforma.txt adds a glorieta
SPAWN_INTERVAL = 10  # the assignment's rate; denser runs pass spawn_interval
MAX_SPAWN_INTERVAL = 10
MOTORCYCLE_SHARE = 0.3  # chance a spawned vehicle is a motorcycle
SPAWN_MODES = ("corners", "edges")
# Cars an edges-mode spawn step adds at most. With spawn_interval 1 this is 3 cars a
# step, about what the 2025 maps can drain now that queues move together; 4 a step
# gridlocks within ~300 steps.
EDGE_SPAWNS_PER_STEP = 3
# Agents a single cell can hold; a road cell holds the road, maybe a light, and a car.
CELL_CAPACITY = 100


class CityModel(Model):
    """
    Creates a model based on a city map. Every spawn_interval steps cars appear at
    the spawn points, and they are removed at their destination. The run stops when
    a spawn step cannot place any car. Two ambulances serve emergencies that open
    every EMERGENCY_INTERVAL steps; they do not count as cars for spawning, stats or
    stopping.

    spawn_points picks where cars appear:
    - "corners" (the assignment's rule): one car on each free map corner.
    - "edges": every border road cell that is not a light and reaches a destination
      is a spawn point. A spawn step fills up to EDGE_SPAWNS_PER_STEP free points,
      chosen at random, so denser traffic does not flood the whole border at once.

    Args:
        map_name: Map file inside map_dir
        seed: Random seed for the model
        map_dir: Folder with the map files and mapDictionary.json
        spawn_interval: Steps between spawns, 1 to MAX_SPAWN_INTERVAL
        spawn_points: "corners" or "edges"
    """

    def __init__(
        self,
        map_name=DEFAULT_MAP,
        seed=42,
        map_dir=CITY_FILES,
        spawn_interval=SPAWN_INTERVAL,
        spawn_points="corners",
    ):
        if not 1 <= spawn_interval <= MAX_SPAWN_INTERVAL:
            raise ValueError(
                f"spawn_interval must be 1..{MAX_SPAWN_INTERVAL}, not {spawn_interval}"
            )
        if spawn_points not in SPAWN_MODES:
            raise ValueError(f"spawn_points must be one of {SPAWN_MODES}")
        super().__init__(rng=seed)
        self.spawn_interval = spawn_interval
        self.spawn_mode = spawn_points

        # Load the map dictionary. It maps each character of the map file to what is
        # on that cell.
        with open(map_dir / "mapDictionary.json") as dictionary_file:
            symbols = json.load(dictionary_file)

        # Load the map file. Each character is one cell; blank lines are skipped.
        with open(map_dir / map_name) as map_file:
            lines = []
            for line in map_file.read().splitlines():
                if line.strip():
                    lines.append(line.strip())
        if not lines:
            raise ValueError(f"map {map_name} is empty")

        self.width = len(lines[0])
        self.height = len(lines)
        self.grid = OrthogonalMooreGrid(
            [self.width, self.height],
            capacity=CELL_CAPACITY,
            torus=False,
            random=self.random,
        )

        self.traffic_lights = []
        self.destinations = []
        self.buildings = []
        self.monuments = []
        self.reserved = set()  # road cells held by a landing ambulance
        self.emergencies_served = 0
        self.spawned = 0
        self.arrived = 0
        self.arrived_trip_steps = 0
        self.arrived_wait_steps = 0
        self.stop_reason = None
        self.events = []  # what happened during the latest step

        road_dirs, light_cells = self.place_map(lines, symbols)

        # Lights are placed after the roads, since their direction comes from the
        # road that feeds them. drivable has every road or light cell and its
        # direction vector.
        light_dirs = infer_light_directions(road_dirs, list(light_cells))
        self.drivable = {**road_dirs, **light_dirs}
        self.place_lights(light_cells, symbols)

        self.graph = build_street_graph(self.drivable, set(self.destinations))
        self.reachable = self.find_spawn_points()
        self.spawn_points = list(self.reachable)
        self.place_ambulances()
        self.running = True
        self.spawn_cars()

    def place_map(self, lines, symbols):
        """
        Goes through each character in the map and creates the matching agent.
        Lights are only collected here; place_lights creates them later.
        Returns the road directions and the light cells.
        """
        road_dirs = {}
        light_cells = {}
        for r, row in enumerate(lines):
            for c, char in enumerate(row):
                pos = (c, self.height - r - 1)  # file row 0 is the top; y=0 the bottom
                cell = self.grid[pos]
                if char not in symbols:
                    # A typo would otherwise leave a silent hole in the city.
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
                # Any other symbol in the dictionary (tiny test maps use '.') is open
                # ground and gets no agent.
        return road_dirs, light_cells

    def place_lights(self, light_cells, symbols):
        """
        Creates the traffic lights. One cycle lasts s + S steps: the 's' lights are
        green on [0, s) and the 'S' lights on [s, s + S).
        """
        short_green = int(symbols["s"])
        long_green = int(symbols["S"])
        cycle = short_green + long_green
        for pos, char in light_cells.items():
            if char == "s":
                light = Traffic_Light(self, self.grid[pos], 0, short_green, cycle)
            else:
                light = Traffic_Light(
                    self, self.grid[pos], short_green, long_green, cycle
                )
            self.traffic_lights.append(light)

    def light_cells(self):
        cells = set()
        for light in self.traffic_lights:
            cells.add(light.cell.coordinate)
        return cells

    def find_spawn_points(self):
        """Returns each spawn point with the list of destinations it can reach."""
        spawns = {}
        if self.spawn_mode == "edges":
            # Border road cells that are not lights. A border cell that only leads
            # off the map is plain road, not a spawn.
            lights = self.light_cells()
            for x, y in self.drivable:
                on_border = x in (0, self.width - 1) or y in (0, self.height - 1)
                if not on_border or (x, y) in lights:
                    continue
                goals = self.reachable_from((x, y))
                if goals:
                    spawns[(x, y)] = goals
            return spawns

        corners = [
            (0, 0),
            (self.width - 1, 0),
            (0, self.height - 1),
            (self.width - 1, self.height - 1),
        ]
        for corner in corners:
            # A one-row or one-column map repeats corners; keep each once.
            if corner not in self.drivable or corner in spawns:
                continue
            spawns[corner] = self.reachable_from(corner)
            if not spawns[corner]:
                logger.warning("spawn corner %s cannot reach any destination", corner)
        return spawns

    def reachable_from(self, start):
        descendants = nx.descendants(self.graph, start)
        goals = []
        for destination in self.destinations:
            if destination in descendants:
                goals.append(destination)
        return goals

    def plaza(self):
        """Obstacle cells connected (up, down, left, right) to a monument: its
        roundabout island. A plaza with no building on it."""
        buildings = set(self.buildings)
        plaza = set()
        frontier = list(self.monuments)
        while frontier:
            x, y = frontier.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                neighbor = (x + dx, y + dy)
                if neighbor in buildings and neighbor not in plaza:
                    plaza.add(neighbor)
                    frontier.append(neighbor)
        return plaza

    def place_ambulances(self):
        """One ambulance per helipad. Helipads never host an emergency; any other
        building can if it has a landing spot. A monument's plaza is not a building."""
        plaza = self.plaza()
        buildings = [b for b in self.buildings if b not in plaza]
        self.helipads = choose_helipads(buildings, self.width, self.height)
        self.ambulances = []
        for pad in self.helipads:
            self.ambulances.append(Ambulance(self, pad))

        lights = self.light_cells()
        spawns = set(self.spawn_points)
        self.landing_spots = {}
        for building in buildings:
            if building in self.helipads:
                continue
            spots = static_landing_spots(building, self.drivable, lights, spawns)
            if spots:
                self.landing_spots[building] = spots

    def route(self, start, goal, avoid=frozenset()):
        return shortest_route(self.graph, start, goal, avoid)

    def has_car(self, pos):
        """Whether a car (or motorcycle) is on the cell."""
        return any(isinstance(agent, Car) for agent in self.grid[pos].agents)

    @property
    def cars(self):
        """Cars and motorcycles. agents_by_type would miss the Car subclasses."""
        return self.agents.select(agent_type=Car)

    @property
    def active_cars(self):
        return len(self.cars)

    def spawn_cars(self):
        """Puts a car on the free spawn points. Returns how many cars it placed."""
        starts = []
        for start in self.spawn_points:
            if not self.has_car(start) and self.reachable[start]:
                starts.append(start)
        if self.spawn_mode == "edges":
            starts = self.random.sample(starts, min(len(starts), EDGE_SPAWNS_PER_STEP))

        for start in starts:
            destination = self.random.choice(self.reachable[start])
            if self.random.random() < MOTORCYCLE_SHARE:
                Motorcycle(self, self.grid[start], destination, self.drivable[start])
            else:
                Car(self, self.grid[start], destination, self.drivable[start])
        self.spawned += len(starts)
        return len(starts)

    def move_cars(self):
        """
        Every car moves at most one cell, in random order, but a car blocked by the
        car ahead gets another try once that car has moved. Without the retries a
        queue only advanced where its cars happened to be drawn front to back, so a
        line at a green light crept forward one car per step.
        """
        cars = list(self.cars)
        self.random.shuffle(cars)
        for car in cars:
            car.begin_step()

        waiting = cars
        while waiting:
            still_waiting = []
            for car in waiting:
                if not car.try_drive():
                    still_waiting.append(car)
            if len(still_waiting) == len(waiting):
                break  # nobody moved this round, so nobody else will
            waiting = still_waiting

        for car in waiting:
            car.hold()

    def emit(self, event_type, agent_id, at=None):
        """Adds an event for /step. Emergency and ambulance events also carry the
        cell they happened at, sent as (x, z)."""
        event = {"type": event_type, "id": str(agent_id)}
        if at is not None:
            event["x"], event["z"] = at
        self.events.append(event)

    def record_arrival(self, car, trip_steps, wait_steps):
        self.emit("arrived", car.unique_id)
        self.arrived += 1
        self.arrived_trip_steps += trip_steps
        self.arrived_wait_steps += wait_steps

    def vehicles(self):
        """The frame of every moving agent (cars, motorcycles and ambulances)."""
        frames = []
        for agent in self.agents:
            if isinstance(agent, (Car, Ambulance)):
                frames.append(agent.frame())
        return frames

    def stats(self):
        """Body of /getStatus. Averages cover arrived cars only and are None until
        one arrives."""
        avg_trip = None
        avg_wait = None
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
        """
        Advance the model by one step. Lights change first so cars see this step's
        colors, then ambulances move so cars see this step's reservations, then cars
        move, then cars spawn and emergencies open. Mesa has already incremented
        self.steps when this runs.
        """
        self.events = []
        for light in self.traffic_lights:
            light.step()
        for ambulance in self.ambulances:
            ambulance.step()
        self.move_cars()

        if self.steps % self.spawn_interval == 0 and self.spawn_cars() == 0:
            self.running = False
            noun = "corner" if self.spawn_mode == "corners" else "point"
            if not any(self.reachable.values()):
                self.stop_reason = f"no spawn {noun} can reach a destination"
            else:
                self.stop_reason = f"every spawn {noun} is occupied"
            logger.warning(
                "simulation stopped at step %s: %s", self.steps, self.stop_reason
            )

        if self.steps % EMERGENCY_INTERVAL == 0:
            maybe_open_emergency(self)
