"""Tests for the /init options the GUI sends: cars per spawn, ambulances and the
chance of an emergency."""

import pytest
from flask.testing import FlaskClient

import city_server
from traffic_base.ambulance import Ambulance, Emergency
from traffic_base.model import CityModel


@pytest.fixture()
def client() -> FlaskClient:
    city_server.city_model = None
    return city_server.app.test_client()


def count(model: CityModel, agent_type: type) -> int:
    return len(model.agents.select(agent_type=agent_type))


def test_cars_per_spawn_limits_how_many_cars_a_spawn_step_adds() -> None:
    # By default every free corner gets a car
    assert CityModel().spawned == 4
    assert CityModel(cars_per_spawn=1).spawned == 1
    assert CityModel(cars_per_spawn=2).spawned == 2


@pytest.mark.parametrize("ambulances", [0, 1, 2])
def test_the_model_has_as_many_ambulances_as_asked(ambulances: int) -> None:
    model = CityModel(ambulances=ambulances)
    assert count(model, Ambulance) == ambulances
    assert len(model.helipads) == ambulances


def test_without_ambulances_emergencies_still_open_but_nobody_serves_them() -> None:
    model = CityModel(ambulances=0)
    for _ in range(100):
        model.step()
    assert count(model, Emergency) > 0
    assert model.emergencies_served == 0


def test_an_emergency_chance_of_zero_never_opens_an_emergency() -> None:
    model = CityModel(emergency_chance=0)
    for _ in range(200):
        model.step()
        assert all(event["type"] != "emergency" for event in model.events)
    assert count(model, Emergency) == 0


def test_a_lower_emergency_chance_opens_fewer_emergencies() -> None:
    def opened(chance: float) -> int:
        model = CityModel(emergency_chance=chance)
        total = 0
        for _ in range(1000):
            model.step()
            total += sum(1 for e in model.events if e["type"] == "emergency")
        return total

    assert 0 < opened(0.3) < opened(1.0)


def test_init_passes_the_new_options_to_the_model(client: FlaskClient) -> None:
    body = {"carsPerSpawn": 2, "ambulances": 1, "emergencyChance": 0.5}
    assert client.post("/init", json=body).status_code == 200
    model = city_server.city_model
    assert model.spawned == 2
    assert count(model, Ambulance) == 1
    assert model.emergency_chance == 0.5
    assert client.get("/city").get_json()["helipads"] == [
        {"x": x, "z": y} for x, y in model.helipads
    ]


@pytest.mark.parametrize(
    "body",
    [
        {"carsPerSpawn": 0},
        {"carsPerSpawn": 5},
        {"carsPerSpawn": "two"},
        {"ambulances": 3},
        {"ambulances": -1},
        {"emergencyChance": 1.5},
        {"emergencyChance": -0.1},
        {"emergencyChance": "half"},
        {"seed": float("inf")},
    ],
)
def test_init_rejects_options_out_of_range(client: FlaskClient, body: dict) -> None:
    response = client.post("/init", json=body)
    assert response.status_code == 400
    assert city_server.city_model is None
