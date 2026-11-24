"""Endpoint tests through Flask's test client."""

import pytest
from flask.testing import FlaskClient

import city_server
from conftest import TinyCity


@pytest.fixture()
def client() -> FlaskClient:
    city_server.city_model = None
    return city_server.app.test_client()


def test_requests_before_init_get_a_409_that_says_to_call_init(
    client: FlaskClient,
) -> None:
    response = client.get("/update")
    assert response.status_code == 409
    assert "/init" in response.get_json()["message"]


def test_init_rejects_a_map_that_is_not_in_city_files(client: FlaskClient) -> None:
    response = client.post("/init", json={"map": "../city_server.py"})
    assert response.status_code == 400
    assert city_server.city_model is None


@pytest.mark.parametrize("map_name", [["2025_base.txt"], {"a": 1}, 7])
def test_init_rejects_a_map_that_is_not_a_string(
    client: FlaskClient, map_name: object
) -> None:
    response = client.post("/init", json={"map": map_name})
    assert response.status_code == 400


@pytest.mark.parametrize("body", ["{not json", "[1, 2]"])
def test_init_rejects_a_body_that_is_not_a_json_object(
    client: FlaskClient, body: str
) -> None:
    response = client.post("/init", data=body, content_type="application/json")
    assert response.status_code == 400
    assert city_server.city_model is None


@pytest.mark.parametrize("body", ["[]", "0", '""', "false", "null"])
def test_init_rejects_a_falsy_json_body_that_is_not_an_object(
    client: FlaskClient, body: str
) -> None:
    response = client.post("/init", data=body, content_type="application/json")
    assert response.status_code == 400
    assert response.get_json()["message"] == "Body must be a JSON object."
    assert city_server.city_model is None


def test_init_without_a_body_uses_the_default_map(client: FlaskClient) -> None:
    response = client.post("/init")
    assert response.status_code == 200
    assert response.get_json()["width"] == 36


@pytest.mark.parametrize("seed", [-1, 2**32, "7", 1.5, True])
def test_init_rejects_seeds_that_are_not_small_integers(
    client: FlaskClient, seed: object
) -> None:
    response = client.post("/init", json={"seed": seed})
    assert response.status_code == 400
    assert city_server.city_model is None


def test_init_names_the_map_when_it_cannot_be_loaded(client: FlaskClient) -> None:
    response = client.post("/init", json={"map": "2024_base.txt"})
    assert response.status_code == 400
    assert "2024_base.txt" in response.get_json()["message"]


def test_init_then_step_reports_cars_with_headings(client: FlaskClient) -> None:
    init = client.post("/init", json={"seed": 1})
    assert init.get_json()["width"] == 36
    client.get("/update")
    cars = client.get("/getAgents").get_json()["positions"]
    assert len(cars) == 4
    assert all(set(car["heading"]) == {"x", "z"} for car in cars)


def test_static_endpoints_report_every_map_cell(client: FlaskClient) -> None:
    client.post("/init", json={})
    counts = {
        path: len(client.get(path).get_json()["positions"])
        for path in (
            "/getRoads",
            "/getObstacles",
            "/getDestinations",
            "/getTrafficLights",
        )
    }
    assert counts == {
        "/getRoads": 772,
        "/getObstacles": 414,
        "/getDestinations": 26,
        "/getTrafficLights": 48,
    }


def test_lights_and_roads_carry_their_state_and_direction(client: FlaskClient) -> None:
    client.post("/init", json={})
    lights = client.get("/getTrafficLights").get_json()["positions"]
    roads = client.get("/getRoads").get_json()["positions"]
    assert {type(light["state"]) for light in lights} == {bool}
    assert {road["direction"] for road in roads} == {"Up", "Down", "Left", "Right"}


def test_status_counts_spawned_cars(client: FlaskClient) -> None:
    client.post("/init", json={})
    status = client.get("/getStatus").get_json()
    assert status["spawned"] == 4
    assert status["running"] is True
    assert status["avgTripSteps"] is None


def test_update_stops_advancing_once_the_run_stops(
    client: FlaskClient, tiny_city: TinyCity
) -> None:
    city_server.city_model = tiny_city([">>s>D"], short_green=1, long_green=1000)
    for _ in range(30):
        last = client.get("/update").get_json()
    assert last["running"] is False
    assert last["currentStep"] == 20
    status = client.get("/getStatus").get_json()
    assert status["stopReason"] == "every spawn corner is occupied"
