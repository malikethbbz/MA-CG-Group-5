# Frame API

The frontend draws the simulation from three endpoints: `/init` creates the model,
`/city` sends the static map once and `/step` advances the model and sends what moves.

`POST /init` takes an optional JSON object. Every field is optional:

| field             | default           | meaning                                              |
|-------------------|-------------------|------------------------------------------------------|
| `map`             | `"2025_base.txt"` | a map file in `city_files/`                          |
| `seed`            | `42`              | random seed                                          |
| `spawnInterval`   | `10`              | steps between spawns, 1 to 10 (the assignment's 10)  |
| `carsPerSpawn`    | `4`               | most cars a spawn step places, 1 to 4                |
| `ambulances`      | `2`               | number of ambulances, 0 to 2                         |
| `emergencyChance` | `1.0`             | chance, 0 to 1, that an emergency opens every 25 steps |

Numbers are read with `int()` / `float()`. A value that can't be converted or is out
of range, a map that is not in `city_files/`, or a body that is not a JSON object
returns `400` with a short `message`.

Every spawn step puts a car on each free map corner, up to `carsPerSpawn` of them.
Lower intervals spawn denser traffic; 1 jams the four corner cells within about a hundred
steps.

A run stops when a spawn step cannot place any car; `stats.stopReason` says why.

The default map is the assignment's `2025_base.txt`. `{"map": "2025_reforma.txt"}`
loads the same city with a Paseo de la Reforma style glorieta in the centre: a
two-lane ring circulating counter-clockwise around an island with a monument, a
traffic light on every approach into the ring, and extra lights along the avenue.

## `GET /city`

Static map data. Call it once after `/init`.

```json
{
  "width": 36,
  "height": 35,
  "roads":        [{"x": 0, "z": 0, "direction": "Right"}],
  "obstacles":    [{"x": 3, "z": 4}],
  "destinations": [{"x": 5, "z": 7}],
  "lights":       [{"id": "12", "x": 6, "z": 2, "direction": "Up"}],
  "hospital":     {"x": 17, "z": 16},
  "helipads":     [{"x": 17, "z": 16}, {"x": 17, "z": 15}],
  "landmarks":    [{"kind": "monument", "x": 15, "z": 20}]
}
```

Grid `(x, y)` is sent as world `(x, z)`; the frontend picks the cell size and the height
of each mesh. `hospital` is the building nearest the map centre (an obstacle cell); no
emergency ever opens there. `helipads` lists where each ambulance parks, one per
ambulance: the hospital roof first, then the building next to it. An ambulance rests
there at `y = 1`.

`landmarks` lists special cells to draw as `{kind, x, z}`. The only kind is
`monument` (map symbol `A`): the column with the golden angel on the glorieta island.
A monument cell is in no other list; cars never enter it and it is not a building, so
no emergency, hospital or helipad is ever there. The list is empty on maps without one, such as
`2025_base.txt`.

## `GET /step`

Advances the model one step (if it is still running) and returns everything that moves.

```json
{
  "step": 31,
  "running": true,
  "stats": {"step": 31, "running": true, "stopReason": null, "spawned": 16,
            "arrived": 9, "active": 7, "avgTripSteps": 18.2, "avgWaitSteps": 1.4,
            "emergenciesServed": 1},
  "lights": [{"id": "12", "green": true}],
  "vehicles": [{"id": "1263", "kind": "car", "x": 34, "y": 0, "z": 27,
                "heading": {"x": 0, "z": 1}, "state": "driving"},
               {"id": "1261", "kind": "ambulance", "x": 7.4, "y": 3.0, "z": 4.1,
                "heading": {"x": 1, "z": 1}, "state": "cruise"}],
  "events": [{"type": "arrived", "id": "1276"},
             {"type": "emergency", "id": "1288", "x": 2, "z": 21}]
}
```

- `vehicles` holds every vehicle alive after the step. Ids are stable: create a mesh for a
  new id, move it while the id appears, delete it when the id is gone.
- `kind` is `car`, `motorcycle` (same rules as a car, about 30% of spawns) or
  `ambulance`. `stats.active` counts cars only.
- `y` is altitude in cells, 0 on the road. Flying units send `y > 0`.
- `heading` is the last one-cell move, so a diagonal is `{"x": 1, "z": 1}`. An
  ambulance sends the nearest of the eight directions it is flying in.
- `state` is kind-specific: a car is `driving` or `waiting`. An ambulance is `idle`
  (parked on its roof, `y = 1`), `cruise` (flying to the emergency at `y = 3`; it
  hovers over its landing cell while a car is still on it), `on_scene` (on the road,
  `y = 0`, for 10 steps) and `return` (flying back at `y = 3`). Ambulance `x` and `z`
  are floats because it flies in straight lines over the grid.
- `events` only lists what happened during this step. Types:

  | type         | `id`         | `x`, `z`                          |
  |--------------|--------------|-----------------------------------|
  | `arrived`    | car          | not sent                          |
  | `emergency`  | emergency    | the building that needs help      |
  | `dispatched` | ambulance    | the road cell it will land on     |
  | `landed`     | ambulance    | the road cell it landed on        |
  | `served`     | emergency    | the building; remove its marker   |

  Once the run has stopped, `/step` returns the final frame again with `events: []`,
  so no event is reported twice. While an ambulance holds a landing cell, cars do not
  enter it.
- A call before `/init` returns 409.

The frontend should interpolate each vehicle between its last two frames so motion is
smooth while `/step` is polled at a fixed interval.
