"""What every moving agent (car, ambulance, police, SWAT) reports to the frontend.

`/step` sends one VehicleFrame per vehicle. The frontend creates a mesh the first time
it sees an id, moves it while the id keeps appearing, and deletes it once it is gone.
"""

from typing import NotRequired, Protocol, TypedDict, runtime_checkable


class Heading(TypedDict):
    x: int
    z: int


class VehicleFrame(TypedDict):
    """Grid (x, y) is sent as world (x, z); `y` is the altitude in cells, 0 on the
    road. `state` is kind-specific, e.g. a car is "driving" or "waiting"."""

    id: str
    kind: str
    x: float
    y: float
    z: float
    heading: Heading
    state: str


class Event(TypedDict):
    """Something the frontend may want to show once, e.g. a car arriving. Emergency
    and ambulance events also carry the grid cell they happened at as (x, z)."""

    type: str
    id: str
    x: NotRequired[int]
    z: NotRequired[int]


@runtime_checkable
class Vehicle(Protocol):
    kind: str

    def frame(self) -> VehicleFrame: ...
