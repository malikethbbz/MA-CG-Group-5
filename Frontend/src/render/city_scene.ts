/*
 * The WebGL scene: a procedural sky pass, then the static city meshes built once,
 * then vehicles interpolated every animation frame between the last two /step frames.
 */

import * as twgl from 'twgl-base.js';
import type GUI from 'lil-gui';
import { Scene } from '../../libs/scene_multi_shader';
import type { CityData, LightState } from '../api/contract';
import { CELL_SIZE } from '../config';
import { buildCityLayout, type CityLayout } from '../world/city_layout';
import type { DrawItem } from '../world/draw_item';
import { frameAlpha } from '../world/interpolation';
import { glorietaUniforms } from '../world/glorieta';
import { markingUniforms } from '../world/road_markings';
import { lampColor, PALETTE, SKY } from '../world/palette';
import { PedestrianCrowd } from '../world/pedestrian_crowd';
import { spawnWalkers } from '../world/pedestrians';
import { STAR_COUNT } from '../world/sky';
import { vehiclesDrawItems } from '../world/vehicle_items';
import { EMPTY_VEHICLES, type VehicleMap } from '../world/vehicle_sync';
import { createControls, type ControlHandlers, type SimSettings } from '../ui/controls';
import { SirenAudio } from '../audio/siren_audio';
import { activeSirenSources, sirenGains } from '../audio/siren_mix';
import { EMPTY_SIRENS, type SirenMap } from '../world/siren';
import { fogUniforms, skyUniforms, withDefines } from './atmosphere';
import { CityCamera } from './city_camera';
import { boxArrays, screenTriangleArrays, wheelArrays } from './geometry';
import vsFlatGLSL from '../../assets/shaders/vs_flat.glsl?raw';
import fsFlatGLSL from '../../assets/shaders/fs_flat.glsl?raw';
import vsSkyGLSL from '../../assets/shaders/vs_sky.glsl?raw';
import fsSkyGLSL from '../../assets/shaders/fs_sky.glsl?raw';

const LIGHT_DIRECTION = [-0.4, -1, -0.6];
// A pink key light and a violet ambient, to match the sky
const LIGHT_COLOR = [0.95, 0.72, 0.9];
const AMBIENT = [0.36, 0.28, 0.55, 1];
const CAMERA_AZIMUTH = 0.6;
const CAMERA_ELEVATION = 0.38;
// Looking at a point above the ground lifts the horizon into view, so the sky shows
const CAMERA_TARGET_LIFT = 2;
const CAMERA_DISTANCE_FACTOR = 0.55;

// What the page provides; the scene handles the sound toggle itself.
export type SceneHandlers = Omit<ControlHandlers, 'onSoundChange'>;

export class CityScene extends Scene {
    private readonly settings: SimSettings;
    private readonly handlers: SceneHandlers;
    private readonly audio = new SirenAudio();
    private readonly layout: CityLayout;
    private readonly view: CityCamera;
    private readonly crowd: PedestrianCrowd;
    private vehicles: VehicleMap = EMPTY_VEHICLES;
    private sirens: SirenMap = EMPTY_SIRENS;
    private lightGreen: ReadonlyMap<string, boolean> = new Map();
    private frameReceivedAt = 0;
    private gui: GUI | null = null;

    constructor(gl: WebGL2RenderingContext, city: CityData, settings: SimSettings, handlers: SceneHandlers) {
        super(gl, {
            flat: { vs: vsFlatGLSL, fs: fsFlatGLSL },
            sky: { vs: vsSkyGLSL, fs: withDefines(fsSkyGLSL, { STAR_COUNT }) },
        });
        this.settings = settings;
        this.handlers = handlers;
        this.layout = buildCityLayout(city);
        this.crowd = new PedestrianCrowd(spawnWalkers(this.layout.walks));
        this.addObject('sky', 'sky', screenTriangleArrays(), SKY.horizon);
        this.addObject('box', 'flat', boxArrays(), PALETTE.road);
        this.addObject('wheel', 'flat', wheelArrays(), PALETTE.wheel);

        const [cx, cy, cz] = this.layout.center;
        const target = [cx, cy + CAMERA_TARGET_LIFT * CELL_SIZE, cz];
        this.view = new CityCamera(this.layout.extent * CAMERA_DISTANCE_FACTOR,
            CAMERA_AZIMUTH, CAMERA_ELEVATION, target, this.layout.extent);
        this.view.setupControls();
    }

