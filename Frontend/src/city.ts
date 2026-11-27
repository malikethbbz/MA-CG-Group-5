/*
 * Turns /city into the static pieces of the city, built once: the ground, the
 * textured street tiles, buildings on their sidewalks, street lamps, traffic light
 * poles, destinations, the hospital and its helipads, and the monument on its
 * plaza. The traffic light lamps are kept apart: their color changes every step.
 *
 * Every piece is a copy of one of two meshes (a box or a street tile) with its own
 * world matrix, built like the course examples: T * R * S.
 *
 * Team 5 - TC2008B
 * 2026-11
 */

import type * as twgl from 'twgl-base.js';
import { M4, V3, type Mat4 } from '../libs/3d-lib';
import type { Color } from '../libs/color';
import { ObjLoader } from '../libs/obj_loader';
import type { CityData, Direction, GridCell } from './api_connection';
import { COLORS } from './config';

export interface DrawItem {
    shape: 'box' | 'street';
    world: Mat4;
    // transpose(inverse(world)), to carry the normals through the scale
    normal: Mat4;
    color: Color;
    // 0 is lit by the light, 1 glows on its own (neon, lamps)
    emissive: number;
    // Street tiles only: the part of the texture shown across the lane
    band?: number[];
}

export interface CityLayout {
    statics: DrawItem[];
    // Traffic light lamps, by light id
    lamps: Map<string, DrawItem>;
    center: number[];
    size: number;
}

const ROAD_THICKNESS = 0.04;
const BUILDING_WIDTH = 0.78;
// The server parks an ambulance at this altitude on its pad (ROOF_ALTITUDE in
// Backend/traffic_base/ambulance.py), so a helipad building is exactly this tall
export const HELIPAD_ROOF = 1;
// An island bigger than this is a city block next to the monument, not a glorieta
const MAX_ISLAND_CELLS = 25;

// The street texture is a whole two-lane road: a yellow line on each edge and a
// dashed line in the middle. These are the parts of it a lane shows across, as
// [offset, scale] of the texture's v (v goes from the lane's left to its right).
export const BAND_DASHES_RIGHT = [0, 0.5];
export const BAND_DASHES_LEFT = [0.5, 0.5];
export const BAND_PLAIN = [0.15, 0.2];

const DIRECTIONS: Record<Direction, number[]> = { Right: [1, 0], Left: [-1, 0], Up: [0, 1], Down: [0, -1] };

const key = (x: number, z: number): string => `${x},${z}`;

export function drawItem(shape: DrawItem['shape'], world: Mat4, color: Color, emissive = 0): DrawItem {
    return { shape, world, normal: M4.transpose(M4.inverse(world)), color, emissive };
}

// A box standing on grid cell (x, z), with its base at height `base`, shifted by `shift`
export function cellBox(cell: GridCell, base: number, size: number[], shift = [0, 0]): Mat4 {
    const position = V3.create(cell.x + shift[0], base + 0.5 * size[1], cell.z + shift[1]);
    return M4.multiply(M4.translation(position), M4.scale(V3.create(size[0], size[1], size[2])));
}

// A box child of another transform (a vehicle, the monument): parent * T(offset) * S(size)
export function childBox(parent: Mat4, offset: number[], size: number[]): Mat4 {
    const local = M4.multiply(M4.translation(V3.create(offset[0], offset[1], offset[2])),
        M4.scale(V3.create(size[0], size[1], size[2])));
    return M4.multiply(parent, local);
}

// The street model (assets/models/street, Free3D "80-street") is a single long box.
// We keep its faces and normals, fit it into a unit cube centred on the origin, and
// lay the texture again so it runs once per cell: u along local +z, the way the lane
// drives, and v across it, along local +x.
export function streetArrays(objString: string): twgl.Arrays {
    const arrays = new ObjLoader().loadObj(objString);
    const position = arrays.a_position.data;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i++) {
        min[i % 3] = Math.min(min[i % 3], position[i]);
        max[i % 3] = Math.max(max[i % 3], position[i]);
    }

    const fitted: number[] = [];
    const texCoord: number[] = [];
    for (let i = 0; i < position.length; i += 3) {
        const x = (position[i] - min[0]) / (max[0] - min[0]) - 0.5;
        const y = (position[i + 1] - min[1]) / (max[1] - min[1]) - 0.5;
        const z = (position[i + 2] - min[2]) / (max[2] - min[2]) - 0.5;
        fitted.push(x, y, z);
        texCoord.push(z + 0.5, x + 0.5);
    }
    return {
        a_position: { numComponents: 3, data: fitted },
        a_normal: arrays.a_normal,
        a_texCoord: { numComponents: 2, data: texCoord },
    };
}

