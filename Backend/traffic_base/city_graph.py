"""Directed street graph built from the city map, and A* routing over it."""

import math
from collections.abc import Set
from typing import Literal

import networkx as nx

Position = tuple[
    int, int
]  # grid cell (x, y); y grows upward, row 0 of the file is the top
Vector = tuple[int, int]  # a direction or a one-cell move (dx, dy)
Direction = Literal["Up", "Down", "Left", "Right"]
Drivable = dict[
    Position, Vector
]  # every road or light cell and the direction it points

DIRECTION_VECTORS: dict[Direction, Vector] = {
    "Up": (0, 1),
    "Down": (0, -1),
    "Right": (1, 0),
    "Left": (-1, 0),
}

NEIGHBOR_OFFSETS: list[Vector] = [
    (dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx, dy) != (0, 0)
]

STRAIGHT_COST = 1.0
DIAGONAL_COST = math.sqrt(2)
SIDEWAYS_COST = 1.5  # dearer than a diagonal, so cars only slide sideways to cross


def step(pos: Position, move: Vector) -> Position:
    return (pos[0] + move[0], pos[1] + move[1])


def _dot(a: Vector, b: Vector) -> int:
    return a[0] * b[0] + a[1] * b[1]


def is_legal_move(move: Vector, from_dir: Vector, to_dir: Vector) -> bool:
    """A move may not point backwards against either cell's direction, and may not
    enter the opposite lane.

    Moving down from an 'Up' cell is illegal. Sideways moves are legal: that is how a
    car on a 'v' column crosses a row of '<' cells at an intersection.
    """
    if _dot(move, from_dir) < 0 or _dot(move, to_dir) < 0:
        return False
    return to_dir != (-from_dir[0], -from_dir[1])


def move_cost(move: Vector, from_dir: Vector) -> float:
    if move == from_dir:
        return STRAIGHT_COST
    if _dot(move, from_dir) > 0:
        return DIAGONAL_COST
    return SIDEWAYS_COST


def infer_light_directions(road_dirs: Drivable, lights: list[Position]) -> Drivable:
    """A light sits on a road, so it points the same way as the road cell feeding it.

    Lights can feed other lights, so this repeats until every light is resolved.
    """
    known = dict(road_dirs)
    pending = set(lights)
    while pending:
        resolved = {
            light: direction
            for light in pending
            for direction in DIRECTION_VECTORS.values()
            if known.get(step(light, (-direction[0], -direction[1]))) == direction
        }
        if not resolved:
            raise ValueError(
                f"cannot infer a direction for lights at {sorted(pending)}"
            )
        known.update(resolved)
        pending -= resolved.keys()
    return {light: known[light] for light in lights}


def _clears_corners(start: Position, move: Vector, drivable: Drivable) -> bool:
    """A diagonal move passes between two cells; both must be road, so cars never clip
    a building corner."""
    if 0 in move:
        return True
    return (
        step(start, (move[0], 0)) in drivable and step(start, (0, move[1])) in drivable
    )


def build_street_graph(drivable: Drivable, destinations: Set[Position]) -> nx.DiGraph:
    """Nodes are drivable cells and destinations. A destination is entered straight from
    any side (never diagonally) and has no outgoing edges."""
    graph = nx.DiGraph()
    graph.add_nodes_from(drivable)
    graph.add_nodes_from(destinations)
    for pos, from_dir in drivable.items():
        for move in NEIGHBOR_OFFSETS:
            target = step(pos, move)
            if target in destinations and 0 in move:
                graph.add_edge(pos, target, weight=STRAIGHT_COST)
            elif (
                target in drivable
                and is_legal_move(move, from_dir, drivable[target])
                and _clears_corners(pos, move, drivable)
            ):
                graph.add_edge(pos, target, weight=move_cost(move, from_dir))
    return graph


def _octile(a: Position, b: Position) -> float:
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return max(dx, dy) + (DIAGONAL_COST - 1) * min(dx, dy)


def shortest_route(
    graph: nx.DiGraph,
    start: Position,
    goal: Position,
    avoid: Set[Position] = frozenset(),
) -> list[Position]:
    """A* route from start (excluded) to goal (included); empty when there is no path.

    `avoid` lets a stuck car plan around cells that are currently blocked. A start or
    goal missing from the graph is a bug, so that error is not caught here.
    """
    view = nx.restricted_view(graph, set(avoid) - {start, goal}, []) if avoid else graph
    try:
        path = nx.astar_path(view, start, goal, heuristic=_octile, weight="weight")
    except nx.NetworkXNoPath:
        return []
    return path[1:]
