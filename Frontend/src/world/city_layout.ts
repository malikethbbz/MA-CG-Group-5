/*
 * Turns /city into static draw items, built once. Traffic-light lamps are kept apart
 * because their color changes with every /step.
 */

import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import type { Color } from '../../libs/color';
import type { CityData, Direction, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { drawItem, normalMatrix, type DrawItem } from './draw_item';
import { PALETTE, scaleColor } from './palette';

const ROAD_THICKNESS = 0.04;
const GROUND_SPREAD = 8;
const MIN_BUILDING_HEIGHT = 0.6;
const BUILDING_HEIGHT_RANGE = 2.4;
const POLE_HEIGHT = 0.7;
const LAMP_SIZE = 0.16;
// How far a light pole sits from the centre of its lane, in cells.
const POLE_SIDE_OFFSET = 0.42;
// Share of buildings with a neon crown, and its size below the roof line
const CROWN_SHARE = 0.3;
const CROWN_DROP = 0.1;
const CROWN_HEIGHT = 0.05;

export interface LightLamp {
    readonly id: string;
    readonly world: Mat4;
    readonly normal: Mat4;
}

export interface CityLayout {
    readonly statics: readonly DrawItem[];
    readonly lamps: readonly LightLamp[];
    // World-space centre of the map, for framing the camera
    readonly center: readonly [number, number, number];
    readonly extent: number;
}

const DIRECTION_VECTORS: Readonly<Record<Direction, readonly [number, number]>> = {
    Right: [1, 0],
    Left: [-1, 0],
    Up: [0, 1],
    Down: [0, -1],
};

// A box centred on cell (x, z) with its base at height `base` (world units).
function box(cell: GridCell, base: number, size: readonly [number, number, number],
    shift: readonly [number, number] = [0, 0]): Mat4 {
    const centre = V3.create(
        (cell.x + shift[0]) * CELL_SIZE,
        base + 0.5 * size[1] * CELL_SIZE,
        (cell.z + shift[1]) * CELL_SIZE,
    );
    const scale = V3.create(size[0] * CELL_SIZE, size[1] * CELL_SIZE, size[2] * CELL_SIZE);
    return M4.multiply(M4.translation(centre), M4.scale(scale));
}

// Deterministic value in [0, 1) per cell, so the skyline is the same on every load.
export function cellNoise(x: number, z: number): number {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildingHeight(x: number, z: number): number {
    return MIN_BUILDING_HEIGHT + BUILDING_HEIGHT_RANGE * cellNoise(x, z);
}

// The ground runs far past the map so the fog carries it into the horizon haze.
function ground(city: CityData): DrawItem {
    const centre: GridCell = { x: (city.width - 1) / 2, z: (city.height - 1) / 2 };
    const size = Math.max(city.width, city.height) * GROUND_SPREAD;
    const world = box(centre, -(ROAD_THICKNESS + 0.02) * CELL_SIZE, [size, 0.02, size]);
    return drawItem('box', world, PALETTE.ground);
}

function roadTile(cell: GridCell): DrawItem {
    return drawItem('box', box(cell, -ROAD_THICKNESS * CELL_SIZE, [0.98, ROAD_THICKNESS, 0.98]), PALETTE.road);
}

// A neon band just under the roof line on some buildings: from above it is only a
// thin rim, from the street it reads as a glowing crown.
function crown(cell: GridCell, height: number, noise: number): DrawItem[] {
    if (noise > CROWN_SHARE) {
        return [];
    }
    const color = noise < CROWN_SHARE / 2 ? PALETTE.crownPink : PALETTE.crownCyan;
    const base = (height - CROWN_DROP) * CELL_SIZE;
    return [drawItem('box', box(cell, base, [0.9, CROWN_HEIGHT, 0.9]), color, 1)];
}

function building(cell: GridCell): DrawItem[] {
    const height = buildingHeight(cell.x, cell.z);
    const noise = cellNoise(cell.z, cell.x);
    const color: Color = PALETTE.buildings[Math.floor(noise * PALETTE.buildings.length)];
    const walls = { ...drawItem('box', box(cell, 0, [0.86, height, 0.86]), color), windowSeed: noise * 997 };
    return [
        walls,
        drawItem('box', box(cell, height * CELL_SIZE, [0.8, 0.02, 0.8]), scaleColor(color, PALETTE.roofLift)),
        ...crown(cell, height, cellNoise(cell.x + 101, cell.z + 57)),
    ];
}

function destination(cell: GridCell): DrawItem[] {
    return [
        drawItem('box', box(cell, 0, [0.8, 0.03, 0.8]), PALETTE.destination, 0.9),
        drawItem('box', box(cell, 0, [0.08, 1.2, 0.08]), PALETTE.destination, 1),
    ];
}

function poleShift(direction: Direction): [number, number] {
    const [dx, dz] = DIRECTION_VECTORS[direction];
    return [dz * POLE_SIDE_OFFSET, -dx * POLE_SIDE_OFFSET];
}

export function buildCityLayout(city: CityData): CityLayout {
    const statics: DrawItem[] = [ground(city)];
    const lamps: LightLamp[] = [];
    for (const road of city.roads) {
        statics.push(roadTile(road));
    }
    for (const light of city.lights) {
        const shift = poleShift(light.direction);
        statics.push(roadTile(light));
        statics.push(drawItem('box', box(light, 0, [0.05, POLE_HEIGHT, 0.05], shift), PALETTE.lightPole));
        const world = box(light, POLE_HEIGHT * CELL_SIZE, [LAMP_SIZE, LAMP_SIZE * 1.6, LAMP_SIZE], shift);
        lamps.push({ id: light.id, world, normal: normalMatrix(world) });
    }
    for (const obstacle of city.obstacles) {
        statics.push(...building(obstacle));
    }
    for (const target of city.destinations) {
        statics.push(...destination(target));
    }
    return {
        statics,
        lamps,
        center: [((city.width - 1) / 2) * CELL_SIZE, 0, ((city.height - 1) / 2) * CELL_SIZE],
        extent: Math.max(city.width, city.height) * CELL_SIZE,
    };
}
