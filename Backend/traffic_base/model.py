import json
import logging
from collections.abc import Set
from pathlib import Path
from typing import Literal, TypedDict, get_args

import networkx as nx
from mesa import Model
from mesa.agent import AgentSet
from mesa.discrete_space import OrthogonalMooreGrid

from .agent import (
    Car,
    Destination,
    Monument,
    Motorcycle,
    Obstacle,
    Road,
    Traffic_Light,
)
from .ambulance import (
    EMERGENCY_INTERVAL,
    Ambulance,
    car_on,
    choose_helipads,
    maybe_open_emergency,
    static_landing_spots,
)
from .city_graph import (
    DIRECTION_VECTORS,
    Drivable,
    Position,
    build_street_graph,
    infer_light_directions,
    shortest_route,
)
from .vehicle import Event, Vehicle, VehicleFrame

logger = logging.getLogger(__name__)

CITY_FILES = Path(__file__).resolve().parent.parent / "city_files"
DEFAULT_MAP = "2025_base.txt"  # the assignment's map; 2025_reforma.txt adds a glorieta
SPAWN_INTERVAL = 10  # the assignment's rate; denser runs pass spawn_interval
MAX_SPAWN_INTERVAL = 10
MOTORCYCLE_SHARE = 0.3  # chance a spawned vehicle is a motorcycle
SpawnPoints = Literal["corners", "edges"]
SPAWN_MODES: tuple[str, ...] = get_args(SpawnPoints)
# Cars an edges-mode spawn step adds at most. With spawn_interval 1 this is 2 cars a
# step, about what the 2025 maps can drain; 3 a step, or 4 every other step, gridlocks.
EDGE_SPAWNS_PER_STEP = 2
SPAWN_NOUN = {"corners": "corner", "edges": "point"}
ROAD_SYMBOLS = "<>^v"
LIGHT_SYMBOLS = "sS"
# Agents a single cell can hold; a road cell holds the road, maybe a light, and a car.
CELL_CAPACITY = 100


class Stats(TypedDict):
    """Body of /getStatus. Averages cover arrived cars only and are None until one
    arrives."""

    step: int
    running: bool
    stopReason: str | None
    spawned: int
    arrived: int
    active: int
    avgTripSteps: float | None
    avgWaitSteps: float | None
    emergenciesServed: int


