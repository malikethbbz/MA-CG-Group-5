# Frame API

The frontend draws the simulation from two endpoints. `/init` still creates the model.

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
  "helipads":     []
}
```

Grid `(x, y)` is sent as world `(x, z)`; the frontend picks the cell size and the height
of each mesh. `helipads` stays empty until ambulances exist.

## `GET /step`

Advances the model one step (if it is still running) and returns everything that moves.

```json
{
  "step": 31,
  "running": true,
  "stats": {"step": 31, "running": true, "stopReason": null, "spawned": 16,
            "arrived": 9, "active": 7, "avgTripSteps": 18.2, "avgWaitSteps": 1.4},
  "lights": [{"id": "12", "green": true}],
  "vehicles": [{"id": "1263", "kind": "car", "x": 34, "y": 0, "z": 27,
                "heading": {"x": 0, "z": 1}, "state": "driving"}],
  "events": [{"type": "arrived", "id": "1276"}]
}
```

- `vehicles` holds every vehicle alive after the step. Ids are stable: create a mesh for a
  new id, move it while the id appears, delete it when the id is gone.
- `kind` is `car` today; `ambulance`, `police`, `rogue` and `swat` come later with the
  same shape.
- `y` is altitude in cells, 0 on the road. Flying units send `y > 0`.
- `heading` is the last one-cell move, so a diagonal is `{"x": 1, "z": 1}`.
- `state` is kind-specific: a car is `driving` or `waiting`.
- `events` only lists what happened during this step.
- A call before `/init` returns 409.

The frontend should interpolate each vehicle between its last two frames so motion is
smooth while `/step` is polled at a fixed interval.
