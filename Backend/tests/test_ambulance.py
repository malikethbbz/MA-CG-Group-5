"""Behavior tests for flying ambulances, on the real 2025 maps and on tiny maps.

Landing rules are checked against the raw map file, not against ambulance.py's own
spot filter, so a wrong filter cannot vouch for itself.
"""

import math
from dataclasses import dataclass, field

import pytest

from conftest import REFORMA_MAP, TinyCity, car_positions, raw_map
from traffic_base.agent import Car
from traffic_base.ambulance import (
    CRUISE_ALTITUDE,
    EMERGENCY_INTERVAL,
    ROOF_ALTITUDE,
    Ambulance,
)
from traffic_base.city_graph import DIRECTION_VECTORS, Position, Vector
from traffic_base.model import DEFAULT_MAP, SPAWN_INTERVAL, CityModel
from traffic_base.vehicle import Event

ARROWS: dict[str, Vector] = {
    ">": DIRECTION_VECTORS["Right"],
    "<": DIRECTION_VECTORS["Left"],
    "^": DIRECTION_VECTORS["Up"],
    "v": DIRECTION_VECTORS["Down"],
}
ORTHOGONAL = list(DIRECTION_VECTORS.values())
RUN_STEPS = 800
# Dense edge traffic is ~5x slower per step; 400 steps still serves 10+ emergencies.
DENSE_RUN_STEPS = 400
# Two-row map: helipads on the corner rooftops, one emergency building at (3, 1)
# whose only landing spot is the road cell (3, 0) below it.
ONE_SPOT_CITY = ["#..#..#", ">>>>>>D"]
ONE_SPOT = (3, 0)
MAX_PHASE_STEPS = 200  # bounds every wait loop so a stuck ambulance fails, not hangs


@dataclass
class AmbulanceSnapshot:
    state: str
    altitude: float
    emergency: int | None
    spot: Position | None


@dataclass
class CityRun:
    """Everything recorded after each step; index 0 is the model before any step."""

    model: CityModel
    raw: list[str]  # map rows, top row first, as in the file
    map_name: str
    cars: list[dict[int, Position]] = field(default_factory=list)
    reserved: list[frozenset[Position]] = field(default_factory=list)
    ambulances: list[dict[int, AmbulanceSnapshot]] = field(default_factory=list)
    events: list[list[Event]] = field(default_factory=list)
    blocked_by_reservation: int = 0  # car-steps whose next cell was reserved

    def char(self, pos: Position) -> str:
        x, y = pos
        if not (0 <= x < self.model.width and 0 <= y < self.model.height):
            return ""
        return self.raw[self.model.height - y - 1][x]

    def record(self) -> None:
        model = self.model
        self.cars.append(car_positions(model))
        self.reserved.append(frozenset(model.reserved))
        self.ambulances.append({a.unique_id: snapshot(a) for a in model.ambulances})
        self.events.append(list(model.events))
        self.blocked_by_reservation += sum(
            1 for car in model.cars if car.route and car.route[0] in model.reserved
        )


def snapshot(ambulance: Ambulance) -> AmbulanceSnapshot:
    emergency = ambulance.emergency.unique_id if ambulance.emergency else None
    return AmbulanceSnapshot(
        ambulance.state, ambulance.altitude, emergency, ambulance.spot
    )


@pytest.fixture(
    scope="module",
    params=[
        (DEFAULT_MAP, "corners", SPAWN_INTERVAL, RUN_STEPS),
        (REFORMA_MAP, "corners", SPAWN_INTERVAL, RUN_STEPS),
        (DEFAULT_MAP, "edges", 1, DENSE_RUN_STEPS),
    ],
    ids=lambda p: f"{p[0]}-{p[1]}-every-{p[2]}",
)
def city_run(request: pytest.FixtureRequest) -> CityRun:
    map_name, spawn_points, spawn_interval, steps = request.param
    model = CityModel(
        map_name=map_name, spawn_points=spawn_points, spawn_interval=spawn_interval
    )
    run = CityRun(model, raw_map(map_name), map_name)
    run.record()
    for _ in range(steps):
        run.model.step()
        run.record()
    return run


def events_of(run: CityRun, event_type: str) -> list[tuple[int, Event]]:
    return [
        (t, e)
        for t, step in enumerate(run.events)
        for e in step
        if e["type"] == event_type
    ]


