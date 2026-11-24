"""Endpoint tests through Flask's test client."""

import itertools

import pytest
from flask.testing import FlaskClient

import city_server
from conftest import TinyCity
from traffic_base.city_graph import DIRECTION_VECTORS


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


@pytest.mark.parametrize("path", ["/city", "/step"])
def test_frame_endpoints_get_a_409_before_init(client: FlaskClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 409
    assert "/init" in response.get_json()["message"]


def test_city_holds_every_cell_the_old_endpoints_report(client: FlaskClient) -> None:
    client.post("/init", json={})
    city = client.get("/city").get_json()
    old = {
        key: len(client.get(path).get_json()["positions"])
        for key, path in (
            ("roads", "/getRoads"),
            ("obstacles", "/getObstacles"),
            ("destinations", "/getDestinations"),
            ("lights", "/getTrafficLights"),
        )
    }
    assert {key: len(city[key]) for key in old} == old
    assert old == {"roads": 772, "obstacles": 414, "destinations": 26, "lights": 48}
    assert (city["width"], city["height"]) == (36, 35)
    assert city["helipads"] == [{"x": 2, "z": 2}, {"x": 33, "z": 32}]


def test_each_light_points_the_way_of_the_cell_feeding_it(client: FlaskClient) -> None:
    client.post("/init", json={})
    city = client.get("/city").get_json()
    directions = {
        (cell["x"], cell["z"]): cell["direction"]
        for cell in city["roads"] + city["lights"]
    }
    for light in city["lights"]:
        dx, dz = DIRECTION_VECTORS[light["direction"]]
        assert directions.get((light["x"] - dx, light["z"] - dz)) == light["direction"]


def test_city_and_step_name_the_same_lights(client: FlaskClient) -> None:
    client.post("/init", json={})
    city_ids = [light["id"] for light in client.get("/city").get_json()["lights"]]
    step_ids = [light["id"] for light in client.get("/step").get_json()["lights"]]
    assert len(set(city_ids)) == len(city_ids) == 48
    assert set(step_ids) == set(city_ids)


def test_a_vehicle_vanishes_only_in_the_frame_that_reports_its_arrival(
    client: FlaskClient,
) -> None:
    client.post("/init", json={})
    frames = [client.get("/step").get_json() for _ in range(60)]
    arrivals = 0
    for before, after in itertools.pairwise(frames):
        kinds = {v["id"]: v["kind"] for v in before["vehicles"]}
        now = {v["id"]: v["kind"] for v in after["vehicles"]}
        arrived = {e["id"] for e in after["events"] if e["type"] == "arrived"}
        assert kinds.keys() - now.keys() == arrived
        assert all(now[i] == kinds[i] for i in kinds.keys() & now.keys())
        assert after["step"] == before["step"] + 1
        arrivals += len(arrived)
    # Seed 42 gives five arrivals, two on consecutive steps, so an off-by-one shows.
    assert arrivals >= 5


def test_step_stops_advancing_once_the_run_stops(
    client: FlaskClient, tiny_city: TinyCity
) -> None:
    city_server.city_model = tiny_city([">>s>D"], short_green=1, long_green=1000)
    frames = [client.get("/step").get_json() for _ in range(30)]
    assert [f["step"] for f in frames[19:]] == [20] * 11
    assert frames[-1]["running"] is False
    assert frames[-1]["stats"]["stopReason"] == "every spawn corner is occupied"


def test_a_stopped_run_does_not_report_its_last_events_again(
    client: FlaskClient, tiny_city: TinyCity
) -> None:
    # The light lets the first car through, then holds every later car on the corner,
    # so the spawn at step 20 fails on the step the first car arrives.
    city_server.city_model = tiny_city(
        [">s" + ">" * 18 + "D"], short_green=10, long_green=1000
    )
    frames = [client.get("/step").get_json() for _ in range(22)]
    assert [f["step"] for f in frames[-3:]] == [20, 20, 20]
    assert [e["type"] for e in frames[-3]["events"]] == ["arrived"]
    assert frames[-2]["events"] == frames[-1]["events"] == []
