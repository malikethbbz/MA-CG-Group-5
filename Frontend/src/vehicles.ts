/*
 * The vehicles from /step. Each one keeps the pose of the previous frame (`from`)
 * and of the latest one (`to`), like oldPosArray in the course base project, and is
 * drawn in between so it moves smoothly while the next step is on its way.
 *
 * A vehicle is a small hierarchy of boxes:
 *   vehicleWorld = T(position) * Ry(yaw)
 *   partWorld    = vehicleWorld * T(partOffset) * S(partSize)
 * In vehicle space +z is forward and y = 0 is the road.
 * Positions are in grid cells; yaw is in radians around +y, 0 facing +z.
 *
 * Team 5 - TC2008B
 * 2026-11
 */

import { M4, V3 } from '../libs/3d-lib';
import type { Color } from '../libs/color';
import type { GridCell, VehicleFrame } from './api_connection';
import { childBox, drawItem, type DrawItem } from './city';
import { COLORS } from './config';

export interface Pose {
    x: number;
    y: number;
    z: number;
    yaw: number;
}

export interface TrackedVehicle {
    id: string;
    kind: string;
    state: string;
    from: Pose;
    to: Pose;
}

// How long each siren lamp stays lit before the other one takes over
const SIREN_FLASH_MS = 250;


/* MOVING BETWEEN TWO FRAMES */

// Fraction of the way from the previous frame to the latest one, in [0, 1]
export function frameAlpha(elapsedMs: number, intervalMs: number): number {
    if (intervalMs <= 0) {
        return 1;
    }
    return Math.min(1, Math.max(0, elapsedMs / intervalMs));
}

// rotationY(yaw) turns the model's +z onto (sin yaw, 0, cos yaw), so yaw = atan2(hx, hz).
// A zero heading (the vehicle has not moved yet) keeps the previous yaw.
export function headingToYaw(heading: GridCell, fallbackYaw: number): number {
    if (heading.x === 0 && heading.z === 0) {
        return fallbackYaw;
    }
    return Math.atan2(heading.x, heading.z);
}

// Turns from one yaw to another the short way round, never more than half a circle
export function lerpAngle(from: number, to: number, t: number): number {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * t;
}

export function interpolatePose(from: Pose, to: Pose, alpha: number): Pose {
    return {
        x: from.x + (to.x - from.x) * alpha,
        y: from.y + (to.y - from.y) * alpha,
        z: from.z + (to.z - from.z) * alpha,
        yaw: lerpAngle(from.yaw, to.yaw, alpha),
    };
}

export function vehiclePose(vehicle: TrackedVehicle, alpha: number): Pose {
    return interpolatePose(vehicle.from, vehicle.to, alpha);
}

// Returns a new map with the vehicles of this frame. A known id moves from its last
// pose to the new one; a new id starts still; ids missing from the frame are gone.
export function syncVehicles(previous: Map<string, TrackedVehicle>, frames: VehicleFrame[]): Map<string, TrackedVehicle> {
    const vehicles = new Map<string, TrackedVehicle>();
    for (const frame of frames) {
        const known = previous.get(frame.id);
        const yaw = headingToYaw(frame.heading, known ? known.to.yaw : 0);
        const to = { x: frame.x, y: frame.y, z: frame.z, yaw };
        vehicles.set(frame.id, { id: frame.id, kind: frame.kind, state: frame.state, from: known ? known.to : to, to });
    }
    return vehicles;
}


/* WHAT THE VEHICLES LOOK LIKE */

// Each car keeps one color, picked from its id
function carColor(id: string): Color {
    let sum = 0;
    for (const char of id) {
        sum += char.charCodeAt(0);
    }
    return COLORS.cars[sum % COLORS.cars.length];
}

function dimmed(color: Color, level: number): Color {
    return [color[0] * level, color[1] * level, color[2] * level, color[3]];
}

export function vehicleItems(vehicle: TrackedVehicle, alpha: number, timeMs: number): DrawItem[] {
    const pose = vehiclePose(vehicle, alpha);
    const world = M4.multiply(M4.translation(V3.create(pose.x, pose.y, pose.z)), M4.rotationY(pose.yaw));
    const part = (offset: number[], size: number[], color: Color, emissive = 0): DrawItem =>
        drawItem('box', childBox(world, offset, size), color, emissive);

    if (vehicle.kind === 'motorcycle') {
        return [
            part([0, 0.12, 0], [0.08, 0.08, 0.45], COLORS.motorcycle, 0.3),
            part([0, 0.25, -0.03], [0.12, 0.18, 0.1], COLORS.cabin),
            part([0, 0.075, 0.16], [0.04, 0.15, 0.15], COLORS.wheel),
            part([0, 0.075, -0.16], [0.04, 0.15, 0.15], COLORS.wheel),
        ];
    }

    // Cars and ambulances: body, cabin and four wheels
    const body = vehicle.kind === 'ambulance' ? COLORS.ambulance : carColor(vehicle.id);
    const items = [
        part([0, 0.16, 0], [0.35, 0.15, 0.6], body, 0.3),
        part([0, 0.29, -0.03], [0.28, 0.11, 0.3], COLORS.cabin),
    ];
    for (const [x, z] of [[0.15, 0.2], [-0.15, 0.2], [0.15, -0.2], [-0.15, -0.2]]) {
        items.push(part([x, 0.085, z], [0.06, 0.17, 0.17], COLORS.wheel));
    }

    if (vehicle.kind === 'ambulance') {
        // Light bar: the red and blue lamps take turns while on a mission
        const onMission = vehicle.state !== 'idle';
        const redTurn = Math.floor(timeMs / SIREN_FLASH_MS) % 2 === 0;
        const redLit = onMission && redTurn;
        const blueLit = onMission && !redTurn;
        items.push(part([0.07, 0.375, 0], [0.12, 0.06, 0.1], dimmed(COLORS.sirenRed, redLit ? 1 : 0.3), redLit ? 1 : 0));
        items.push(part([-0.07, 0.375, 0], [0.12, 0.06, 0.1], dimmed(COLORS.sirenBlue, blueLit ? 1 : 0.3), blueLit ? 1 : 0));
    }
    return items;
}
