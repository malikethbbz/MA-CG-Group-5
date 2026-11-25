/*
 * Draw items for every tracked vehicle at the current interpolation point.
 */

import type { Color } from '../../libs/color';
import { drawItem, type DrawItem } from './draw_item';
import { PALETTE, vehicleColor } from './palette';
import { vehicleMatrices, type Paint } from './vehicle_model';
import { vehicleSpec } from './vehicle_specs';
import { travelledDistance, vehiclePose, type TrackedVehicle, type VehicleMap } from './vehicle_sync';

interface Finish {
    readonly color: Color;
    readonly emissive: number;
}

function finish(paint: Paint, kind: string): Finish {
    switch (paint) {
        case 'body':
            return { color: vehicleColor(kind), emissive: 0.35 };
        case 'dark':
            return { color: PALETTE.cabin, emissive: 0 };
        case 'accent':
            return { color: PALETTE.headlight, emissive: 1 };
    }
}

function vehicleItems(vehicle: TrackedVehicle, alpha: number): DrawItem[] {
    const spec = vehicleSpec(vehicle.kind);
    const matrices = vehicleMatrices(spec, vehiclePose(vehicle, alpha), travelledDistance(vehicle, alpha));
    const parts = spec.parts.map((part, i) => {
        const { color, emissive } = finish(part.paint, vehicle.kind);
        return drawItem('box', matrices.parts[i], color, emissive);
    });
    return [...parts, ...matrices.wheels.map((wheel) => drawItem('wheel', wheel, PALETTE.wheel))];
}

export function vehiclesDrawItems(vehicles: VehicleMap, alpha: number): DrawItem[] {
    return [...vehicles.values()].flatMap((vehicle) => vehicleItems(vehicle, alpha));
}