class CityModel(Model):
    """City built from a map file. Every spawn_interval steps cars appear at the spawn
    points and are removed at their destination. The run stops when a spawn step cannot
    place any car. Two ambulances serve emergencies that open every
    EMERGENCY_INTERVAL steps; they are not cars for spawning, stats or stopping.

    spawn_points picks where cars appear:
    - "corners" (the assignment's rule): one car on each free map corner.
    - "edges": every border road cell that is not a light and reaches a destination
      is a spawn point. A spawn step fills up to EDGE_SPAWNS_PER_STEP free points,
      chosen at random, so denser traffic does not flood the whole border at once.
    """

    def __init__(
        self,
        map_name: str = DEFAULT_MAP,
        seed: int = 42,
        map_dir: Path = CITY_FILES,
        spawn_interval: int = SPAWN_INTERVAL,
        spawn_points: SpawnPoints = "corners",
    ) -> None:
        if not 1 <= spawn_interval <= MAX_SPAWN_INTERVAL:
            raise ValueError(
                f"spawn_interval must be 1..{MAX_SPAWN_INTERVAL}, not {spawn_interval}"
            )
        if spawn_points not in SPAWN_MODES:
            raise ValueError(f"spawn_points must be one of {SPAWN_MODES}")
        super().__init__(rng=seed)
        self.spawn_interval = spawn_interval
        self.spawn_mode = spawn_points
        symbols = json.loads((map_dir / "mapDictionary.json").read_text())
        lines = [
            line.strip()
            for line in (map_dir / map_name).read_text().splitlines()
            if line.strip()
        ]
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
        self.traffic_lights: list[Traffic_Light] = []
        self.destinations: list[Position] = []
        self.buildings: list[Position] = []
        self.monuments: list[Position] = []
        self.reserved: set[Position] = set()  # road cells held by a landing ambulance
        self.emergencies_served = 0
        self.spawned = 0
        self.arrived = 0
        self.arrived_trip_steps = 0
        self.arrived_wait_steps = 0
        self.stop_reason: str | None = None
        self.events: list[Event] = []  # what happened during the latest step

        road_dirs, light_cells = self._place_map(lines, symbols)
        light_dirs = infer_light_directions(road_dirs, list(light_cells))
        self.drivable: Drivable = {**road_dirs, **light_dirs}
        self._place_lights(light_cells, symbols)
        self.graph = build_street_graph(self.drivable, set(self.destinations))
        self.reachable = self._find_spawn_points()
        self.spawn_points = list(self.reachable)
        self._place_ambulances({t.cell.coordinate for t in self.traffic_lights})
        self.running = True
        self._spawn_cars()

    def _place_map(
        self, lines: list[str], symbols: dict[str, str | int]
    ) -> tuple[Drivable, dict[Position, str]]:
        road_dirs: Drivable = {}
        light_cells: dict[Position, str] = {}
        for r, row in enumerate(lines):
            for c, char in enumerate(row):
                pos = (c, self.height - r - 1)  # file row 0 is the top; y=0 the bottom
                if char not in symbols:
                    # A typo would otherwise leave a silent hole in the city.
                    raise ValueError(
                        f"map symbol {char!r} at row {r}, column {c} is not in "
                        "mapDictionary.json"
                    )
                if char in ROAD_SYMBOLS:
                    Road(self, self.grid[pos], symbols[char])
                    road_dirs[pos] = DIRECTION_VECTORS[symbols[char]]
                elif char in LIGHT_SYMBOLS:
                    light_cells[pos] = char
                else:
                    self._place_fixed(char, pos)
        return road_dirs, light_cells

    def _place_fixed(self, char: str, pos: Position) -> None:
        """Buildings, destinations and monuments. Any other symbol the dictionary
        declares (tiny test maps use '.') is open ground and gets no agent."""
        cell = self.grid[pos]
        if char == "#":
            Obstacle(self, cell)
            self.buildings.append(pos)
        elif char == "D":
            Destination(self, cell)
            self.destinations.append(pos)
        elif char == "A":
            Monument(self, cell)
            self.monuments.append(pos)

    def _place_lights(
        self, light_cells: dict[Position, str], symbols: dict[str, str | int]
    ) -> None:
        # One cycle of s + S steps: 's' is green on [0, s), 'S' on [s, s + S).
        short_green, long_green = int(symbols["s"]), int(symbols["S"])
        cycle = short_green + long_green
        slots = {"s": (0, short_green), "S": (short_green, long_green)}
        for pos, char in light_cells.items():
            offset, green = slots[char]
            light = Traffic_Light(self, self.grid[pos], offset, green, cycle)
            self.traffic_lights.append(light)

    def _corner_spawns(self) -> list[Position]:
        corners = [
            (0, 0),
            (self.width - 1, 0),
            (0, self.height - 1),
            (self.width - 1, self.height - 1),
        ]
        # dict.fromkeys drops repeated corners on one-row or one-column maps.
        return [c for c in dict.fromkeys(corners) if c in self.drivable]

    def _edge_spawns(self) -> list[Position]:
        """Border road cells that are not lights. Destinations are never drivable."""
        lights = {t.cell.coordinate for t in self.traffic_lights}
        return [
            (x, y)
            for (x, y) in self.drivable
            if (x in (0, self.width - 1) or y in (0, self.height - 1))
            and (x, y) not in lights
        ]

    def _find_spawn_points(self) -> dict[Position, list[Position]]:
        """Each spawn point with the destinations it reaches."""
        if self.spawn_mode == "edges":
            # A border cell that only leads off the map is plain road, not a spawn.
            edges = {
                start: self._reachable_from(start) for start in self._edge_spawns()
            }
            return {start: goals for start, goals in edges.items() if goals}
        corners = {
            start: self._reachable_from(start) for start in self._corner_spawns()
        }
        for start, goals in corners.items():
            if not goals:
                logger.warning("spawn corner %s cannot reach any destination", start)
        return corners

    def _place_ambulances(self, lights: set[Position]) -> None:
        """One ambulance per helipad. Helipads never host an emergency; any other
        building can if it has a landing spot."""
        self.helipads = choose_helipads(self.buildings, self.width, self.height)
        self.ambulances = [Ambulance(self, pad) for pad in self.helipads]
        spawns = set(self.spawn_points)
        spots = {
            building: static_landing_spots(building, self.drivable, lights, spawns)
            for building in self.buildings
            if building not in self.helipads
        }
        self.landing_spots = {b: s for b, s in spots.items() if s}

    def _reachable_from(self, start: Position) -> list[Position]:
        descendants = nx.descendants(self.graph, start)
        return [d for d in self.destinations if d in descendants]

    def route(
        self, start: Position, goal: Position, avoid: Set[Position] = frozenset()
    ) -> list[Position]:
        return shortest_route(self.graph, start, goal, avoid)

    def _is_free(self, pos: Position) -> bool:
        return not car_on(self, pos)

    def _spawn_cars(self) -> int:
        starts = [
            s for s in self.spawn_points if self._is_free(s) and self.reachable[s]
        ]
        if self.spawn_mode == "edges":
            starts = self.random.sample(starts, min(len(starts), EDGE_SPAWNS_PER_STEP))
        for start in starts:
            destination = self.random.choice(self.reachable[start])
            vehicle = Motorcycle if self.random.random() < MOTORCYCLE_SHARE else Car
            vehicle(self, self.grid[start], destination, self.drivable[start])
        self.spawned += len(starts)
        return len(starts)

    def _why_no_spawn(self) -> str:
        noun = SPAWN_NOUN[self.spawn_mode]
        if not any(self.reachable.values()):
            return f"no spawn {noun} can reach a destination"
        return f"every spawn {noun} is occupied"

    def emit(self, event_type: str, agent_id: int, at: Position | None = None) -> None:
        event: Event = {"type": event_type, "id": str(agent_id)}
        if at is not None:
            event["x"], event["z"] = at
        self.events.append(event)

    def vehicles(self) -> list[VehicleFrame]:
        return [agent.frame() for agent in self.agents if isinstance(agent, Vehicle)]

    def record_arrival(self, car: Car, trip_steps: int, wait_steps: int) -> None:
        self.emit("arrived", car.unique_id)
        self.arrived += 1
        self.arrived_trip_steps += trip_steps
        self.arrived_wait_steps += wait_steps

    @property
    def cars(self) -> AgentSet:
        """Cars and motorcycles; agents_by_type would miss the Car subclasses."""
        return self.agents.select(agent_type=Car)

    @property
    def active_cars(self) -> int:
        return len(self.cars)

    def stats(self) -> Stats:
        def average(total: int) -> float | None:
            return total / self.arrived if self.arrived else None

        return {
            "step": self.steps,
            "running": self.running,
            "stopReason": self.stop_reason,
            "spawned": self.spawned,
            "arrived": self.arrived,
            "active": self.active_cars,
            "avgTripSteps": average(self.arrived_trip_steps),
            "avgWaitSteps": average(self.arrived_wait_steps),
            "emergenciesServed": self.emergencies_served,
        }

    def step(self) -> None:
        """Lights change first so cars see this step's colors, then ambulances move so
        cars see this step's reservations, then cars move, then cars spawn and
        emergencies open. Mesa has already incremented self.steps when this runs."""
        self.events = []
        for light in self.traffic_lights:
            light.step()
        for ambulance in self.ambulances:
            ambulance.step()
        self.cars.shuffle_do("step")
        if self.steps % self.spawn_interval == 0 and self._spawn_cars() == 0:
            self.running = False
            self.stop_reason = self._why_no_spawn()
            logger.warning(
                "simulation stopped at step %s: %s", self.steps, self.stop_reason
            )
        if self.steps % EMERGENCY_INTERVAL == 0:
            maybe_open_emergency(self)
