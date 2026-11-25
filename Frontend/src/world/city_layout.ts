/*
 * Turns /city into static draw items, built once: ground, roads, buildings, street
 * lamps. Traffic-light lamps are kept apart because their color changes every /step.
 */

import type { Mat4 } from '../../libs/3d-lib';
import type { Color } from '../../libs/color';
import type { CityData, Direction, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { cellBox } from './cell_box';
import { drawItem, normalMatrix, type DrawItem } from './draw_item';
import { PALETTE, scaleColor } from './palette';
import { landmarkItems } from './landmarks';
import { BUILDING_WIDTH, sidewalkItem, sidewalks, type Sidewalk } from './sidewalks';
import { streetLampItems, streetLamps } from './street_lamps';

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
    // Sidewalk strips, where the pedestrians walk
    readonly walks: readonly Sidewalk[];
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
    const world = cellBox(centre, -(ROAD_THICKNESS + 0.02) * CELL_SIZE, [size, 0.02, size]);
    return drawItem('box', world, PALETTE.ground);
}

function roadTile(cell: GridCell): DrawItem {
    return drawItem('box', cellBox(cell, -ROAD_THICKNESS * CELL_SIZE, [0.98, ROAD_THICKNESS, 0.98]), PALETTE.road);
}

// A neon band just under the roof line on some buildings: from above it is only a
// thin rim, from the street it reads as a glowing crown.
function crown(cell: GridCell, height: number, noise: number): DrawItem[] {
    if (noise > CROWN_SHARE) {
        return [];
    }
    const color = noise < CROWN_SHARE / 2 ? PALETTE.crownPink : PALETTE.crownCyan;
    const base = (height - CROWN_DROP) * CELL_SIZE;
    return [drawItem('box', cellBox(cell, base, [BUILDING_WIDTH + 0.04, CROWN_HEIGHT, BUILDING_WIDTH + 0.04]), color, 1)];
}

function building(cell: GridCell): DrawItem[] {
    const height = buildingHeight(cell.x, cell.z);
    const noise = cellNoise(cell.z, cell.x);
    const color: Color = PALETTE.buildings[Math.floor(noise * PALETTE.buildings.length)];
    const walls = { ...drawItem('box', cellBox(cell, 0, [BUILDING_WIDTH, height, BUILDING_WIDTH]), color), windowSeed: noise * 997 };
    return [
        walls,
        drawItem('box', cellBox(cell, height * CELL_SIZE, [BUILDING_WIDTH - 0.06, 0.02, BUILDING_WIDTH - 0.06]), scaleColor(color, PALETTE.roofLift)),
        ...crown(cell, height, cellNoise(cell.x + 101, cell.z + 57)),
    ];
}

function destination(cell: GridCell): DrawItem[] {
    return [
        drawItem('box', cellBox(cell, 0, [0.8, 0.03, 0.8]), PALETTE.destination, 0.9),
        drawItem('box', cellBox(cell, 0, [0.08, 1.2, 0.08]), PALETTE.destination, 1),
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
        statics.push(drawItem('box', cellBox(light, 0, [0.05, POLE_HEIGHT, 0.05], shift), PALETTE.lightPole));
        const world = cellBox(light, POLE_HEIGHT * CELL_SIZE, [LAMP_SIZE, LAMP_SIZE * 1.6, LAMP_SIZE], shift);
        lamps.push({ id: light.id, world, normal: normalMatrix(world) });
    }
    // A landmark stands on its own island; no tower is generated on that cell
    const landmarkCells = new Set(city.landmarks.map((l) => `${l.x},${l.z}`));
    for (const obstacle of city.obstacles) {
        if (!landmarkCells.has(`${obstacle.x},${obstacle.z}`)) {
            statics.push(...building(obstacle));
        }
    }
    statics.push(...landmarkItems(city.landmarks));
    for (const target of city.destinations) {
        statics.push(...destination(target));
    }
    const walks = sidewalks(city);
    statics.push(...walks.map(sidewalkItem));
    for (const lamp of streetLamps(city)) {
        statics.push(...streetLampItems(lamp));
    }
    return {
        statics,
        lamps,
        walks,
        center: [((city.width - 1) / 2) * CELL_SIZE, 0, ((city.height - 1) / 2) * CELL_SIZE],
        extent: Math.max(city.width, city.height) * CELL_SIZE,
    };
}
