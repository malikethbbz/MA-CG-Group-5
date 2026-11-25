/*
 * Emergency sirens as data: which kinds carry a light bar, when it is on, and how it
 * flashes over time. Pure functions only; the renderer and the audio read the result.
 *
 * Ambulance states (docs/frame-api.md):
 *   idle -> takeoff -> cruise -> landing -> on_scene -> takeoff -> return -> landing -> idle
 * takeoff and landing happen on both legs, so a per-vehicle `homebound` latch tells
 * the outbound leg (siren on) from the trip home (siren off).
 */

import type { Color } from '../../libs/color';
import { hex } from './palette';
import type { VehicleMap } from './vehicle_sync';

// off: bar dark and silent; pulse: slow glow, silent (on scene); active: flashing + sound
export type SirenMode = 'off' | 'pulse' | 'active';
export type SirenVoice = 'wail' | 'yelp';

export interface SirenSpec {
    // Left and right lamps of the light bar
    readonly colors: readonly [Color, Color];
    readonly voice: SirenVoice;
    mode(state: string, homebound: boolean): SirenMode;
}

const RED = hex('#ff1f3d');
const WHITE = hex('#f4f6ff');
const BLUE = hex('#2f6bff');

function ambulanceMode(state: string, homebound: boolean): SirenMode {
    if (state === 'on_scene') {
        return 'pulse';
    }
    const outbound = state === 'takeoff' || state === 'cruise' || state === 'landing';
    return outbound && !homebound ? 'active' : 'off';
}

const POLICE_QUIET_STATES: ReadonlySet<string> = new Set(['idle', 'patrol']);

function policeMode(state: string): SirenMode {
    return POLICE_QUIET_STATES.has(state) ? 'off' : 'active';
}

// A new kind with a siren only needs a row here.
const SIRENS: Readonly<Record<string, SirenSpec>> = {
    ambulance: { colors: [RED, WHITE], voice: 'wail', mode: ambulanceMode },
    police: { colors: [RED, BLUE], voice: 'yelp', mode: policeMode },
};

export function sirenSpec(kind: string): SirenSpec | undefined {
    return SIRENS[kind];
}

// True once the ambulance has reached the scene, until it is back on its pad or is
// sent out again.
export function nextHomebound(homebound: boolean, state: string): boolean {
    if (state === 'on_scene' || state === 'return') {
        return true;
    }
    if (state === 'idle' || state === 'cruise') {
        return false;
    }
    return homebound;
}

export interface SirenTrack {
    readonly mode: SirenMode;
    readonly homebound: boolean;
}

export type SirenMap = ReadonlyMap<string, SirenTrack>;
export const EMPTY_SIRENS: SirenMap = new Map();

// Call once per /step frame after syncVehicles. Returns a new map holding only the
// vehicles whose kind has a siren; `previous` is never modified.
export function syncSirens(previous: SirenMap, vehicles: VehicleMap): SirenMap {
    const next = new Map<string, SirenTrack>();
    for (const vehicle of vehicles.values()) {
        const spec = sirenSpec(vehicle.kind);
        if (!spec) {
            continue;
        }
        const homebound = nextHomebound(previous.get(vehicle.id)?.homebound ?? false, vehicle.state);
        next.set(vehicle.id, { mode: spec.mode(vehicle.state, homebound), homebound });
    }
    return next;
}

export const FLASH_PERIOD_MS = 500;
export const PULSE_PERIOD_MS = 2000;

// Spreads vehicles over the flash cycle so two ambulances do not blink in lockstep.
export function flashOffsetMs(id: string): number {
    let h = 0;
    for (const char of id) {
        h = (Math.imul(h, 31) + char.charCodeAt(0)) >>> 0;
    }
    return h % FLASH_PERIOD_MS;
}

// Brightness in [0, 1] of the left and right lamps at time `timeMs`.
export function sirenLevels(mode: SirenMode, timeMs: number, offsetMs = 0): readonly [number, number] {
    const t = timeMs + offsetMs;
    if (mode === 'active') {
        const firstHalf = ((t % FLASH_PERIOD_MS) + FLASH_PERIOD_MS) % FLASH_PERIOD_MS < FLASH_PERIOD_MS / 2;
        return firstHalf ? [1, 0] : [0, 1];
    }
    if (mode === 'pulse') {
        const glow = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / PULSE_PERIOD_MS);
        return [glow, glow];
    }
    return [0, 0];
}
