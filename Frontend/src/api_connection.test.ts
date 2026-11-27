import { afterEach, describe, expect, it, vi } from 'vitest';
import { initModel, parseCity, parseStep } from './api_connection';

// The examples from docs/frame-api.md
const CITY = {
    width: 36, height: 36,
    roads: [{ x: 0, z: 0, direction: 'Right' }],
    obstacles: [{ x: 3, z: 4 }],
    destinations: [{ x: 5, z: 7 }],
    lights: [{ id: '12', x: 6, z: 2, direction: 'Up' }],
    hospital: { x: 3, z: 4 },
    helipads: [{ x: 3, z: 4 }],
    landmarks: [{ kind: 'monument', x: 15, z: 21 }],
};

const STEP = {
    step: 31, running: true,
    stats: { step: 31, running: true, stopReason: null, spawned: 16, arrived: 9, active: 7,
        avgTripSteps: 18.2, avgWaitSteps: 1.4, emergenciesServed: 1 },
    lights: [{ id: '12', green: true, yellow: false }],
    vehicles: [{ id: '1263', kind: 'car', x: 34, y: 0, z: 27, heading: { x: 0, z: 1 }, state: 'driving' }],
    events: [{ type: 'arrived', id: '1276' }],
};

describe('initModel', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts the GUI options as the /init body', async () => {
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"message":"ok"}'));
        vi.stubGlobal('fetch', fetchMock);
        const options = { map: '2025_reforma.txt', spawnInterval: 3, carsPerSpawn: 2, ambulances: 1, emergencyChance: 0.5 };
        await initModel(options);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url.endsWith('/init')).toBe(true);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual(options);
    });

    it('shows the message the server gives when it refuses a value', async () => {
        const refusal = new Response(JSON.stringify({ message: 'carsPerSpawn must be 1 to 4.' }), { status: 400 });
        vi.stubGlobal('fetch', vi.fn(async () => refusal));
        await expect(initModel({ carsPerSpawn: 9 })).rejects.toThrow('400: carsPerSpawn must be 1 to 4.');
    });

    it('says the server cannot be reached when it is down', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        }));
        await expect(initModel({})).rejects.toThrow('No se puede conectar');
    });
});

describe('parseCity', () => {
    it('reads the documented example', () => {
        const city = parseCity(CITY);
        expect(city.hospital).toEqual({ x: 3, z: 4 });
        expect(city.lights).toEqual([{ id: '12', x: 6, z: 2, direction: 'Up' }]);
        expect(city.landmarks).toEqual([{ x: 15, z: 21 }]);
    });

    it('accepts a city without hospital, helipads or landmarks', () => {
        const { hospital: _h, helipads: _p, landmarks: _l, ...bare } = CITY;
        const city = parseCity(bare);
        expect(city.hospital).toBeNull();
        expect(city.helipads).toEqual([]);
        expect(city.landmarks).toEqual([]);
    });

    it('skips landmarks of a kind it cannot draw', () => {
        const city = parseCity({ ...CITY, landmarks: [{ kind: 'statue', x: 1, z: 2 }, { kind: 'monument', x: 5, z: 6 }] });
        expect(city.landmarks).toEqual([{ x: 5, z: 6 }]);
    });

    it('rejects an unknown road direction, naming the field', () => {
        const bad = { ...CITY, roads: [{ x: 0, z: 0, direction: 'North' }] };
        expect(() => parseCity(bad)).toThrow('city.roads[0].direction');
    });
});

describe('parseStep', () => {
    it('reads the documented example', () => {
        const frame = parseStep(STEP);
        expect(frame.stats).toEqual(STEP.stats);
        expect(frame.vehicles).toEqual(STEP.vehicles);
        expect(frame.lights).toEqual(STEP.lights);
    });

    it('accepts null averages before any car arrives, and stats without emergencies', () => {
        const { emergenciesServed: _e, ...stats } = STEP.stats;
        const early = parseStep({ ...STEP, stats: { ...stats, avgTripSteps: null, avgWaitSteps: null } });
        expect(early.stats.avgTripSteps).toBeNull();
        expect(early.stats.emergenciesServed).toBeUndefined();
    });

    it('rejects a vehicle with a numeric id, and a missing vehicles list', () => {
        expect(() => parseStep({ ...STEP, vehicles: [{ ...STEP.vehicles[0], id: 1263 }] })).toThrow('step.vehicles[0].id');
        const { vehicles: _v, ...noVehicles } = STEP;
        expect(() => parseStep(noVehicles)).toThrow('step.vehicles');
    });
});
