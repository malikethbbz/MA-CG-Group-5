/*
 * Urban mobility: draws the city of the traffic server with WebGL and moves the
 * cars, motorcycles and ambulances smoothly between /step frames.
 * Built on the course base project (random_agents.ts) by Gilberto Echeverria.
 *
 * Requires the server running: Backend/city_server.py on http://localhost:8585/
 *
 * Team 5 - TC2008B
 * 2026-11
 */

'use strict';

import * as twgl from 'twgl-base.js';
import GUI from 'lil-gui';
import { M4, type Mat4 } from '../libs/3d-lib';
import type { Color } from '../libs/color';
import { Light3D } from '../libs/light3d';
import { Scene } from '../libs/scene_multi_shader';
import { cubeFaceColors } from '../libs/shapes';
import { getCity, getStep, initModel, type StepFrame } from './api_connection';
import { CityCamera } from './camera';
import { buildCity, streetArrays, type CityLayout, type DrawItem } from './city';
import { COLORS, MAP, RETRY_DELAY_MS } from './config';
import { Hud } from './hud';
import { frameAlpha, syncVehicles, vehicleItems, vehiclePose, type TrackedVehicle } from './vehicles';

// Define the shader code, using GLSL 3.00
import vsPhongGLSL from '../assets/shaders/vs_phong.glsl?raw';
import fsPhongGLSL from '../assets/shaders/fs_phong.glsl?raw';
import fsStreetGLSL from '../assets/shaders/fs_street.glsl?raw';

// The street model and its texture (Free3D "80-street")
import streetObj from '../assets/models/street/street.obj?raw';
import streetTextureUrl from '../assets/models/street/street.jpg';

