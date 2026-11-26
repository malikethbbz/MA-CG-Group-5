/*
 * How loud each siren voice plays, from the active sirens and their distance to the
 * camera target. Pure: the Web Audio side only applies the numbers.
 */

import { CELL_SIZE } from '../config';
import { sirenSpec, type SirenMap, type SirenVoice } from '../world/siren';
import { vehiclePose, type VehicleMap } from '../world/vehicle_sync';

export interface SirenSource {
    readonly voice: SirenVoice;
    // World units from the siren to the point the camera looks at
    readonly distance: number;
}

export type VoiceGains = Readonly<Record<SirenVoice, number>>;

// A siren this far away sounds at half the loudness of one at the target.
export const REFERENCE_DISTANCE = 10;
// Loudest a single voice can get, however many sirens are near
export const MAX_VOICE_GAIN = 0.22;
// Loudest both voices together can get
export const MAX_TOTAL_GAIN = 0.3;

export const SILENT: VoiceGains = { wail: 0, yelp: 0 };

export function distanceFalloff(distance: number): number {
    const d = Math.max(0, distance) / REFERENCE_DISTANCE;
    return 1 / (1 + d * d);
}

// More sirens are louder, but with diminishing returns up to MAX_VOICE_GAIN.
function voiceGain(sources: readonly SirenSource[], voice: SirenVoice): number {
    const presence = sources
        .filter((source) => source.voice === voice)
        .reduce((sum, source) => sum + distanceFalloff(source.distance), 0);
    return MAX_VOICE_GAIN * (1 - Math.exp(-presence));
}

export function sirenGains(sources: readonly SirenSource[]): VoiceGains {
    const wail = voiceGain(sources, 'wail');
    const yelp = voiceGain(sources, 'yelp');
    const total = wail + yelp;
    const scale = total > MAX_TOTAL_GAIN ? MAX_TOTAL_GAIN / total : 1;
    return { wail: wail * scale, yelp: yelp * scale };
}

// Every siren that is sounding right now, with its distance (world units) to `target`.
export function activeSirenSources(vehicles: VehicleMap, sirens: SirenMap, alpha: number,
    target: readonly [number, number, number]): SirenSource[] {
    const sources: SirenSource[] = [];
    for (const vehicle of vehicles.values()) {
        const spec = sirenSpec(vehicle.kind);
        if (!spec || sirens.get(vehicle.id)?.mode !== 'active') {
            continue;
        }
        const pose = vehiclePose(vehicle, alpha);
        const distance = Math.hypot(pose.x * CELL_SIZE - target[0], pose.y * CELL_SIZE - target[1],
            pose.z * CELL_SIZE - target[2]);
        sources.push({ voice: spec.voice, distance });
    }
    return sources;
}
