import { describe, expect, it } from 'vitest';
import type { VehicleFrame } from './api_connection';
import { COLORS } from './config';
import {
    frameAlpha, headingToYaw, interpolatePose, lerpAngle, syncVehicles, vehicleItems, type Pose, type TrackedVehicle,
} from './vehicles';

// Unit vector the model's +z axis points to after rotationY(yaw)
const facing = (yaw: number): number[] => [Math.sin(yaw), Math.cos(yaw)];

function frame(id: string, x: number, z: number, hx = 0, hz = 1, kind = 'car', state = 'driving'): VehicleFrame {
    return { id, kind, x, y: 0, z, heading: { x: hx, z: hz }, state };
}

describe('frameAlpha', () => {
    it('is the elapsed share of the step, clamped to [0, 1]', () => {
        expect(frameAlpha(200, 400)).toBe(0.5);
        expect(frameAlpha(1000, 400)).toBe(1);
        expect(frameAlpha(-50, 400)).toBe(0);
        expect(frameAlpha(0, 0)).toBe(1);
    });
});

describe('turning', () => {
    it('faces the model forward axis along the heading, and keeps the yaw for a zero heading', () => {
        for (const [hx, hz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
            const [fx, fz] = facing(headingToYaw({ x: hx, z: hz }, 0));
            expect(fx).toBeCloseTo(hx / Math.hypot(hx, hz));
            expect(fz).toBeCloseTo(hz / Math.hypot(hx, hz));
        }
        expect(headingToYaw({ x: 0, z: 0 }, 1.23)).toBe(1.23);
    });

    it('turns 90 degrees across the +-PI seam instead of 270 the other way', () => {
        // Heading -z (yaw PI) turning to -x (yaw -PI/2): a left turn through the seam
        const from = headingToYaw({ x: 0, z: -1 }, 0);
        const to = headingToYaw({ x: -1, z: 0 }, 0);
        const [fx, fz] = facing(lerpAngle(from, to, 0.5));
        expect(fx).toBeCloseTo(-Math.SQRT1_2);
        expect(fz).toBeCloseTo(-Math.SQRT1_2);
    });

    it('never turns more than half a circle, for any pair of headings', () => {
        const headings = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        for (const [ax, az] of headings) {
            for (const [bx, bz] of headings) {
                const a = headingToYaw({ x: ax, z: az }, 0);
                const b = headingToYaw({ x: bx, z: bz }, 0);
                expect(Math.abs(lerpAngle(a, b, 1) - a)).toBeLessThanOrEqual(Math.PI + 1e-9);
                expect(facing(lerpAngle(a, b, 1))[0]).toBeCloseTo(Math.sin(b));
            }
        }
    });
});

describe('interpolatePose', () => {
    const from: Pose = { x: 2, y: 0, z: 4, yaw: 0 };
    const to: Pose = { x: 3, y: 2, z: 6, yaw: Math.PI / 2 };

    it('goes from the previous pose to the new one, halfway at 0.5', () => {
        expect(interpolatePose(from, to, 0)).toEqual(from);
        const mid = interpolatePose(from, to, 0.5);
        expect([mid.x, mid.y, mid.z]).toEqual([2.5, 1, 5]);
        expect(mid.yaw).toBeCloseTo(Math.PI / 4);
    });
});

describe('syncVehicles', () => {
    it('starts a new vehicle still and moves a known one from its last pose', () => {
        const first = syncVehicles(new Map(), [frame('1', 0, 0)]);
        expect(first.get('1')?.from).toEqual(first.get('1')?.to);
        const second = syncVehicles(first, [frame('1', 0, 1)]);
        expect(second.get('1')?.from).toMatchObject({ x: 0, z: 0 });
        expect(second.get('1')?.to).toMatchObject({ x: 0, z: 1 });
    });

    it('drops vehicles missing from the frame and never changes the previous map', () => {
        const before = syncVehicles(new Map(), [frame('a', 0, 0), frame('b', 3, 0)]);
        const snapshot = structuredClone([...before.entries()]);
        const after = syncVehicles(before, [frame('b', 4, 0, 1, 0), frame('c', 9, 9)]);
        expect([...after.keys()].sort()).toEqual(['b', 'c']);
        expect([...before.entries()]).toEqual(snapshot);
    });

    it('keeps the previous yaw when a waiting vehicle reports a zero heading', () => {
        const first = syncVehicles(new Map(), [frame('1', 0, 0, 1, 0)]);
        const second = syncVehicles(first, [frame('1', 0, 0, 0, 0, 'car', 'waiting')]);
        expect(second.get('1')?.to.yaw).toBeCloseTo(Math.PI / 2);
        expect(second.get('1')?.state).toBe('waiting');
    });
});

describe('vehicleItems', () => {
    const tracked = (kind: string, state: string): TrackedVehicle => {
        const pose = { x: 5, y: 0, z: 7, yaw: Math.PI / 2 };
        return { id: '1', kind, state, from: pose, to: pose };
    };

    it('builds the vehicle around its position, facing its heading', () => {
        const body = vehicleItems(tracked('car', 'driving'), 1, 0)[0].world;
        expect(body[12]).toBeCloseTo(5);
        expect(body[14]).toBeCloseTo(7);
        // Yaw PI/2 faces +x: the body's length (its local z, 0.6) now lies along world x
        expect(body[8]).toBeCloseTo(0.6);
        expect(body[10]).toBeCloseTo(0);
    });

    it('blinks the ambulance light bar red and blue only while on a mission', () => {
        // The light bar is the last two boxes: red lamp, then blue lamp
        const bar = (state: string, timeMs: number) => vehicleItems(tracked('ambulance', state), 1, timeMs).slice(-2);
        const [red0, blue0] = bar('cruise', 0);
        const [red1, blue1] = bar('cruise', 250);
        expect([red0.emissive, blue0.emissive]).toEqual([1, 0]);
        expect([red1.emissive, blue1.emissive]).toEqual([0, 1]);
        expect(red0.color).toEqual(COLORS.sirenRed);
        expect(bar('idle', 0).map((lamp) => lamp.emissive)).toEqual([0, 0]);
        expect(bar('idle', 0).map((lamp) => lamp.color)).toEqual(bar('idle', 250).map((lamp) => lamp.color));
        expect(vehicleItems(tracked('car', 'driving'), 1, 0)).toHaveLength(6);
    });
});
