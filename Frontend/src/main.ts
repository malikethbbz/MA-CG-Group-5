/*
 * Entry point: /init -> /city -> poll /step, drawing the city with WebGL.
 * Changing the traffic density re-inits the model and keeps the city on screen.
 * Requires Backend/city_server.py running on http://localhost:8585/.
 */

import { fetchCity, fetchStep, initModel } from './api/client';
import type { CityData, StepFrame } from './api/contract';
import { RETRY_DELAY_MS } from './config';
import { CityScene } from './render/city_scene';
import { startPolling, type Poller } from './sim/poller';
import { retryUntilOk } from './sim/retry';
import { defaultSettings, type SimSettings } from './ui/controls';
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

function retryReporter(hud: Hud): (error: unknown, attempt: number) => void {
    return (error, attempt) => {
        console.error(error);
        hud.showStatus(`${errorText(error)} Retrying (attempt ${attempt})...`, 'error');
    };
}

function initWith(settings: SimSettings, hud: Hud): Promise<void> {
    const init = () => initModel({ spawnInterval: settings.spawnInterval });
    return retryUntilOk(init, retryReporter(hud), RETRY_DELAY_MS);
}

async function loadCity(settings: SimSettings, hud: Hud): Promise<CityData> {
    hud.showStatus('Connecting to the simulation server...', 'info');
    await initWith(settings, hud);
    return retryUntilOk(fetchCity, retryReporter(hud), RETRY_DELAY_MS);
}

function finishedMessage(frame: StepFrame): string {
    const reason = frame.stats.stopReason ? `: ${frame.stats.stopReason}` : '';
    return `Simulation finished at step ${frame.step}${reason}.`;
}

// One /step polling run; a traffic change stops it and starts a new one.
function pollRun(scene: CityScene, settings: SimSettings, hud: Hud): Poller {
    let vehicles: VehicleMap = EMPTY_VEHICLES;
    scene.showFrame(vehicles, [], performance.now());
    return startPolling({
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
}

async function main(): Promise<void> {
    const hud = createHud();
    try {
        const gl = webglContext();
        const settings = defaultSettings();
        const city = await loadCity(settings, hud);
        let poller: Poller | null = null;
        let latestRequest = 0;
        let restarts = Promise.resolve();

        // Restarts run one after another so /init calls never race; only the
        // latest request starts polling.
        const restart = (): void => {
            const request = ++latestRequest;
            poller?.stop();
            hud.showStatus('Restarting the simulation with the new traffic...', 'info');
            restarts = restarts.then(async () => {
                if (request !== latestRequest) {
                    return;
                }
                await initWith(settings, hud);
                if (request === latestRequest) {
                    poller = pollRun(scene, settings, hud);
                }
            });
        };

        const scene = new CityScene(gl, city, settings, { onTrafficChange: restart });
        scene.setupUI();
        scene.draw(0);
        hud.clearStatus();
        poller = pollRun(scene, settings, hud);
    } catch (error) {
        console.error(error);
        hud.showStatus(errorText(error), 'error');
    }
}

void main();
