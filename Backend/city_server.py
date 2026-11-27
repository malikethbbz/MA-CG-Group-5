# TC2008B. Sistemas Multiagentes y Gráficas Computacionales
# Flask server that runs the Mesa city model and serves its state to the WebGL client.
# Based on Octavio Navarro's 2024 example. docs/frame-api.md describes the routes.

import json
import logging
import os

from flask import Flask, jsonify, request
from flask_cors import CORS

from traffic_base.agent import Car, Destination, Obstacle, Road, Traffic_Light
from traffic_base.city_graph import DIRECTION_VECTORS
from traffic_base.model import (
    CITY_FILES,
    DEFAULT_MAP,
    MAX_SPAWN_INTERVAL,
    SPAWN_INTERVAL,
    SPAWN_MODES,
    CityModel,
)

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42
MAX_SEED = 2**32  # numpy's seed range
DEFAULT_PORT = 8585

# Every map file the client may ask for in /init.
AVAILABLE_MAPS = set()
for map_path in CITY_FILES.glob("*.txt"):
    AVAILABLE_MAPS.add(map_path.name)

# (0, 1) -> "Up", and so on, to send the lights' direction by name.
DIRECTION_NAMES = {}
for name, vector in DIRECTION_VECTORS.items():
    DIRECTION_NAMES[vector] = name

city_model = None

# This application will be used to interact with WebGL. Any localhost port may call
# it, since the frontend dev server picks its own port.
app = Flask("Traffic example")
CORS(app, origins=[r"http://localhost(:\d+)?", r"http://127\.0\.0\.1(:\d+)?"])


class InitParamsError(Exception):
    """A bad /init parameter. The message is sent to the client."""


def model_not_ready():
    return jsonify({"message": "Model not initialized. Call /init first."}), 409


def server_error(route):
    # Unexpected bug: log the traceback, keep the client message short.
    logger.exception("%s failed", route)
    return jsonify({"message": "Server error, check the server log."}), 500


def int_param(params, key, default, low, high):
    """Reads an integer in [low, high]. JSON booleans are rejected even though bool
    is an int in Python."""
    value = params.get(key, default)
    is_int = isinstance(value, int) and not isinstance(value, bool)
    if not is_int or not low <= value <= high:
        raise InitParamsError(f"{key} must be an integer from {low} to {high}.")
    return value


def choice_param(params, key, default, options):
    """Reads a string that must be one of the options."""
    value = params.get(key, default)
    if not isinstance(value, str) or value not in options:
        raise InitParamsError(f"{key} must be one of {sorted(options)}.")
    return value


def read_init_params():
    """Reads the /init body. No body means "use the defaults"."""
    params = {}
    raw = request.get_data()
    if raw:
        # Parsed by hand: get_json returns None for both bad JSON and a `null` body.
        try:
            params = json.loads(raw)
        except ValueError as error:
            raise InitParamsError("Body must be JSON.") from error
    if not isinstance(params, dict):
        raise InitParamsError("Body must be a JSON object.")

    spawn_points = choice_param(params, "spawnPoints", "corners", SPAWN_MODES)
    map_name = choice_param(params, "map", DEFAULT_MAP, AVAILABLE_MAPS)
    seed = int_param(params, "seed", DEFAULT_SEED, 0, MAX_SEED - 1)
    spawn_interval = int_param(
        params, "spawnInterval", SPAWN_INTERVAL, 1, MAX_SPAWN_INTERVAL
    )
    return map_name, seed, spawn_interval, spawn_points


def agent_position(agent):
    """The position of an agent for the per-type routes. Grid (x, y) is sent as
    world (x, z); y is the height in the 3D scene."""
    x, y = agent.cell.coordinate
    return {"id": str(agent.unique_id), "x": x, "y": 1, "z": y}


def all_of(agent_type):
    # select also matches subclasses, so Car includes the motorcycles.
    return city_model.agents.select(agent_type=agent_type)


def cells_xz(cells):
    """Grid cells (x, y) as world {x, z}. The frontend picks each mesh's height."""
    return [{"x": x, "z": y} for x, y in cells]


# This route creates the model. It takes an optional JSON object with map, seed,
# spawnInterval and spawnPoints.
@app.route("/init", methods=["GET", "POST"])
def init_model():
    global city_model

    try:
        map_name, seed, spawn_interval, spawn_points = read_init_params()
    except InitParamsError as error:
        return jsonify({"message": str(error)}), 400

    try:
        city_model = CityModel(
            map_name=map_name,
            seed=seed,
            spawn_interval=spawn_interval,
            spawn_points=spawn_points,
        )
    except (OSError, ValueError, KeyError):
        logger.exception("map %s could not be loaded", map_name)
        return jsonify({"message": f"Map {map_name} could not be loaded."}), 400

    return jsonify(
        {
            "message": "Model initiated.",
            "width": city_model.width,
            "height": city_model.height,
        }
    )


