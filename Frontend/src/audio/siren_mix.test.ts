import { describe, expect, it } from 'vitest';
import type { VehicleFrame } from '../api/contract';
import { CELL_SIZE } from '../config';
import { EMPTY_SIRENS, syncSirens } from '../world/siren';
import { EMPTY_VEHICLES, syncVehicles } from '../world/vehicle_sync';
import {
    activeSirenSources, distanceFalloff, MAX_TOTAL_GAIN, MAX_VOICE_GAIN, REFERENCE_DISTANCE, sirenGains,
    type SirenSource,
} from './siren_mix';

const wails = (...distances: number[]): SirenSource[] => distances.map((distance) => ({ voice: 'wail', distance }));
const yelps = (...distances: number[]): SirenSource[] => distances.map((distance) => ({ voice: 'yelp', distance }));

describe('sirenGains', () => {
    it('is silent with no active siren', () => {
        expect(sirenGains([])).toEqual({ wail: 0, yelp: 0 });
    });

    it('gets quieter with distance: half the presence at the reference distance', () => {
        expect(distanceFalloff(REFERENCE_DISTANCE)).toBeCloseTo(0.5);
        // Falls off with the square of distance, so far sirens fade out quickly
        expect(distanceFalloff(3 * REFERENCE_DISTANCE)).toBeCloseTo(0.1);
        const near = sirenGains(wails(0)).wail;
        const mid = sirenGains(wails(REFERENCE_DISTANCE)).wail;
        const far = sirenGains(wails(6 * REFERENCE_DISTANCE)).wail;
        expect(near).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(far);
        expect(far).toBeGreaterThan(0);
    });

    it('gets louder with more sirens, but never past the per-voice cap', () => {
        const one = sirenGains(wails(5)).wail;
        const three = sirenGains(wails(5, 5, 5)).wail;
        const crowd = sirenGains(wails(...Array<number>(200).fill(0))).wail;
        expect(three).toBeGreaterThan(one);
        expect(three).toBeLessThan(3 * one);
        expect(crowd).toBeLessThanOrEqual(MAX_VOICE_GAIN);
        expect(crowd).toBeGreaterThan(0.95 * MAX_VOICE_GAIN);
    });

    it('keeps each voice to its own sirens and caps both together', () => {
        expect(sirenGains(yelps(2)).wail).toBe(0);
        const both = sirenGains([...wails(...Array<number>(50).fill(0)), ...yelps(...Array<number>(50).fill(0))]);
        expect(both.wail + both.yelp).toBeLessThanOrEqual(MAX_TOTAL_GAIN + 1e-12);
        expect(both.wail).toBeCloseTo(both.yelp);
    });
});

describe('activeSirenSources', () => {
    function unit(id: string, kind: string, state: string, x: number, z: number, y = 0): VehicleFrame {
        return { id, kind, x, y, z, heading: { x: 1, z: 0 }, state };
    }

    it('lists only sounding sirens, with their voice and distance to the target', () => {
        const frames = [
            unit('amb-out', 'ambulance', 'cruise', 3, 4, 2),
            unit('amb-home', 'ambulance', 'idle', 0, 0),
            unit('amb-scene', 'ambulance', 'on_scene', 1, 0),
            unit('cop', 'police', 'pursuit', 10, 0),
            unit('car', 'car', 'driving', 1, 1),
        ];
        const vehicles = syncVehicles(EMPTY_VEHICLES, frames).vehicles;
        const sources = activeSirenSources(vehicles, syncSirens(EMPTY_SIRENS, vehicles), 1, [0, 2 * CELL_SIZE, 0]);
        expect(sources).toHaveLength(2);
        expect(sources[0].voice).toBe('wail');
        expect(sources[0].distance).toBeCloseTo(5 * CELL_SIZE);
        expect(sources[1].voice).toBe('yelp');
        expect(sources[1].distance).toBeCloseTo(Math.hypot(10, 2) * CELL_SIZE);
    });
});
