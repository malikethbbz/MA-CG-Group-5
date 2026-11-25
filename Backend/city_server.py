# TC2008B. Sistemas Multiagentes y Gráficas Computacionales
# Flask server that runs the Mesa city model and serves its state to the WebGL client.
# Based on Octavio Navarro's 2024 example.

import json
import logging
import os
from collections.abc import Callable, Collection
from typing import Any, NamedTuple, cast

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from mesa import Agent

from traffic_base.agent import Car, Destination, Obstacle, Road, Traffic_Light
from traffic_base.city_graph import DIRECTION_VECTORS, Position
from traffic_base.model import (
    CITY_FILES,
    DEFAULT_MAP,
    MAX_SPAWN_INTERVAL,
    SPAWN_INTERVAL,
    SPAWN_MODES,
    CityModel,
    SpawnPoints,
)

logger = logging.getLogger(__name__)

app = Flask("Traffic example")
CORS(app, origins=[r"http://localhost(:\d+)?", r"http://127\.0\.0\.1(:\d+)?"])

DEFAULT_SEED = 42
MAX_SEED = 2**32  # numpy's seed range
DEFAULT_PORT = 8585
AVAILABLE_MAPS = {path.name for path in CITY_FILES.glob("*.txt")}
DIRECTION_NAMES = {vector: name for name, vector in DIRECTION_VECTORS.items()}

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


def _agents_of(model: CityModel, agent_type: type[Agent]) -> list[Agent]:
    # select matches subclasses too, so /getAgents also lists motorcycles.
    return list(model.agents.select(agent_type=agent_type))


def _positions_of(
    agent_type: type[Agent], describe: Callable[[Any], JsonDict] = lambda _: {}
) -> list[JsonDict]:
    agents = _agents_of(_require_model(), agent_type)
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


class InitParams(NamedTuple):
    map_name: str
    seed: int
    spawn_interval: int
    spawn_points: SpawnPoints


def _int_param(params: JsonDict, key: str, default: int, low: int, high: int) -> int:
    """An integer in [low, high]; JSON booleans are rejected even though bool is int."""
    value = params.get(key, default)
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not low <= value <= high
    ):
        raise InitParamsError(f"{key} must be an integer from {low} to {high}.")
    return value


def _choice_param(
    params: JsonDict, key: str, default: str, options: Collection[str]
) -> str:
    value = params.get(key, default)
    if not isinstance(value, str) or value not in options:
        raise InitParamsError(f"{key} must be one of {sorted(options)}.")
    return value


def _parse_init_params() -> InitParams:
    """Raises InitParamsError with a client-facing message."""
    raw = request.get_data()
    params: object = {}  # no body means "use the defaults"
    if raw:
        # Parsed by hand: get_json returns None for both bad JSON and a `null` body.
        try:
            params = json.loads(raw)
        except ValueError as error:
            raise InitParamsError("Body must be JSON.") from error
    if not isinstance(params, dict):
        raise InitParamsError("Body must be a JSON object.")
    spawn_points = _choice_param(params, "spawnPoints", "corners", SPAWN_MODES)
    return InitParams(
        _choice_param(params, "map", DEFAULT_MAP, AVAILABLE_MAPS),
        _int_param(params, "seed", DEFAULT_SEED, 0, MAX_SEED - 1),
        _int_param(params, "spawnInterval", SPAWN_INTERVAL, 1, MAX_SPAWN_INTERVAL),
        cast(SpawnPoints, spawn_points),  # one of SPAWN_MODES, checked above
    )


@app.route("/init", methods=["GET", "POST"])
def init_model() -> Reply:
    global city_model
    try:
        params = _parse_init_params()
    except InitParamsError as error:
        return _error(str(error), 400)
    try:
        city_model = CityModel(
            map_name=params.map_name,
            seed=params.seed,
            spawn_interval=params.spawn_interval,
            spawn_points=params.spawn_points,
        )
    except (OSError, ValueError, KeyError):
        logger.exception("map %s could not be loaded", params.map_name)
        return _error(f"Map {params.map_name} could not be loaded.", 400)
    return jsonify(
        {
            "message": "Model initiated.",
            "width": city_model.width,
            "height": city_model.height,
        }
    )


def _xz(pos: Position, **extra: object) -> JsonDict:
    """Grid (x, y) maps to world (x, z); the frontend picks each mesh's height."""
    x, y = pos
    return {"x": x, "z": y, **extra}


def _city() -> JsonDict:
    model = _require_model()
    return {
        "width": model.width,
        "height": model.height,
        "roads": [
            _xz(road.cell.coordinate, direction=road.direction)
            for road in _agents_of(model, Road)
        ],
        "obstacles": [_xz(o.cell.coordinate) for o in _agents_of(model, Obstacle)],
        "destinations": [
            _xz(d.cell.coordinate) for d in _agents_of(model, Destination)
        ],
        "lights": [
            _xz(
                light.cell.coordinate,
                id=str(light.unique_id),
                direction=DIRECTION_NAMES[model.drivable[light.cell.coordinate]],
            )
            for light in model.traffic_lights
        ],
        "helipads": [_xz(pos) for pos in model.helipads],
        "landmarks": [_xz(pos, kind="monument") for pos in model.monuments],
    }


def _frame() -> JsonDict:
    model = _require_model()
    advanced = model.running
    if advanced:
        model.step()
    return {
        "step": model.steps,
        "running": model.running,
        "stats": dict(model.stats()),
        "lights": [
            {"id": str(light.unique_id), "green": light.state}
            for light in model.traffic_lights
        ],
        "vehicles": model.vehicles(),
        # A stopped run sends its last frame again; its events were already sent.
        "events": model.events if advanced else [],
    }


@app.route("/city", methods=["GET"])
def get_city() -> Reply:
    return _respond(_city)


@app.route("/step", methods=["GET"])
def step_model() -> Reply:
    return _respond(_frame)


# Per-type endpoints the current frontend still polls; /city and /step replace them.
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
