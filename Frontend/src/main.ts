/*
 * Entry point: /init -> /city -> poll /step, drawing the city with WebGL.
 * Changing the traffic or spawn points re-inits the model and keeps the city on screen.
 * Requires Backend/city_server.py running on http://localhost:8585/.
 */

import { fetchCity, fetchStep, initModel } from './api/client';
import type { CityData, StepFrame } from './api/contract';
import { RETRY_DELAY_MS } from './config';
import { CityScene } from './render/city_scene';
import { startPolling, type Poller } from './sim/poller';
import { createRestarter } from './sim/restarter';
import { retryUntilOk } from './sim/retry';
import { initOptions, isClientError, type RunOptions } from './sim/run_options';
import { defaultSettings, type SimSettings } from './ui/controls';
import { createHud, type Hud } from './ui/hud';
import { EMPTY_SIRENS, syncSirens, type SirenMap } from './world/siren';
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

// Retries until the server answers; a refusal (4xx) is thrown to the caller.
function initWith(run: RunOptions, hud: Hud): Promise<void> {
    const init = () => initModel(initOptions(run));
    return retryUntilOk(init, retryReporter(hud), RETRY_DELAY_MS, undefined, (error) => !isClientError(error));
}

async function loadCity(settings: SimSettings, hud: Hud): Promise<CityData> {
    hud.showStatus('Connecting to the simulation server...', 'info');
    await initWith(runOptions(settings), hud);
    return retryUntilOk(fetchCity, retryReporter(hud), RETRY_DELAY_MS);
}

function finishedMessage(frame: StepFrame): string {
    const reason = frame.stats.stopReason ? `: ${frame.stats.stopReason}` : '';
    return `Simulation finished at step ${frame.step}${reason}.`;
}

// One /step polling run; a run-option change stops it and starts a new one.
function pollRun(scene: CityScene, settings: SimSettings, hud: Hud): Poller {
    let vehicles: VehicleMap = EMPTY_VEHICLES;
    let sirens: SirenMap = EMPTY_SIRENS;
    scene.showFrame(vehicles, sirens, [], performance.now());
    return startPolling({
        fetchStep,
        intervalMs: () => settings.stepIntervalMs,
        retryDelayMs: RETRY_DELAY_MS,
        onFrame: (frame) => {
            vehicles = syncVehicles(vehicles, frame.vehicles).vehicles;
            sirens = syncSirens(sirens, vehicles);
            scene.showFrame(vehicles, sirens, frame.lights, performance.now());
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

// How long a refused-setting message stays up, even as frames keep arriving
const REFUSED_NOTICE_MS = 6000;

function runOptions(settings: SimSettings): RunOptions {
    return { spawnInterval: settings.spawnInterval, spawnPoints: settings.spawnPoints };
}

async function main(): Promise<void> {
    const hud = createHud();
    try {
        const gl = webglContext();
        const settings = defaultSettings();
        const city = await loadCity(settings, hud);
        let poller: Poller | null = null;

        const restarter = createRestarter({
            wanted: () => runOptions(settings),
            init: (run) => initWith(run, hud),
            stopRun: () => {
                poller?.stop();
                hud.showStatus('Restarting the simulation with the new settings...', 'info');
            },
            startRun: () => {
                poller = pollRun(scene, settings, hud);
            },
            onRefused: (error, kept) => {
                console.error(error);
                settings.spawnInterval = kept.spawnInterval;
                settings.spawnPoints = kept.spawnPoints;
                scene.refreshControls();
                hud.showStatus(`The server refused that setting (${errorText(error)}). The current run continues.`,
                    'error', REFUSED_NOTICE_MS);
            },
            onFailed: (error) => {
                console.error(error);
                hud.showStatus(errorText(error), 'error');
            },
        }, runOptions(settings));

        const scene = new CityScene(gl, city, settings, { onRunOptionsChange: () => void restarter.restart() });
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
