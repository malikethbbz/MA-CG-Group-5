/*
 * The shape of each vehicle kind as data for the shared hierarchy in vehicle_model.ts.
 * Kinds without a spec of their own (ambulance, police, ...) are drawn as cars.
 */

import { CELL_SIZE } from '../config';
import type { Triple, VehicleSpec } from './vehicle_model';

// Every vehicle fits inside its lane cell with road showing around it: the footprint
// stays under half a cell wide, so two cars in adjacent lanes never touch, even
// mid-diagonal. Wheels sit flush with the body sides instead of sticking out.
const K = CELL_SIZE;

function car(): VehicleSpec {
    const wheelRadius = 0.085 * K;
    const wheelWidth = 0.06 * K;
    const body: Triple = [0.35 * K, 0.15 * K, 0.6 * K];
    const cabin: Triple = [0.28 * K, 0.11 * K, 0.3 * K];
    // The body hangs over the upper part of the wheels
    const bodyLift = 0.6 * wheelRadius + 0.5 * body[1];
    const cabinLift = bodyLift + 0.5 * (body[1] + cabin[1]);
    const axleX = 0.5 * (body[0] - wheelWidth);
    const axleZ = 0.2 * K;
    return {
        parts: [
            { paint: 'body', size: body, offset: [0, bodyLift, 0] },
            { paint: 'dark', size: cabin, offset: [0, cabinLift, -0.03 * K] },
            { paint: 'accent', size: [0.26 * K, 0.03 * K, 0.01 * K], offset: [0, bodyLift, 0.5 * body[2]] },
        ],
        wheelRadius,
        wheelWidth,
        // front-left, front-right, rear-left, rear-right
        wheelOffsets: [
            [axleX, wheelRadius, axleZ],
            [-axleX, wheelRadius, axleZ],
            [axleX, wheelRadius, -axleZ],
            [-axleX, wheelRadius, -axleZ],
        ],
        roofHeight: cabinLift + 0.5 * cabin[1],
    };
}

function motorcycle(): VehicleSpec {
    const wheelRadius = 0.075 * K;
    const wheelWidth = 0.04 * K;
    const axleZ = 0.16 * K;
    const body: Triple = [0.08 * K, 0.08 * K, 0.45 * K];
    const bodyLift = wheelRadius + 0.01 * K;
    const torso: Triple = [0.13 * K, 0.16 * K, 0.1 * K];
    const torsoLift = bodyLift + 0.5 * (body[1] + torso[1]);
    const helmet: Triple = [0.09 * K, 0.08 * K, 0.09 * K];
    return {
        parts: [
            { paint: 'body', size: body, offset: [0, bodyLift, 0] },
            { paint: 'dark', size: torso, offset: [0, torsoLift, -0.03 * K] },
            { paint: 'body', size: helmet, offset: [0, torsoLift + 0.5 * (torso[1] + helmet[1]), -0.02 * K] },
            { paint: 'accent', size: [0.06 * K, 0.03 * K, 0.01 * K], offset: [0, bodyLift + 0.03 * K, 0.5 * body[2]] },
        ],
        wheelRadius,
        wheelWidth,
        // front, rear: both on the centre line
        wheelOffsets: [
            [0, wheelRadius, axleZ],
            [0, wheelRadius, -axleZ],
        ],
        roofHeight: torsoLift + 0.5 * torso[1] + helmet[1],
    };
}

export const CAR_SPEC: VehicleSpec = car();
export const MOTORCYCLE_SPEC: VehicleSpec = motorcycle();

const SPECS: Readonly<Record<string, VehicleSpec>> = {
    motorcycle: MOTORCYCLE_SPEC,
};

export function vehicleSpec(kind: string): VehicleSpec {
    return SPECS[kind] ?? CAR_SPEC;
}