def test_two_helipads_sit_on_far_apart_rooftops(city_run: CityRun) -> None:
    model = city_run.model
    assert len(model.helipads) == len(model.ambulances) == 2
    assert all(city_run.char(pad) == "#" for pad in model.helipads)
    a, b = model.helipads
    assert math.dist(a, b) > math.hypot(model.width, model.height) / 2
    fresh = CityModel(map_name=city_run.map_name)
    homes = {(f["x"], f["z"]) for f in fresh.vehicles() if f["kind"] == "ambulance"}
    assert homes == set(model.helipads)


def test_ambulances_serve_many_emergencies(city_run: CityRun) -> None:
    served = events_of(city_run, "served")
    assert len(served) >= 10
    assert city_run.model.stats()["emergenciesServed"] == len(served)
    assert len(events_of(city_run, "emergency")) >= len(served)


def is_perpendicular_road(run: CityRun, pos: Position, own: Vector) -> bool:
    """Raw-map intersection test: an orthogonal neighbour is an arrow at right angles
    to `own`. A light has no arrow in the file, so it takes the model's inferred
    direction."""
    for dx, dy in ORTHOGONAL:
        neighbour = (pos[0] + dx, pos[1] + dy)
        char = run.char(neighbour)
        other = run.model.drivable.get(neighbour) if char in "sS" else ARROWS.get(char)
        if other and own[0] * other[0] + own[1] * other[1] == 0:
            return True
    return False


def test_every_landing_obeys_the_landing_rules(city_run: CityRun) -> None:
    model = city_run.model
    w, h = model.width - 1, model.height - 1
    corners = {(0, 0), (w, 0), (0, h), (w, h)}
    emergency_at = {
        e["id"]: (e["x"], e["z"]) for _, e in events_of(city_run, "emergency")
    }
    landings = events_of(city_run, "landed")
    for t, event in landings:
        spot = (event["x"], event["z"])
        mine = city_run.ambulances[t][int(event["id"])]
        others = [s for i, s in city_run.ambulances[t].items() if i != int(event["id"])]
        building = emergency_at[str(mine.emergency)]
        assert city_run.char(spot) in ARROWS, f"landed off a plain road at {spot}"
        assert spot not in corners
        assert not is_perpendicular_road(city_run, spot, ARROWS[city_run.char(spot)])
        assert abs(spot[0] - building[0]) + abs(spot[1] - building[1]) == 1
        assert city_run.char(building) == "#" and building not in model.helipads
        assert all(o.spot != spot for o in others)
        assert spot not in city_run.cars[t].values()
    assert len(landings) >= 10


def test_no_car_ever_enters_a_reserved_cell(city_run: CityRun) -> None:
    entries = 0
    for t in range(1, len(city_run.cars)):
        before, after = city_run.cars[t - 1], city_run.cars[t]
        for car_id in before.keys() & after.keys():
            if before[car_id] != after[car_id]:
                assert after[car_id] not in city_run.reserved[t], (
                    f"car {car_id} entered reserved {after[car_id]} on step {t}"
                )
                entries += 1
    assert entries > 1000
    assert city_run.blocked_by_reservation > 0  # the rule was actually put to work


def test_ambulances_never_share_an_emergency_and_release_every_spot(
    city_run: CityRun,
) -> None:
    owner: dict[int, int] = {}
    for t, ambulances in enumerate(city_run.ambulances):
        held = [s.spot for s in ambulances.values() if s.spot is not None]
        assert city_run.reserved[t] == set(held), f"leaked reservation on step {t}"
        assert len(set(held)) == len(held)
        for amb_id, snap in ambulances.items():
            if snap.emergency is not None:
                assert owner.setdefault(snap.emergency, amb_id) == amb_id
    assert len(set(owner.values())) == 2  # both ambulances worked


def test_car_invariants_still_hold_with_ambulances(city_run: CityRun) -> None:
    model = city_run.model
    for positions in city_run.cars:
        assert len(set(positions.values())) == len(positions)
    assert model.arrived > 100
    assert model.active_cars == len(model.cars)
    assert model.spawned == model.arrived + model.stats()["active"]


def dispatched(model: CityModel) -> Ambulance:
    return next(a for a in model.ambulances if a.emergency is not None)


def step_while(model: CityModel, ambulance: Ambulance, state: str) -> None:
    """Steps while the ambulance is (or is not, with a leading "!") in `state`."""
    negate, state = state.startswith("!"), state.lstrip("!")
    for _ in range(MAX_PHASE_STEPS):
        if (ambulance.state == state) == negate:
            return
        model.step()
    pytest.fail(f"ambulance stuck {'outside' if negate else 'in'} {state}")


def step_until_emergency(model: CityModel) -> None:
    for _ in range(EMERGENCY_INTERVAL + 1):  # it opens, then the next step dispatches
        model.step()
    assert model.landing_spots == {(3, 1): (ONE_SPOT,)}
    assert dispatched(model).spot == ONE_SPOT


