# Frame API

The frontend draws the simulation from two endpoints. `/init` still creates the model.

`POST /init` takes an optional JSON object: `map` (a file in `city_files/`), `seed`
(0 to 2³²−1) and `spawnInterval` (1 to 10, default 10, the assignment's rate). Lower
intervals spawn denser traffic; 2 still flows, 1 gridlocks the 2025 map.

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
  "helipads":     [{"x": 2, "z": 2}, {"x": 33, "z": 32}]
}
```

Grid `(x, y)` is sent as world `(x, z)`; the frontend picks the cell size and the height
of each mesh. `helipads` lists the two ambulance pads as `{x, z}`. Each sits on a
building rooftop (an obstacle cell), and an ambulance rests there at `y = 1`.

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
  `ambulance`; `police`, `rogue` and `swat` come later with the
  same shape. `stats.active` counts cars only.
- `y` is altitude in cells, 0 on the road. Flying units send `y > 0`.
- `heading` is the last one-cell move, so a diagonal is `{"x": 1, "z": 1}`. An
  ambulance sends the nearest of the eight directions it is flying in.
- `state` is kind-specific: a car is `driving` or `waiting`. An ambulance is `idle`
  (on its pad), `takeoff`, `cruise` (flying to the emergency), `landing` (descending;
  it hovers while a car is still on its landing cell), `on_scene` (on the road, `y = 0`),
  then `takeoff`, `return` and `landing` back onto its pad. Ambulance `x` and `z` are
  floats because it flies in straight lines over the grid.
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
