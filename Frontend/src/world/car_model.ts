/*
 * A car as a parent/child transform hierarchy built from our own M4 matrices:
 *
 *   carWorld   = T(position) · Ry(yaw)
 *   bodyWorld  = carWorld · T(bodyOffset) · S(bodySize)
 *   wheelWorld = carWorld · T(wheelOffset) · Rx(spin) · S(wheelSize)
 *
 * The wheels inherit every move and turn of the car, then roll on their own axle.
 * Pure math: no WebGL, so it is unit-tested directly.
 */

import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import { CELL_SIZE } from '../config';
import type { Pose } from './interpolation';

// Sizes in world units, for a car whose forward axis is local +z.
export const WHEEL_RADIUS = 0.11 * CELL_SIZE;
const WHEEL_WIDTH = 0.08 * CELL_SIZE;
const BODY_SIZE = V3.create(0.42 * CELL_SIZE, 0.2 * CELL_SIZE, 0.72 * CELL_SIZE);
const CABIN_SIZE = V3.create(0.34 * CELL_SIZE, 0.14 * CELL_SIZE, 0.36 * CELL_SIZE);
const BODY_LIFT = WHEEL_RADIUS + 0.5 * BODY_SIZE[1];
const CABIN_LIFT = BODY_LIFT + 0.5 * (BODY_SIZE[1] + CABIN_SIZE[1]);
const AXLE_X = 0.5 * BODY_SIZE[0] + 0.5 * WHEEL_WIDTH;
const AXLE_Z = 0.25 * CELL_SIZE;

// Car-local wheel hubs: front-left, front-right, rear-left, rear-right.
export const WHEEL_OFFSETS: readonly [number, number, number][] = [
    [AXLE_X, WHEEL_RADIUS, AXLE_Z],
    [-AXLE_X, WHEEL_RADIUS, AXLE_Z],
    [AXLE_X, WHEEL_RADIUS, -AXLE_Z],
    [-AXLE_X, WHEEL_RADIUS, -AXLE_Z],
];

export interface CarMatrices {
    readonly body: Mat4;
    readonly cabin: Mat4;
    readonly wheels: readonly Mat4[];
}

// Rolling without slipping: the angle is arc length over radius. Positive spin
// rolls the wheel toward the car's +z (forward).
export function wheelSpin(distanceWorld: number): number {
    return distanceWorld / WHEEL_RADIUS;
}

export function carWorldMatrix(pose: Pose): Mat4 {
    const position = V3.create(pose.x * CELL_SIZE, pose.y * CELL_SIZE, pose.z * CELL_SIZE);
    return M4.multiply(M4.translation(position), M4.rotationY(pose.yaw));
}

// Hub transform without the scale, so its translation is the wheel's centre.
export function wheelHubMatrix(carWorld: Mat4, offset: readonly number[], spin: number): Mat4 {
    const local = M4.multiply(M4.translation(V3.create(offset[0], offset[1], offset[2])),
        M4.rotationX(spin));
    return M4.multiply(carWorld, local);
}

function part(carWorld: Mat4, lift: number, size: Float32Array): Mat4 {
    return M4.multiply(carWorld, M4.multiply(M4.translation(V3.create(0, lift, 0)), M4.scale(size)));
}

// Matrices for a unit box (body, cabin) and a unit wheel (radius 1, width 1, axle on x).
export function carMatrices(pose: Pose, distanceCells: number): CarMatrices {
    const carWorld = carWorldMatrix(pose);
    const spin = wheelSpin(distanceCells * CELL_SIZE);
    const wheelScale = M4.scale(V3.create(WHEEL_WIDTH, WHEEL_RADIUS, WHEEL_RADIUS));
    return {
        body: part(carWorld, BODY_LIFT, BODY_SIZE),
        cabin: part(carWorld, CABIN_LIFT, CABIN_SIZE),
        wheels: WHEEL_OFFSETS.map((offset) => M4.multiply(wheelHubMatrix(carWorld, offset, spin), wheelScale)),
    };
}
