/*
 * The shape of each vehicle kind as data for the shared hierarchy in vehicle_model.ts.
 * Kinds without a spec of their own (ambulance, police, ...) are drawn as cars.
 */

import { CELL_SIZE } from '../config';
import type { Triple, VehicleSpec } from './vehicle_model';

// Vehicles are drawn a bit larger than true scale so they read at the default zoom.
const K = 1.2 * CELL_SIZE;

function car(): VehicleSpec {
    const wheelRadius = 0.11 * K;
    const wheelWidth = 0.08 * K;
    const body: Triple = [0.42 * K, 0.2 * K, 0.72 * K];
    const cabin: Triple = [0.34 * K, 0.14 * K, 0.36 * K];
    const bodyLift = wheelRadius + 0.5 * body[1];
    const cabinLift = bodyLift + 0.5 * (body[1] + cabin[1]);
    const axleX = 0.5 * body[0] + 0.5 * wheelWidth;
    const axleZ = 0.25 * K;
    return {
        parts: [
            { paint: 'body', size: body, offset: [0, bodyLift, 0] },
            { paint: 'dark', size: cabin, offset: [0, cabinLift, 0] },
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
    };
}

function motorcycle(): VehicleSpec {
    const wheelRadius = 0.1 * K;
    const wheelWidth = 0.05 * K;
    const axleZ = 0.22 * K;
    const body: Triple = [0.1 * K, 0.1 * K, 0.5 * K];
    const bodyLift = wheelRadius + 0.02 * K;
    const torso: Triple = [0.16 * K, 0.2 * K, 0.12 * K];
    const torsoLift = bodyLift + 0.5 * (body[1] + torso[1]);
    const helmet: Triple = [0.11 * K, 0.1 * K, 0.11 * K];
    return {
        parts: [
            { paint: 'body', size: body, offset: [0, bodyLift, 0] },
            { paint: 'dark', size: torso, offset: [0, torsoLift, -0.04 * K] },
            { paint: 'body', size: helmet, offset: [0, torsoLift + 0.5 * (torso[1] + helmet[1]), -0.02 * K] },
            { paint: 'accent', size: [0.08 * K, 0.04 * K, 0.02 * K], offset: [0, bodyLift + 0.04 * K, 0.26 * K] },
        ],
        wheelRadius,
        wheelWidth,
        // front, rear: both on the centre line
        wheelOffsets: [
            [0, wheelRadius, axleZ],
            [0, wheelRadius, -axleZ],
        ],
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
