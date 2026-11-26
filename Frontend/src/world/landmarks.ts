/*
 * Landmarks from /city, drawn as transform hierarchies like the vehicles.
 * The monument is an Angel of Independence style column on a roundabout island:
 *
 *   monumentWorld = T(cell centre)
 *   stepWorld     = monumentWorld · T(step) · S(step)       (stepped base, pedestal,
 *   columnWorld   = monumentWorld · T(column) · S(column)    column, capital)
 *   figureWorld   = monumentWorld · T(top of capital)
 *   wingWorld     = figureWorld · T(shoulder) · Rz(±spread) · S(wing)
 */

import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import type { Landmark } from '../api/contract';
import { CELL_SIZE } from '../config';
import { drawItem, type DrawItem } from './draw_item';
import { PALETTE } from './palette';
import { childBox, type Triple } from './vehicle_model';

// Stacked from the ground up: [width, height] of each square block, in cells
const PLINTH: readonly (readonly [number, number])[] = [
    [0.92, 0.08], [0.72, 0.08], [0.52, 0.1], [0.3, 0.32],
];
const COLUMN: readonly [number, number] = [0.12, 3.2];
const CAPITAL: readonly [number, number] = [0.24, 0.1];
const WING_SPREAD = 0.55;
const STONE_GLOW = 0.15;
const GOLD_GLOW = 0.85;

function stack(world: Mat4, blocks: readonly (readonly [number, number])[], start: number): [Mat4[], number] {
    let base = start;
    const boxes = blocks.map(([width, height]) => {
        const box = childBox(world, [0, base + 0.5 * height, 0], [width, height, width]);
        base += height;
        return box;
    });
    return [boxes, base];
}

function figure(world: Mat4): Mat4[] {
    const k = CELL_SIZE;
    const wing: Triple = [0.3 * k, 0.05 * k, 0.03 * k];
    const shoulder = 0.18 * k;
    const wingBox = (side: 1 | -1) => M4.multiply(world, M4.multiply(
        M4.translation(V3.create(side * 0.14 * k, shoulder, -0.02 * k)),
        M4.multiply(M4.rotationZ(side * WING_SPREAD), M4.scale(V3.create(wing[0], wing[1], wing[2])))));
    return [
        childBox(world, [0, 0.12 * k, 0], [0.09 * k, 0.24 * k, 0.07 * k]),
        childBox(world, [0, 0.28 * k, 0], [0.06 * k, 0.07 * k, 0.06 * k]),
        // Raised arm holding the laurel crown
        childBox(world, [0.05 * k, 0.33 * k, 0], [0.025 * k, 0.16 * k, 0.025 * k]),
        wingBox(1),
        wingBox(-1),
    ];
}

export function monumentItems(landmark: Landmark): DrawItem[] {
    const world = M4.translation(V3.create(landmark.x * CELL_SIZE, 0, landmark.z * CELL_SIZE));
    const scaled = (blocks: readonly (readonly [number, number])[]) =>
        blocks.map(([w, h]) => [w * CELL_SIZE, h * CELL_SIZE] as const);
    const [plinth, plinthTop] = stack(world, scaled(PLINTH), 0);
    const [shaft, shaftTop] = stack(world, scaled([COLUMN, CAPITAL]), plinthTop);
    const figureWorld = M4.multiply(world, M4.translation(V3.create(0, shaftTop, 0)));
    return [
        ...[...plinth, shaft[0]].map((m) => drawItem('box', m, PALETTE.monumentStone, STONE_GLOW)),
        drawItem('box', shaft[1], PALETTE.monumentGold, GOLD_GLOW),
        ...figure(figureWorld).map((m) => drawItem('box', m, PALETTE.monumentGold, GOLD_GLOW)),
    ];
}

// Every landmark kind the parser accepts has a builder here.
const BUILDERS: Readonly<Record<Landmark['kind'], (landmark: Landmark) => DrawItem[]>> = {
    monument: monumentItems,
};

export function landmarkItems(landmarks: readonly Landmark[]): DrawItem[] {
    return landmarks.flatMap((landmark) => BUILDERS[landmark.kind](landmark));
}
