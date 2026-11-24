/*
 * Draw items for every tracked vehicle at the current interpolation point.
 */

import { carMatrices } from './car_model';
import { drawItem, type DrawItem } from './draw_item';
import { PALETTE, vehicleColor } from './palette';
import { travelledDistance, vehiclePose, type TrackedVehicle, type VehicleMap } from './vehicle_sync';

function vehicleItems(vehicle: TrackedVehicle, alpha: number): DrawItem[] {
    const parts = carMatrices(vehiclePose(vehicle, alpha), travelledDistance(vehicle, alpha));
    return [
        drawItem('box', parts.body, vehicleColor(vehicle.kind), 0.35),
        drawItem('box', parts.cabin, PALETTE.cabin),
        ...parts.wheels.map((wheel) => drawItem('wheel', wheel, PALETTE.wheel)),
    ];
}

export function vehiclesDrawItems(vehicles: VehicleMap, alpha: number): DrawItem[] {
    return [...vehicles.values()].flatMap((vehicle) => vehicleItems(vehicle, alpha));
}
