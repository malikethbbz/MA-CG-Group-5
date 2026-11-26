"""The Reforma map: a two-lane glorieta circulating counter-clockwise around a
monument, like Mexico City's Angel of Independence.

The ring is found from the raw map file (the island around the 'A' and the two lanes
around it), not from the street graph, so a wrong graph rule cannot vouch for itself.
"""

from dataclasses import dataclass

import pytest

from conftest import (
    DENSE_STEPS,
    REFORMA_MAP,
    TinyCity,
    TrafficRun,
    car_positions,
    moves,
    raw_map,
    traffic_run,
)
from traffic_base.city_graph import DIRECTION_VECTORS, Position, Vector, step
from traffic_base.model import SPAWN_INTERVAL, CityModel

ARROWS: dict[str, Vector] = {
    ">": DIRECTION_VECTORS["Right"],
    "<": DIRECTION_VECTORS["Left"],
    "^": DIRECTION_VECTORS["Up"],
    "v": DIRECTION_VECTORS["Down"],
}
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
            if char and char not in ARROWS and char not in LIGHTS and nxt not in island:
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
    params=[(SPAWN_INTERVAL,), (3,), (1, "edges", DENSE_STEPS)],
    ids=lambda p: "-".join(map(str, p)),
)
def reforma_run(request: pytest.FixtureRequest) -> TrafficRun:
    """Shares test_city's cached runs, so the dense edge run costs nothing extra."""
    return traffic_run(REFORMA_MAP, *request.param)


def dot(a: Vector, b: Vector) -> int:
    return a[0] * b[0] + a[1] * b[1]


def test_the_island_is_a_plaza_around_one_monument(glorieta: Glorieta) -> None:
    assert len(glorieta.island) == (glorieta.east - glorieta.west + 1) * (
        glorieta.north - glorieta.south + 1
    )  # a solid rectangle, so the flood fill did not leak into the city
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
    assert len(ring) == width * height - len(glorieta.island)


def approaches(glorieta: Glorieta, model: CityModel) -> dict[Position, Vector]:
    """Cells off the ring that point straight into it, with their direction."""
    ring = glorieta.ring()
    return {
        pos: direction
        for pos, direction in model.drivable.items()
        if pos not in ring and step(pos, direction) in ring
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
