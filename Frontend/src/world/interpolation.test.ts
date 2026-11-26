import { describe, expect, it } from 'vitest';
import {
    frameAlpha, headingToYaw, interpolatePose, lerpAngle, shortestAngleDelta, type Pose,
} from './interpolation';

// Unit vector the model's +z axis points to after rotationY(yaw)
function facing(yaw: number): [number, number] {
    return [Math.sin(yaw), Math.cos(yaw)];
}

describe('frameAlpha', () => {
    it('is the elapsed fraction of the step interval', () => {
        expect(frameAlpha(0, 400)).toBe(0);
        expect(frameAlpha(200, 400)).toBe(0.5);
        expect(frameAlpha(400, 400)).toBe(1);
    });

    it('clamps to 1 when the next frame is late, and to 0 before the frame', () => {
        expect(frameAlpha(1000, 400)).toBe(1);
        expect(frameAlpha(-50, 400)).toBe(0);
    });

    it('jumps straight to the target for a zero interval', () => {
        expect(frameAlpha(0, 0)).toBe(1);
    });
});

describe('interpolatePose', () => {
    const from: Pose = { x: 2, y: 0, z: 4, yaw: 0 };
    const to: Pose = { x: 3, y: 2, z: 6, yaw: Math.PI / 2 };

    it('returns the previous pose at alpha 0 and the new one at alpha 1', () => {
        expect(interpolatePose(from, to, 0)).toEqual(from);
        const end = interpolatePose(from, to, 1);
        expect([end.x, end.y, end.z]).toEqual([3, 2, 6]);
        expect(end.yaw).toBeCloseTo(Math.PI / 2);
    });

    it('is halfway in position, altitude and yaw at alpha 0.5', () => {
        const mid = interpolatePose(from, to, 0.5);
        expect([mid.x, mid.y, mid.z]).toEqual([2.5, 1, 5]);
        expect(mid.yaw).toBeCloseTo(Math.PI / 4);
    });
});

describe('headingToYaw', () => {
    it('faces the model forward axis along the heading', () => {
        for (const [hx, hz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
            const [fx, fz] = facing(headingToYaw({ x: hx, z: hz }, 0));
            const length = Math.hypot(hx, hz);
            expect(fx).toBeCloseTo(hx / length);
            expect(fz).toBeCloseTo(hz / length);
        }
    });

    it('keeps the fallback for a zero heading', () => {
        expect(headingToYaw({ x: 0, z: 0 }, 1.23)).toBe(1.23);
    });
});

describe('shortest-angle yaw blending', () => {
    it('turns 90 degrees across the +-PI seam instead of 270 the other way', () => {
        // Heading -z (yaw PI) turning to -x (yaw -PI/2): a left turn through the seam
        const from = headingToYaw({ x: 0, z: -1 }, 0);
        const to = headingToYaw({ x: -1, z: 0 }, 0);
        expect(Math.abs(shortestAngleDelta(from, to))).toBeCloseTo(Math.PI / 2);
        const [fx, fz] = facing(lerpAngle(from, to, 0.5));
        expect(fx).toBeCloseTo(-Math.SQRT1_2);
        expect(fz).toBeCloseTo(-Math.SQRT1_2);
    });

    it('never turns more than half a circle for any pair of headings', () => {
        const headings = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        for (const [ax, az] of headings) {
            for (const [bx, bz] of headings) {
                const a = headingToYaw({ x: ax, z: az }, 0);
                const b = headingToYaw({ x: bx, z: bz }, 0);
                expect(Math.abs(shortestAngleDelta(a, b))).toBeLessThanOrEqual(Math.PI + 1e-9);
                const [fx, fz] = facing(lerpAngle(a, b, 1));
                expect(fx).toBeCloseTo(Math.sin(b));
                expect(fz).toBeCloseTo(Math.cos(b));
            }
        }
    });

    it('wraps yaw values that drifted beyond one turn', () => {
        expect(shortestAngleDelta(5 * Math.PI, 0)).toBeCloseTo(-Math.PI);
        expect(shortestAngleDelta(0.1, 0.1 + 4 * Math.PI)).toBeCloseTo(0);
    });
});
