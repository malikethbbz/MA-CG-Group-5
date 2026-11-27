"""Behavior tests for cars and lights, on the real 2025 maps and on tiny maps."""

from typing import Any

import networkx as nx
import pytest

from conftest import (
    REFORMA_MAP,
    TRAFFIC_STEPS,
    TinyCity,
    TrafficRun,
    car_positions,
    moves,
    traffic_run,
)
from traffic_base.agent import PATIENCE, Car, Motorcycle
from traffic_base.city_graph import DIRECTION_VECTORS, Position, is_legal_move
from traffic_base.model import (
    DEFAULT_MAP,
    MAX_SPAWN_INTERVAL,
    SPAWN_INTERVAL,
    CityModel,
)

RIGHT = DIRECTION_VECTORS["Right"]
PLAYABLE_MAPS = [DEFAULT_MAP, REFORMA_MAP]
LONG_RUNS = [
    (DEFAULT_MAP, SPAWN_INTERVAL),
    (REFORMA_MAP, SPAWN_INTERVAL),
    (REFORMA_MAP, 3),
]


def run_id(spec: tuple[Any, ...]) -> str:
    map_name, interval = spec
    return f"{map_name}-every-{interval}"


@pytest.fixture(scope="module", params=LONG_RUNS, ids=run_id)
def city_run(request: pytest.FixtureRequest) -> TrafficRun:
    """A real map run, recording every car's cell each step."""
    return traffic_run(*request.param)


@pytest.mark.parametrize("map_name", PLAYABLE_MAPS)
def test_every_destination_is_reachable_from_every_spawn_corner(
    map_name: str,
) -> None:
    model = CityModel(map_name=map_name)
    assert len(model.spawn_points) == 4
    for start in model.spawn_points:
        assert set(model.destinations) <= nx.descendants(model.graph, start)
        assert set(model.reachable[start]) == set(model.destinations)


@pytest.mark.parametrize("map_name", PLAYABLE_MAPS)
def test_the_two_light_groups_are_never_green_at_the_same_time(map_name: str) -> None:
    model = CityModel(map_name=map_name)
    short = [t for t in model.traffic_lights if t.offset == 0]
    long = [t for t in model.traffic_lights if t.offset != 0]
    assert short and long
    seen = set()
    for _ in range(2 * short[0].cycle):
        model.step()
        short_green = {t.state for t in short}
        long_green = {t.state for t in long}
        assert len(short_green) == len(long_green) == 1  # each group switches together
        assert short_green != long_green
        seen.add(short_green.pop())
    assert seen == {True, False}  # both groups actually took a turn


def test_cars_never_share_a_cell(city_run: TrafficRun) -> None:
    _, history = city_run
    for positions in history:
        assert len(set(positions.values())) == len(positions)


def test_cars_only_move_one_cell_with_the_street_direction(
    city_run: TrafficRun,
) -> None:
    model, history = city_run
    steps = moves(history)
    for _, _, (x, y), (nx_, ny) in steps:
        move = (nx_ - x, ny - y)
        assert max(abs(move[0]), abs(move[1])) == 1
        if (nx_, ny) in model.drivable:
            assert is_legal_move(
                move, model.drivable[(x, y)], model.drivable[(nx_, ny)]
            )
    assert len(steps) > 1000  # the run really exercised the movement rules


def test_diagonal_moves_never_cut_a_building_corner(
    city_run: TrafficRun,
) -> None:
    """Checked on raw map cells, independent of the graph's own move rule."""
    model, history = city_run
    diagonals = [
        (a, b) for _, _, a, b in moves(history) if a[0] != b[0] and a[1] != b[1]
    ]
    for (x, y), (nx_, ny) in diagonals:
        assert (nx_, y) in model.drivable and (x, ny) in model.drivable
    assert len(diagonals) > 100


