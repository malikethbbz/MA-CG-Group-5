/*
 * Pure bookkeeping of the vehicles seen in /step frames, keyed by their stable id.
 * Each vehicle keeps the pose of the previous frame (`from`) and of the latest one
 * (`to`); the renderer interpolates between them. No WebGL here.
 */

import type { VehicleFrame } from '../api/contract';
import { headingToYaw, interpolatePose, poseDistance, type Pose } from './interpolation';

export interface TrackedVehicle {
    readonly id: string;
    readonly kind: string;
    readonly state: string;
    readonly from: Pose;
    readonly to: Pose;
    // Distance in cells driven before reaching `from`; feeds the wheel spin.
    readonly odometer: number;
}

export type VehicleMap = ReadonlyMap<string, TrackedVehicle>;

export interface SyncResult {
    readonly vehicles: VehicleMap;
    readonly added: readonly string[];
    readonly updated: readonly string[];
    readonly removed: readonly string[];
}

export const EMPTY_VEHICLES: VehicleMap = new Map();

function poseOf(frame: VehicleFrame, fallbackYaw: number): Pose {
    return { x: frame.x, y: frame.y, z: frame.z, yaw: headingToYaw(frame.heading, fallbackYaw) };
}

function spawn(frame: VehicleFrame): TrackedVehicle {
    const pose = poseOf(frame, 0);
    return { id: frame.id, kind: frame.kind, state: frame.state, from: pose, to: pose, odometer: 0 };
}

function advance(previous: TrackedVehicle, frame: VehicleFrame): TrackedVehicle {
    return {
        id: frame.id,
        kind: frame.kind,
        state: frame.state,
        from: previous.to,
        to: poseOf(frame, previous.to.yaw),
        odometer: previous.odometer + poseDistance(previous.from, previous.to),
    };
}

// Returns a new map; `previous` is never modified.
export function syncVehicles(previous: VehicleMap, frames: readonly VehicleFrame[]): SyncResult {
    const vehicles = new Map<string, TrackedVehicle>();
    const added: string[] = [];
    const updated: string[] = [];
    for (const frame of frames) {
        const known = previous.get(frame.id);
        if (known) {
            vehicles.set(frame.id, advance(known, frame));
            updated.push(frame.id);
        } else {
            vehicles.set(frame.id, spawn(frame));
            added.push(frame.id);
        }
    }
    const removed = [...previous.keys()].filter((id) => !vehicles.has(id));
    return { vehicles, added, updated, removed };
}

export function vehiclePose(vehicle: TrackedVehicle, alpha: number): Pose {
    return interpolatePose(vehicle.from, vehicle.to, alpha);
}

// Total distance in cells at the interpolated point, so wheels roll exactly as far
// as the body moves and stop when from === to.
export function travelledDistance(vehicle: TrackedVehicle, alpha: number): number {
    return vehicle.odometer + alpha * poseDistance(vehicle.from, vehicle.to);
}
