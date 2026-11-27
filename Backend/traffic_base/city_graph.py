"""Street graph built from the city map, and the A* routing the cars use.

Positions are grid cells (x, y). y grows upward, so row 0 of the map file is the
top row of the grid. A direction or a one-cell move is a vector (dx, dy).
"""

import math

import networkx as nx

# Short names for the tuples used everywhere, only to make the hints readable.
Position = tuple[int, int]
Vector = tuple[int, int]

DIRECTION_VECTORS = {
    "Up": (0, 1),
    "Down": (0, -1),
    "Right": (1, 0),
    "Left": (-1, 0),
}

# The eight cells around a cell.
NEIGHBOR_OFFSETS = [
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1),           (0, 1),
    (1, -1),  (1, 0),  (1, 1),
]  # fmt: skip

STRAIGHT_COST = 1.0
DIAGONAL_COST = math.sqrt(2)
SIDEWAYS_COST = 1.5  # dearer than a diagonal, so cars only slide sideways to cross


def step(pos, move):
    """Returns the cell reached by moving `move` from `pos`."""
    return (pos[0] + move[0], pos[1] + move[1])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def is_legal_move(move, from_dir, to_dir):
    """
    Checks if a car may make a one-cell move between two road cells.
    A move may not point backwards against either cell's direction, and it may not
    enter the opposite lane. Moving down from an 'Up' cell is illegal. Sideways moves
    are legal: that is how a car on a 'v' column crosses a row of '<' cells.
    Args:
        move: The move (dx, dy)
        from_dir: Direction of the cell the car is on
        to_dir: Direction of the cell the car moves to
    """
    if dot(move, from_dir) < 0 or dot(move, to_dir) < 0:
        return False
    return to_dir != (-from_dir[0], -from_dir[1])


def move_cost(move, from_dir):
    """Going straight is cheapest, then a diagonal, then sliding sideways."""
    if move == from_dir:
        return STRAIGHT_COST
    if dot(move, from_dir) > 0:
        return DIAGONAL_COST
    return SIDEWAYS_COST


def infer_light_directions(road_dirs, lights):
    """
    Finds the direction of every traffic light. A light sits on a road, so it points
    the same way as the road cell that feeds it. Lights can feed other lights, so this
    repeats until every light has a direction.
    Args:
        road_dirs: Dictionary of road cell -> direction vector
        lights: List of light cells
    """
    known = dict(road_dirs)
    pending = set(lights)
    while pending:
        # Only look at what was known before this round.
        resolved = {}
        for light in pending:
            for direction in DIRECTION_VECTORS.values():
                behind = step(light, (-direction[0], -direction[1]))
                if known.get(behind) == direction:
                    resolved[light] = direction
        if not resolved:
            raise ValueError(
                f"cannot infer a direction for lights at {sorted(pending)}"
            )
        known.update(resolved)
        pending -= resolved.keys()

    light_dirs = {}
    for light in lights:
        light_dirs[light] = known[light]
    return light_dirs


def clears_corners(start, move, drivable):
    """A diagonal move passes between two cells. Both must be road, so cars never clip
    the corner of a building."""
    if 0 in move:
        return True
    side_a = step(start, (move[0], 0))
    side_b = step(start, (0, move[1]))
    return side_a in drivable and side_b in drivable


def build_street_graph(drivable, destinations):
    """
    Builds the directed graph the cars route on. Nodes are drivable cells and
    destinations. A destination is entered straight from any side (never diagonally)
    and has no outgoing edges.
    Args:
        drivable: Dictionary of every road or light cell -> its direction vector
        destinations: Set of destination cells
    """
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
                and clears_corners(pos, move, drivable)
            ):
                graph.add_edge(pos, target, weight=move_cost(move, from_dir))
    return graph


def octile_distance(a, b):
    """A* heuristic: the cost of the shortest path if there were no buildings."""
    dx = abs(a[0] - b[0])
    dy = abs(a[1] - b[1])
    return max(dx, dy) + (DIAGONAL_COST - 1) * min(dx, dy)


def shortest_route(graph, start, goal, avoid=frozenset()):
    """
    A* route from start (not included) to goal (included). Empty if there is no path.
    A start or goal missing from the graph is a bug, so that error is not caught here.
    Args:
        graph: The street graph
        start: Cell where the route begins
        goal: Cell where the route ends
        avoid: Cells to plan around, so a stuck car can get past a blocked cell
    """
    if avoid:
        graph = nx.restricted_view(graph, set(avoid) - {start, goal}, [])
    try:
        path = nx.astar_path(
            graph, start, goal, heuristic=octile_distance, weight="weight"
        )
    except nx.NetworkXNoPath:
        return []
    return path[1:]
