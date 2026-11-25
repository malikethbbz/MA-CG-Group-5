/*
 * A vehicle as a parent/child transform hierarchy built from our own M4 matrices:
 *
 *   vehicleWorld = T(position) · Ry(yaw)
 *   partWorld    = vehicleWorld · T(partOffset) · S(partSize)
 *   wheelWorld   = vehicleWorld · T(wheelOffset) · Rx(spin) · S(wheelSize)
 *
 * Every kind (car, motorcycle, ...) is a VehicleSpec: the boxes it is made of and
 * where its wheels sit. The wheels inherit every move and turn of the vehicle, then
 * roll on their own axle. Pure math: no WebGL, so it is unit-tested directly.
 */

import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import { CELL_SIZE } from '../config';
import type { Pose } from './interpolation';

export type Triple = readonly [number, number, number];

// How a part is colored: the vehicle's body color, the dark glass/rider color, a
// headlight, or a glowing roof sign.
export type Paint = 'body' | 'dark' | 'accent' | 'sign';

export interface PartSpec {
    readonly paint: Paint;
    // Size of the box in world units, and its centre in vehicle-local space
    readonly size: Triple;
    readonly offset: Triple;
}

// Vehicle-local space: +z is forward, +x is the vehicle's left, y = 0 is the road.
export interface VehicleSpec {
    readonly parts: readonly PartSpec[];
    readonly wheelRadius: number;
    readonly wheelWidth: number;
    // Wheel hub centres; every wheel's axle is the local x axis
    readonly wheelOffsets: readonly Triple[];
    // Height of the top of the vehicle, where a light bar sits
    readonly roofHeight: number;
}

export interface VehicleMatrices {
    // One matrix per spec part, in spec order, for a unit box
    readonly parts: readonly Mat4[];
    // One matrix per wheel offset, for a unit wheel (radius 1, width 1, axle on x)
    readonly wheels: readonly Mat4[];
}

// Rolling without slipping: the angle is arc length over radius. Positive spin
// rolls the wheel toward the vehicle's +z (forward).
export function wheelSpin(distanceWorld: number, radius: number): number {
    return distanceWorld / radius;
}

export function vehicleWorldMatrix(pose: Pose): Mat4 {
    const position = V3.create(pose.x * CELL_SIZE, pose.y * CELL_SIZE, pose.z * CELL_SIZE);
    return M4.multiply(M4.translation(position), M4.rotationY(pose.yaw));
}

function translation(offset: Triple): Mat4 {
    return M4.translation(V3.create(offset[0], offset[1], offset[2]));
}

// Hub transform without the scale, so its translation is the wheel's centre.
export function wheelHubMatrix(vehicleWorld: Mat4, offset: Triple, spin: number): Mat4 {
    return M4.multiply(vehicleWorld, M4.multiply(translation(offset), M4.rotationX(spin)));
}

// A child box of the vehicle: centred on `offset`, scaled to `size`.
export function childBox(vehicleWorld: Mat4, offset: Triple, size: Triple): Mat4 {
    const scale = M4.scale(V3.create(size[0], size[1], size[2]));
    return M4.multiply(vehicleWorld, M4.multiply(translation(offset), scale));
}

const BAR_LAMP_SIZE: Triple = [0.12 * CELL_SIZE, 0.06 * CELL_SIZE, 0.1 * CELL_SIZE];

// Left and right lamps of a roof light bar, children of the vehicle like every part.
export function lightBarMatrices(spec: VehicleSpec, pose: Pose): readonly [Mat4, Mat4] {
    const vehicleWorld = vehicleWorldMatrix(pose);
    const y = spec.roofHeight + 0.5 * BAR_LAMP_SIZE[1];
    const x = 0.5 * BAR_LAMP_SIZE[0] + 0.01 * CELL_SIZE;
    return [childBox(vehicleWorld, [x, y, 0], BAR_LAMP_SIZE), childBox(vehicleWorld, [-x, y, 0], BAR_LAMP_SIZE)];
}

export function vehicleMatrices(spec: VehicleSpec, pose: Pose, distanceCells: number): VehicleMatrices {
    const vehicleWorld = vehicleWorldMatrix(pose);
    const spin = wheelSpin(distanceCells * CELL_SIZE, spec.wheelRadius);
    const wheelScale = M4.scale(V3.create(spec.wheelWidth, spec.wheelRadius, spec.wheelRadius));
    return {
        parts: spec.parts.map((part) => childBox(vehicleWorld, part.offset, part.size)),
        wheels: spec.wheelOffsets.map((offset) =>
            M4.multiply(wheelHubMatrix(vehicleWorld, offset, spin), wheelScale)),
    };
}