// Most streets are two one-way lanes side by side, so a lane shows the half of the
// texture with the dashes toward its partner lane and a yellow line on the outside.
// A lane on its own keeps its yellow line toward the traffic going the other way.
// Next to a crossing street the tile is plain asphalt, so no line crosses the junction.
export function textureBand(flow: Map<string, number[]>, cell: GridCell, ahead: number[]): number[] {
    const right = flow.get(key(cell.x + ahead[1], cell.z - ahead[0]));
    const left = flow.get(key(cell.x - ahead[1], cell.z + ahead[0]));
    const along = (d: number[] | undefined): number | undefined => d && d[0] * ahead[0] + d[1] * ahead[1];
    if (along(right) === 0 || along(left) === 0) {
        return BAND_PLAIN;
    }
    return along(left) === 1 || along(right) === -1 ? BAND_DASHES_LEFT : BAND_DASHES_RIGHT;
}

// A street tile turned to its direction of travel: T(cell) * Ry(yaw) * S(tile).
// Like the vehicles, rotationY(yaw) turns the model's +z onto `ahead`.
function streetTile(cell: GridCell, ahead: number[], band: number[]): DrawItem {
    const yaw = Math.atan2(ahead[0], ahead[1]);
    const world = M4.multiply(M4.translation(V3.create(cell.x, -0.5 * ROAD_THICKNESS, cell.z)),
        M4.multiply(M4.rotationY(yaw), M4.scale(V3.create(1, ROAD_THICKNESS, 1))));
    return { ...drawItem('street', world, COLORS.ground), band };
}

