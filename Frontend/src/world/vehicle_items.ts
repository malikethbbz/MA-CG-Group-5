/*
 * Draw items for every tracked vehicle at the current interpolation point, including
 * the flashing light bar of kinds that carry a siren.
 */

import type { Color } from '../../libs/color';
import { drawItem, type DrawItem } from './draw_item';
import type { Pose } from './interpolation';
import { PALETTE, scaleColor } from './palette';
import { EMPTY_SIRENS, flashOffsetMs, sirenLevels, sirenSpec, type SirenMap } from './siren';
import { lightBarMatrices, vehicleMatrices, type Paint, type VehicleSpec } from './vehicle_model';
import { vehicleLook } from './vehicle_designs';
import { travelledDistance, vehiclePose, type TrackedVehicle, type VehicleMap } from './vehicle_sync';

// An unlit bar lamp keeps a hint of its color
const BAR_IDLE_LEVEL = 0.2;

interface Finish {
    readonly color: Color;
    readonly emissive: number;
}

function finish(paint: Paint, bodyColor: Color): Finish {
    switch (paint) {
        case 'body':
            return { color: bodyColor, emissive: 0.35 };
        case 'dark':
            return { color: PALETTE.cabin, emissive: 0 };
        case 'accent':
            return { color: PALETTE.headlight, emissive: 1 };
        case 'sign':
            return { color: PALETTE.taxiSign, emissive: 1 };
    }
}

function lightBarItems(vehicle: TrackedVehicle, spec: VehicleSpec, pose: Pose, sirens: SirenMap,
    timeMs: number): DrawItem[] {
    const siren = sirenSpec(vehicle.kind);
    if (!siren) {
        return [];
    }
    const mode = sirens.get(vehicle.id)?.mode ?? 'off';
    const levels = sirenLevels(mode, timeMs, flashOffsetMs(vehicle.id));
    return lightBarMatrices(spec, pose).map((world, i) => {
        const level = Math.max(BAR_IDLE_LEVEL, levels[i]);
        return drawItem('box', world, scaleColor(siren.colors[i], level), levels[i] > 0 ? 1 : 0.5);
    });
}

function vehicleItems(vehicle: TrackedVehicle, alpha: number, sirens: SirenMap, timeMs: number): DrawItem[] {
    const { spec, color: bodyColor } = vehicleLook(vehicle.kind, vehicle.id);
    const pose = vehiclePose(vehicle, alpha);
    const matrices = vehicleMatrices(spec, pose, travelledDistance(vehicle, alpha));
    const parts = spec.parts.map((part, i) => {
        const { color, emissive } = finish(part.paint, bodyColor);
        return drawItem('box', matrices.parts[i], color, emissive);
    });
    return [
        ...parts,
        ...matrices.wheels.map((wheel) => drawItem('wheel', wheel, PALETTE.wheel)),
        ...lightBarItems(vehicle, spec, pose, sirens, timeMs),
    ];
}

export function vehiclesDrawItems(vehicles: VehicleMap, alpha: number, sirens: SirenMap = EMPTY_SIRENS,
    timeMs = 0): DrawItem[] {
    return [...vehicles.values()].flatMap((vehicle) => vehicleItems(vehicle, alpha, sirens, timeMs));
}
