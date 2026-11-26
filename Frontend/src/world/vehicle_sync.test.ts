import { describe, expect, it } from 'vitest';
import type { VehicleFrame } from '../api/contract';
import { EMPTY_VEHICLES, syncVehicles, travelledDistance, vehiclePose } from './vehicle_sync';

function car(id: string, x: number, z: number, hx = 0, hz = 1, state = 'driving'): VehicleFrame {
    return { id, kind: 'car', x, y: 0, z, heading: { x: hx, z: hz }, state };
}

describe('syncVehicles', () => {
    it('adds every vehicle of the first frame with from equal to to', () => {
        const { vehicles, added, updated, removed } = syncVehicles(EMPTY_VEHICLES, [car('1', 0, 0), car('2', 5, 5)]);
        expect(added).toEqual(['1', '2']);
        expect(updated).toEqual([]);
        expect(removed).toEqual([]);
        expect(vehicles.get('2')?.from).toEqual(vehicles.get('2')?.to);
        expect(vehicles.get('2')?.to).toMatchObject({ x: 5, z: 5 });
    });

    it('moves a known vehicle from its last target to the new frame position', () => {
        const first = syncVehicles(EMPTY_VEHICLES, [car('1', 0, 0)]).vehicles;
        const second = syncVehicles(first, [car('1', 0, 1)]).vehicles;
        const third = syncVehicles(second, [car('1', 0, 2)]);
        const tracked = third.vehicles.get('1');
        expect(third.updated).toEqual(['1']);
        expect(tracked?.from).toMatchObject({ x: 0, z: 1 });
        expect(tracked?.to).toMatchObject({ x: 0, z: 2 });
    });

    it('removes a vanished id and adds a new one in the same frame', () => {
        const before = syncVehicles(EMPTY_VEHICLES, [car('a', 0, 0), car('b', 3, 0)]).vehicles;
        const result = syncVehicles(before, [car('b', 4, 0, 1, 0), car('c', 9, 9)]);
        expect(result.removed).toEqual(['a']);
        expect(result.added).toEqual(['c']);
        expect(result.updated).toEqual(['b']);
        expect([...result.vehicles.keys()].sort()).toEqual(['b', 'c']);
    });

    it('never modifies the previous map or its vehicles', () => {
        const before = syncVehicles(EMPTY_VEHICLES, [car('a', 0, 0), car('b', 3, 0)]).vehicles;
        const snapshot = structuredClone([...before.entries()]);
        syncVehicles(before, [car('b', 4, 0), car('c', 1, 1)]);
        expect([...before.entries()]).toEqual(snapshot);
    });

    it('keeps the previous yaw when a frame reports a zero heading', () => {
        const first = syncVehicles(EMPTY_VEHICLES, [car('1', 0, 0, 1, 0)]).vehicles;
        const second = syncVehicles(first, [car('1', 0, 0, 0, 0, 'waiting')]).vehicles;
        expect(second.get('1')?.to.yaw).toBeCloseTo(Math.PI / 2);
        expect(second.get('1')?.state).toBe('waiting');
    });

    it('accumulates distance across frames and adds none while waiting', () => {
        let vehicles = syncVehicles(EMPTY_VEHICLES, [car('1', 0, 0)]).vehicles;
        for (const z of [1, 2, 3, 3, 3]) {
            vehicles = syncVehicles(vehicles, [car('1', 0, z)]).vehicles;
        }
        // Moves 0->1->2->3 then waits twice: 3 cells by the end of the last segment
        const tracked = vehicles.get('1')!;
        expect(travelledDistance(tracked, 0)).toBeCloseTo(3);
        expect(travelledDistance(tracked, 1)).toBeCloseTo(3);
    });

    it('continues the distance smoothly from one frame to the next', () => {
        const a = syncVehicles(EMPTY_VEHICLES, [car('1', 0, 0)]).vehicles;
        const b = syncVehicles(a, [car('1', 0, 1)]).vehicles;
        const c = syncVehicles(b, [car('1', 1, 2, 1, 1)]).vehicles;
        expect(travelledDistance(b.get('1')!, 1)).toBeCloseTo(travelledDistance(c.get('1')!, 0));
        expect(travelledDistance(c.get('1')!, 1)).toBeCloseTo(1 + Math.SQRT2);
    });

    it('interpolates altitude for flying units', () => {
        const a = syncVehicles(EMPTY_VEHICLES, [{ ...car('h', 2, 2), y: 0 }]).vehicles;
        const b = syncVehicles(a, [{ ...car('h', 2, 2), y: 4 }]).vehicles;
        expect(vehiclePose(b.get('h')!, 0.25).y).toBeCloseTo(1);
    });
});
