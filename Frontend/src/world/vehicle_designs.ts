/*
 * What each vehicle looks like. The server only says "car"; the client gives every
 * car one of several designs and a neon color, picked from a hash of its id so a car
 * keeps its look on every frame. Other kinds have one shape and their kind color.
 */

import type { Color } from '../../libs/color';
import { CELL_SIZE } from '../config';
import { hex, vehicleColor } from './palette';
import type { VehicleSpec } from './vehicle_model';
import { CAR_SPEC, carSpec, MOTORCYCLE_SPEC } from './vehicle_specs';

const K = CELL_SIZE;

export interface CarDesign {
    readonly name: string;
    readonly spec: VehicleSpec;
    readonly colors: readonly Color[];
}

export const CAR_DESIGNS: readonly CarDesign[] = [
    {
        name: 'compact',
        spec: carSpec({
            body: [0.32 * K, 0.14 * K, 0.48 * K], cabin: [0.27 * K, 0.12 * K, 0.26 * K],
            cabinZ: -0.02 * K, wheelRadius: 0.075 * K, axleZ: 0.15 * K,
        }),
        colors: [hex('#00f0ff'), hex('#7df9ff'), hex('#ff7ad9')],
    },
    {
        name: 'sedan',
        spec: carSpec({
            body: [0.35 * K, 0.14 * K, 0.62 * K], cabin: [0.28 * K, 0.11 * K, 0.3 * K],
            cabinZ: -0.03 * K, wheelRadius: 0.085 * K, axleZ: 0.2 * K,
            // Rear spoiler
            extras: ({ bodyTop, bodyLength }) => [
                { paint: 'dark', size: [0.33 * K, 0.02 * K, 0.06 * K], offset: [0, bodyTop + 0.04 * K, -0.45 * bodyLength] },
            ],
        }),
        colors: [hex('#3d8bff'), hex('#b26bff'), hex('#00ffc6')],
    },
    {
        name: 'taxi',
        spec: carSpec({
            body: [0.35 * K, 0.14 * K, 0.6 * K], cabin: [0.28 * K, 0.11 * K, 0.3 * K],
            cabinZ: -0.03 * K, wheelRadius: 0.085 * K, axleZ: 0.2 * K,
            // Glowing roof sign
            extras: ({ cabinTop }) => [
                { paint: 'sign', size: [0.14 * K, 0.05 * K, 0.07 * K], offset: [0, cabinTop + 0.025 * K, -0.03 * K] },
            ],
        }),
        colors: [hex('#ffd21f'), hex('#ffe14d')],
    },
    {
        name: 'box truck',
        spec: carSpec({
            body: [0.36 * K, 0.1 * K, 0.76 * K], cabin: [0.32 * K, 0.14 * K, 0.18 * K],
            cabinZ: 0.27 * K, wheelRadius: 0.09 * K, axleZ: 0.26 * K,
            // Cargo box behind the cab
            extras: ({ bodyTop }) => [
                { paint: 'body', size: [0.36 * K, 0.3 * K, 0.5 * K], offset: [0, bodyTop + 0.15 * K, -0.12 * K] },
            ],
        }),
        colors: [hex('#ff8a3d'), hex('#f2f2ff'), hex('#9dff4d')],
    },
    {
        name: 'sports',
        spec: carSpec({
            body: [0.34 * K, 0.09 * K, 0.6 * K], cabin: [0.24 * K, 0.07 * K, 0.22 * K],
            cabinZ: -0.05 * K, wheelRadius: 0.075 * K, axleZ: 0.2 * K,
            extras: ({ bodyTop, bodyLength }) => [
                { paint: 'body', size: [0.34 * K, 0.015 * K, 0.07 * K], offset: [0, bodyTop + 0.05 * K, -0.46 * bodyLength] },
            ],
        }),
        colors: [hex('#ff2b6e'), hex('#ff3bf2'), hex('#2bffea')],
    },
];

// FNV-1a: a stable 32-bit hash of the id string
export function idHash(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
    }
    return h;
}

export function carDesign(id: string): CarDesign {
    return CAR_DESIGNS[idHash(id) % CAR_DESIGNS.length];
}

export interface VehicleLook {
    readonly spec: VehicleSpec;
    readonly color: Color;
}

export function vehicleLook(kind: string, id: string): VehicleLook {
    if (kind === 'car') {
        const design = carDesign(id);
        // Different bits of the hash than the design index, so colors vary within a design
        const color = design.colors[(idHash(id) >>> 8) % design.colors.length];
        return { spec: design.spec, color };
    }
    const spec = kind === 'motorcycle' ? MOTORCYCLE_SPEC : CAR_SPEC;
    return { spec, color: vehicleColor(kind) };
}