// Initial view: the whole city, seen from the south-east and a bit above
const CAMERA_AZIMUTH = 0.6;
const CAMERA_ELEVATION = 0.6;
const CAMERA_DISTANCE_FACTOR = 0.8;
const SPECULAR: Color = [0.3, 0.3, 0.3, 1];
const SHININESS = 40;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class CityScene extends Scene {

    // Variable for the scene settings, changed from the GUI
    settings = {
        stepIntervalMs: 400,
        spawnInterval: 10,
        carsPerSpawn: 4,
        ambulances: 2,
        emergencyChance: 1.0,
        map: MAP,
    };

    camera = new CityCamera(30, CAMERA_AZIMUTH, CAMERA_ELEVATION, [0, 0, 0], 36);
    hud = new Hud();
    city: CityLayout | null = null;
    vehicles = new Map<string, TrackedVehicle>();
    lightGreen = new Map<string, boolean>();
    // Ids of the lights showing yellow (only the ones around the glorieta have it)
    lightYellow = new Set<string>();
    // Id of the vehicle the camera follows, if any
    following: string | null = null;

    // Polling /step: when the last frame arrived and whether a request is on its way.
    // runId changes on every restart, so an answer for an older run is ignored.
    running = false;
    waiting = false;
    elapsed = 0;
    frameTime = 0;
    runId = 0;

    constructor(gl: WebGL2RenderingContext) {
        super(gl, {
            phong: { vs: vsPhongGLSL, fs: fsPhongGLSL },
            street: { vs: vsPhongGLSL, fs: fsStreetGLSL },
        });

        // Every piece of the city is a copy of one of these two objects
        this.addObject('box', 'phong', cubeFaceColors(0.5), COLORS.ground);
        const street = this.addObject('street', 'street', streetArrays(streetObj), COLORS.ground);
        street.texture = twgl.createTexture(gl, {
            src: streetTextureUrl,
            flipY: 1,
            min: gl.LINEAR_MIPMAP_LINEAR,
            mag: gl.LINEAR,
        });

        // The moon: a pinkish light high above the city, with a violet ambient
        this.addLight('main', new Light3D(
            0,                          // ID
            [30, 40, 35],               // Position
            [0.45, 0.4, 0.65, 1.0],     // Ambient
            [0.85, 0.7, 0.85, 1.0],     // Diffuse
            [0.6, 0.5, 0.6, 1.0],       // Specular
        ));

        this.camera.setupControls();
    }

    // The settings sent to /init; stepIntervalMs is only used here
    runOptions() {
        const { stepIntervalMs: _, ...options } = this.settings;
        return options;
    }

    // Creates the model and loads the city, trying again until the server answers
    async connect(): Promise<void> {
        for (let attempt = 1; ; attempt++) {
            try {
                this.hud.showStatus('Conectando con el servidor...', 'info');
                await initModel(this.runOptions());
                this.city = buildCity(await getCity());
                this.camera.maxDistance = 1.6 * this.city.size;
                this.resetCamera();
                this.running = true;
                this.hud.clearStatus();
                return;
            } catch (error) {
                console.error(error);
                this.hud.showStatus(`${errorText(error)} Reintentando (intento ${attempt})...`, 'error');
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    // "Reiniciar simulación": a new model with the current GUI values
    async restart(): Promise<void> {
        const run = ++this.runId;
        const wasRunning = this.running;
        this.running = false;
        this.hud.showStatus('Reiniciando la simulación...', 'info');
        let restarted = false;
        try {
            await initModel(this.runOptions());
            this.vehicles = new Map();
            this.lightGreen = new Map();
            this.lightYellow = new Set();
            this.following = null;
            this.hud.clearStatus();
            restarted = true;
        } catch (error) {
            // The server keeps its current model, so the current run goes on
            console.error(error);
            this.hud.showStatus(`No se pudo reiniciar: ${errorText(error)}`, 'error', 5000);
        }
        if (run === this.runId) {
            this.running = restarted || wasRunning;
            this.waiting = false;
            this.elapsed = 0;
        }
    }

    // Requests the next step; the answer replaces the vehicles and the lights
    async update(): Promise<void> {
        const run = this.runId;
        this.waiting = true;
        try {
            const frame = await getStep();
            if (run === this.runId) {
                this.showFrame(frame);
            }
        } catch (error) {
            console.error(error);
            this.hud.showStatus(`${errorText(error)} Reintentando...`, 'error');
        } finally {
            if (run === this.runId) {
                this.waiting = false;
            }
        }
    }

    showFrame(frame: StepFrame): void {
        this.vehicles = syncVehicles(this.vehicles, frame.vehicles);
        this.lightGreen = new Map(frame.lights.map((light) => [light.id, light.green]));
        this.lightYellow = new Set(frame.lights.filter((light) => light.yellow).map((light) => light.id));
        this.frameTime = performance.now();
        this.hud.showStats(frame.stats);
        if (frame.running) {
            this.hud.clearStatus();
        } else {
            this.running = false;
            const reason = frame.stats.stopReason ? `: ${frame.stats.stopReason}` : '';
            this.hud.showStatus(`La simulación terminó en el paso ${frame.step}${reason}.`, 'done');
        }
    }

    // Follows a random vehicle of a kind; `onMission` only picks ambulances on a call
    follow(kind: string, onMission = false): void {
        const choices = [...this.vehicles.values()]
            .filter((vehicle) => vehicle.kind === kind && (!onMission || vehicle.state !== 'idle'));
        if (choices.length === 0) {
            this.hud.showStatus('No hay ningún vehículo así ahora mismo.', 'info', 2500);
            return;
        }
        this.following = choices[Math.floor(Math.random() * choices.length)].id;
    }

    centerCamera(): void {
        if (this.city) {
            const [x, y, z] = this.city.center;
            this.camera.target = { x, y, z };
        }
        this.camera.panOffset = [0, 0, 0];
        this.following = null;
    }

    resetCamera(): void {
        this.centerCamera();
        this.camera.azimuth = CAMERA_AZIMUTH;
        this.camera.elevation = CAMERA_ELEVATION;
        this.camera.distance = CAMERA_DISTANCE_FACTOR * (this.city ? this.city.size : 36);
    }

    prepareObject(item: DrawItem, viewProjectionMatrix: Mat4): void {
        // The world matrix of every piece was built once, as T * R * S
        const uniforms = {
            u_world: item.world,
            u_worldViewProjection: M4.multiply(viewProjectionMatrix, item.world),
            u_worldInverseTransform: item.normal,
            u_ambientColor: item.color,
            u_diffuseColor: item.color,
            u_specularColor: SPECULAR,
            u_shininess: SHININESS,
            u_emissive: item.emissive,
            u_texBand: item.band ?? [0, 1],
            u_texture: this.getObject('street').texture,
        };
        this.drawObject(item.shape, uniforms);
    }

    // Function to do the actual display of the scene
    render(deltaTime: number): void {
        const { gl } = this;

        // Match the canvas to its size on the page, so the aspect is right after a resize
        twgl.resizeCanvasToDisplaySize(gl.canvas as HTMLCanvasElement);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.clearColor(COLORS.background[0], COLORS.background[1], COLORS.background[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);

        const now = performance.now();
        const alpha = frameAlpha(now - this.frameTime, this.settings.stepIntervalMs);
        this.moveFollowCamera(alpha);

        // Scene uniforms, set for all the programs used
        const light = this.getLight('main');
        const globalUniforms = {
            u_viewWorldPosition: this.camera.posArray,
            u_lightWorldPosition: light.posArray,
            u_ambientLight: light.ambient,
            u_diffuseLight: light.diffuse,
            u_specularLight: light.specular,
        };
        for (const program of this.programs.values()) {
            gl.useProgram(program.program);
            twgl.setUniforms(program, globalUniforms);
        }

        // Check for camera keys and update the camera position
        this.camera.checkKeys();
        const viewProjectionMatrix = this.camera.setupViewProjection(gl);

        this.renderCity(viewProjectionMatrix);
        for (const vehicle of this.vehicles.values()) {
            for (const item of vehicleItems(vehicle, alpha, now)) {
                this.prepareObject(item, viewProjectionMatrix);
            }
        }

        // Ask for the next step once the step duration has passed
        this.elapsed += deltaTime;
        if (this.running && !this.waiting && this.elapsed >= this.settings.stepIntervalMs) {
            this.elapsed = 0;
            void this.update();
        }
    }

    renderCity(viewProjectionMatrix: Mat4): void {
        if (!this.city) {
            return;
        }
        for (const item of this.city.statics) {
            this.prepareObject(item, viewProjectionMatrix);
        }
        // Traffic lights take their color from the last step; unlit until it arrives
        for (const [id, lamp] of this.city.lamps) {
            const green = this.lightGreen.get(id);
            let color = green === undefined ? COLORS.lightPole : green ? COLORS.lightGreen : COLORS.lightRed;
            if (this.lightYellow.has(id)) {
                color = COLORS.lightYellow;
            }
            this.prepareObject({ ...lamp, color }, viewProjectionMatrix);
        }
    }

    // While following, the camera looks at the vehicle; it stops when the vehicle leaves
    moveFollowCamera(alpha: number): void {
        if (this.following === null) {
            return;
        }
        const vehicle = this.vehicles.get(this.following);
        if (!vehicle) {
            this.following = null;
            return;
        }
        const pose = vehiclePose(vehicle, alpha);
        this.camera.target = { x: pose.x, y: pose.y, z: pose.z };
        this.camera.panOffset = [0, 0, 0];
    }

    // Setup UI controls for the simulation, the camera and the light
    setupUI(): void {
        const gui = new GUI({ title: 'Controles' });
        const actions = {
            restart: () => void this.restart(),
            followCar: () => this.follow('car'),
            followAmbulance: () => this.follow('ambulance'),
            followEmergency: () => this.follow('ambulance', true),
            stopFollowing: () => { this.following = null; },
            resetCamera: () => this.resetCamera(),
            centerCamera: () => this.centerCamera(),
        };

        // The sliders take effect on "Reiniciar simulación"; the step duration right away
        const simFolder = gui.addFolder('Simulación');
        simFolder.add(this.settings, 'stepIntervalMs', 100, 2000, 50).name('Duración del paso (ms)');
        simFolder.add(this.settings, 'spawnInterval', 1, 10, 1).name('Tasa de aparición (pasos)');
        simFolder.add(this.settings, 'carsPerSpawn', 1, 4, 1).name('Vehículos por paso');
        simFolder.add(this.settings, 'ambulances', 0, 2, 1).name('Ambulancias');
        simFolder.add(this.settings, 'emergencyChance', 0, 1, 0.1).name('Prob. de emergencia');
        simFolder.add(actions, 'restart').name('Reiniciar simulación');

        // listen() keeps the sliders in step with the camera keys
        const camera = this.camera;
        const cameraFolder = gui.addFolder('Cámara').close();
        cameraFolder.add(camera, 'distance', 3, camera.maxDistance).name('Distancia').listen();
        cameraFolder.add(camera, 'elevation', camera.minElevation, camera.maxElevation).name('Elevación').listen();
        cameraFolder.add(camera, 'azimuth', -Math.PI, Math.PI).name('Azimut').listen();

        const light = this.getLight('main');
        const lightFolder = gui.addFolder('Luz').close();
        lightFolder.add(light.position, 'x', -20, 60).name('Posición x');
        lightFolder.add(light.position, 'y', 0, 80).name('Posición y');
        lightFolder.add(light.position, 'z', -20, 60).name('Posición z');
        lightFolder.addColor(light, 'ambient').name('Ambiental');
        lightFolder.addColor(light, 'diffuse').name('Difusa');
        lightFolder.addColor(light, 'specular').name('Especular');

        const actionsFolder = gui.addFolder('Acciones');
        actionsFolder.add(actions, 'followCar').name('Seguir carro aleatorio');
        actionsFolder.add(actions, 'followAmbulance').name('Seguir ambulancia aleatoria');
        actionsFolder.add(actions, 'followEmergency').name('Seguir ambulancia en emergencia');
        actionsFolder.add(actions, 'stopFollowing').name('Dejar de seguir');
        actionsFolder.add(actions, 'resetCamera').name('Reiniciar cámara');
        actionsFolder.add(actions, 'centerCamera').name('Centrar cámara');
    }
}

/*
 * Main function to initialize the WebGL context, create the scene, and set up the UI.
 */
async function main(): Promise<void> {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    if (!gl) {
        new Hud().showStatus('Este navegador no soporta WebGL2.', 'error');
        return;
    }

    const scene = new CityScene(gl);
    await scene.connect();
    scene.setupUI();
    scene.draw(0);
}

main();