    // Called once per /step frame; vehicles interpolate from this moment on.
    showFrame(vehicles: VehicleMap, sirens: SirenMap, lights: readonly LightState[], receivedAt: number): void {
        this.vehicles = vehicles;
        this.sirens = sirens;
        this.lightGreen = new Map(lights.map((light) => [light.id, light.green]));
        this.frameReceivedAt = receivedAt;
    }

    setupUI(): void {
        this.gui = createControls(this.settings, {
            ...this.handlers,
            onSoundChange: (enabled) => this.audio.setEnabled(enabled),
        });
    }

    // Shows settings changed in code (e.g. reverted after the server refused them).
    refreshControls(): void {
        this.gui?.controllersRecursive().forEach((controller) => controller.updateDisplay());
    }

    protected render(_deltaTime: number): void {
        const { gl } = this;
        twgl.resizeCanvasToDisplaySize(gl.canvas as HTMLCanvasElement);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.view.checkKeys();
        const now = performance.now();
        const viewProjection = this.view.setupViewProjection(gl);

        // The sky covers every pixel, behind everything, so no clear color shows
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        this.drawObject('sky', skyUniforms(viewProjection, this.view.azimuth, now));

        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        const program = this.getProgram('flat');
        gl.useProgram(program.program);
        twgl.setUniforms(program, {
            u_lightDirection: LIGHT_DIRECTION,
            u_lightColor: LIGHT_COLOR,
            u_ambientColor: AMBIENT,
            u_viewProjection: viewProjection,
            u_windowColor: PALETTE.windowCyan.slice(0, 3),
            u_windowAltColor: PALETTE.windowPink.slice(0, 3),
            u_paintColor: PALETTE.paint.slice(0, 3),
            u_dividerColor: PALETTE.divider.slice(0, 3),
            ...glorietaUniforms(this.layout.glorieta),
            ...fogUniforms(this.view.posArray, this.view.distance, this.layout.extent),
        });

        const alpha = frameAlpha(now - this.frameReceivedAt, this.settings.stepIntervalMs);
        for (const item of this.layout.statics) {
            this.drawItem(item);
        }
        for (const item of this.lampItems()) {
            this.drawItem(item);
        }
        this.crowd.update(now);
        for (const item of this.crowd.items) {
            this.drawItem(item);
        }
        for (const item of vehiclesDrawItems(this.vehicles, alpha, this.sirens, now)) {
            this.drawItem(item);
        }
        const target = this.view.targetArray;
        const sources = activeSirenSources(this.vehicles, this.sirens, alpha, [target[0], target[1], target[2]]);
        this.audio.update(sirenGains(sources));
    }

    private lampItems(): DrawItem[] {
        return this.layout.lamps.map((lamp) => ({
            shape: 'box',
            world: lamp.world,
            normal: lamp.normal,
            color: lampColor(this.lightGreen.get(lamp.id)),
            emissive: 1,
        }));
    }

    private drawItem(item: DrawItem): void {
        this.drawObject(item.shape, {
            u_world: item.world,
            u_worldInverseTransform: item.normal,
            u_color: item.color,
            u_emissive: item.emissive,
            u_windows: item.windowSeed === undefined ? 0 : 1,
            u_windowSeed: item.windowSeed ?? 0,
            u_warp: item.unwarped === true ? 0 : 1,
            ...markingUniforms(item.marking),
        });
    }
}