def test_cars_never_enter_a_red_light(city_run: TrafficRun) -> None:
    model, history = city_run
    lights = {t.cell.coordinate: t for t in model.traffic_lights}
    entries = [
        (t, car_id, dst)
        for t, car_id, src, dst in moves(history)
        if dst in lights and src not in lights
    ]
    for t, car_id, pos in entries:
        assert lights[pos].is_green(t), f"car {car_id} ran a red at {pos}, step {t}"
    assert len(entries) > 50


def test_cars_reach_destinations_and_are_removed(
    city_run: TrafficRun,
) -> None:
    model, history = city_run
    assert model.arrived > 100
    assert model.spawned == model.arrived + model.active_cars
    assert not any(pos in model.destinations for pos in history[-1].values())


def test_four_cars_spawn_every_spawn_interval_while_corners_are_free() -> None:
    model = CityModel()
    assert model.spawned == 4
    for _ in range(SPAWN_INTERVAL):
        model.step()
    assert model.spawned == 8


def test_car_waits_at_a_light_that_stays_red_and_the_run_stops(
    tiny_city: TinyCity,
) -> None:
    model = tiny_city([">>s>D"], short_green=1, long_green=1000)
    while model.running and model.steps < 100:
        model.step()
        assert (2, 0) not in car_positions(model).values()
    assert model.arrived == 0
    assert model.steps == 2 * SPAWN_INTERVAL  # second spawn step found the corner taken
    stats = model.stats()
    assert stats["stopReason"] == "every spawn corner is occupied"
    assert stats["avgTripSteps"] is None


def test_same_cars_drive_through_when_the_light_is_green(tiny_city: TinyCity) -> None:
    model = tiny_city([">>s>D"], short_green=1000, long_green=1)
    for _ in range(25):
        model.step()
    stats = model.stats()
    assert stats["arrived"] == 3  # cars from steps 0, 10 and 20
    assert stats["avgTripSteps"] == 4  # four cells to the destination, no waiting
    assert stats["avgWaitSteps"] == 0
    assert model.running


def test_car_already_on_a_light_keeps_going_when_it_turns_red(
    tiny_city: TinyCity,
) -> None:
    # Two lights in a row, green only on steps 0 and 1: the car enters the first on
    # step 1 and must not stop on it when the second turns red on step 2.
    model = tiny_city([">ss>D"], short_green=2, long_green=1000)
    for _ in range(5):
        model.step()
    assert not model.traffic_lights[0].state
    assert model.arrived == 1


def test_run_stops_with_a_reason_when_no_corner_reaches_a_destination(
    tiny_city: TinyCity,
) -> None:
    model = tiny_city(["<<<<D"])  # the only spawn corner points off the map
    assert model.reachable == {(0, 0): []}
    for _ in range(SPAWN_INTERVAL):
        model.step()
    assert not model.running
    assert model.stats()["stopReason"] == "no spawn corner can reach a destination"


def place_car_alone(model: CityModel, at: Position, destination: Position) -> Car:
    return Car(model, model.grid[at], destination, model.drivable[at])


@pytest.mark.parametrize("seed", [1, 2, 3, 42])
def test_a_bumper_to_bumper_queue_moves_up_together_in_one_step(
    tiny_city: TinyCity, seed: int
) -> None:
    """Six cars nose to tail on a clear road all advance a cell in the same step,
    whatever order they are drawn in. Moving them in one random pass only advanced
    the cars drawn front to back, so most of the queue stood still."""
    model = tiny_city([">" * 9 + "D"])
    model.random.seed(seed)
    for car in list(model.cars):
        car.remove()
    queue = [place_car_alone(model, (x, 0), (9, 0)) for x in range(6)]
    model.step()
    assert [car.cell.coordinate for car in queue] == [(x + 1, 0) for x in range(6)]
    assert all(car.state == "driving" for car in queue)


