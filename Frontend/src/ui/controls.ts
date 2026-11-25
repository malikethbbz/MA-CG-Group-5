/*
 * lil-gui panel. The settings object is shared with the poller and the scene,
 * which read it on every use, so slider changes apply immediately. Choices that
 * need the server (traffic density) or a user gesture (sound) go through handlers.
 */

import GUI from 'lil-gui';
import {
    DEFAULT_SPAWN_INTERVAL, DEFAULT_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, MIN_STEP_INTERVAL_MS,
    TRAFFIC_LEVELS,
} from '../config';

export interface SimSettings {
    stepIntervalMs: number;
    // Steps between car spawns, sent to /init as spawnInterval
    spawnInterval: number;
    // Siren audio; off by default (browsers block autoplay anyway)
    sound: boolean;
}

export interface ControlHandlers {
    // The simulation must restart with the new spawn interval
    onTrafficChange(spawnInterval: number): void;
    onSoundChange(enabled: boolean): void;
}

export function defaultSettings(): SimSettings {
    return { stepIntervalMs: DEFAULT_STEP_INTERVAL_MS, spawnInterval: DEFAULT_SPAWN_INTERVAL, sound: false };
}

export function createControls(settings: SimSettings, handlers: ControlHandlers): GUI {
    const gui = new GUI({ title: 'Simulation' });
    gui.add(settings, 'stepIntervalMs', MIN_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, 50)
        .name('Step interval (ms)');
    gui.add(settings, 'spawnInterval', TRAFFIC_LEVELS)
        .name('Traffic')
        .onChange((value: number) => handlers.onTrafficChange(value));
    gui.add(settings, 'sound')
        .name('Sound')
        .onChange((value: boolean) => handlers.onSoundChange(value));
    return gui;
}
