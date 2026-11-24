import json
from pathlib import Path

import networkx as nx
from mesa import Model
from mesa.discrete_space import OrthogonalMooreGrid

from .agent import Car, Destination, Obstacle, Road, Traffic_Light
from .city_graph import (
    DIRECTION_VECTORS,
    Position,
    build_street_graph,
    infer_light_directions,
    shortest_route,
)

CITY_FILES = Path(__file__).resolve().parent.parent / "city_files"
DEFAULT_MAP = "2025_base.txt"
SPAWN_INTERVAL = 10
ROAD_SYMBOLS = "<>^v"
LIGHT_SYMBOLS = "sS"


class CityModel(Model):
    """City built from a map file. Cars appear at the map corners every SPAWN_INTERVAL
    steps and are removed when they reach their destination. The simulation stops when
    a spawn step cannot place any car."""

    def __init__(
        self, map_name: str = DEFAULT_MAP, seed: int = 42, map_dir: Path = CITY_FILES
    ):
        super().__init__(rng=seed)
        symbols = json.loads((map_dir / "mapDictionary.json").read_text())
        lines = [
            line.strip()
            for line in (map_dir / map_name).read_text().splitlines()
            if line.strip()
        ]
        self.width = len(lines[0])
        self.height = len(lines)
        self.grid = OrthogonalMooreGrid(
            [self.width, self.height], capacity=100, torus=False, random=self.random
        )
        self.traffic_lights: list[Traffic_Light] = []
        self.destinations: list[Position] = []
        self.spawned = 0
        self.arrived = 0
        self.trip_steps = 0
        self.arrived_wait_steps = 0

        road_dirs, light_cells = self._place_map(lines, symbols)
        light_dirs = infer_light_directions(road_dirs, list(light_cells))
        self.drivable = {**road_dirs, **light_dirs}
        self._place_lights(light_cells, symbols)
        self.graph = build_street_graph(self.drivable, set(self.destinations))
        self.spawn_points = self._corner_spawns()
        self.reachable = {
            start: [d for d in self.destinations if d in descendants]
            for start in self.spawn_points
            for descendants in [nx.descendants(self.graph, start)]
        }
        self.running = True
        self._spawn_cars()

    def _place_map(self, lines: list[str], symbols: dict):
        road_dirs: dict[Position, tuple[int, int]] = {}
        light_cells: dict[Position, str] = {}
        for r, row in enumerate(lines):
            for c, char in enumerate(row):
                pos = (c, self.height - r - 1)
                cell = self.grid[pos]
                if char in ROAD_SYMBOLS:
                    Road(self, cell, symbols[char])
                    road_dirs[pos] = DIRECTION_VECTORS[symbols[char]]
                elif char in LIGHT_SYMBOLS:
                    light_cells[pos] = char
                elif char == "#":
                    Obstacle(self, cell)
                elif char == "D":
                    Destination(self, cell)
                    self.destinations.append(pos)
        return road_dirs, light_cells

    def _place_lights(self, light_cells: dict[Position, str], symbols: dict):
        # 's' is green first for its duration, then 'S' for its own.
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

    def route(
        self, start: Position, goal: Position, avoid: set[Position] = frozenset()
    ) -> list[Position]:
        return shortest_route(self.graph, start, goal, avoid)

    def _is_free(self, pos: Position) -> bool:
        return not any(isinstance(a, Car) for a in self.grid[pos].agents)

    def _spawn_cars(self) -> int:
        placed = 0
        for start in self.spawn_points:
            if not self._is_free(start):
                continue
            if not self.reachable[start]:
                continue
            destination = self.random.choice(self.reachable[start])
            Car(self, self.grid[start], destination, self.drivable[start])
            placed += 1
        self.spawned += placed
        return placed

    def car_arrived(self, car: Car):
        self.arrived += 1
        self.trip_steps += car.age
        self.arrived_wait_steps += car.wait_steps
        car.remove()

    @property
    def active_cars(self) -> int:
        return len(self.agents_by_type.get(Car, []))

    def stats(self) -> dict:
        return {
            "step": self.steps,
            "running": self.running,
            "spawned": self.spawned,
            "arrived": self.arrived,
            "active": self.active_cars,
            "avgTripSteps": self.trip_steps / self.arrived if self.arrived else 0,
            "avgWaitSteps": self.arrived_wait_steps / self.arrived if self.arrived else 0,
        }

    def step(self):
        """Lights change first so cars see this step's colors, then cars move, then spawn."""
        for light in self.traffic_lights:
            light.step()
        if Car in self.agents_by_type:
            self.agents_by_type[Car].shuffle_do("step")
        if self.steps % SPAWN_INTERVAL == 0 and self._spawn_cars() == 0:
            self.running = False
