import { describe, expect, it } from 'vitest';
import type { VehicleFrame } from '../api/contract';
import {
    EMPTY_SIRENS, FLASH_PERIOD_MS, flashOffsetMs, PULSE_PERIOD_MS, sirenLevels, syncSirens,
    type SirenMap, type SirenMode,
} from './siren';
import { vehiclesDrawItems } from './vehicle_items';
import { CAR_SPEC } from './vehicle_specs';
import { EMPTY_VEHICLES, syncVehicles, type VehicleMap } from './vehicle_sync';

function unit(id: string, kind: string, state: string): VehicleFrame {
    return { id, kind, x: 3, y: 0, z: 4, heading: { x: 1, z: 0 }, state };
}

// Feeds one vehicle through a sequence of states, frame by frame, as main.ts does,
// and returns the siren mode after each frame.
function modesOver(kind: string, states: readonly string[]): (SirenMode | undefined)[] {
    let vehicles: VehicleMap = EMPTY_VEHICLES;
    let sirens: SirenMap = EMPTY_SIRENS;
    return states.map((state) => {
        vehicles = syncVehicles(vehicles, [unit('a1', kind, state)]).vehicles;
        sirens = syncSirens(sirens, vehicles);
        return sirens.get('a1')?.mode;
    });
}

describe('siren on/off per kind and state', () => {
    it('runs an ambulance mission: siren out, glow on scene, silent all the way home', () => {
        const mission = ['idle', 'takeoff', 'cruise', 'landing', 'on_scene', 'takeoff', 'return', 'landing', 'idle'];
        expect(modesOver('ambulance', mission)).toEqual(
            ['off', 'active', 'active', 'active', 'pulse', 'off', 'off', 'off', 'off']);
    });

    it('turns the siren back on when a parked ambulance is sent out again', () => {
        const twoCalls = ['cruise', 'landing', 'on_scene', 'takeoff', 'return', 'landing', 'idle', 'takeoff', 'cruise'];
        expect(modesOver('ambulance', twoCalls).slice(-2)).toEqual(['active', 'active']);
    });

    it('sounds a police siren in any state except idle and patrol', () => {
        expect(modesOver('police', ['idle', 'patrol', 'pursuit', 'responding', 'patrol']))
            .toEqual(['off', 'off', 'active', 'active', 'off']);
    });

    it('tracks no siren for kinds without one', () => {
        expect(modesOver('car', ['driving', 'waiting'])).toEqual([undefined, undefined]);
        expect(modesOver('motorcycle', ['driving'])).toEqual([undefined]);
    });

    it('forgets a vehicle once it leaves the frame', () => {
        const vehicles = syncVehicles(EMPTY_VEHICLES, [unit('a1', 'ambulance', 'cruise')]).vehicles;
        const sirens = syncSirens(EMPTY_SIRENS, vehicles);
        expect(syncSirens(sirens, EMPTY_VEHICLES).size).toBe(0);
    });
});

describe('flash timing', () => {
    it('alternates the two lamps every half period while active, never both lit', () => {
        expect(sirenLevels('active', 0)).toEqual([1, 0]);
        expect(sirenLevels('active', FLASH_PERIOD_MS / 2 - 1)).toEqual([1, 0]);
        expect(sirenLevels('active', FLASH_PERIOD_MS / 2)).toEqual([0, 1]);
        expect(sirenLevels('active', FLASH_PERIOD_MS)).toEqual([1, 0]);
        for (let t = 0; t < 3 * FLASH_PERIOD_MS; t += 37) {
            const [left, right] = sirenLevels('active', t);
            expect(left + right).toBe(1);
        }
    });

    it('shifts the phase by the per-vehicle offset, also for negative times', () => {
        expect(sirenLevels('active', 0, FLASH_PERIOD_MS / 2)).toEqual([0, 1]);
        expect(sirenLevels('active', -10)).toEqual([0, 1]);
    });

    it('pulses both lamps slowly and smoothly on scene', () => {
        const at = (t: number) => sirenLevels('pulse', t);
        expect(at(PULSE_PERIOD_MS / 4)).toEqual([1, 1]);
        expect(at(3 * PULSE_PERIOD_MS / 4)[0]).toBeCloseTo(0);
        expect(at(100)[0]).toBeCloseTo(at(100 + PULSE_PERIOD_MS)[0]);
        // Slow: a tenth of a period never jumps more than a third of the range
        for (let t = 0; t < PULSE_PERIOD_MS; t += 50) {
            expect(Math.abs(at(t + PULSE_PERIOD_MS / 10)[0] - at(t)[0])).toBeLessThan(0.34);
        }
    });

    it('keeps the bar dark when off', () => {
        expect(sirenLevels('off', 123)).toEqual([0, 0]);
    });

    it('gives each id a stable offset inside one flash period', () => {
        expect(flashOffsetMs('1261')).toBe(flashOffsetMs('1261'));
        const offsets = new Set(['1', '2', '3', '41', '1261', '1288'].map(flashOffsetMs));
        expect(offsets.size).toBeGreaterThan(3);
        for (const offset of offsets) {
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset).toBeLessThan(FLASH_PERIOD_MS);
        }
    });
});

describe('light bar draw items', () => {
    const bar = (kind: string, state: string, timeMs: number) => {
        const vehicles = syncVehicles(EMPTY_VEHICLES, [unit('a1', kind, state)]).vehicles;
        const items = vehiclesDrawItems(vehicles, 0, syncSirens(EMPTY_SIRENS, vehicles), timeMs);
        // The bar lamps are the last two items, after the body parts and wheels
        const partCount = CAR_SPEC.parts.length + CAR_SPEC.wheelOffsets.length;
        return items.slice(partCount);
    };

    it('mounts two lamps on the roof of an ambulance, and none on a car', () => {
        const lamps = bar('ambulance', 'cruise', 0);
        expect(lamps).toHaveLength(2);
        for (const lamp of lamps) {
            expect(lamp.world[13]).toBeGreaterThan(CAR_SPEC.roofHeight);
        }
        expect(bar('car', 'driving', 0)).toHaveLength(0);
    });

    it('swaps which lamp is bright half a period later while on a call', () => {
        const offset = flashOffsetMs('a1');
        const brightness = (t: number) => bar('ambulance', 'cruise', t - offset).map((lamp) => lamp.color[0] + lamp.color[1] + lamp.color[2]);
        const [l0, r0] = brightness(0);
        const [l1, r1] = brightness(FLASH_PERIOD_MS / 2);
        expect(l0).toBeGreaterThan(l1);
        expect(r1).toBeGreaterThan(r0);
    });

    it('does not flash a parked ambulance', () => {
        const colors = (t: number) => bar('ambulance', 'idle', t).map((lamp) => [...lamp.color]);
        expect(colors(0)).toEqual(colors(FLASH_PERIOD_MS / 2));
    });
});
