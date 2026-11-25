/*
 * The Reforma roundabout drawn round. The server drives a square ring of grid cells
 * around the monument's island; the vertex shader bends that square onto a circle, so
 * roads, cars and buildings near it all curve the same way and stay joined.
 *
 * warpPoint() is the reference for the GLSL warp in vs_flat.glsl, which mirrors it
 * line for line. Every distance here is in cells.
 *
 * A point's inset d is how far inside the ring's outer edge it lies (negative
 * outside). Each inset is a rectangle; a point on it is placed at the same share of
 * the way round a circle of radius R - d, so the lanes become concentric circles.
 * The island inside the lanes shrinks onto a disk, and outside the ring the bend fades
 * out over BLEND_CELLS.
 */

import type { CityData, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';

// The server's glorieta is two lanes wide all round
export const RING_LANES = 2;
// Past this many cells outside the ring the city is drawn on its grid again
export const BLEND_CELLS = 4;
// An island bigger than this is a city block next to a landmark, not a roundabout
const MAX_ISLAND_CELLS = 25;

export interface Glorieta {
    readonly centre: readonly [number, number];
    // Half extents of the island and of the ring's outer edge
    readonly island: readonly [number, number];
    readonly outer: readonly [number, number];
    // Radius the ring's outer edge is drawn at
    readonly radius: number;
    // "x,z" of every island cell, drawn as a plaza instead of buildings
    readonly plaza: ReadonlySet<string>;
}

const key = (x: number, z: number): string => `${x},${z}`;

// Obstacle cells 4-connected to the monument: the roundabout's island.
function floodIsland(start: GridCell, obstacles: ReadonlySet<string>): GridCell[] {
    const seen = new Set([key(start.x, start.z)]);
    const island: GridCell[] = [start];
    for (let i = 0; i < island.length && island.length <= MAX_ISLAND_CELLS; i++) {
        const { x, z } = island[i];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const id = key(x + dx, z + dz);
            if (obstacles.has(id) && !seen.has(id)) {
                seen.add(id);
                island.push({ x: x + dx, z: z + dz });
            }
        }
    }
    return island;
}

// The radius that keeps the middle of the ring as long as the square it replaces,
// so cars on the circle keep their length.
function ringRadius(outer: readonly [number, number]): number {
    const middle = RING_LANES / 2;
    return middle + (2 * (outer[0] + outer[1] - 2 * middle)) / Math.PI;
}

export function findGlorieta(city: CityData): Glorieta | null {
    const monument = city.landmarks.find((landmark) => landmark.kind === 'monument');
    if (monument === undefined) {
        return null;
    }
    const obstacles = new Set(city.obstacles.map((cell) => key(cell.x, cell.z)));
    obstacles.add(key(monument.x, monument.z));
    const island = floodIsland(monument, obstacles);
    if (island.length > MAX_ISLAND_CELLS) {
        return null;
    }
    const xs = island.map((cell) => cell.x);
    const zs = island.map((cell) => cell.z);
    const [west, east, south, north] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const half: [number, number] = [(east - west + 1) / 2, (north - south + 1) / 2];
    const outer: [number, number] = [half[0] + RING_LANES, half[1] + RING_LANES];
    return {
        centre: [(west + east) / 2, (south + north) / 2],
        island: half,
        outer,
        radius: ringRadius(outer),
        plaza: new Set(island.map((cell) => key(cell.x, cell.z))),
    };
}

// Share of the way round a rectangle of half extents (a, b), counter-clockwise from
// the +x midpoint, for a point (x, z) on its edge. Midpoints land on the axes.
export function aroundRectangle(x: number, z: number, a: number, b: number): number {
    const perimeter = 4 * (a + b);
    let t: number;
    if (a - Math.abs(x) <= b - Math.abs(z)) {
        t = x > 0 ? z : b + 2 * a + (b - z);
    } else {
        t = z > 0 ? b + (a - x) : 3 * b + 2 * a + (x + a);
    }
    return (((t / perimeter) % 1) + 1) % 1;
}

function onCircle(share: number, radius: number): [number, number] {
    const angle = 2 * Math.PI * share;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

// Where grid point (x, z) is drawn.
export function warpPoint(g: Glorieta, x: number, z: number): [number, number] {
    const px = x - g.centre[0];
    const pz = z - g.centre[1];
    const [a, b] = g.outer;
    const inset = Math.min(a - Math.abs(px), b - Math.abs(pz));
    let bent: [number, number];
    if (inset >= RING_LANES) {
        // The island: scale out to its edge, then shrink onto the inner disk
        const [ia, ib] = g.island;
        const s = Math.max(Math.abs(px) / ia, Math.abs(pz) / ib);
        bent = s === 0 ? [0, 0] : onCircle(aroundRectangle(px / s, pz / s, ia, ib), s * (g.radius - RING_LANES));
    } else {
        bent = onCircle(aroundRectangle(px, pz, a - inset, b - inset), g.radius - inset);
    }
    const w = 1 - smoothstep(0, BLEND_CELLS, -inset);
    return [x + (bent[0] + g.centre[0] - x) * w, z + (bent[1] + g.centre[1] - z) * w];
}

// Uniforms for the warp in vs_flat.glsl, in world units. Without a glorieta the
// warp is off and the city is drawn on its grid.
export function glorietaUniforms(g: Glorieta | null): Record<string, unknown> {
    if (g === null) {
        return { u_ringOn: 0 };
    }
    const k = CELL_SIZE;
    return {
        u_ringOn: 1,
        u_ringCentre: [g.centre[0] * k, g.centre[1] * k],
        u_ringIsland: [g.island[0] * k, g.island[1] * k],
        u_ringOuter: [g.outer[0] * k, g.outer[1] * k],
        u_ringRadius: g.radius * k,
        u_ringLanes: RING_LANES * k,
        u_ringBlend: BLEND_CELLS * k,
    };
}
