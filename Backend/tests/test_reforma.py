"""The Reforma map: a two-lane glorieta circulating counter-clockwise around a
monument, like Mexico City's Angel of Independence.

The ring is found from the raw map file (the island around the 'A' and the two lanes
around it), not from the street graph, so a wrong graph rule cannot vouch for itself.
"""

from dataclasses import dataclass

import pytest

from conftest import (
    REFORMA_MAP,
    TinyCity,
    TrafficRun,
    car_positions,
    moves,
    raw_map,
    traffic_run,
)
from traffic_base.agent import YELLOW_STEPS
from traffic_base.city_graph import DIRECTION_VECTORS, Position, Vector, step
from traffic_base.model import SPAWN_INTERVAL, CityModel

ARROWS: dict[str, Vector] = {
    ">": DIRECTION_VECTORS["Right"],
    "<": DIRECTION_VECTORS["Left"],
    "^": DIRECTION_VECTORS["Up"],
    "v": DIRECTION_VECTORS["Down"],
}
# The island's corners are diagonal road, numbered like a numpad: 7 is up-left
DIAGONALS: dict[str, Vector] = {"7": (-1, 1), "9": (1, 1), "1": (-1, -1), "3": (1, -1)}
LIGHTS = "sS"
RING_LANES = 2
# Counter-clockwise seen from above with y growing north: east along the south side,
# north along the east side, west along the north side, south along the west side.
TANGENTS: dict[str, Vector] = {
    "south": (1, 0),
    "east": (0, 1),
    "north": (-1, 0),
    "west": (0, -1),
}
MIN_MOVES_PER_SIDE = 50


@dataclass(frozen=True)
class Glorieta:
    """The island's bounding box (inclusive) and the raw map rows around it."""

    raw: list[str]
    monument: Position
    island: frozenset[Position]
    west: int
    east: int
    south: int
    north: int

    def sides(self, pos: Position) -> list[str]:
        """The ring sides a cell lies on: two for a corner cell, none off the ring."""
        x, y = pos
        gaps = {
            "west": self.west - x,
            "east": x - self.east,
            "south": self.south - y,
            "north": y - self.north,
        }
        if not 1 <= max(gaps.values()) <= RING_LANES:
            return []
        return [side for side, gap in gaps.items() if gap > 0]

    def ring(self) -> set[Position]:
        return {
            (x, y)
            for x in range(self.west - RING_LANES, self.east + RING_LANES + 1)
            for y in range(self.south - RING_LANES, self.north + RING_LANES + 1)
            if self.sides((x, y))
        }


def char_at(raw: list[str], pos: Position) -> str:
    x, y = pos
    if not (0 <= x < len(raw[0]) and 0 <= y < len(raw)):
        return ""
    return raw[len(raw) - y - 1][x]


def flood_island(raw: list[str], start: Position) -> set[Position]:
    """Every off-road cell 4-connected to the monument."""
    island, frontier = {start}, [start]
    while frontier:
        here = frontier.pop()
        for move in DIRECTION_VECTORS.values():
            nxt = step(here, move)
            char = char_at(raw, nxt)
            road = char in ARROWS or char in LIGHTS or char in DIAGONALS
            if char and not road and nxt not in island:
                island.add(nxt)
                frontier.append(nxt)
    return island


def find_glorieta(raw: list[str]) -> Glorieta:
    height = len(raw)
    monuments = [
        (c, height - r - 1)
        for r, row in enumerate(raw)
        for c, char in enumerate(row)
        if char == "A"
    ]
    assert len(monuments) == 1
    island = flood_island(raw, monuments[0])
    xs, ys = [x for x, _ in island], [y for _, y in island]
    return Glorieta(
        raw, monuments[0], frozenset(island), min(xs), max(xs), min(ys), max(ys)
    )


@pytest.fixture(scope="module")
def glorieta() -> Glorieta:
    return find_glorieta(raw_map(REFORMA_MAP))


@pytest.fixture(
    scope="module",
    params=[(SPAWN_INTERVAL,), (3,)],
    ids=lambda p: "-".join(map(str, p)),
)
def reforma_run(request: pytest.FixtureRequest) -> TrafficRun:
    """Shares test_city's cached runs."""
    return traffic_run(REFORMA_MAP, *request.param)


def dot(a: Vector, b: Vector) -> int:
    return a[0] * b[0] + a[1] * b[1]


