/*
 * Paint on the road, so every street shows which way it runs: arrows along straight
 * stretches, dashed lines between lanes going the same way, a solid divider between
 * opposite ways, an edge line along the curb and a stop line at each traffic light.
 *
 * The fragment shader paints a tile from its RoadMarking, in the tile's own frame:
 * `ahead` is the direction of travel and edge 0 is the side at +perp, where
 * perp = (ahead.z, -ahead.x). Edge 1 is the side at -perp.
 */

import type { CityData, Direction } from '../api/contract';

export const EDGE_NONE = 0;
export const EDGE_DASHED = 1;
export const EDGE_DIVIDER = 2;
export const EDGE_CURB = 3;
export type EdgeLine = typeof EDGE_NONE | typeof EDGE_DASHED | typeof EDGE_DIVIDER | typeof EDGE_CURB;

// An arrow on every ARROW_SPACING-th cell of a straight stretch
export const ARROW_SPACING = 3;

export interface RoadMarking {
    readonly ahead: readonly [number, number];
    readonly edges: readonly [EdgeLine, EdgeLine];
    readonly arrow: boolean;
    readonly stopLine: boolean;
    // Distance along the travel axis, so dashes line up from tile to tile
    readonly phase: number;
}

const VECTORS: Readonly<Record<Direction, readonly [number, number]>> = {
    Right: [1, 0],
    Left: [-1, 0],
    Up: [0, 1],
    Down: [0, -1],
};

const key = (x: number, z: number): string => `${x},${z}`;

type Flow = ReadonlyMap<string, readonly [number, number]>;

function edgeLine(flow: Flow, x: number, z: number, ahead: readonly [number, number]): EdgeLine {
    const other = flow.get(key(x, z));
    if (other === undefined) {
        return EDGE_CURB;
    }
    const along = other[0] * ahead[0] + other[1] * ahead[1];
    if (along === 1) {
        return EDGE_DASHED;
    }
    // A crossing street: its lanes run straight through, so no line across them
    return along === -1 ? EDGE_DIVIDER : EDGE_NONE;
}

// Arrows only where the lane runs straight with no street crossing it.
function isStraight(flow: Flow, x: number, z: number, ahead: readonly [number, number],
    edges: readonly [EdgeLine, EdgeLine]): boolean {
    const same = (dx: number, dz: number) => {
        const next = flow.get(key(x + dx, z + dz));
        return next !== undefined && next[0] === ahead[0] && next[1] === ahead[1];
    };
    return same(ahead[0], ahead[1]) && same(-ahead[0], -ahead[1]) && !edges.includes(EDGE_NONE);
}

// One marking per road and light cell, keyed "x,z".
export function roadMarkings(city: CityData): Map<string, RoadMarking> {
    const cells = [
        ...city.roads.map((road) => ({ ...road, light: false })),
        ...city.lights.map((light) => ({ ...light, light: true })),
    ];
    const flow: Flow = new Map(cells.map((cell) => [key(cell.x, cell.z), VECTORS[cell.direction]]));
    const markings = new Map<string, RoadMarking>();
    for (const cell of cells) {
        const ahead = VECTORS[cell.direction];
        const perp = [ahead[1], -ahead[0]] as const;
        const edges: [EdgeLine, EdgeLine] = [
            edgeLine(flow, cell.x + perp[0], cell.z + perp[1], ahead),
            edgeLine(flow, cell.x - perp[0], cell.z - perp[1], ahead),
        ];
        const phase = cell.x * ahead[0] + cell.z * ahead[1];
        markings.set(key(cell.x, cell.z), {
            ahead,
            edges,
            arrow: !cell.light && isStraight(flow, cell.x, cell.z, ahead, edges)
                && ((phase % ARROW_SPACING) + ARROW_SPACING) % ARROW_SPACING === 0,
            stopLine: cell.light,
            phase,
        });
    }
    return markings;
}

// Uniforms fs_flat.glsl paints the tile with; a tile without a marking stays bare.
export function markingUniforms(marking: RoadMarking | undefined): Record<string, unknown> {
    if (marking === undefined) {
        return { u_marking: 0 };
    }
    return {
        u_marking: 1,
        u_markAhead: marking.ahead,
        u_markEdges: marking.edges,
        u_markArrow: marking.arrow ? 1 : 0,
        u_markStop: marking.stopLine ? 1 : 0,
        u_markPhase: marking.phase,
    };
}
