/*
 * Decorative pedestrians, client-side only: small glowing people pacing back and forth
 * along the sidewalks. Seeded and bounded, so the crowd is the same on every load and
 * never larger than PEDESTRIAN_COUNT. A walker stays inside its own building cell's
 * sidewalk, so it never steps onto a road cell.
 */

import type { Color } from '../../libs/color';
import { hex } from './palette';
import { seededRandom } from './sky';
import { alongStrip, WALL_OFFSET, type Sidewalk } from './sidewalks';

export const PEDESTRIAN_COUNT = 150;
const PEDESTRIAN_SEED = 77;
// Distance from the building cell's centre to the walking line, in cells: just
// outside the wall, inside the street lamps
const WALK_OFFSET = WALL_OFFSET + 0.04;
// Half the length of the stretch a walker paces, in cells
export const WALK_HALF_SPAN = 0.42;
export const BOB_HEIGHT = 0.012;
const MIN_SPEED = 0.15;
const SPEED_RANGE = 0.2;
// Steps per cell walked, for the bob
const STEPS_PER_CELL = 7;

const COLORS: readonly Color[] = [hex('#ff6bd6'), hex('#6bf6ff'), hex('#fff27a'), hex('#b28bff'), hex('#7dff9b')];

export interface Walker {
    readonly walk: Sidewalk;
    // Where on its back-and-forth cycle the walker starts, in [0, 1)
    readonly phase: number;
    // Cells per second
    readonly speed: number;
    readonly color: Color;
}

export function spawnWalkers(walks: readonly Sidewalk[], seed = PEDESTRIAN_SEED,
    count = PEDESTRIAN_COUNT): Walker[] {
    if (walks.length === 0) {
        return [];
    }
    const random = seededRandom(seed);
    return Array.from({ length: count }, () => ({
        walk: walks[Math.floor(random() * walks.length)],
        phase: random(),
        speed: MIN_SPEED + SPEED_RANGE * random(),
        color: COLORS[Math.floor(random() * COLORS.length)],
    }));
}

export interface WalkerPlace {
    // Grid position (cells) and how high the step lifts the walker (cells)
    x: number;
    z: number;
    bob: number;
}

// Writes into `out` so the per-frame update allocates nothing.
export function placeWalker(walker: Walker, timeMs: number, out: WalkerPlace): WalkerPlace {
    const { cell, side } = walker.walk;
    const [ax, az] = alongStrip(side);
    const lap = 4 * WALK_HALF_SPAN;
    const cycle = walker.phase + (walker.speed * timeMs) / 1000 / lap;
    const pingPong = 1 - Math.abs(2 * (cycle - Math.floor(cycle)) - 1);
    const along = -WALK_HALF_SPAN + 2 * WALK_HALF_SPAN * pingPong;
    out.x = cell.x + side[0] * WALK_OFFSET + ax * along;
    out.z = cell.z + side[1] * WALK_OFFSET + az * along;
    const walked = cycle * lap;
    out.bob = BOB_HEIGHT * Math.abs(Math.sin(Math.PI * STEPS_PER_CELL * walked));
    return out;
}
