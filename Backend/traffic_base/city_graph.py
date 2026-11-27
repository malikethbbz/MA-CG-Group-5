"""Street graph built from the city map, and the A* routing the cars use.

Positions are grid cells (x, y), with y growing upward. Directions and moves are
vectors (dx, dy).
"""

import math

import networkx as nx

Position = tuple[int, int]
Vector = tuple[int, int]

DIRECTION_VECTORS = {"Up": (0, 1), "Down": (0, -1), "Right": (1, 0), "Left": (-1, 0)}
NEIGHBORS = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx, dy) != (0, 0)]
DIAGONAL_COST = math.sqrt(2)
SIDEWAYS_COST = 1.5  # dearer than a diagonal, so cars only slide sideways to cross


def step(pos, move):
    return (pos[0] + move[0], pos[1] + move[1])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def is_legal_move(move, from_dir, to_dir):
    """A move may not go backwards against either cell's direction, and may not enter
    the opposite lane. Sideways is fine: that is how a car crosses an intersection."""
    if dot(move, from_dir) < 0 or dot(move, to_dir) < 0:
        return False
    return to_dir != (-from_dir[0], -from_dir[1])


def infer_light_directions(road_dirs, lights):
    """A light points the same way as the cell that feeds it. Lights can feed other
    lights, so this repeats until every light has a direction."""
    known = dict(road_dirs)
    pending = set(lights)
    while pending:
        found = {}
        for light in pending:
            for d in DIRECTION_VECTORS.values():
                if known.get(step(light, (-d[0], -d[1]))) == d:
                    found[light] = d
        if not found:
            raise ValueError(
                f"cannot infer a direction for lights at {sorted(pending)}"
            )
        known.update(found)
        pending -= found.keys()
    return {light: known[light] for light in lights}


def build_street_graph(drivable, destinations):
    """
    Directed graph of the drivable cells. Destinations are entered straight from any
    side and have no exits. Diagonal moves need road on both cells they pass between,
    so cars never cut a building corner.
    Args:
        drivable: Dictionary of every road or light cell -> its direction vector
        destinations: Set of destination cells
    """
    graph = nx.DiGraph()
    graph.add_nodes_from(drivable)
    graph.add_nodes_from(destinations)
    for pos, from_dir in drivable.items():
        for move in NEIGHBORS:
            target = step(pos, move)
            straight = 0 in move
            if target in destinations and straight:
                graph.add_edge(pos, target, weight=1.0)
            elif target not in drivable:
                continue
            elif not is_legal_move(move, from_dir, drivable[target]):
                continue
            elif straight or (
                step(pos, (move[0], 0)) in drivable
                and step(pos, (0, move[1])) in drivable
            ):
                if move == from_dir:
                    cost = 1.0
                elif dot(move, from_dir) > 0:
                    cost = DIAGONAL_COST
                else:
                    cost = SIDEWAYS_COST
                graph.add_edge(pos, target, weight=cost)
    return graph


def distance_estimate(a, b):
    """A* heuristic: the cost of the path if there were no buildings."""
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return max(dx, dy) + (DIAGONAL_COST - 1) * min(dx, dy)


def shortest_route(graph, start, goal, avoid=frozenset()):
    """A* route from start (not included) to goal, or [] if there is none. `avoid`
    lets a stuck car plan around a blocked cell."""
    if avoid:
        graph = nx.restricted_view(graph, set(avoid) - {start, goal}, [])
    try:
        path = nx.astar_path(graph, start, goal, distance_estimate, weight="weight")
    except nx.NetworkXNoPath:
        return []
    return path[1:]