// Deterministic value in [0, 1) per cell, so the skyline is the same on every load
export function cellNoise(x: number, z: number): number {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Ambulances park on the hospital and on the helipads next to it, so those
// buildings are exactly as tall as the altitude the server parks them at
function building(cell: GridCell, kind: 'hospital' | 'helipad' | 'tower'): DrawItem[] {
    const height = kind === 'tower' ? 0.6 + 2.4 * cellNoise(cell.x, cell.z) : HELIPAD_ROOF;
    let color = COLORS.buildings[Math.floor(cellNoise(cell.z, cell.x) * COLORS.buildings.length)];
    let roof = COLORS.roof;
    if (kind === 'hospital') {
        color = COLORS.hospital;
        roof = COLORS.hospital;
    }
    const items = [
        drawItem('box', cellBox(cell, -0.01, [1, 0.02, 1]), COLORS.sidewalk),
        drawItem('box', cellBox(cell, 0, [BUILDING_WIDTH, height, BUILDING_WIDTH]), color),
        drawItem('box', cellBox(cell, height, [BUILDING_WIDTH - 0.06, 0.02, BUILDING_WIDTH - 0.06]), roof),
    ];
    if (kind === 'hospital') {
        // A red cross on the roof
        items.push(drawItem('box', cellBox(cell, height, [0.5, 0.04, 0.14]), COLORS.hospitalCross, 0.6));
        items.push(drawItem('box', cellBox(cell, height, [0.14, 0.04, 0.5]), COLORS.hospitalCross, 0.6));
    } else if (kind === 'helipad') {
        items.push(drawItem('box', cellBox(cell, height, [0.5, 0.03, 0.5]), COLORS.helipad, 1));
    }
    return items;
}

// "x,z" of the building cells joined to a monument: the glorieta's island, drawn as
// a plaza. The server drives the square ring around it like any other street.
export function plazaCells(city: CityData): Set<string> {
    const buildings = new Set(city.obstacles.map((cell) => key(cell.x, cell.z)));
    const plaza = new Set<string>();
    for (const monument of city.landmarks) {
        const island = [monument];
        const seen = new Set([key(monument.x, monument.z)]);
        // Flood fill, giving up once the island is too big to be one
        for (let i = 0; i < island.length && island.length <= MAX_ISLAND_CELLS; i++) {
            for (const [dx, dz] of Object.values(DIRECTIONS)) {
                const next = { x: island[i].x + dx, z: island[i].z + dz };
                if (buildings.has(key(next.x, next.z)) && !seen.has(key(next.x, next.z))) {
                    seen.add(key(next.x, next.z));
                    island.push(next);
                }
            }
        }
        if (island.length <= MAX_ISLAND_CELLS) {
            seen.forEach((id) => plaza.add(id));
        }
    }
    return plaza;
}

// An Angel of Independence style column: stepped base, column, golden winged figure
function monument(cell: GridCell): DrawItem[] {
    const world = M4.translation(V3.create(cell.x, 0, cell.z));
    const items: DrawItem[] = [];
    let base = 0;
    for (const [width, height] of [[0.9, 0.08], [0.7, 0.08], [0.5, 0.1], [0.3, 0.3], [0.12, 3.2]]) {
        items.push(drawItem('box', childBox(world, [0, base + height / 2, 0], [width, height, width]), COLORS.monumentStone));
        base += height;
    }
    const gold = (part: Mat4): DrawItem => drawItem('box', part, COLORS.monumentGold, 0.8);
    items.push(gold(childBox(world, [0, base + 0.05, 0], [0.24, 0.1, 0.24])));
    items.push(gold(childBox(world, [0, base + 0.25, 0], [0.09, 0.3, 0.08])));
    for (const side of [1, -1]) {
        const wing = M4.multiply(M4.translation(V3.create(side * 0.14, base + 0.3, 0)), M4.rotationZ(side * 0.55));
        items.push(gold(childBox(M4.multiply(world, wing), [0, 0, 0], [0.3, 0.05, 0.03])));
    }
    return items;
}

export function buildCity(city: CityData): CityLayout {
    const center = [(city.width - 1) / 2, 0, (city.height - 1) / 2];
    const size = Math.max(city.width, city.height);
    const statics = [drawItem('box', cellBox({ x: center[0], z: center[2] }, -0.08, [3 * size, 0.02, 3 * size]), COLORS.ground)];
    const lamps = new Map<string, DrawItem>();

    // Streets and traffic lights
    const flow = new Map<string, number[]>();
    for (const road of [...city.roads, ...city.lights]) {
        flow.set(key(road.x, road.z), DIRECTIONS[road.direction]);
    }
    for (const road of [...city.roads, ...city.lights]) {
        const ahead = DIRECTIONS[road.direction];
        statics.push(streetTile(road, ahead, textureBand(flow, road, ahead)));
    }
    for (const light of city.lights) {
        // The pole stands on the right of its lane
        const [dx, dz] = DIRECTIONS[light.direction];
        const shift = [dz * 0.42, -dx * 0.42];
        statics.push(drawItem('box', cellBox(light, 0, [0.05, 0.7, 0.05], shift), COLORS.lightPole));
        lamps.set(light.id, drawItem('box', cellBox(light, 0.7, [0.16, 0.25, 0.16], shift), COLORS.lightPole, 1));
    }

    // Buildings, with a street lamp on the sidewalk of those that face a road
    const plaza = plazaCells(city);
    for (const id of plaza) {
        const [x, z] = id.split(',').map(Number);
        statics.push(drawItem('box', cellBox({ x, z }, 0, [1, 0.03, 1]), COLORS.plaza));
    }
    const pads = new Set(city.helipads.map((pad) => key(pad.x, pad.z)));
    for (const cell of city.obstacles) {
        if (plaza.has(key(cell.x, cell.z))) {
            continue;
        }
        let kind: 'hospital' | 'helipad' | 'tower' = pads.has(key(cell.x, cell.z)) ? 'helipad' : 'tower';
        if (city.hospital && city.hospital.x === cell.x && city.hospital.z === cell.z) {
            kind = 'hospital';
        }
        statics.push(...building(cell, kind));
        const side = Object.values(DIRECTIONS).find(([dx, dz]) => flow.has(key(cell.x + dx, cell.z + dz)));
        if (side && !city.lights.some((l) => l.x === cell.x + side[0] && l.z === cell.z + side[1])) {
            const lampColor = (cell.x + cell.z) % 2 === 0 ? COLORS.lampPink : COLORS.lampCyan;
            const at = [side[0] * 0.46, side[1] * 0.46];
            statics.push(drawItem('box', cellBox(cell, 0, [0.03, 1, 0.03], at), COLORS.lightPole));
            statics.push(drawItem('box', cellBox(cell, 1, [0.12, 0.06, 0.12], at), lampColor, 1));
        }
    }
    for (const landmark of city.landmarks) {
        statics.push(...monument(landmark));
    }
    for (const target of city.destinations) {
        statics.push(drawItem('box', cellBox(target, 0, [0.8, 0.03, 0.8]), COLORS.destination, 0.9));
        statics.push(drawItem('box', cellBox(target, 0, [0.08, 1.2, 0.08]), COLORS.destination, 1));
    }
    return { statics, lamps, center, size };
}
