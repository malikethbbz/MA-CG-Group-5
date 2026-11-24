"""Behavior tests for routing, traffic lights, and cars on the real map and tiny maps."""

import json

import networkx as nx
import pytest

from traffic_base.agent import Car
from traffic_base.city_graph import DIRECTION_VECTORS, is_legal_move
from traffic_base.model import CityModel

RIGHT, LEFT = DIRECTION_VECTORS["Right"], DIRECTION_VECTORS["Left"]
UP, DOWN = DIRECTION_VECTORS["Up"], DIRECTION_VECTORS["Down"]


def tiny_city(tmp_path, rows: list[str], short_green: int, long_green: int) -> CityModel:
    """One-file city whose 's' lights are green for short_green steps per cycle."""
    symbols = {">": "Right", "<": "Left", "^": "Up", "v": "Down", "#": "Obstacle",
               "D": "Destination", "s": short_green, "S": long_green}
    (tmp_path / "mapDictionary.json").write_text(json.dumps(symbols))
    (tmp_path / "city.txt").write_text("\n".join(rows))
    return CityModel(map_name="city.txt", map_dir=tmp_path)


def car_positions(model: CityModel) -> dict[int, tuple[int, int]]:
    return {car.unique_id: car.cell.coordinate for car in model.agents_by_type.get(Car, [])}


@pytest.fixture(scope="module")
def city_run():
    """The real 2025 map run for 600 steps, recording every car's cell each step."""
    model = CityModel()
    history = [car_positions(model)]
    for _ in range(600):
        model.step()
        history.append(car_positions(model))
    return model, history


# --- Routing rules ---------------------------------------------------------

def test_driving_forward_is_legal():
    assert is_legal_move(RIGHT, RIGHT, RIGHT)


def test_driving_backwards_is_illegal():
    assert not is_legal_move(LEFT, RIGHT, RIGHT)


def test_sliding_into_the_opposite_lane_is_illegal():
    assert not is_legal_move(UP, RIGHT, LEFT)


def test_crossing_an_intersection_that_points_across_your_path_is_legal():
    # Driving down a column through a row of '<' cells, then into the next 'v'.
    assert is_legal_move(DOWN, DOWN, LEFT)
    assert is_legal_move(DOWN, LEFT, DOWN)


def test_every_destination_is_reachable_from_every_spawn_corner():
    model = CityModel()
    assert len(model.spawn_points) == 4
    for start in model.spawn_points:
        reachable = nx.descendants(model.graph, start)
        assert set(model.destinations) <= reachable


# --- Traffic lights --------------------------------------------------------

def test_the_two_light_groups_are_never_green_at_the_same_time():
    model = CityModel()
    short = [t for t in model.traffic_lights if t.green_steps == 7]
    long = [t for t in model.traffic_lights if t.green_steps == 15]
    assert short and long
    for _ in range(60):
        model.step()
        assert {t.state for t in short} == {not long[0].state}
        assert {t.state for t in long} == {long[0].state}


# --- Cars on the real map --------------------------------------------------

def test_cars_never_share_a_cell(city_run):
    _, history = city_run
    for positions in history:
        assert len(set(positions.values())) == len(positions)


def test_cars_only_move_with_the_street_direction(city_run):
    model, history = city_run
    moves = 0
    for before, after in zip(history, history[1:]):
        for car_id, (x, y) in before.items():
            if car_id not in after or after[car_id] == (x, y):
                continue
            nx_, ny = after[car_id]
            move = (nx_ - x, ny - y)
            assert max(abs(move[0]), abs(move[1])) == 1, "cars move one cell per step"
            if (nx_, ny) in model.drivable:
                assert is_legal_move(move, model.drivable[(x, y)], model.drivable[(nx_, ny)])
            moves += 1
    assert moves > 1000  # the run really exercised the movement rules


def test_cars_never_enter_a_red_light(city_run):
    model, history = city_run
    # Replay light states: state at step t is the same function the lights use.
    lights = {t.cell.coordinate: t for t in model.traffic_lights}
    entries = 0
    for t, (before, after) in enumerate(zip(history, history[1:]), start=1):
        for car_id, pos in after.items():
            prev = before.get(car_id)
            if pos in lights and prev is not None and prev != pos and prev not in lights:
                assert lights[pos]._is_green(t), f"car {car_id} ran a red at {pos}, step {t}"
                entries += 1
    assert entries > 50


def test_cars_reach_destinations_and_are_removed(city_run):
    model, history = city_run
    assert model.arrived > 100
    assert model.spawned == model.arrived + model.active_cars
    assert not any(pos in model.destinations for pos in history[-1].values())


def test_four_cars_spawn_every_ten_steps_while_corners_are_free():
    model = CityModel()
    assert model.spawned == 4
    for _ in range(10):
        model.step()
    assert model.spawned == 8


# --- Negative control on a tiny map: only the light timing differs ---------

def test_car_waits_at_a_light_that_stays_red_and_the_simulation_stops(tmp_path):
    model = tiny_city(tmp_path, [">>s>D"], short_green=1, long_green=1000)
    while model.running and model.steps < 100:
        model.step()
        assert (2, 0) not in car_positions(model).values()
    assert model.arrived == 0
    assert not model.running  # step 20: the spawn corner was still occupied
    assert model.steps == 20
    assert model.spawned == 2


def test_same_car_drives_through_when_the_light_is_green(tmp_path):
    model = tiny_city(tmp_path, [">>s>D"], short_green=1000, long_green=1)
    for _ in range(25):
        model.step()
    assert model.arrived == 3  # cars from steps 0, 10 and 20 all arrived
    assert model.running
