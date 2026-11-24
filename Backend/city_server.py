# TC2008B. Sistemas Multiagentes y Gráficas Computacionales
# Flask server that runs the Mesa city model and serves its state to the WebGL client.
# Based on Octavio Navarro's 2024 example.

import logging
import os
from collections.abc import Callable
from typing import Any

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from mesa import Agent

from traffic_base.agent import Car, Destination, Obstacle, Road, Traffic_Light
from traffic_base.model import CITY_FILES, DEFAULT_MAP, CityModel

logger = logging.getLogger(__name__)

app = Flask("Traffic example")
CORS(app, origins=[r"http://localhost(:\d+)?", r"http://127\.0\.0\.1(:\d+)?"])

DEFAULT_SEED = 42
MAX_SEED = 2**32  # numpy's seed range
DEFAULT_PORT = 8585
AVAILABLE_MAPS = {path.name for path in CITY_FILES.glob("*.txt")}

city_model: CityModel | None = None

JsonDict = dict[str, Any]
Reply = Response | tuple[Response, int]


class ModelNotReadyError(Exception):
    pass


class InitParamsError(Exception):
    pass


def _error(message: str, status: int) -> tuple[Response, int]:
    return jsonify({"message": message}), status


def _require_model() -> CityModel:
    if city_model is None:
        raise ModelNotReadyError
    return city_model


def _position(agent: Agent, **extra: object) -> JsonDict:
    """Grid (x, y) maps to world (x, z); y is the height in the 3D scene."""
    x, y = agent.cell.coordinate
    return {"id": str(agent.unique_id), "x": x, "y": 1, "z": y, **extra}


def _positions_of(
    agent_type: type[Agent], describe: Callable[[Any], JsonDict] = lambda _: {}
) -> list[JsonDict]:
    # A type with no agents yet (no cars at step 0) is simply an empty list.
    agents = _require_model().agents_by_type.get(agent_type, [])
    return [_position(agent, **describe(agent)) for agent in agents]


def _respond(build: Callable[[], JsonDict]) -> Reply:
    try:
        return jsonify(build())
    except ModelNotReadyError:
        return _error("Model not initialized. Call /init first.", 409)
    except Exception:
        # Unexpected bug: log the traceback, keep the client message short.
        logger.exception("request failed")
        return _error("Server error, check the server log.", 500)


def _parse_init_params() -> tuple[str, int]:
    """Returns (map_name, seed); raises InitParamsError with a client-facing message."""
    params = request.get_json(silent=True)
    if params is None and request.get_data():
        raise InitParamsError("Body must be JSON.")
    if not isinstance(params or {}, dict):
        raise InitParamsError("Body must be a JSON object.")
    params = params or {}
    map_name = params.get("map", DEFAULT_MAP)
    if not isinstance(map_name, str) or map_name not in AVAILABLE_MAPS:
        raise InitParamsError(f"Unknown map. Options: {sorted(AVAILABLE_MAPS)}")
    seed = params.get("seed", DEFAULT_SEED)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < MAX_SEED:
        raise InitParamsError(f"Seed must be an integer from 0 to {MAX_SEED - 1}.")
    return map_name, seed


@app.route("/init", methods=["GET", "POST"])
def init_model() -> Reply:
    global city_model
    try:
        map_name, seed = _parse_init_params()
    except InitParamsError as error:
        return _error(str(error), 400)
    try:
        city_model = CityModel(map_name=map_name, seed=seed)
    except (OSError, ValueError, KeyError):
        logger.exception("map %s could not be loaded", map_name)
        return _error(f"Map {map_name} could not be loaded.", 400)
    return jsonify(
        {
            "message": "Model initiated.",
            "width": city_model.width,
            "height": city_model.height,
        }
    )


@app.route("/getAgents", methods=["GET"])
def get_agents() -> Reply:
    def car(c: Car) -> JsonDict:
        return {"heading": {"x": c.heading[0], "z": c.heading[1]}}

    return _respond(lambda: {"positions": _positions_of(Car, car)})


@app.route("/getObstacles", methods=["GET"])
def get_obstacles() -> Reply:
    return _respond(lambda: {"positions": _positions_of(Obstacle)})


@app.route("/getTrafficLights", methods=["GET"])
def get_traffic_lights() -> Reply:
    def light(t: Traffic_Light) -> JsonDict:
        return {"state": t.state}

    return _respond(lambda: {"positions": _positions_of(Traffic_Light, light)})


@app.route("/getRoads", methods=["GET"])
def get_roads() -> Reply:
    def road(r: Road) -> JsonDict:
        return {"direction": r.direction}

    return _respond(lambda: {"positions": _positions_of(Road, road)})


@app.route("/getDestinations", methods=["GET"])
def get_destinations() -> Reply:
    return _respond(lambda: {"positions": _positions_of(Destination)})


@app.route("/getStatus", methods=["GET"])
def get_status() -> Reply:
    return _respond(lambda: dict(_require_model().stats()))


@app.route("/update", methods=["GET"])
def update_model() -> Reply:
    def advance() -> JsonDict:
        model = _require_model()
        if model.running:
            model.step()
        return {
            "message": f"Model at step {model.steps}.",
            "currentStep": model.steps,
            "running": model.running,
        }

    return _respond(advance)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    host = os.environ.get("FLASK_HOST", "localhost")
    port = int(os.environ.get("FLASK_PORT", str(DEFAULT_PORT)))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)
