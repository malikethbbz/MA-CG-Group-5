"""Behavior tests for the flying ambulances and the hospital, on the real 2025 maps
and on a tiny map.

Landing rules are checked against the raw map file, not against the model's own spot
list, so a wrong list cannot vouch for itself.
"""

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
from traffic_base.city_graph import Position
from traffic_base.model import DEFAULT_MAP, CityModel

Event = dict[str, str | int]  # an /step event: type, id, and x, z for some types
RUN_STEPS = 800
# One-row city: the hospital (3, 1) and the second roof (4, 1) sit in the middle, and
# the only emergency building (6, 1) has one landing cell, the road (6, 0) below it.
ONE_SPOT_CITY = ["...##.#.", ">>>>>>>D"]
ONE_SPOT = (6, 0)
MAX_PHASE_STEPS = 200  # bounds every wait loop so a stuck ambulance fails, not hangs


@dataclass
class AmbulanceSnapshot:
    state: str
    altitude: float
    emergency: int | None
    spot: Position | None
    position: tuple[float, float]


@dataclass
class CityRun:
    """Everything recorded after each step; index 0 is the model before any step."""

    model: CityModel
    raw: list[str]  # map rows, top row first, as in the file
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
        ambulance.state,
        ambulance.altitude,
        emergency,
        ambulance.spot,
        (ambulance.x, ambulance.z),
    )


@pytest.fixture(scope="module", params=[DEFAULT_MAP, REFORMA_MAP])
def city_run(request: pytest.FixtureRequest) -> CityRun:
    model = CityModel(map_name=request.param)
    run = CityRun(model, raw_map(request.param))
    run.record()
    for _ in range(RUN_STEPS):
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


def test_ambulances_start_at_and_return_to_the_hospital(city_run: CityRun) -> None:
    model = city_run.model
    hospital = model.hospital
    assert city_run.char(hospital) == "#"
    assert model.helipads[0] == hospital
    assert len(model.helipads) == len(set(model.helipads)) == 2
    # The second roof is the building right next to the hospital.
    other = model.helipads[1]
    assert abs(other[0] - hospital[0]) + abs(other[1] - hospital[1]) == 1
    start = {s.position for s in city_run.ambulances[0].values()}
    assert start == set(model.helipads)

    returns = 0
    for before, after in zip(
        city_run.ambulances, city_run.ambulances[1:], strict=False
    ):
        for amb_id, snap in after.items():
            if snap.state == "idle":
                home = city_run.ambulances[0][amb_id].position
                assert snap.position == home
                assert snap.altitude == ROOF_ALTITUDE
            if snap.state == "idle" and before[amb_id].state == "return":
                returns += 1
    assert returns >= 10


def test_no_emergency_ever_opens_at_the_hospital(city_run: CityRun) -> None:
    opened = {(e["x"], e["z"]) for _, e in events_of(city_run, "emergency")}
    assert len(opened) >= 10
    assert not opened & set(city_run.model.helipads)


def test_ambulances_serve_many_emergencies(city_run: CityRun) -> None:
    served = events_of(city_run, "served")
    assert len(served) >= 10
    assert city_run.model.stats()["emergenciesServed"] == len(served)
    assert len(events_of(city_run, "emergency")) >= len(served)


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
        assert city_run.char(spot) in "<>^v", f"landed off a plain road at {spot}"
        assert spot not in corners
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
    assert model.spawned == model.arrived + model.stats()["active"]


def dispatched(model: CityModel) -> Ambulance:
    return next(a for a in model.ambulances if a.emergency is not None)


def step_while(model: CityModel, ambulance: Ambulance, state: str) -> None:
    for _ in range(MAX_PHASE_STEPS):
        if ambulance.state != state:
            return
        model.step()
    pytest.fail(f"ambulance stuck in {state}")


def step_until_emergency(model: CityModel) -> None:
    for _ in range(EMERGENCY_INTERVAL + 1):  # it opens, then the next step dispatches
        model.step()
    assert model.hospital == (3, 1)
    assert model.landing_spots == {(6, 1): (ONE_SPOT,)}
    assert dispatched(model).spot == ONE_SPOT


def test_ambulance_hovers_over_a_car_on_its_spot_until_it_leaves(
    tiny_city: TinyCity,
) -> None:
    model = tiny_city(ONE_SPOT_CITY)
    for car in list(model.cars):
        car.remove()
    stalled = Car(model, model.grid[ONE_SPOT], (7, 0), model.drivable[ONE_SPOT])
    stalled.route = []  # broken down on the spot
    step_until_emergency(model)
    ambulance = dispatched(model)

    for _ in range(20):
        model.step()
    assert ambulance.state == "cruise"
    assert (ambulance.x, ambulance.z) == ONE_SPOT
    assert ambulance.altitude == CRUISE_ALTITUDE

    stalled.route = model.route(ONE_SPOT, (7, 0))
    model.step()  # the ambulance moves first, so it still sees the car this step
    assert ambulance.altitude == CRUISE_ALTITUDE
    assert ONE_SPOT not in car_positions(model).values()
    model.step()
    assert ambulance.state == "on_scene"
    assert ambulance.altitude == 0
    assert ONE_SPOT not in car_positions(model).values()  # the queue stayed out
    assert "landed" in [e["type"] for e in model.events]


def test_one_emergency_runs_the_full_state_cycle_in_order(tiny_city: TinyCity) -> None:
    model = tiny_city(ONE_SPOT_CITY)
    step_until_emergency(model)
    ambulance = dispatched(model)
    ours = {str(ambulance.unique_id), str(ambulance.emergency.unique_id)}
    states, kinds = ["idle", ambulance.state], []
    for _ in range(MAX_PHASE_STEPS):
        if ambulance.state == "idle":
            break
        model.step()
        kinds += [e["type"] for e in model.events if e["id"] in ours]
        if ambulance.state != states[-1]:
            states.append(ambulance.state)
    assert states == ["idle", "cruise", "on_scene", "return", "idle"]
    assert kinds == ["landed", "served"]
    assert (ambulance.x, ambulance.z) == ambulance.home
    assert ambulance.home in model.helipads
    assert ambulance.altitude == ROOF_ALTITUDE
    assert ambulance.spot is None
    assert model.reserved == {a.spot for a in model.ambulances if a.spot}
