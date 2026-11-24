import { describe, expect, it } from 'vitest';
import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import type { VehicleFrame } from '../api/contract';
import { CELL_SIZE } from '../config';
import { carWorldMatrix, WHEEL_OFFSETS, WHEEL_RADIUS, wheelHubMatrix, wheelSpin } from './car_model';
import { vehiclesDrawItems } from './vehicle_items';
import { EMPTY_VEHICLES, syncVehicles } from './vehicle_sync';

function point(m: Mat4, x = 0, y = 0, z = 0): number[] {
    return [...M4.transformPoint(m, V3.create(x, y, z))];
}

function expectClose(actual: number[], expected: number[]): void {
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
}

describe('wheelSpin', () => {
    it('is the distance rolled over the wheel radius', () => {
        expect(wheelSpin(0)).toBe(0);
        expect(wheelSpin(2 * Math.PI * WHEEL_RADIUS)).toBeCloseTo(2 * Math.PI);
        expect(wheelSpin(CELL_SIZE)).toBeCloseTo(CELL_SIZE / WHEEL_RADIUS);
    });
});

describe('wheel hierarchy', () => {
    const frontLeft = WHEEL_OFFSETS[0];

    it('places a wheel at car position + yaw-rotated offset', () => {
        // Car on cell (5, 7) facing +x: rotationY(PI/2) sends local (x, y, z) to (z, y, -x)
        const car = carWorldMatrix({ x: 5, y: 0, z: 7, yaw: Math.PI / 2 });
        const hub = wheelHubMatrix(car, frontLeft, 0);
        const [ox, oy, oz] = frontLeft;
        expectClose(point(hub), [5 * CELL_SIZE + oz, oy, 7 * CELL_SIZE - ox]);
    });

    it('keeps the wheel centre fixed while it spins', () => {
        const car = carWorldMatrix({ x: 2, y: 1, z: 3, yaw: 0.7 });
        expectClose(point(wheelHubMatrix(car, frontLeft, 1.9)), point(wheelHubMatrix(car, frontLeft, 0)));
    });

    it('rolls the top of the wheel toward the direction the car faces', () => {
        // Car faces +x; a small positive spin must push the rim top forward (+x)
        const car = carWorldMatrix({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 });
        const before = point(wheelHubMatrix(car, frontLeft, 0), 0, 1, 0);
        const after = point(wheelHubMatrix(car, frontLeft, 0.2), 0, 1, 0);
        expect(after[0] - before[0]).toBeGreaterThan(0.1);
        expect(after[2]).toBeCloseTo(before[2]);
    });
});

describe('vehicle draw items', () => {
    function car(x: number, z: number, state: string): VehicleFrame {
        return { id: '1', kind: 'car', x, y: 0, z, heading: { x: 0, z: 1 }, state };
    }
    const wheels = (vehicles: Parameters<typeof vehiclesDrawItems>[0], alpha: number) =>
        vehiclesDrawItems(vehicles, alpha).filter((item) => item.shape === 'wheel').map((item) => [...item.world]);

    it('spins the wheels while the car drives between frames', () => {
        const a = syncVehicles(EMPTY_VEHICLES, [car(0, 0, 'driving')]).vehicles;
        const b = syncVehicles(a, [car(0, 1, 'driving')]).vehicles;
        expect(wheels(b, 0.5)).not.toEqual(wheels(b, 0));
    });

    it('keeps the wheels still while the car waits', () => {
        const a = syncVehicles(EMPTY_VEHICLES, [car(0, 0, 'driving')]).vehicles;
        const b = syncVehicles(a, [car(0, 1, 'driving')]).vehicles;
        const waiting = syncVehicles(b, [car(0, 1, 'waiting')]).vehicles;
        expect(wheels(waiting, 1)).toEqual(wheels(waiting, 0));
        // ...and the waiting wheels keep the angle they reached, they do not reset
        expect(wheels(waiting, 0)).toEqual(wheels(b, 1));
    });
});
