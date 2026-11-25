/*
 * Vertex data for the meshes the city is drawn with. The box and wheel carry a vertex color
 * that the shader multiplies by the per-object color.
 */

import type * as twgl from 'twgl-base.js';
import { cubeFaceColors } from '../../libs/shapes';

const WHEEL_SEGMENTS = 12;
const TREAD_DARK = 0.35;

// Unit cube centred on the origin (-0.5..0.5), white so u_color shows as is.
export function boxArrays(): twgl.Arrays {
    const cube = cubeFaceColors(0.5) as Record<string, { numComponents: number; data: number[] }>;
    const vertexCount = cube.a_position.data.length / 3;
    return {
        a_position: cube.a_position,
        a_normal: cube.a_normal,
        a_color: { numComponents: 4, data: new Array(vertexCount * 4).fill(1) },
        indices: cube.indices,
    };
}

// Cylinder of radius 1 and width 1 whose axle is the x axis. Tread faces and hub
// wedges alternate light and dark, so the spin is visible on a plain color.
export function wheelArrays(): twgl.Arrays {
    const position: number[] = [];
    const normal: number[] = [];
    const color: number[] = [];
    const indices: number[] = [];
    const push = (p: number[], n: number[], shade: number): number => {
        position.push(...p);
        normal.push(...n);
        color.push(shade, shade, shade, 1);
        return position.length / 3 - 1;
    };
    for (let i = 0; i < WHEEL_SEGMENTS; i++) {
        const a0 = (i / WHEEL_SEGMENTS) * 2 * Math.PI;
        const a1 = ((i + 1) / WHEEL_SEGMENTS) * 2 * Math.PI;
        const mid = (a0 + a1) / 2;
        const shade = i % 2 === 0 ? 1 : TREAD_DARK;
        const p0 = [Math.cos(a0), Math.sin(a0)];
        const p1 = [Math.cos(a1), Math.sin(a1)];
        // Tread quad, counter-clockwise seen from outside
        const n = [0, Math.cos(mid), Math.sin(mid)];
        const a = push([-0.5, p0[0], p0[1]], n, shade);
        const b = push([0.5, p0[0], p0[1]], n, shade);
        const c = push([0.5, p1[0], p1[1]], n, shade);
        const d = push([-0.5, p1[0], p1[1]], n, shade);
        indices.push(a, d, c, a, c, b);
        // Hub wedges on both sides
        const hubShade = 1.35 - shade;
        const r0 = push([0.5, 0, 0], [1, 0, 0], hubShade);
        const r1 = push([0.5, p0[0], p0[1]], [1, 0, 0], hubShade);
        const r2 = push([0.5, p1[0], p1[1]], [1, 0, 0], hubShade);
        indices.push(r0, r1, r2);
        const l0 = push([-0.5, 0, 0], [-1, 0, 0], hubShade);
        const l1 = push([-0.5, p0[0], p0[1]], [-1, 0, 0], hubShade);
        const l2 = push([-0.5, p1[0], p1[1]], [-1, 0, 0], hubShade);
        indices.push(l0, l2, l1);
    }
    return {
        a_position: { numComponents: 3, data: position },
        a_normal: { numComponents: 3, data: normal },
        a_color: { numComponents: 4, data: color },
        indices: { numComponents: 3, data: indices },
    };
}

// One clip-space triangle that covers the whole viewport, for the sky pass.
export function screenTriangleArrays(): twgl.Arrays {
    return {
        a_position: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    };
}
