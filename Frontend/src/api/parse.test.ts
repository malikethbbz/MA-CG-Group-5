import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCity, parseStep } from './parse';

// The examples from docs/frame-api.md
const CITY = {
    width: 36, height: 35,
    roads: [{ x: 0, z: 0, direction: 'Right' }],
    obstacles: [{ x: 3, z: 4 }],
    destinations: [{ x: 5, z: 7 }],
    lights: [{ id: '12', x: 6, z: 2, direction: 'Up' }],
    helipads: [],
};

const STEP = {
    step: 31, running: true,
    stats: { step: 31, running: true, stopReason: null, spawned: 16, arrived: 9, active: 7,
        avgTripSteps: 18.2, avgWaitSteps: 1.4 },
    lights: [{ id: '12', green: true }],
    vehicles: [{ id: '1263', kind: 'car', x: 34, y: 0, z: 27, heading: { x: 0, z: 1 }, state: 'driving' }],
    events: [{ type: 'arrived', id: '1276' }],
};

describe('parseCity', () => {
    it('accepts the documented example, with no landmarks when the field is absent', () => {
        expect(parseCity(CITY)).toEqual({ ...CITY, landmarks: [] });
    });

    it('rejects an unknown road direction, naming the field', () => {
        const bad = { ...CITY, roads: [{ x: 0, z: 0, direction: 'North' }] };
        expect(() => parseCity(bad)).toThrow('city.roads[0].direction');
    });
});

describe('parseCity landmarks', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reads an empty list as no landmarks', () => {
        expect(parseCity({ ...CITY, landmarks: [] }).landmarks).toEqual([]);
    });

    it('keeps a monument with its cell', () => {
        const city = parseCity({ ...CITY, landmarks: [{ kind: 'monument', x: 17, z: 12 }] });
        expect(city.landmarks).toEqual([{ kind: 'monument', x: 17, z: 12 }]);
    });

    it('skips an unknown kind with a warning and keeps the rest', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const city = parseCity({ ...CITY, landmarks: [
            { kind: 'statue', x: 1, z: 2 },
            { kind: 'monument', x: 5, z: 6 },
        ] });
        expect(city.landmarks).toEqual([{ kind: 'monument', x: 5, z: 6 }]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('statue');
    });

    it('still rejects a malformed landmark, naming the field', () => {
        expect(() => parseCity({ ...CITY, landmarks: [{ kind: 'monument', x: 'a', z: 1 }] }))
            .toThrow('city.landmarks[0].x');
        expect(() => parseCity({ ...CITY, landmarks: {} })).toThrow('city.landmarks');
    });
});

describe('parseStep', () => {
    it('accepts the documented example unchanged', () => {
        expect(parseStep(STEP)).toEqual(STEP);
    });

    it('accepts null averages before any car arrives', () => {
        const early = { ...STEP, stats: { ...STEP.stats, avgTripSteps: null, avgWaitSteps: null } };
        expect(parseStep(early).stats.avgTripSteps).toBeNull();
    });

    it('rejects a vehicle with a numeric id, naming the field', () => {
        const bad = { ...STEP, vehicles: [{ ...STEP.vehicles[0], id: 1263 }] };
        expect(() => parseStep(bad)).toThrow('step.vehicles[0].id');
    });

    it('rejects a missing vehicles list', () => {
        const { vehicles: _omit, ...bad } = STEP;
        expect(() => parseStep(bad)).toThrow('step.vehicles');
    });
});