def test_a_queue_still_never_puts_two_cars_on_one_cell(tiny_city: TinyCity) -> None:
    # Two lanes merging into one: the retries must not let a second car into a
    # cell the first one took this step.
    model = tiny_city([">>>>>>D", ">>>>>>D"])
    for _ in range(60):
        model.step()
        cells = [car.cell.coordinate for car in model.cars]
        assert len(cells) == len(set(cells))


def test_blocked_car_reroutes_around_a_stalled_car_and_arrives(
    tiny_city: TinyCity,
) -> None:
    model = tiny_city([">>>>>", ">>>>D"])
    for car in list(model.cars):
        car.remove()
    stalled = place_car_alone(model, (1, 0), (4, 0))
    stalled.route = []  # broken down: never moves again
    car = place_car_alone(model, (0, 0), (4, 0))
    assert car.route[0] == (1, 0)

    for _ in range(PATIENCE):
        model.step()
    assert car.cell.coordinate == (0, 0)
    assert car.route and (1, 0) not in car.route

    for _ in range(SPAWN_INTERVAL - PATIENCE - 1):  # stop before the next spawn
        model.step()
    assert model.arrived == 1


def test_blocked_car_with_no_detour_retries_once_per_patience_window(
    tiny_city: TinyCity,
) -> None:
    # Car 1 waits at a red light forever; car 2 queues behind it on a one-lane road.
    model = tiny_city([">>s>D"], short_green=1, long_green=1000)
    for _ in range(SPAWN_INTERVAL):
        model.step()
    calls = []
    original_route = model.route

    def counting_route(*args: object, **kwargs: object) -> list[Position]:
        calls.append(kwargs.get("avoid"))
        return original_route(*args, **kwargs)

    model.route = counting_route
    while model.running:
        model.step()
    blocked_steps = model.steps - SPAWN_INTERVAL
    assert calls == [{(1, 0)}] * (blocked_steps // PATIENCE)


def test_motorcycles_spawn_and_follow_the_same_rules(
    city_run: TrafficRun,
) -> None:
    # city_run's invariants (one cell per car, street direction, no red lights) cover
    # every Car subclass because model.cars selects by isinstance.
    model, _ = city_run
    kinds = {frame["kind"] for frame in model.vehicles()}
    assert {"car", "motorcycle"} <= kinds
    share = sum(isinstance(c, Motorcycle) for c in model.cars) / model.active_cars
    assert 0 < share < 1


def test_a_shorter_spawn_interval_spawns_sooner() -> None:
    model = CityModel(spawn_interval=3)
    for _ in range(3):
        model.step()
    assert model.spawned == 8


@pytest.mark.parametrize("interval", [0, MAX_SPAWN_INTERVAL + 1])
def test_spawn_interval_outside_the_allowed_range_is_rejected(interval: int) -> None:
    with pytest.raises(ValueError, match="spawn_interval"):
        CityModel(spawn_interval=interval)


def test_a_long_run_keeps_flowing(city_run: TrafficRun) -> None:
    model, _ = city_run
    assert model.running, model.stop_reason
    assert model.steps == TRAFFIC_STEPS
    assert model.arrived > model.spawned * 0.8  # the city is not slowly filling up


@pytest.mark.parametrize(
    "map_name", ["2021_base.txt", "2022_base.txt", "2023_base.txt"]
)
def test_older_maps_still_load_with_every_destination_reachable(map_name: str) -> None:
    model = CityModel(map_name=map_name)
    assert len(model.spawn_points) >= 3
    for start in model.spawn_points:
        assert set(model.reachable[start]) == set(model.destinations)
    assert model.monuments == []


def test_the_2024_map_still_fails_on_its_orphan_light() -> None:
    with pytest.raises(ValueError, match=r"cannot infer a direction.*\(4, 19\)"):
        CityModel(map_name="2024_base.txt")


def test_a_map_symbol_missing_from_the_dictionary_is_rejected(
    tiny_city: TinyCity,
) -> None:
    with pytest.raises(ValueError, match=r"'\?' at row 0, column 2"):
        tiny_city([">>?>D"])
