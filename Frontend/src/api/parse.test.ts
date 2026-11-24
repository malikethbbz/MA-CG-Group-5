import { describe, expect, it } from 'vitest';
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
    it('accepts the documented example unchanged', () => {
        expect(parseCity(CITY)).toEqual(CITY);
    });

    it('rejects an unknown road direction, naming the field', () => {
        const bad = { ...CITY, roads: [{ x: 0, z: 0, direction: 'North' }] };
        expect(() => parseCity(bad)).toThrow('city.roads[0].direction');
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