def corners(glorieta: Glorieta) -> dict[str, Position]:
    return {
        "north-west": (glorieta.west, glorieta.north),
        "north-east": (glorieta.east, glorieta.north),
        "south-west": (glorieta.west, glorieta.south),
        "south-east": (glorieta.east, glorieta.south),
    }


def test_the_island_is_a_plaza_around_one_monument(glorieta: Glorieta) -> None:
    assert (
        len(glorieta.island)
        == (glorieta.east - glorieta.west + 1) * (glorieta.north - glorieta.south + 1)
        - 4
    )  # a rectangle without its corners, so the flood fill did not leak
    assert {char_at(glorieta.raw, p) for p in glorieta.island} == {"#", "A"}
    assert len(glorieta.island) <= 25


def test_the_ring_is_two_lanes_of_counter_clockwise_road(glorieta: Glorieta) -> None:
    ring = glorieta.ring()
    for pos in ring:
        char = char_at(glorieta.raw, pos)
        assert char in ARROWS, f"ring cell {pos} is {char!r}, not a plain road"
        alignment = [dot(ARROWS[char], TANGENTS[s]) for s in glorieta.sides(pos)]
        assert min(alignment) >= 0, f"ring cell {pos} points clockwise"
        assert max(alignment) == 1, f"ring cell {pos} does not go round"
    width = glorieta.east - glorieta.west + 1 + 2 * RING_LANES
    height = glorieta.north - glorieta.south + 1 + 2 * RING_LANES
    # The island and its four diagonal corners sit inside the ring
    assert len(ring) == width * height - len(glorieta.island) - 4


def test_the_island_corners_are_diagonal_roads_going_round(glorieta: Glorieta) -> None:
    """Each corner cuts across from one side of the ring to the next one,
    counter-clockwise, so the ring looks like a diamond around the monument."""
    for name, corner in corners(glorieta).items():
        char = char_at(glorieta.raw, corner)
        assert char in DIAGONALS, f"{name} corner {corner} is {char!r}"
        north_or_south, east_or_west = name.split("-")
        for side in (north_or_south, east_or_west):
            assert dot(DIAGONALS[char], TANGENTS[side]) == 1, f"{name} goes clockwise"


def test_a_car_turning_at_the_glorieta_cuts_across_the_island_corner(
    glorieta: Glorieta,
) -> None:
    """For each corner, a car on the inner lane of one side that turns onto the next
    side is routed diagonally over the corner instead of round the square."""
    model = CityModel(map_name=REFORMA_MAP)
    w, e, s, n = glorieta.west, glorieta.east, glorieta.south, glorieta.north
    turns = {
        # corner: (inner lane cell before the corner, inner lane cell after it)
        "north-west": ((w + 1, n + 1), (w - 1, n - 1)),
        "north-east": ((e + 1, n - 1), (e - 1, n + 1)),
        "south-west": ((w - 1, s + 1), (w + 1, s - 1)),
        "south-east": ((e - 1, s - 1), (e + 1, s + 1)),
    }
    for name, (start, goal) in turns.items():
        route = model.route(start, goal)
        assert route == [corners(glorieta)[name], goal], f"{name}: {route}"


def test_cars_drive_over_the_island_corners(
    glorieta: Glorieta, reforma_run: TrafficRun
) -> None:
    on_corners = set(corners(glorieta).values())
    crossings = [
        dst for _, _, _, dst in moves(reforma_run.history) if dst in on_corners
    ]
    assert len(crossings) >= 20


def approaches(glorieta: Glorieta, model: CityModel) -> dict[Position, Vector]:
    """Cells off the ring that point straight into it, with their direction. The
    island's diagonal corners are part of the glorieta, not approaches."""
    ring = glorieta.ring()
    inside = set(corners(glorieta).values())
    return {
        pos: direction
        for pos, direction in model.drivable.items()
        if pos not in ring and pos not in inside and step(pos, direction) in ring
    }


def test_every_approach_into_the_ring_is_a_light_and_the_axes_alternate(
    glorieta: Glorieta,
) -> None:
    feeders = approaches(glorieta, CityModel(map_name=REFORMA_MAP))
    groups: dict[str, set[str]] = {"avenue": set(), "cross street": set()}
    for pos, (dx, _) in feeders.items():
        char = char_at(glorieta.raw, pos)
        assert char in LIGHTS, f"approach {pos} enters the ring without a light"
        groups["avenue" if dx else "cross street"].add(char)
    # Reforma shares the 's' group with the rest of the avenue's lights, so it is red
    # exactly while the cross street feeds the ring.
    assert groups == {"avenue": {"s"}, "cross street": {"S"}}
    assert len(feeders) == 4 * RING_LANES


