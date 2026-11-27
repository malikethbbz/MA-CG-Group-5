import { describe, expect, it } from 'vitest';
import { M4, V3 } from '../libs/3d-lib';

function apply(m: Float32Array, x: number, y: number, z: number): number[] {
    return [...M4.transformPoint(m, V3.create(x, y, z))];
}

function expectClose(actual: number[], expected: number[]): void {
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
}

describe('M4 transforms from libs/3d-lib', () => {
    it('rotates each axis counter-clockwise for a positive angle', () => {
        const q = Math.PI / 2;
        expectClose(apply(M4.rotationX(q), 0, 1, 0), [0, 0, 1]);
        expectClose(apply(M4.rotationY(q), 0, 0, 1), [1, 0, 0]);
        expectClose(apply(M4.rotationZ(q), 1, 0, 0), [0, 1, 0]);
    });

    it('translates and scales points', () => {
        expectClose(apply(M4.translation(V3.create(1, 2, 3)), 1, 1, 1), [2, 3, 4]);
        expectClose(apply(M4.scale(V3.create(2, 3, 4)), 1, 1, 1), [2, 3, 4]);
    });

    it('multiply(a, b) applies b first, then a', () => {
        const t = M4.translation(V3.create(10, 0, 0));
        const r = M4.rotationY(Math.PI / 2);
        // Rotate (0,0,1) to (1,0,0), then translate: (11, 0, 0)
        expectClose(apply(M4.multiply(t, r), 0, 0, 1), [11, 0, 0]);
        // Translate to (10,0,1), then rotate: (1, 0, -10)
        expectClose(apply(M4.multiply(r, t), 0, 0, 1), [1, 0, -10]);
    });

    it('inverse undoes a composed transform', () => {
        const m = M4.multiply(M4.translation(V3.create(3, -2, 5)), M4.rotationX(0.8));
        expectClose(apply(M4.multiply(M4.inverse(m), m), 4, 5, 6), [4, 5, 6]);
    });
});

describe('V3 from libs/3d-lib', () => {
    it('normalizes in place without dividing by zero', () => {
        const v = V3.create(3, 0, 4);
        V3.normalize(v, v);
        expectClose([...v], [0.6, 0, 0.8]);
        expectClose([...V3.normalize(V3.create(0, 0, 0))], [0, 0, 0]);
    });

    it('crosses x into y to give z, even when the result aliases an input', () => {
        const x = V3.create(1, 0, 0);
        V3.cross(x, V3.create(0, 1, 0), x);
        expectClose([...x], [0, 0, 1]);
        expect(V3.dot(V3.create(1, 2, 3), V3.create(4, 5, 6))).toBe(32);
    });
});
