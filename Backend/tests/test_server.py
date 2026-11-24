"""Endpoint tests through Flask's test client."""

import pytest

import city_server


@pytest.fixture()
def client():
    city_server.city_model = None
    return city_server.app.test_client()


def test_update_before_init_returns_a_friendly_error(client):
    response = client.get("/update")
    assert response.status_code == 500
    assert "Server error" in response.get_json()["message"]


def test_init_rejects_a_map_that_is_not_in_city_files(client):
    response = client.post("/init", json={"map": "../city_server.py"})
    assert response.status_code == 400
    assert city_server.city_model is None


def test_init_then_step_reports_cars_with_headings(client):
    init = client.post("/init", json={"seed": 1})
    assert init.get_json()["width"] == 36
    client.get("/update")
    cars = client.get("/getAgents").get_json()["positions"]
    assert len(cars) == 4
    assert all(set(car["heading"]) == {"x", "z"} for car in cars)


def test_traffic_lights_endpoint_reports_every_light_with_its_state(client):
    client.post("/init", json={})
    lights = client.get("/getTrafficLights").get_json()["positions"]
    assert len(lights) == 48
    assert {type(light["state"]) for light in lights} == {bool}


def test_status_counts_spawned_cars(client):
    client.post("/init", json={})
    status = client.get("/getStatus").get_json()
    assert status["spawned"] == 4
    assert status["running"] is True
