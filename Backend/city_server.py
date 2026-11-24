# TC2008B. Sistemas Multiagentes y Gráficas Computacionales
# Python flask server to interact with webGL.
# Based on Octavio Navarro's 2024 example.

import logging
import os

from flask import Flask, jsonify, request
from flask_cors import CORS

from traffic_base.agent import Car, Destination, Obstacle, Road, Traffic_Light
from traffic_base.model import CITY_FILES, DEFAULT_MAP, CityModel

logger = logging.getLogger(__name__)

app = Flask("Traffic example")
CORS(app, origins=[r"http://localhost(:\d+)?", r"http://127\.0\.0\.1(:\d+)?"])

city_model: CityModel | None = None
AVAILABLE_MAPS = {path.name for path in CITY_FILES.glob("*.txt")}


def _require_model() -> CityModel:
    if city_model is None:
        raise RuntimeError("model not initialized; call /init first")
    return city_model


def _position(agent, **extra) -> dict:
    """Grid (x, y) maps to world (x, z); y is the height in the 3D scene."""
    x, y = agent.cell.coordinate
    return {"id": str(agent.unique_id), "x": x, "y": 1, "z": y, **extra}


def _positions_of(agent_type, describe=lambda agent: {}) -> list[dict]:
    agents = _require_model().agents_by_type.get(agent_type, [])
    return [_position(agent, **describe(agent)) for agent in agents]


def _respond(build):
    try:
        return jsonify(build())
    except Exception:
        logger.exception("request failed")
        return jsonify({"message": "Server error, check the server log."}), 500


@app.route("/init", methods=["GET", "POST"])
def init_model():
    global city_model
    params = request.get_json(silent=True) or {}
    map_name = params.get("map", DEFAULT_MAP)
    if map_name not in AVAILABLE_MAPS:
        return jsonify({"message": f"Unknown map. Options: {sorted(AVAILABLE_MAPS)}"}), 400
    try:
        seed = int(params.get("seed", 42))
        city_model = CityModel(map_name=map_name, seed=seed)
    except (ValueError, TypeError):
        logger.exception("bad /init parameters")
        return jsonify({"message": "Invalid map or seed."}), 400
    return jsonify(
        {
            "message": "Model initiated.",
            "width": city_model.width,
            "height": city_model.height,
        }
    )


@app.route("/getAgents", methods=["GET"])
def get_agents():
    def car(c: Car) -> dict:
        return {"heading": {"x": c.heading[0], "z": c.heading[1]}}

    return _respond(lambda: {"positions": _positions_of(Car, car)})


@app.route("/getObstacles", methods=["GET"])
def get_obstacles():
    return _respond(lambda: {"positions": _positions_of(Obstacle)})


@app.route("/getTrafficLights", methods=["GET"])
def get_traffic_lights():
    return _respond(
        lambda: {"positions": _positions_of(Traffic_Light, lambda t: {"state": t.state})}
    )


@app.route("/getRoads", methods=["GET"])
def get_roads():
    return _respond(
        lambda: {"positions": _positions_of(Road, lambda r: {"direction": r.direction})}
    )


@app.route("/getDestinations", methods=["GET"])
def get_destinations():
    return _respond(lambda: {"positions": _positions_of(Destination)})


@app.route("/getStatus", methods=["GET"])
def get_status():
    return _respond(lambda: _require_model().stats())


@app.route("/update", methods=["GET"])
def update_model():
    def advance() -> dict:
        model = _require_model()
        if model.running:
            model.step()
        return {"message": f"Model at step {model.steps}.", "currentStep": model.steps,
                "running": model.running}

    return _respond(advance)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    host = os.environ.get("FLASK_HOST", "localhost")
    port = int(os.environ.get("FLASK_PORT", "8585"))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)
