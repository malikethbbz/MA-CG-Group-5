import functools
import json
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

import pytest

from traffic_base.city_graph import Position
from traffic_base.model import CITY_FILES, CityModel

TinyCity = Callable[..., CityModel]
History = list[dict[int, Position]]

REFORMA_MAP = "2025_reforma.txt"
TRAFFIC_STEPS = 1000


@pytest.fixture()
def tiny_city(tmp_path: Path) -> TinyCity:
    """Builds a CityModel from a few map rows. 's' lights are green for short_green
    steps of every cycle and 'S' lights for long_green."""

    def build(rows: list[str], short_green: int = 7, long_green: int = 15) -> CityModel:
        symbols = {
            ">": "Right",
            "<": "Left",
            "^": "Up",
            "v": "Down",
            "#": "Obstacle",
            "D": "Destination",
            "A": "Monument",
            ".": "Empty",  # open ground, so only the buildings a test draws exist
            "s": short_green,
            "S": long_green,
        }
        (tmp_path / "mapDictionary.json").write_text(json.dumps(symbols))
        (tmp_path / "city.txt").write_text("\n".join(rows))
        return CityModel(map_name="city.txt", map_dir=tmp_path)

    return build


def car_positions(model: CityModel) -> dict[int, Position]:
    cars = model.cars
    return {car.unique_id: car.cell.coordinate for car in cars}


def raw_map(map_name: str) -> list[str]:
    """Map rows as in the file, top row first."""
    text = (CITY_FILES / map_name).read_text()
    return [line.strip() for line in text.splitlines() if line.strip()]


class TrafficRun(NamedTuple):
    model: CityModel
    history: History  # every car's cell after each step; index 0 is before any step


@functools.cache
def traffic_run(map_name: str, spawn_interval: int) -> TrafficRun:
    """A real map run for TRAFFIC_STEPS steps with seed 42. Cached so every test
    module reads the same run; tests must not step the model."""
    model = CityModel(map_name=map_name, spawn_interval=spawn_interval)
    history = [car_positions(model)]
    for _ in range(TRAFFIC_STEPS):
        model.step()
        history.append(car_positions(model))
    return TrafficRun(model, history)


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
