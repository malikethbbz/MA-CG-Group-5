import json
from collections.abc import Callable
from pathlib import Path

import pytest

from traffic_base.agent import Car
from traffic_base.city_graph import Position
from traffic_base.model import CityModel

TinyCity = Callable[..., CityModel]


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
            "s": short_green,
            "S": long_green,
        }
        (tmp_path / "mapDictionary.json").write_text(json.dumps(symbols))
        (tmp_path / "city.txt").write_text("\n".join(rows))
        return CityModel(map_name="city.txt", map_dir=tmp_path)

    return build


def car_positions(model: CityModel) -> dict[int, Position]:
    cars = model.agents_by_type.get(Car, [])
    return {car.unique_id: car.cell.coordinate for car in cars}
