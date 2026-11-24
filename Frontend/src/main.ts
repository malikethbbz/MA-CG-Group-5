/*
 * Entry point: /init -> /city -> poll /step, drawing the city with WebGL.
 * Requires Backend/city_server.py running on http://localhost:8585/.
 */

import { fetchCity, fetchStep, initModel } from './api/client';
import type { CityData, StepFrame } from './api/contract';
import { RETRY_DELAY_MS } from './config';
import { CityScene } from './render/city_scene';
import { startPolling } from './sim/poller';
import { retryUntilOk } from './sim/retry';
import { defaultSettings } from './ui/controls';
import { createHud, type Hud } from './ui/hud';
import { EMPTY_VEHICLES, syncVehicles, type VehicleMap } from './world/vehicle_sync';

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function webglContext(): WebGL2RenderingContext {
    const canvas = document.querySelector('canvas');
    if (!canvas) {
        throw new Error('No canvas element found in the page.');
    }
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('This browser does not support WebGL2.');
    }
    return gl;
}

async function loadCity(hud: Hud): Promise<CityData> {
    const reportRetry = (error: unknown, attempt: number): void => {
        console.error(error);
        hud.showStatus(`${errorText(error)} Retrying (attempt ${attempt})...`, 'error');
    };
    hud.showStatus('Connecting to the simulation server...', 'info');
    await retryUntilOk(initModel, reportRetry, RETRY_DELAY_MS);
    return retryUntilOk(fetchCity, reportRetry, RETRY_DELAY_MS);
}

function finishedMessage(frame: StepFrame): string {
    const reason = frame.stats.stopReason ? `: ${frame.stats.stopReason}` : '';
    return `Simulation finished at step ${frame.step}${reason}.`;
}

async function main(): Promise<void> {
    const hud = createHud();
    try {
        const gl = webglContext();
        const city = await loadCity(hud);
        const settings = defaultSettings();
        const scene = new CityScene(gl, city, settings);
        scene.setupUI();
        scene.draw(0);
        hud.clearStatus();

        let vehicles: VehicleMap = EMPTY_VEHICLES;
        startPolling({
            fetchStep,
            intervalMs: () => settings.stepIntervalMs,
            retryDelayMs: RETRY_DELAY_MS,
            onFrame: (frame) => {
                vehicles = syncVehicles(vehicles, frame.vehicles).vehicles;
                scene.showFrame(vehicles, frame.lights, performance.now());
                hud.showStats(frame.stats);
                hud.clearStatus();
            },
            onError: (error) => {
                console.error(error);
                hud.showStatus(`${errorText(error)} Retrying...`, 'error');
            },
            onFinished: (frame) => hud.showStatus(finishedMessage(frame), 'done'),
        });
    } catch (error) {
        console.error(error);
        hud.showStatus(errorText(error), 'error');
    }
}

void main();
