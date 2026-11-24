import json
import logging
from collections.abc import Set
from pathlib import Path
from typing import TypedDict

import networkx as nx
from mesa import Model
from mesa.discrete_space import OrthogonalMooreGrid

from .agent import Car, Destination, Obstacle, Road, Traffic_Light
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
DEFAULT_MAP = "2025_base.txt"
SPAWN_INTERVAL = 10
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


class CityModel(Model):
    """City built from a map file. Cars appear at the map corners every SPAWN_INTERVAL
    steps and are removed at their destination. The run stops when a spawn step cannot
    place any car.
    """

    def __init__(
        self, map_name: str = DEFAULT_MAP, seed: int = 42, map_dir: Path = CITY_FILES
    ) -> None:
        super().__init__(rng=seed)
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
        self.helipads: list[Position] = []  # ambulance homes, filled once they exist
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
        self.spawn_points = self._corner_spawns()
        self.reachable = {
            start: self._reachable_from(start) for start in self.spawn_points
        }
        self.running = True
        self._spawn_cars()

    def _place_map(
        self, lines: list[str], symbols: dict[str, str | int]
    ) -> tuple[Drivable, dict[Position, str]]:
        road_dirs: Drivable = {}
        light_cells: dict[Position, str] = {}
        for r, row in enumerate(lines):
            for c, char in enumerate(row):
                pos = (
                    c,
                    self.height - r - 1,
                )  # file row 0 is the top; grid y=0 is the bottom
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

    def _reachable_from(self, start: Position) -> list[Position]:
        descendants = nx.descendants(self.graph, start)
        reachable = [d for d in self.destinations if d in descendants]
        if not reachable:
            logger.warning("spawn corner %s cannot reach any destination", start)
        return reachable

    def route(
        self, start: Position, goal: Position, avoid: Set[Position] = frozenset()
    ) -> list[Position]:
        return shortest_route(self.graph, start, goal, avoid)

    def _is_free(self, pos: Position) -> bool:
        return not any(isinstance(a, Car) for a in self.grid[pos].agents)

    def _spawn_cars(self) -> int:
        placed = 0
        for start in self.spawn_points:
            if self._is_free(start) and self.reachable[start]:
                destination = self.random.choice(self.reachable[start])
                Car(self, self.grid[start], destination, self.drivable[start])
                placed += 1
        self.spawned += placed
        return placed

    def _why_no_spawn(self) -> str:
        if not any(self.reachable.values()):
            return "no spawn corner can reach a destination"
        return "every spawn corner is occupied"

    def emit(self, event_type: str, agent_id: int) -> None:
        self.events.append({"type": event_type, "id": str(agent_id)})

    def vehicles(self) -> list[VehicleFrame]:
        return [agent.frame() for agent in self.agents if isinstance(agent, Vehicle)]

    def record_arrival(self, car: Car, trip_steps: int, wait_steps: int) -> None:
        self.emit("arrived", car.unique_id)
        self.arrived += 1
        self.arrived_trip_steps += trip_steps
        self.arrived_wait_steps += wait_steps

    @property
    def active_cars(self) -> int:
        return len(self.agents_by_type.get(Car, []))

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
        }

    def step(self) -> None:
        """Lights change first so cars see this step's colors, then cars move, then
        cars spawn. Mesa has already incremented self.steps when this runs."""
        self.events = []
        for light in self.traffic_lights:
            light.step()
        if Car in self.agents_by_type:
            self.agents_by_type[Car].shuffle_do("step")
        if self.steps % SPAWN_INTERVAL == 0 and self._spawn_cars() == 0:
            self.running = False
            self.stop_reason = self._why_no_spawn()
            logger.warning(
                "simulation stopped at step %s: %s", self.steps, self.stop_reason
            )
