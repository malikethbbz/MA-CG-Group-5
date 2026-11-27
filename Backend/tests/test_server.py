"""Endpoint tests for /init, /city and /step through Flask's test client."""

import itertools

import pytest
from flask.testing import FlaskClient

import city_server
from conftest import REFORMA_MAP, TinyCity
from traffic_base.city_graph import DIRECTION_VECTORS


@pytest.fixture()
def client() -> FlaskClient:
    city_server.city_model = None
    return city_server.app.test_client()


@pytest.mark.parametrize("path", ["/city", "/step"])
def test_requests_before_init_get_a_409_that_says_to_call_init(
    client: FlaskClient, path: str
) -> None:
    response = client.get(path)
    assert response.status_code == 409
    assert "/init" in response.get_json()["message"]


@pytest.mark.parametrize("map_name", ["../city_server.py", "2019_base.txt", 7])
def test_init_rejects_a_map_that_is_not_in_city_files(
    client: FlaskClient, map_name: object
) -> None:
    response = client.post("/init", json={"map": map_name})
    assert response.status_code == 400
    assert city_server.city_model is None


@pytest.mark.parametrize("body", ["{not json", "[1, 2]", "null", '{"seed": "x"}'])
def test_init_rejects_a_body_that_is_not_a_json_object_of_options(
    client: FlaskClient, body: str
) -> None:
    response = client.post("/init", data=body, content_type="application/json")
    assert response.status_code == 400
    assert city_server.city_model is None


def test_init_without_a_body_uses_the_default_map(client: FlaskClient) -> None:
    response = client.post("/init")
    assert response.status_code == 200
    assert response.get_json()["width"] == 36


def test_init_passes_the_spawn_interval_to_the_model(client: FlaskClient) -> None:
    client.post("/init", json={"spawnInterval": 2})
    for _ in range(2):
        frame = client.get("/step").get_json()
    assert frame["stats"]["spawned"] == 8


def test_city_lists_every_map_cell_and_the_hospital(client: FlaskClient) -> None:
    client.post("/init", json={})
    city = client.get("/city").get_json()
    counts = {key: len(city[key]) for key in ("roads", "obstacles", "destinations")}
    assert counts == {"roads": 772, "obstacles": 414, "destinations": 26}
    assert len(city["lights"]) == 48
    assert (city["width"], city["height"]) == (36, 35)
    model = city_server.city_model
    assert city["hospital"] == {"x": model.hospital[0], "z": model.hospital[1]}
    assert city["helipads"][0] == city["hospital"]
    assert city["hospital"] in city["obstacles"]
    assert {road["direction"] for road in city["roads"]} == {
        "Up",
        "Down",
        "Left",
        "Right",
    }


def test_city_lists_the_reforma_monument_as_a_landmark_and_never_as_an_obstacle(
    client: FlaskClient,
) -> None:
    assert client.post("/init", json={"map": REFORMA_MAP}).status_code == 200
    city = client.get("/city").get_json()
    # File row 14, column 15 of a 35-row map is grid (15, 35 - 14 - 1).
    assert city["landmarks"] == [{"kind": "monument", "x": 15, "z": 20}]
    for key in ("roads", "obstacles", "destinations", "lights"):
        assert all((c["x"], c["z"]) != (15, 20) for c in city[key])
    frames = [client.get("/step").get_json() for _ in range(100)]
    on_road = [v for f in frames for v in f["vehicles"] if v["y"] == 0]
    assert on_road
    assert all((v["x"], v["z"]) != (15, 20) for v in on_road)


def test_the_base_map_has_no_landmarks(client: FlaskClient) -> None:
    client.post("/init", json={})
    assert client.get("/city").get_json()["landmarks"] == []


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
    step_lights = client.get("/step").get_json()["lights"]
    assert len(set(city_ids)) == len(city_ids) == 48
    assert {light["id"] for light in step_lights} == set(city_ids)
    assert {type(light["green"]) for light in step_lights} == {bool}


def test_step_reports_cars_with_headings(client: FlaskClient) -> None:
    client.post("/init", json={"seed": 1})
    frame = client.get("/step").get_json()
    cars = [v for v in frame["vehicles"] if v["kind"] in ("car", "motorcycle")]
    assert len(cars) == 4
    assert all(set(car["heading"]) == {"x", "z"} for car in cars)
    assert frame["stats"]["spawned"] == 4
    assert frame["stats"]["avgTripSteps"] is None


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
