/*
 * lil-gui panel. The settings object is shared with the poller and the scene,
 * which read it on every use, so slider changes apply immediately. Choices that
 * need the server (map, traffic) or a user gesture (sound) go through
 * handlers. After a setting is changed back in code, refresh the panel.
 */

import GUI from 'lil-gui';
import {
    DEFAULT_STEP_INTERVAL_MS, DEFAULT_TRAFFIC, MAP_CHOICES, MAX_STEP_INTERVAL_MS,
    MIN_STEP_INTERVAL_MS, TRAFFIC_PRESETS,
} from '../config';

export interface SimSettings {
    // Map file sent to /init; changing it reloads the page with ?map=
    map: string;
    stepIntervalMs: number;
    // A TRAFFIC_PRESETS name; sent to /init as spawnInterval and spawnPoints
    traffic: string;
    // Siren audio; off by default (browsers block autoplay anyway)
    sound: boolean;
}

export interface ControlHandlers {
    // The map changed: the city itself must be rebuilt
    onMapChange(map: string): void;
    // Traffic changed: the simulation must restart with it
    onRunOptionsChange(): void;
    onSoundChange(enabled: boolean): void;
}

export function defaultSettings(map: string): SimSettings {
    return {
        map,
        stepIntervalMs: DEFAULT_STEP_INTERVAL_MS,
        traffic: DEFAULT_TRAFFIC,
        sound: false,
    };
}

export function createControls(settings: SimSettings, handlers: ControlHandlers): GUI {
    const gui = new GUI({ title: 'Simulation' });
    gui.add(settings, 'map', MAP_CHOICES)
        .name('Map')
        .onChange((map: string) => handlers.onMapChange(map));
    gui.add(settings, 'stepIntervalMs', MIN_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, 50)
        .name('Step interval (ms)');
    gui.add(settings, 'traffic', Object.keys(TRAFFIC_PRESETS))
        .name('Traffic')
        .onChange(() => handlers.onRunOptionsChange());
    gui.add(settings, 'sound')
        .name('Sound')
        .onChange((value: boolean) => handlers.onSoundChange(value));
    return gui;
}
