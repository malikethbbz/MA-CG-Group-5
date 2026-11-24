/*
 * Pure helpers to move a vehicle smoothly between two /step frames.
 * Positions are in grid cells; yaw is in radians around +y, 0 facing +z.
 */

import type { Heading } from '../api/contract';

export interface Pose {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
}

// Fraction of the way from the previous frame to the latest one, in [0, 1].
export function frameAlpha(elapsedMs: number, intervalMs: number): number {
    if (intervalMs <= 0) {
        return 1;
    }
    return Math.min(1, Math.max(0, elapsedMs / intervalMs));
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// rotationY(yaw) turns the model's +z forward axis onto (sin yaw, 0, cos yaw),
// so yaw = atan2(hx, hz). A zero heading (no move yet) keeps the previous yaw.
export function headingToYaw(heading: Heading, fallbackYaw: number): number {
    if (heading.x === 0 && heading.z === 0) {
        return fallbackYaw;
    }
    return Math.atan2(heading.x, heading.z);
}

// Signed difference to - from, wrapped into [-PI, PI) so a turn never goes the long way.
export function shortestAngleDelta(from: number, to: number): number {
    const TAU = 2 * Math.PI;
    const delta = (to - from) % TAU;
    const wrapped = delta < -Math.PI ? delta + TAU : delta >= Math.PI ? delta - TAU : delta;
    return wrapped;
}

export function lerpAngle(from: number, to: number, t: number): number {
    return from + shortestAngleDelta(from, to) * t;
}

export function interpolatePose(from: Pose, to: Pose, alpha: number): Pose {
    return {
        x: lerp(from.x, to.x, alpha),
        y: lerp(from.y, to.y, alpha),
        z: lerp(from.z, to.z, alpha),
        yaw: lerpAngle(from.yaw, to.yaw, alpha),
    };
}

export function poseDistance(a: Pose, b: Pose): number {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
