/*
 * lil-gui panel. The settings object is shared with the poller and the scene,
 * which read it on every use, so slider changes apply immediately. Choices that
 * need the server (traffic, spawn points) or a user gesture (sound) go through
 * handlers. After a setting is changed back in code, refresh the panel.
 */

import GUI from 'lil-gui';
import {
    DEFAULT_SPAWN_INTERVAL, DEFAULT_SPAWN_POINTS, DEFAULT_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS,
    MIN_STEP_INTERVAL_MS, SPAWN_POINT_CHOICES, TRAFFIC_LEVELS, type SpawnPoints,
} from '../config';

export interface SimSettings {
    stepIntervalMs: number;
    // Steps between car spawns, sent to /init as spawnInterval
    spawnInterval: number;
    // Where cars enter, sent to /init as spawnPoints
    spawnPoints: SpawnPoints;
    // Siren audio; off by default (browsers block autoplay anyway)
    sound: boolean;
}

export interface ControlHandlers {
    // Traffic or spawn points changed: the simulation must restart with them
    onRunOptionsChange(): void;
    onSoundChange(enabled: boolean): void;
}

export function defaultSettings(): SimSettings {
    return {
        stepIntervalMs: DEFAULT_STEP_INTERVAL_MS,
        spawnInterval: DEFAULT_SPAWN_INTERVAL,
        spawnPoints: DEFAULT_SPAWN_POINTS,
        sound: false,
    };
}

export function createControls(settings: SimSettings, handlers: ControlHandlers): GUI {
    const gui = new GUI({ title: 'Simulation' });
    gui.add(settings, 'stepIntervalMs', MIN_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, 50)
        .name('Step interval (ms)');
    gui.add(settings, 'spawnInterval', TRAFFIC_LEVELS)
        .name('Traffic')
        .onChange(() => handlers.onRunOptionsChange());
    gui.add(settings, 'spawnPoints', SPAWN_POINT_CHOICES)
        .name('Spawn points')
        .onChange(() => handlers.onRunOptionsChange());
    gui.add(settings, 'sound')
        .name('Sound')
        .onChange((value: boolean) => handlers.onSoundChange(value));
    return gui;
}
