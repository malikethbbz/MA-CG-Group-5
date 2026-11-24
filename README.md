# MA-CG Group 5

## Project Description

This repository contains Group 5's work for **Multi-Agent Systems and Computer Graphics** (Modelación de sistemas multiagentes con gráficas computacionales). The project models a multi-agent system, in which autonomous agents perceive their environment, make decisions and interact with each other, and presents the simulation through 3D computer graphics.

### Challenge: Urban mobility

A multi-agent traffic simulation of a city, built with Mesa and rendered in WebGL with a
cyberpunk look. Cars spawn at the map corners, drive to a destination following the street
directions, respect traffic lights and avoid collisions. On top of the required behavior we
are adding two flying ambulances, ground police units and a flying SWAT unit that responds
to rogue cars.

## Team Members

| Name | Student ID |
|------|------------|
| Juan Carlos Luz Gallardo | A01028527 |
| Isabela Valls Chavez | A01173825 |
| Francisco Javier Becerra Gómez | A01027383 |

## Repository Structure

```
Backend/              Mesa model and Flask server (port 8585)
  city_server.py      HTTP endpoints consumed by the frontend
  traffic_base/       Agents and city model
  city_files/         City maps and mapDictionary.json
Frontend/             WebGL client (TypeScript + Vite)
  libs/               3D math, camera, lights, shapes, API client
  src/                Scene entry point
  assets/shaders/     GLSL shaders
```

Both folders start from the course base project
([TC2008B/BaseProject](https://github.com/gilecheverria/TC2008B)).

## Running Locally

Run the backend and the frontend in two terminals.

### Backend

Requires Python 3.12+ (Mesa 3).

```bash
cd Backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python city_server.py            # http://localhost:8585
```

Tests:

```bash
pip install -r requirements-dev.txt
python -m pytest
ruff check . && ruff format --check .
```

### Frontend

Requires Node 20.19+ or 22.12+ (Vite 8).

```bash
cd Frontend
npm install
npx vite                         # http://localhost:5173
```

## Map Legend

From `Backend/city_files/mapDictionary.json`:

| Symbol | Meaning |
|--------|---------|
| `>` `<` `^` `v` | Road and its direction |
| `S` `s` | Traffic light (green for 15 and 7 steps) |
| `#` | Obstacle / building |
| `D` | Destination |

The two light groups share a 22-step cycle: `s` lights are green for the first 7 steps,
then `S` lights for the next 15, so crossing streets are never green at the same time.

## Server API

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/init` | GET, POST | Creates the model. POST body: `{"map": "2025_base.txt", "seed": 42}` (both optional) |
| `/update` | GET | Advances one step while the simulation is running |
| `/getAgents` | GET | Cars: `id`, `x`, `y`, `z`, `heading` |
| `/getTrafficLights` | GET | Lights: position and `state` (`true` = green) |
| `/getObstacles` | GET | Building positions |
| `/getRoads` | GET | Road positions and `direction` |
| `/getDestinations` | GET | Destination positions |
| `/getStatus` | GET | Step, `running`, `stopReason`, spawned / arrived / active cars, average trip and wait steps (`null` until a car arrives) |

Grid `(x, y)` maps to world `(x, z)`; `y` is the height in the 3D scene. Calls made
before `/init` return `409`.

## Agent Design

Each car runs the first behavior whose condition holds, from highest to lowest priority:

1. No route available: wait
2. Red light on the next cell: stop
3. Car on the next cell: wait; every `PATIENCE` blocked steps (3), look for a route around it
4. Otherwise: drive one cell along the A* route

Routes come from a directed street graph built from the map (`traffic_base/city_graph.py`).
A move is legal when it never goes against the direction of the current or the next cell,
which allows driving forward, changing lanes and crossing intersections.

## Roadmap

| Phase | Scope |
|-------|-------|
| 1 | Cars: A* routing, traffic lights, collision avoidance, spawning and removal |
| 2 | 3D city: buildings, roads, lights and cars driven by transformation matrices |
| 3 | Flying ambulances: emergencies, landing spot reservation |
| 4 | Rogue cars, ground police coordination, flying SWAT unit |
| 5 | Cyberpunk visuals: models, neon lighting, atmosphere |
| 6 | Report, video and final cleanup |

## Deliverables

- PDF report: problem and solution, agent design, subsumption architecture, environment, conclusions
- WebGL simulation and the server connecting it to Mesa
- Video of the simulation running
