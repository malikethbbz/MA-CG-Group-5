/*
 * Functions to connect to the traffic server (Backend/city_server.py), following
 * libs/api_connection.ts from the course base project:
 *   POST /init  creates a fresh model with the GUI options
 *   GET  /city  the static city: roads, buildings, traffic lights, landmarks
 *   GET  /step  advances the model one step and returns what moves
 * The fields are the ones in docs/frame-api.md. The answers are checked before
 * they are used, so a bad payload fails here with a clear message.
 *
 * Team 5 - TC2008B
 * 2026-11
 */

'use strict';

import { SERVER_URL } from './config';

export type Direction = 'Right' | 'Left' | 'Up' | 'Down' | 'UpLeft' | 'UpRight' | 'DownLeft' | 'DownRight';

export interface GridCell {
    x: number;
    z: number;
}

export interface RoadCell extends GridCell {
    direction: Direction;
}

export interface LightCell extends RoadCell {
    id: string;
}

export interface CityData {
    width: number;
    height: number;
    roads: RoadCell[];
    obstacles: GridCell[];
    destinations: GridCell[];
    lights: LightCell[];
    // Where the ambulances park; both fields are optional in the payload
    hospital: GridCell | null;
    helipads: GridCell[];
    // Monuments only; absent in the payload means none
    landmarks: GridCell[];
}

export interface VehicleFrame {
    id: string;
    kind: string;
    x: number;
    y: number;
    z: number;
    heading: GridCell;
    // A car is "driving" or "waiting"; an ambulance "idle", "cruise", "on_scene" or "return"
    state: string;
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
    emergenciesServed?: number;
}

export interface StepFrame {
    step: number;
    running: boolean;
    stats: Stats;
    lights: { id: string; green: boolean; yellow: boolean }[];
    vehicles: VehicleFrame[];
}

// Body of POST /init; anything left out takes the server default
export interface InitOptions {
    map?: string;
    spawnInterval?: number;
    carsPerSpawn?: number;
    ambulances?: number;
    emergencyChance?: number;
}


/* FUNCTIONS FOR THE INTERACTION WITH THE MESA SERVER */

async function request(endpoint: string, options?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(SERVER_URL + endpoint, options);
    } catch (error) {
        throw new Error(`No se puede conectar al servidor en ${SERVER_URL}.`, { cause: error });
    }

    if (!response.ok) {
        // The server explains a refused request in a JSON "message"
        let message = response.statusText;
        try {
            message = (await response.json()).message ?? message;
        } catch {
            // Not JSON: the status line is all there is
        }
        throw new Error(`/${endpoint} falló con ${response.status}: ${message}`);
    }
    return response.json();
}

/*
 * Initializes the traffic model by sending a POST request to the server.
 */
export async function initModel(options: InitOptions): Promise<void> {
    await request('init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
    });
}

/*
 * Retrieves the static city.
 */
export async function getCity(): Promise<CityData> {
    return parseCity(await request('city'));
}

/*
 * Advances the model one step and retrieves the vehicles, lights and stats.
 */
export async function getStep(): Promise<StepFrame> {
    return parseStep(await request('step'));
}


/* CHECKING THE ANSWERS */

type Json = Record<string, unknown>;

function check(ok: boolean, path: string, expected: string): void {
    if (!ok) {
        throw new Error(`Malformed server response: ${path} should be ${expected}.`);
    }
}

function object(value: unknown, path: string): Json {
    check(typeof value === 'object' && value !== null && !Array.isArray(value), path, 'an object');
    return value as Json;
}

function num(o: Json, key: string, path: string): number {
    check(typeof o[key] === 'number' && Number.isFinite(o[key]), `${path}.${key}`, 'a number');
    return o[key] as number;
}

function str(o: Json, key: string, path: string): string {
    check(typeof o[key] === 'string', `${path}.${key}`, 'a string');
    return o[key] as string;
}

function bool(o: Json, key: string, path: string): boolean {
    check(typeof o[key] === 'boolean', `${path}.${key}`, 'a boolean');
    return o[key] as boolean;
}

// An array whose items are objects, each read by `item`
function list<T>(o: Json, key: string, path: string, item: (o: Json, path: string) => T): T[] {
    const value = o[key];
    check(Array.isArray(value), `${path}.${key}`, 'an array');
    return (value as unknown[]).map((v, i) => item(object(v, `${path}.${key}[${i}]`), `${path}.${key}[${i}]`));
}

const cell = (o: Json, path: string): GridCell => ({ x: num(o, 'x', path), z: num(o, 'z', path) });

function road(o: Json, path: string): RoadCell {
    const direction = str(o, 'direction', path);
    check(['Right', 'Left', 'Up', 'Down', 'UpLeft', 'UpRight', 'DownLeft', 'DownRight'].includes(direction),
        `${path}.direction`, 'a straight or diagonal direction');
    return { ...cell(o, path), direction: direction as Direction };
}

export function parseCity(value: unknown): CityData {
    const o = object(value, 'city');
    // Landmarks are optional, and this client only knows how to draw monuments
    const landmarks = o.landmarks === undefined ? [] : list(o, 'landmarks', 'city', (l, p) => ({
        ...cell(l, p), kind: str(l, 'kind', p),
    }));
    return {
        width: num(o, 'width', 'city'),
        height: num(o, 'height', 'city'),
        roads: list(o, 'roads', 'city', road),
        obstacles: list(o, 'obstacles', 'city', cell),
        destinations: list(o, 'destinations', 'city', cell),
        lights: list(o, 'lights', 'city', (l, p) => ({ ...road(l, p), id: str(l, 'id', p) })),
        hospital: o.hospital === undefined ? null : cell(object(o.hospital, 'city.hospital'), 'city.hospital'),
        helipads: o.helipads === undefined ? [] : list(o, 'helipads', 'city', cell),
        landmarks: landmarks.filter((l) => l.kind === 'monument').map((l) => ({ x: l.x, z: l.z })),
    };
}

function vehicle(o: Json, path: string): VehicleFrame {
    return {
        id: str(o, 'id', path),
        kind: str(o, 'kind', path),
        x: num(o, 'x', path),
        y: num(o, 'y', path),
        z: num(o, 'z', path),
        heading: cell(object(o.heading, `${path}.heading`), `${path}.heading`),
        state: str(o, 'state', path),
    };
}

function stats(o: Json, path: string): Stats {
    const nullable = (key: string): number | null => (o[key] === null ? null : num(o, key, path));
    return {
        step: num(o, 'step', path),
        running: bool(o, 'running', path),
        stopReason: o.stopReason === null ? null : str(o, 'stopReason', path),
        spawned: num(o, 'spawned', path),
        arrived: num(o, 'arrived', path),
        active: num(o, 'active', path),
        avgTripSteps: nullable('avgTripSteps'),
        avgWaitSteps: nullable('avgWaitSteps'),
        // Only servers with ambulances send it
        ...(o.emergenciesServed === undefined ? {} : { emergenciesServed: num(o, 'emergenciesServed', path) }),
    };
}

export function parseStep(value: unknown): StepFrame {
    const o = object(value, 'step');
    return {
        step: num(o, 'step', 'step'),
        running: bool(o, 'running', 'step'),
        stats: stats(object(o.stats, 'step.stats'), 'step.stats'),
        lights: list(o, 'lights', 'step', (l, p) => ({ id: str(l, 'id', p), green: bool(l, 'green', p), yellow: l.yellow === true })),
        vehicles: list(o, 'vehicles', 'step', vehicle),
    };
}
