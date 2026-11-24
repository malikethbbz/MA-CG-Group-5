/*
 * Runtime checks for server responses. The server is external input, so a payload
 * that does not match docs/frame-api.md is rejected with a message naming the field.
 */

import type {
    CityData, Direction, GridCell, Heading, LightCell, LightState, RoadCell,
    Stats, StepEvent, StepFrame, VehicleFrame,
} from './contract';

export class MalformedResponseError extends Error {
    constructor(path: string, expected: string) {
        super(`Malformed server response: ${path} should be ${expected}.`);
        this.name = 'MalformedResponseError';
    }
}

type Json = Record<string, unknown>;

const DIRECTIONS: readonly Direction[] = ['Right', 'Left', 'Up', 'Down'];

function object(value: unknown, path: string): Json {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new MalformedResponseError(path, 'an object');
    }
    return value as Json;
}

function num(o: Json, key: string, path: string): number {
    const value = o[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new MalformedResponseError(`${path}.${key}`, 'a number');
    }
    return value;
}

function str(o: Json, key: string, path: string): string {
    const value = o[key];
    if (typeof value !== 'string') {
        throw new MalformedResponseError(`${path}.${key}`, 'a string');
    }
    return value;
}

function bool(o: Json, key: string, path: string): boolean {
    const value = o[key];
    if (typeof value !== 'boolean') {
        throw new MalformedResponseError(`${path}.${key}`, 'a boolean');
    }
    return value;
}

function nullableNum(o: Json, key: string, path: string): number | null {
    return o[key] === null ? null : num(o, key, path);
}

function nullableStr(o: Json, key: string, path: string): string | null {
    return o[key] === null ? null : str(o, key, path);
}

function list<T>(o: Json, key: string, path: string, item: (v: unknown, p: string) => T): T[] {
    const value = o[key];
    if (!Array.isArray(value)) {
        throw new MalformedResponseError(`${path}.${key}`, 'an array');
    }
    return value.map((v, i) => item(v, `${path}.${key}[${i}]`));
}

function direction(o: Json, path: string): Direction {
    const value = str(o, 'direction', path);
    if (!DIRECTIONS.includes(value as Direction)) {
        throw new MalformedResponseError(`${path}.direction`, `one of ${DIRECTIONS.join(', ')}`);
    }
    return value as Direction;
}

function cell(v: unknown, path: string): GridCell {
    const o = object(v, path);
    return { x: num(o, 'x', path), z: num(o, 'z', path) };
}

function road(v: unknown, path: string): RoadCell {
    const o = object(v, path);
    return { ...cell(o, path), direction: direction(o, path) };
}

function lightCell(v: unknown, path: string): LightCell {
    const o = object(v, path);
    return { ...cell(o, path), id: str(o, 'id', path), direction: direction(o, path) };
}

export function parseCity(value: unknown): CityData {
    const path = 'city';
    const o = object(value, path);
    return {
        width: num(o, 'width', path),
        height: num(o, 'height', path),
        roads: list(o, 'roads', path, road),
        obstacles: list(o, 'obstacles', path, cell),
        destinations: list(o, 'destinations', path, cell),
        lights: list(o, 'lights', path, lightCell),
        helipads: list(o, 'helipads', path, cell),
    };
}

function heading(v: unknown, path: string): Heading {
    const o = object(v, path);
    return { x: num(o, 'x', path), z: num(o, 'z', path) };
}

function vehicle(v: unknown, path: string): VehicleFrame {
    const o = object(v, path);
    return {
        id: str(o, 'id', path),
        kind: str(o, 'kind', path),
        x: num(o, 'x', path),
        y: num(o, 'y', path),
        z: num(o, 'z', path),
        heading: heading(o.heading, `${path}.heading`),
        state: str(o, 'state', path),
    };
}

function lightState(v: unknown, path: string): LightState {
    const o = object(v, path);
    return { id: str(o, 'id', path), green: bool(o, 'green', path) };
}

function stepEvent(v: unknown, path: string): StepEvent {
    const o = object(v, path);
    return { type: str(o, 'type', path), id: str(o, 'id', path) };
}

function stats(v: unknown, path: string): Stats {
    const o = object(v, path);
    return {
        step: num(o, 'step', path),
        running: bool(o, 'running', path),
        stopReason: nullableStr(o, 'stopReason', path),
        spawned: num(o, 'spawned', path),
        arrived: num(o, 'arrived', path),
        active: num(o, 'active', path),
        avgTripSteps: nullableNum(o, 'avgTripSteps', path),
        avgWaitSteps: nullableNum(o, 'avgWaitSteps', path),
    };
}

export function parseStep(value: unknown): StepFrame {
    const path = 'step';
    const o = object(value, path);
    return {
        step: num(o, 'step', path),
        running: bool(o, 'running', path),
        stats: stats(o.stats, `${path}.stats`),
        lights: list(o, 'lights', path, lightState),
        vehicles: list(o, 'vehicles', path, vehicle),
        events: list(o, 'events', path, stepEvent),
    };
}
