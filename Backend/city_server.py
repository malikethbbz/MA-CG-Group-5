# TC2008B. Sistemas Multiagentes y Gráficas Computacionales
# Flask server that runs the Mesa city model and serves its state to the WebGL client.
# Based on Octavio Navarro's 2024 example. docs/frame-api.md describes the routes.

import json
import logging
import os

from flask import Flask, jsonify, request
from flask_cors import CORS

from traffic_base.agent import Destination, Obstacle, Road
from traffic_base.city_graph import DIAGONAL_VECTORS, DIRECTION_VECTORS
from traffic_base.model import CITY_FILES, DEFAULT_MAP, SPAWN_INTERVAL, CityModel

logger = logging.getLogger(__name__)


AVAILABLE_MAPS = {path.name for path in CITY_FILES.glob("*.txt")}
DIRECTION_NAMES = {
    vector: name for name, vector in {**DIRECTION_VECTORS, **DIAGONAL_VECTORS}.items()
}

city_model = None

app = Flask("Traffic example")
CORS(app, origins=[r"http://localhost(:\d+)?", r"http://127\.0\.0\.1(:\d+)?"])


def model_not_ready():
    return jsonify({"message": "Model not initialized. Call /init first."}), 409


def xz(pos):
    """Grid (x, y) is world (x, z) for the frontend."""
    return {"x": pos[0], "z": pos[1]}


@app.route("/init", methods=["GET", "POST"])
def init_model():
    global city_model

    try:
        params = json.loads(request.data) if request.data else {}
        if not isinstance(params, dict):
            raise ValueError("the body must be a JSON object")
        map_name = params.get("map", DEFAULT_MAP)
        if map_name not in AVAILABLE_MAPS:
            raise ValueError(f"unknown map {map_name}")
        city_model = CityModel(
            map_name=map_name,
            seed=int(params.get("seed", 42)),
            spawn_interval=int(params.get("spawnInterval", SPAWN_INTERVAL)),
            cars_per_spawn=int(params.get("carsPerSpawn", 4)),
            ambulances=int(params.get("ambulances", 2)),
            emergency_chance=float(params.get("emergencyChance", 1.0)),
        )
    except (ValueError, TypeError, KeyError, OverflowError, FileNotFoundError) as error:
        logger.warning("/init failed: %s", error)
        return jsonify({"message": f"Could not create the model: {error}"}), 400

    return jsonify(
        {
            "message": "Model initiated.",
            "width": city_model.width,
            "height": city_model.height,
        }
    )


# This route sends the map once, after /init.
@app.route("/city", methods=["GET"])
def get_city():
    if city_model is None:
        return model_not_ready()

    roads = []
    for road in city_model.agents.select(agent_type=Road):
        roads.append({**xz(road.cell.coordinate), "direction": road.direction})

    lights = []
    for light in city_model.traffic_lights:
        pos = light.cell.coordinate
        direction = DIRECTION_NAMES[city_model.drivable[pos]]
        lights.append({**xz(pos), "id": str(light.unique_id), "direction": direction})

    obstacles = city_model.agents.select(agent_type=Obstacle)
    destinations = city_model.agents.select(agent_type=Destination)
    return jsonify(
        {
            "width": city_model.width,
            "height": city_model.height,
            "roads": roads,
            "obstacles": [xz(o.cell.coordinate) for o in obstacles],
            "destinations": [xz(d.cell.coordinate) for d in destinations],
            "lights": lights,
            "hospital": xz(city_model.hospital),
            "helipads": [xz(pad) for pad in city_model.helipads],
            "landmarks": [
                {**xz(pos), "kind": "monument"} for pos in city_model.monuments
            ],
        }
    )


# This route advances the model one step and sends everything that moves.
@app.route("/step", methods=["GET"])
def step_model():
    if city_model is None:
        return model_not_ready()

    advanced = city_model.running
    if advanced:
        city_model.step()

    lights = []
    for light in city_model.traffic_lights:
        lights.append(
            {"id": str(light.unique_id), "green": light.state, "yellow": light.yellow}
        )

    return jsonify(
        {
            "step": city_model.steps,
            "running": city_model.running,
            "stats": city_model.stats(),
            "lights": lights,
            "vehicles": city_model.vehicles(),
            # A stopped run sends its last frame again; its events were already sent.
            "events": city_model.events if advanced else [],
        }
    )


if __name__ == "__main__":
    # Run the flask server in port 8585
    logging.basicConfig(level=logging.INFO)
    host = os.environ.get("FLASK_HOST", "localhost")
    port = int(os.environ.get("FLASK_PORT", "8585"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)
