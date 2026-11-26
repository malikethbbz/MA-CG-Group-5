/*
 * Types for the frame API, mirroring docs/frame-api.md field for field.
 * Field names are the server's (camelCase only where the contract uses it).
 */

export type Direction = 'Right' | 'Left' | 'Up' | 'Down';

export interface GridCell {
    x: number;
    z: number;
}

export interface RoadCell extends GridCell {
    direction: Direction;
}

export interface LightCell extends GridCell {
    id: string;
    direction: Direction;
}

// Kinds of landmark this client can draw; others are skipped while parsing.
export type LandmarkKind = 'monument';

export interface Landmark extends GridCell {
    kind: LandmarkKind;
}

// GET /city
export interface CityData {
    width: number;
    height: number;
    roads: RoadCell[];
    obstacles: GridCell[];
    destinations: GridCell[];
    lights: LightCell[];
    helipads: GridCell[];
    // Optional in the payload; absent means none
    landmarks: Landmark[];
}

export interface Heading {
    x: number;
    z: number;
}

// `kind` is "car", "motorcycle" or "ambulance"; "police", "rogue" and "swat" come later.
export interface VehicleFrame {
    id: string;
    kind: string;
    x: number;
    y: number;
    z: number;
    heading: Heading;
    state: string;
}

export interface LightState {
    id: string;
    green: boolean;
}

export interface Stats {
    step: number;
    running: boolean;
    stopReason: string | null;
    spawned: number;
    arrived: number;
    active: number;
    avgTripSteps: number | null;
    avgWaitSteps: number | null;
}

export interface StepEvent {
    type: string;
    id: string;
}

// GET /step
export interface StepFrame {
    step: number;
    running: boolean;
    stats: Stats;
    lights: LightState[];
    vehicles: VehicleFrame[];
    events: StepEvent[];
}
