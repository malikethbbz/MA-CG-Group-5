/*
 * Neon street lamps, visual only. A lamp stands on the strip between a building and
 * the road (the edge of an obstacle cell that faces a road), at a regular,
 * deterministic spacing, so it never stands on a lane or in a car's way.
 */

import type { Color } from '../../libs/color';
import type { CityData, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { cellBox } from './cell_box';
import { drawItem, type DrawItem } from './draw_item';
import { PALETTE, scaleColor } from './palette';

// One lamp per LAMP_SPACING diagonals of building cells
export const LAMP_SPACING = 2;
// How far the pole sits from its building cell's centre, toward the road (cells).
// The building is 0.86 wide, so 0.46 is just outside its wall and inside the cell.
export const POLE_OFFSET = 0.46;
const POLE_HEIGHT = 1.0;
const POLE_WIDTH = 0.03;
const HEAD_SIZE: readonly [number, number, number] = [0.15, 0.07, 0.15];
// The head leans out over the curb
const HEAD_REACH = 0.07;
const POOL_SIZE = 0.4;
const POOL_STRENGTH = 0.5;

export interface StreetLamp {
    readonly cell: GridCell;
    // Unit grid step from the lamp's building cell to the road it lights
    readonly side: readonly [number, number];
    readonly color: Color;
}

// Checked in this order, so a corner building always picks the same road.
const SIDES: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const key = (x: number, z: number): string => `${x},${z}`;

// Only plain road cells count: traffic-light cells are listed apart in /city and
// already have a pole of their own.
function lampSide(cell: GridCell, roads: ReadonlySet<string>): readonly [number, number] | null {
    return SIDES.find((side) => roads.has(key(cell.x + side[0], cell.z + side[1]))) ?? null;
}

export function streetLamps(city: CityData): StreetLamp[] {
    const roads = new Set(city.roads.map((road) => key(road.x, road.z)));
    const lamps: StreetLamp[] = [];
    for (const cell of city.obstacles) {
        if ((cell.x + cell.z) % LAMP_SPACING !== 0) {
            continue;
        }
        const side = lampSide(cell, roads);
        if (side) {
            const color = ((cell.x + cell.z) / LAMP_SPACING) % 2 === 0 ? PALETTE.lampPink : PALETTE.lampCyan;
            lamps.push({ cell, side, color });
        }
    }
    return lamps.sort((a, b) => a.cell.x - b.cell.x || a.cell.z - b.cell.z);
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