def test_ambulance_hovers_over_a_car_on_the_only_spot_until_it_leaves(
    tiny_city: TinyCity,
) -> None:
    model = tiny_city(ONE_SPOT_CITY)
    for car in list(model.cars):
        car.remove()
    stalled = Car(model, model.grid[ONE_SPOT], (6, 0), model.drivable[ONE_SPOT])
    stalled.route = []  # broken down on the spot
    step_until_emergency(model)
    ambulance = dispatched(model)
    step_while(model, ambulance, "!landing")

    for _ in range(10):
        model.step()
        assert ambulance.state == "landing"
        assert ambulance.altitude == CRUISE_ALTITUDE

    stalled.route = model.route(ONE_SPOT, (6, 0))
    model.step()  # the ambulance moves first, so it still sees the car this step
    assert ambulance.altitude == CRUISE_ALTITUDE
    assert ONE_SPOT not in car_positions(model).values()
    step_while(model, ambulance, "landing")
    assert ambulance.state == "on_scene"
    assert ambulance.altitude == 0
    assert ONE_SPOT not in car_positions(model).values()  # the queue stayed out
    assert "landed" in [e["type"] for e in model.events]


def test_one_emergency_runs_the_full_state_cycle_in_order(tiny_city: TinyCity) -> None:
    model = tiny_city(ONE_SPOT_CITY)
    step_until_emergency(model)
    ambulance = dispatched(model)
    assert ambulance.emergency is not None
    ours = {str(ambulance.unique_id), str(ambulance.emergency.unique_id)}
    states, kinds = ["idle", ambulance.state], []
    for _ in range(MAX_PHASE_STEPS):
        if ambulance.state == "idle":
            break
        model.step()
        kinds += [e["type"] for e in model.events if e["id"] in ours]
        if ambulance.state != states[-1]:
            states.append(ambulance.state)
    assert states == [
        "idle",
        "takeoff",
        "cruise",
        "landing",
        "on_scene",
        "takeoff",
        "return",
        "landing",
        "idle",
    ]
    assert kinds == ["landed", "served"]
    assert (ambulance.x, ambulance.z) == ambulance.home
    assert ambulance.altitude == ROOF_ALTITUDE
    assert ambulance.spot is None  # released; the other ambulance may hold one
    assert model.reserved == {a.spot for a in model.ambulances if a.spot}


def test_an_emergency_with_two_free_spots_still_gets_one_ambulance(
    tiny_city: TinyCity,
) -> None:
    # The real run never has both ambulances idle next to a two-spot emergency, so
    # this map makes one: building (3, 1) has a free road cell above and below.
    model = tiny_city([">>>>>>D#", "#..#....", ">>>>>>D."])
    assert set(model.landing_spots[(3, 1)]) == {(3, 0), (3, 2)}
    for _ in range(EMERGENCY_INTERVAL + 1):
        model.step()
    assert sorted(a.state for a in model.ambulances) == ["idle", "takeoff"]
    assert len(model.reserved) == 1


def test_ambulances_never_land_on_a_light_or_a_spawn_corner(
    tiny_city: TinyCity,
) -> None:
    # On the real map every light and corner is also an intersection, so this map
    # puts a light and the spawn corner on a straight road next to a building.
    model = tiny_city(
        [
            ">>s>>>D#",  # spawn corner (0, 2), light (2, 2), pad on (7, 2)
            "#.#.#...",  # emergency buildings below each of them
            "#.......",  # pad on (0, 0)
        ]
    )
    assert model.spawn_points == [(0, 2)]
    landings = set()
    for _ in range(300):
        model.step()
        landings |= {(e["x"], e["z"]) for e in model.events if e["type"] == "landed"}
    assert landings == {(4, 2)}


def test_ambulances_never_land_on_an_edge_spawn_point(tiny_city: TinyCity) -> None:
    # The real maps' two-lane outer ring touches no building, so this map puts
    # emergency buildings (2, 2) and (4, 2) between the top border road and an inner
    # road. In edges mode the border road spawns cars, so only the inner road is safe.
    model = tiny_city(
        [
            ">>>>>>D#",  # border road; pad on (7, 3)
            "..#.#...",
            ">>>>>>D.",  # inner road, on the border only at its first cell
            "#.......",  # pad on (0, 0)
        ],
        spawn_points="edges",
    )
    landings = set()
    for _ in range(300):
        model.step()
        landings |= {(e["x"], e["z"]) for e in model.events if e["type"] == "landed"}
    assert landings == {(2, 1), (4, 1)}