def test_cars_only_drive_the_ring_counter_clockwise(
    glorieta: Glorieta, reforma_run: TrafficRun
) -> None:
    """A corner cell joins two sides, so a move into it may follow either one (a lane
    change at the south-west corner heads north, against the west side); it is
    clockwise only when it opposes both.

    Circulation is counted on side cells only, so a side nobody can drive fails even
    when traffic still turns through its corners."""
    ring = glorieta.ring()
    circulating = dict.fromkeys(TANGENTS, 0)
    for t, car_id, (x, y), dst in moves(reforma_run.history):
        if dst not in ring:
            continue
        move = (dst[0] - x, dst[1] - y)
        along = {side: dot(move, TANGENTS[side]) for side in glorieta.sides(dst)}
        assert max(along.values()) >= 0, (
            f"car {car_id} drove clockwise into {dst} at {t}"
        )
        if len(along) == 1:
            (side, amount), *_ = along.items()
            circulating[side] += max(amount, 0)
    assert min(circulating.values()) >= MIN_MOVES_PER_SIDE, circulating


def test_the_monument_is_never_entered_and_is_not_a_building(
    glorieta: Glorieta, reforma_run: TrafficRun
) -> None:
    model, history = reforma_run
    assert model.monuments == [glorieta.monument]
    assert all(glorieta.monument not in cars.values() for cars in history)
    assert glorieta.monument not in model.graph
    assert glorieta.monument not in model.buildings
    assert glorieta.monument not in model.helipads


def test_cars_drive_around_a_monument_in_their_lane(tiny_city: TinyCity) -> None:
    # The straight route from the bottom-left corner runs through the monument at
    # (2, 0); a drivable monument would be the shorter path.
    model = tiny_city([">>>>D", ">>A>>"])
    history = [car_positions(model)]
    for _ in range(SPAWN_INTERVAL - 1):
        model.step()
        history.append(car_positions(model))
    assert model.arrived == 3  # (4, 0) reaches the destination with one step up
    assert all((2, 0) not in cars.values() for cars in history)


def test_no_emergency_can_open_on_the_monument_plaza(glorieta: Glorieta) -> None:
    """The island is drawn as a garden, so an ambulance landing beside it would answer
    a call from nowhere."""
    model = CityModel(map_name=REFORMA_MAP)
    assert glorieta.island & model.landing_spots.keys() == set()
    assert not glorieta.island & set(model.helipads)
    # Buildings across the ring still take calls
    assert len(model.landing_spots) > 100


def test_only_the_lights_feeding_the_glorieta_have_a_yellow_phase(
    glorieta: Glorieta,
) -> None:
    model = CityModel(map_name=REFORMA_MAP)
    feeders = approaches(glorieta, model)
    with_yellow = {
        light.cell.coordinate for light in model.traffic_lights if light.has_yellow
    }
    assert with_yellow == set(feeders)


def test_a_yellow_light_is_the_end_of_its_green(glorieta: Glorieta) -> None:
    model = CityModel(map_name=REFORMA_MAP)
    light = next(light for light in model.traffic_lights if light.has_yellow)
    seen = []
    for _ in range(light.cycle):
        model.step()
        seen.append("Y" if light.yellow else "G" if light.state else "R")
    # Green, then YELLOW_STEPS of yellow, then red, in one cycle
    colors = "".join(seen)
    assert colors.count("Y") == YELLOW_STEPS
    assert "GY" in colors and "YR" in colors
    assert colors.count("Y") + colors.count("G") == light.green_steps


def test_cars_never_drive_into_a_yellow_light(reforma_run: TrafficRun) -> None:
    model, history = reforma_run
    lights = {t.cell.coordinate: t for t in model.traffic_lights if t.has_yellow}
    entries = 0
    for t, car_id, src, dst in moves(history):
        if dst in lights and src not in lights:
            entries += 1
            assert not lights[dst].is_yellow(t), f"car {car_id} ran a yellow at {t}"
    assert entries > 50
