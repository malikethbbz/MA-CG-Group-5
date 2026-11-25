import { describe, expect, it } from 'vitest';
import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import type { VehicleFrame } from '../api/contract';
import { CELL_SIZE } from '../config';
import { vehiclesDrawItems } from './vehicle_items';
import { vehicleWorldMatrix, wheelHubMatrix, wheelSpin } from './vehicle_model';
import { CAR_SPEC, MOTORCYCLE_SPEC } from './vehicle_specs';
import { EMPTY_VEHICLES, syncVehicles, type VehicleMap } from './vehicle_sync';

function point(m: Mat4, x = 0, y = 0, z = 0): number[] {
    return [...M4.transformPoint(m, V3.create(x, y, z))];
}

function expectClose(actual: number[], expected: number[]): void {
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
}

function frame(kind: string, x: number, z: number, state = 'driving', hx = 0, hz = 1): VehicleFrame {
    return { id: '1', kind, x, y: 0, z, heading: { x: hx, z: hz }, state };
}

// Two synced frames of one vehicle: from the first position to the second
function moved(kind: string, from: [number, number], to: [number, number], hx = 0, hz = 1): VehicleMap {
    const a = syncVehicles(EMPTY_VEHICLES, [frame(kind, ...from, 'driving', hx, hz)]).vehicles;
    return syncVehicles(a, [frame(kind, ...to, 'driving', hx, hz)]).vehicles;
}

const wheelWorlds = (vehicles: VehicleMap, alpha: number): Mat4[] =>
    vehiclesDrawItems(vehicles, alpha).filter((item) => item.shape === 'wheel').map((item) => item.world);

describe('wheelSpin', () => {
    it('is the distance rolled over the wheel radius', () => {
        expect(wheelSpin(0, 0.2)).toBe(0);
        expect(wheelSpin(2 * Math.PI * 0.2, 0.2)).toBeCloseTo(2 * Math.PI);
        expect(wheelSpin(CELL_SIZE, 0.1)).toBeCloseTo(CELL_SIZE / 0.1);
    });
});

describe('wheel hierarchy', () => {
    const frontLeft = CAR_SPEC.wheelOffsets[0];

    it('places a wheel at vehicle position + yaw-rotated offset', () => {
        // Car on cell (5, 7) facing +x: rotationY(PI/2) sends local (x, y, z) to (z, y, -x)
        const car = vehicleWorldMatrix({ x: 5, y: 0, z: 7, yaw: Math.PI / 2 });
        const [ox, oy, oz] = frontLeft;
        expectClose(point(wheelHubMatrix(car, frontLeft, 0)), [5 * CELL_SIZE + oz, oy, 7 * CELL_SIZE - ox]);
    });

    it('keeps the wheel centre fixed while it spins', () => {
        const car = vehicleWorldMatrix({ x: 2, y: 1, z: 3, yaw: 0.7 });
        expectClose(point(wheelHubMatrix(car, frontLeft, 1.9)), point(wheelHubMatrix(car, frontLeft, 0)));
    });

    it('rolls the top of the wheel toward the direction the vehicle faces', () => {
        // Facing +x; a small positive spin must push the rim top forward (+x)
        const car = vehicleWorldMatrix({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 });
        const before = point(wheelHubMatrix(car, frontLeft, 0), 0, 1, 0);
        const after = point(wheelHubMatrix(car, frontLeft, 0.2), 0, 1, 0);
        expect(after[0] - before[0]).toBeGreaterThan(0.1);
        expect(after[2]).toBeCloseTo(before[2]);
    });
});

describe('vehicle draw items', () => {
    it('spins the wheels while the car drives between frames', () => {
        const b = moved('car', [0, 0], [0, 1]);
        expect(wheelWorlds(b, 0.5).map((m) => [...m])).not.toEqual(wheelWorlds(b, 0).map((m) => [...m]));
    });

    it('keeps the wheels still while the car waits', () => {
        const b = moved('car', [0, 0], [0, 1]);
        const waiting = syncVehicles(b, [frame('car', 0, 1, 'waiting')]).vehicles;
        const asArrays = (ms: Mat4[]) => ms.map((m) => [...m]);
        expect(asArrays(wheelWorlds(waiting, 1))).toEqual(asArrays(wheelWorlds(waiting, 0)));
        // ...and the waiting wheels keep the angle they reached, they do not reset
        expect(asArrays(wheelWorlds(waiting, 0))).toEqual(asArrays(wheelWorlds(b, 1)));
    });
});

describe('motorcycle through the shared hierarchy', () => {
    it('has two wheels, front and rear, on the centre line of its heading', () => {
        // Riding diagonally from (3, 4): the centre line is (3, 4) + t * (1, 1) / sqrt 2
        const bike = moved('motorcycle', [3, 4], [3, 4], 1, 1);
        const hubs = wheelWorlds(bike, 0).map((m) => point(m));
        expect(hubs).toHaveLength(2);
        const axle = MOTORCYCLE_SPEC.wheelOffsets[0][2];
        const along = (axle / Math.SQRT2);
        expectClose(hubs[0], [3 * CELL_SIZE + along, MOTORCYCLE_SPEC.wheelRadius, 4 * CELL_SIZE + along]);
        expectClose(hubs[1], [3 * CELL_SIZE - along, MOTORCYCLE_SPEC.wheelRadius, 4 * CELL_SIZE - along]);
    });

    it('spins its wheels by its own radius: half a circumference turns them upside down', () => {
        const radius = MOTORCYCLE_SPEC.wheelRadius;
        const circumferenceCells = (2 * Math.PI * radius) / CELL_SIZE;
        const bike = moved('motorcycle', [0, 0], [0, circumferenceCells]);
        for (const wheel of wheelWorlds(bike, 0.5)) {
            const hub = point(wheel);
            const rimTop = point(wheel, 0, 1, 0);
            expectClose([rimTop[0] - hub[0], rimTop[1] - hub[1], rimTop[2] - hub[2]], [0, -radius, 0]);
        }
    });

    it('keeps the car its four wheels', () => {
        expect(wheelWorlds(moved('car', [0, 0], [0, 0]), 0)).toHaveLength(4);
    });
});
