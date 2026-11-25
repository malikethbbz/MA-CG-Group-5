/*
 * Maps the Traffic menu's preset names to /init options and back.
 */

import { DEFAULT_TRAFFIC, TRAFFIC_PRESETS, type TrafficPreset } from '../config';

export function trafficPreset(name: string): TrafficPreset {
    return TRAFFIC_PRESETS[name] ?? TRAFFIC_PRESETS[DEFAULT_TRAFFIC];
}

// The menu entry for options already in effect, so a refused change can be undone.
export function trafficName(run: TrafficPreset): string {
    const match = Object.entries(TRAFFIC_PRESETS).find(([, preset]) =>
        preset.spawnInterval === run.spawnInterval && preset.spawnPoints === run.spawnPoints);
    return match?.[0] ?? DEFAULT_TRAFFIC;
}
