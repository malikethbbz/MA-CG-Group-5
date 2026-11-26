/*
 * One draw call: which mesh, where (world matrix), and how it is lit.
 */

import { M4, type Mat4 } from '../../libs/3d-lib';
import type { Color } from '../../libs/color';
import type { RoadMarking } from './road_markings';

export type ShapeName = 'box' | 'wheel';

export interface DrawItem {
    readonly shape: ShapeName;
    readonly world: Mat4;
    // transpose(inverse(world)), to carry normals through non-uniform scales
    readonly normal: Mat4;
    readonly color: Color;
    // 0 is fully lit by the sun, 1 ignores lighting (neon, signal lamps)
    readonly emissive: number;
    // Set on buildings: lit window strips on the sides, varied by this seed
    readonly windowSeed?: number;
    // Set on road tiles: the lane paint drawn on top
    readonly marking?: RoadMarking;
    // Set on items placed on the roundabout's circle already, so the warp skips them
    readonly unwarped?: boolean;
}

export function normalMatrix(world: Mat4): Mat4 {
    return M4.transpose(M4.inverse(world));
}

export function drawItem(shape: ShapeName, world: Mat4, color: Color, emissive = 0): DrawItem {
    return { shape, world, normal: normalMatrix(world), color, emissive };
}
