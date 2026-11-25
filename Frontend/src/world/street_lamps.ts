/*
 * Neon street lamps, visual only. A lamp stands on a sidewalk (sidewalks.ts) at a
 * regular, deterministic spacing, so it never stands on a lane or in a car's way.
 */

import type { Color } from '../../libs/color';
import type { CityData, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { cellBox } from './cell_box';
import { drawItem, type DrawItem } from './draw_item';
import { PALETTE, scaleColor } from './palette';
import { sidewalks, type Side } from './sidewalks';

// One lamp per LAMP_SPACING diagonals of building cells: 1 lights every building
// that faces a road, so the streets read as lit at night
export const LAMP_SPACING = 1;
// How far the pole sits from its building cell's centre, toward the road (cells):
// on the outer half of the sidewalk, past where pedestrians walk.
const POLE_OFFSET = 0.47;
const POLE_HEIGHT = 1.0;
const POLE_WIDTH = 0.03;
const HEAD_SIZE: readonly [number, number, number] = [0.15, 0.07, 0.15];
// The head leans out over the curb
const HEAD_REACH = 0.07;
const POOL_SIZE = 0.4;
const POOL_STRENGTH = 0.4;

export interface StreetLamp {
    readonly cell: GridCell;
    // Unit grid step from the lamp's building cell to the road it lights
    readonly side: Side;
    readonly color: Color;
}

// One lamp per building cell on the spacing, on its first sidewalk.
export function streetLamps(city: CityData): StreetLamp[] {
    const lit = new Set<string>();
    const lamps: StreetLamp[] = [];
    for (const { cell, side } of sidewalks(city)) {
        const id = `${cell.x},${cell.z}`;
        if ((cell.x + cell.z) % LAMP_SPACING !== 0 || lit.has(id)) {
            continue;
        }
        lit.add(id);
        const color = (cell.x + cell.z) % 2 === 0 ? PALETTE.lampPink : PALETTE.lampCyan;
        lamps.push({ cell, side, color });
    }
    return lamps;
}

// Pole, glowing head, and a faint pool of its light on the road beside it.
export function streetLampItems(lamp: StreetLamp): DrawItem[] {
    const [sx, sz] = lamp.side;
    const at = (reach: number): [number, number] => [sx * reach, sz * reach];
    const top = POLE_HEIGHT * CELL_SIZE;
    return [
        drawItem('box', cellBox(lamp.cell, 0, [POLE_WIDTH, POLE_HEIGHT, POLE_WIDTH], at(POLE_OFFSET)),
            PALETTE.lightPole),
        drawItem('box', cellBox(lamp.cell, top, HEAD_SIZE, at(POLE_OFFSET + HEAD_REACH)), lamp.color, 1),
        drawItem('box', cellBox(lamp.cell, 0.001 * CELL_SIZE, [POOL_SIZE, 0.004, POOL_SIZE], at(0.5 + 0.5 * POOL_SIZE)),
            scaleColor(lamp.color, POOL_STRENGTH), 1),
    ];
}
