/*
 * The strip between a building wall and the road. Buildings are narrower than their
 * cell, so every building cell that touches a road has a sidewalk on that side,
 * inside its own cell: street lamps and pedestrians live there, never on a lane.
 */

import type { CityData, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { cellBox } from './cell_box';
import { drawItem, type DrawItem } from './draw_item';
import { findGlorieta } from './glorieta';
import { PALETTE } from './palette';

// Building footprint, in cells; the rest of the cell is sidewalk
export const BUILDING_WIDTH = 0.78;
export const WALL_OFFSET = 0.5 * BUILDING_WIDTH;
const SIDEWALK_HEIGHT = 0.02;

export type Side = readonly [number, number];

export interface Sidewalk {
    // The building cell the strip belongs to
    readonly cell: GridCell;
    // Unit grid step from that cell to the road the strip runs along
    readonly side: Side;
}

// Checked in this order, so the list comes out the same on every load.
const SIDES: readonly Side[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const key = (x: number, z: number): string => `${x},${z}`;

// Only plain road cells count: traffic-light cells are listed apart in /city and keep
// their own pole. Landmarks and the roundabout's plaza get no sidewalk furniture.
export function sidewalks(city: CityData): Sidewalk[] {
    const roads = new Set(city.roads.map((road) => key(road.x, road.z)));
    const skipped = new Set([
        ...city.landmarks.map((landmark) => key(landmark.x, landmark.z)),
        ...(findGlorieta(city)?.plaza ?? []),
    ]);
    const cells = [...city.obstacles]
        .filter((cell) => !skipped.has(key(cell.x, cell.z)))
        .sort((a, b) => a.x - b.x || a.z - b.z);
    return cells.flatMap((cell) => SIDES
        .filter((side) => roads.has(key(cell.x + side[0], cell.z + side[1])))
        .map((side) => ({ cell, side })));
}

// Unit vector along the strip (perpendicular to its side)
export function alongStrip(side: Side): Side {
    return [Math.abs(side[1]), Math.abs(side[0])];
}

export function sidewalkItem(walk: Sidewalk): DrawItem {
    const across = 0.5 - WALL_OFFSET;
    const [ax, az] = alongStrip(walk.side);
    const size: [number, number, number] = [ax + across * az, SIDEWALK_HEIGHT, az + across * ax];
    const centre = WALL_OFFSET + 0.5 * across;
    const world = cellBox(walk.cell, -0.01 * CELL_SIZE, size, [walk.side[0] * centre, walk.side[1] * centre]);
    return drawItem('box', world, PALETTE.sidewalk, 0.15);
}
