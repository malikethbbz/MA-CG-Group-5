/*
 * lil-gui panel. The settings object is shared with the poller and the scene,
 * which read it on every use, so slider changes apply immediately.
 */

import GUI from 'lil-gui';
import { DEFAULT_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, MIN_STEP_INTERVAL_MS } from '../config';

export interface SimSettings {
    stepIntervalMs: number;
}

export function defaultSettings(): SimSettings {
    return { stepIntervalMs: DEFAULT_STEP_INTERVAL_MS };
}

export function createControls(settings: SimSettings): GUI {
    const gui = new GUI({ title: 'Simulation' });
    gui.add(settings, 'stepIntervalMs', MIN_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, 50)
        .name('Step interval (ms)');
    return gui;
}
