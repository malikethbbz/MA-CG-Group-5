"""Directed street graph built from the city map, and A* routing over it.

A move from cell u to a neighbor v is legal when it never goes against the street:
the move must not point backwards relative to u's direction or v's direction, and v
must not be the opposite lane. This allows driving forward, diagonal lane changes, and
crossing straight through an intersection whose cells point across your path.
"""

import math

import networkx as nx

Position = tuple[int, int]

DIRECTION_VECTORS = {
    "Up": (0, 1),
    "Down": (0, -1),
    "Right": (1, 0),
    "Left": (-1, 0),
}

NEIGHBOR_OFFSETS = [
    (dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx, dy) != (0, 0)
]


def _dot(a: Position, b: Position) -> int:
    return a[0] * b[0] + a[1] * b[1]


def _is_opposite(a: Position, b: Position) -> bool:
    return a[0] == -b[0] and a[1] == -b[1]


def is_legal_move(move: Position, from_dir: Position, to_dir: Position) -> bool:
    if _dot(move, from_dir) < 0 or _dot(move, to_dir) < 0:
        return False
    return not _is_opposite(from_dir, to_dir)


def move_cost(move: Position, from_dir: Position) -> float:
    """Straight driving is cheapest, so routes only change lanes when it pays off."""
    if move == from_dir:
        return 1.0
    if _dot(move, from_dir) > 0:
        return math.sqrt(2)  # diagonal lane change
    return 1.5  # sideways: crossing an intersection or changing lane


def infer_light_directions(
    road_dirs: dict[Position, Position], lights: list[Position]
) -> dict[Position, Position]:
    """A traffic light sits on a road cell; it takes the direction of the road feeding it.

    Lights can come in rows (a light feeding another light), so this repeats until stable.
    """
    known = dict(road_dirs)
    pending = set(lights)
    while pending:
        resolved = {}
        for light in pending:
            for direction in DIRECTION_VECTORS.values():
                source = (light[0] - direction[0], light[1] - direction[1])
                if known.get(source) == direction:
                    resolved[light] = direction
                    break
        if not resolved:
            raise ValueError(f"cannot infer a direction for lights at {sorted(pending)}")
        known.update(resolved)
        pending -= resolved.keys()
    return {light: known[light] for light in lights}


def build_street_graph(
    drivable: dict[Position, Position], destinations: set[Position]
) -> nx.DiGraph:
    """Nodes are drivable cells and destinations; destinations are entered from any side
    and have no outgoing edges."""
    graph = nx.DiGraph()
    graph.add_nodes_from(drivable)
    graph.add_nodes_from(destinations)
    for (x, y), from_dir in drivable.items():
        for move in NEIGHBOR_OFFSETS:
            target = (x + move[0], y + move[1])
            if target in destinations and 0 in move:
                graph.add_edge((x, y), target, weight=1.0)
            elif target in drivable and is_legal_move(move, from_dir, drivable[target]):
                graph.add_edge((x, y), target, weight=move_cost(move, from_dir))
    return graph


def _octile(a: Position, b: Position) -> float:
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return max(dx, dy) + (math.sqrt(2) - 1) * min(dx, dy)


def shortest_route(
    graph: nx.DiGraph, start: Position, goal: Position, avoid: set[Position] = frozenset()
) -> list[Position]:
    """A* route from start (excluded) to goal (included); empty when unreachable.

    `avoid` lets a stuck car plan around cells that are currently blocked.
    """
    view = nx.restricted_view(graph, avoid - {start, goal}, []) if avoid else graph
    try:
        path = nx.astar_path(view, start, goal, heuristic=_octile, weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return []
    return path[1:]
