/*
 * Draw items for the pedestrians, built once and moved in place every frame: each
 * walker is a body box and a head box on the shared box mesh. Their matrices are
 * plain T·S, so a frame only rewrites the translation column (no allocation), and the
 * normal matrix, which ignores translation, is computed once.
 */

import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import { CELL_SIZE } from '../config';
import { normalMatrix, type DrawItem } from './draw_item';
import { placeWalker, type Walker, type WalkerPlace } from './pedestrians';

const BODY: readonly [number, number, number] = [0.05, 0.1, 0.05];
const HEAD = 0.045;
const BODY_EMISSIVE = 0.75;
const HEAD_EMISSIVE = 1;

function scaled(size: readonly [number, number, number]): Mat4 {
    return M4.scale(V3.create(size[0] * CELL_SIZE, size[1] * CELL_SIZE, size[2] * CELL_SIZE));
}

function part(world: Mat4, color: DrawItem['color'], emissive: number): DrawItem {
    return { shape: 'box', world, normal: normalMatrix(world), color, emissive };
}

export class PedestrianCrowd {
    // Two items per walker: body, then head
    readonly items: readonly DrawItem[];
    private readonly walkers: readonly Walker[];
    private readonly place: WalkerPlace = { x: 0, z: 0, bob: 0 };

    constructor(walkers: readonly Walker[]) {
        this.walkers = walkers;
        this.items = walkers.flatMap((walker) => [
            part(scaled(BODY), walker.color, BODY_EMISSIVE),
            part(scaled([HEAD, HEAD, HEAD]), walker.color, HEAD_EMISSIVE),
        ]);
    }

    update(timeMs: number): void {
        for (let i = 0; i < this.walkers.length; i++) {
            const { x, z, bob } = placeWalker(this.walkers[i], timeMs, this.place);
            const bodyY = (bob + 0.5 * BODY[1]) * CELL_SIZE;
            const headY = (bob + BODY[1] + 0.5 * HEAD + 0.005) * CELL_SIZE;
            setTranslation(this.items[2 * i].world, x * CELL_SIZE, bodyY, z * CELL_SIZE);
            setTranslation(this.items[2 * i + 1].world, x * CELL_SIZE, headY, z * CELL_SIZE);
        }
    }
}

// Column-major M4: the translation is elements 12, 13, 14.
function setTranslation(m: Mat4, x: number, y: number, z: number): void {
    m[12] = x;
    m[13] = y;
    m[14] = z;
}