# This route sends the static map once, after /init.
@app.route("/city", methods=["GET"])
def get_city():
    if city_model is None:
        return model_not_ready()
    try:
        roads = []
        for road in all_of(Road):
            x, y = road.cell.coordinate
            roads.append({"x": x, "z": y, "direction": road.direction})

        lights = []
        for light in city_model.traffic_lights:
            x, y = light.cell.coordinate
            direction = DIRECTION_NAMES[city_model.drivable[(x, y)]]
            lights.append(
                {"x": x, "z": y, "id": str(light.unique_id), "direction": direction}
            )

        obstacles = [o.cell.coordinate for o in all_of(Obstacle)]
        destinations = [d.cell.coordinate for d in all_of(Destination)]
        landmarks = []
        for x, y in city_model.monuments:
            landmarks.append({"x": x, "z": y, "kind": "monument"})

        return jsonify(
            {
                "width": city_model.width,
                "height": city_model.height,
                "roads": roads,
                "obstacles": cells_xz(obstacles),
                "destinations": cells_xz(destinations),
                "lights": lights,
                "helipads": cells_xz(city_model.helipads),
                "landmarks": landmarks,
            }
        )
    except Exception:
        return server_error("/city")


# This route advances the model one step and sends everything that moves.
@app.route("/step", methods=["GET"])
def step_model():
    if city_model is None:
        return model_not_ready()
    try:
        advanced = city_model.running
        if advanced:
            city_model.step()

        lights = []
        for light in city_model.traffic_lights:
            lights.append({"id": str(light.unique_id), "green": light.state})

        # A stopped run sends its last frame again; its events were already sent.
        events = city_model.events if advanced else []
        return jsonify(
            {
                "step": city_model.steps,
                "running": city_model.running,
                "stats": city_model.stats(),
                "lights": lights,
                "vehicles": city_model.vehicles(),
                "events": events,
            }
        )
    except Exception:
        return server_error("/step")


# The routes below are the per-type routes of the class example. /city and /step
# replace them, but they still work.
@app.route("/getAgents", methods=["GET"])
def get_agents():
    if city_model is None:
        return model_not_ready()
    try:
        positions = []
        for car in all_of(Car):
            position = agent_position(car)
            position["heading"] = {"x": car.heading[0], "z": car.heading[1]}
            positions.append(position)
        return jsonify({"positions": positions})
    except Exception:
        return server_error("/getAgents")


@app.route("/getObstacles", methods=["GET"])
def get_obstacles():
    if city_model is None:
        return model_not_ready()
    try:
        obstacles = [agent_position(o) for o in all_of(Obstacle)]
        return jsonify({"positions": obstacles})
    except Exception:
        return server_error("/getObstacles")


@app.route("/getTrafficLights", methods=["GET"])
def get_traffic_lights():
    if city_model is None:
        return model_not_ready()
    try:
        positions = []
        for light in all_of(Traffic_Light):
            position = agent_position(light)
            position["state"] = light.state
            positions.append(position)
        return jsonify({"positions": positions})
    except Exception:
        return server_error("/getTrafficLights")


@app.route("/getRoads", methods=["GET"])
def get_roads():
    if city_model is None:
        return model_not_ready()
    try:
        positions = []
        for road in all_of(Road):
            position = agent_position(road)
            position["direction"] = road.direction
            positions.append(position)
        return jsonify({"positions": positions})
    except Exception:
        return server_error("/getRoads")


@app.route("/getDestinations", methods=["GET"])
def get_destinations():
    if city_model is None:
        return model_not_ready()
    try:
        destinations = [agent_position(d) for d in all_of(Destination)]
        return jsonify({"positions": destinations})
    except Exception:
        return server_error("/getDestinations")


@app.route("/getStatus", methods=["GET"])
def get_status():
    if city_model is None:
        return model_not_ready()
    try:
        return jsonify(city_model.stats())
    except Exception:
        return server_error("/getStatus")


# This route advances the model like /step, but only answers with the step number.
@app.route("/update", methods=["GET"])
def update_model():
    if city_model is None:
        return model_not_ready()
    try:
        if city_model.running:
            city_model.step()
        return jsonify(
            {
                "message": f"Model at step {city_model.steps}.",
                "currentStep": city_model.steps,
                "running": city_model.running,
            }
        )
    except Exception:
        return server_error("/update")


if __name__ == "__main__":
    # Run the flask server in port 8585
    logging.basicConfig(level=logging.INFO)
    host = os.environ.get("FLASK_HOST", "localhost")
    port = int(os.environ.get("FLASK_PORT", str(DEFAULT_PORT)))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)
