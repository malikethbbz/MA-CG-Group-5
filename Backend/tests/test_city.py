"""Behavior tests for cars and lights, on the real 2025 map and on tiny maps."""

import networkx as nx
import pytest

from conftest import TinyCity, car_positions
from traffic_base.agent import PATIENCE, Car
from traffic_base.city_graph import DIRECTION_VECTORS, Position, is_legal_move
from traffic_base.model import SPAWN_INTERVAL, CityModel

RIGHT = DIRECTION_VECTORS["Right"]
History = list[dict[int, Position]]


@pytest.fixture(scope="module")
def city_run() -> tuple[CityModel, History]:
    """The real 2025 map run for 600 steps, recording every car's cell each step."""
    model = CityModel()
    history = [car_positions(model)]
    for _ in range(600):
        model.step()
        history.append(car_positions(model))
    return model, history


def moves(history: History) -> list[tuple[int, int, Position, Position]]:
    """(step, car id, from, to) for every car that changed cell."""
    return [
        (t, car_id, before[car_id], after[car_id])
        for t, (before, after) in enumerate(
            zip(history, history[1:], strict=False), start=1
        )
        for car_id in before.keys() & after.keys()
        if before[car_id] != after[car_id]
    ]


def test_every_destination_is_reachable_from_every_spawn_corner() -> None:
    model = CityModel()
    assert len(model.spawn_points) == 4
    for start in model.spawn_points:
        assert set(model.destinations) <= nx.descendants(model.graph, start)


def test_the_two_light_groups_are_never_green_at_the_same_time() -> None:
    model = CityModel()
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


def test_cars_never_share_a_cell(city_run: tuple[CityModel, History]) -> None:
    _, history = city_run
    for positions in history:
        assert len(set(positions.values())) == len(positions)


def test_cars_only_move_one_cell_with_the_street_direction(
    city_run: tuple[CityModel, History],
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
    city_run: tuple[CityModel, History],
) -> None:
    """Checked on raw map cells, independent of the graph's own move rule."""
    model, history = city_run
    diagonals = [
        (a, b) for _, _, a, b in moves(history) if a[0] != b[0] and a[1] != b[1]
    ]
    for (x, y), (nx_, ny) in diagonals:
        assert (nx_, y) in model.drivable and (x, ny) in model.drivable
    assert len(diagonals) > 100


def test_cars_never_enter_a_red_light(city_run: tuple[CityModel, History]) -> None:
    model, history = city_run
    lights = {t.cell.coordinate: t for t in model.traffic_lights}
    entries = [
        (t, car_id, dst)
        for t, car_id, src, dst in moves(history)
        if dst in lights and src not in lights
    ]
    for t, car_id, pos in entries:
        assert lights[pos]._is_green(t), f"car {car_id} ran a red at {pos}, step {t}"
    assert len(entries) > 50


def test_cars_reach_destinations_and_are_removed(
    city_run: tuple[CityModel, History],
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
    tiny_city: TinyCity, caplog: pytest.LogCaptureFixture
) -> None:
    model = tiny_city(["<<<<D"])  # the only spawn corner points off the map
    assert "cannot reach any destination" in caplog.text
    for _ in range(SPAWN_INTERVAL):
        model.step()
    assert not model.running
    assert model.stats()["stopReason"] == "no spawn corner can reach a destination"


def place_car_alone(model: CityModel, at: Position, destination: Position) -> Car:
    return Car(model, model.grid[at], destination, model.drivable[at])


def test_blocked_car_reroutes_around_a_stalled_car_and_arrives(
    tiny_city: TinyCity,
) -> None:
    model = tiny_city([">>>>>", ">>>>D"])
    for car in list(model.agents_by_type[Car]):
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
