/*
 * The WebGL scene: static city meshes built once, vehicles interpolated every
 * animation frame between the last two /step frames.
 */

import * as twgl from 'twgl-base.js';
import { M4, type Mat4 } from '../../libs/3d-lib';
import { Camera3D } from '../../libs/camera3d';
import { Scene } from '../../libs/scene_multi_shader';
import type { CityData, LightState } from '../api/contract';
import { buildCityLayout, type CityLayout } from '../world/city_layout';
import type { DrawItem } from '../world/draw_item';
import { frameAlpha } from '../world/interpolation';
import { lampColor, PALETTE } from '../world/palette';
import { vehiclesDrawItems } from '../world/vehicle_items';
import { EMPTY_VEHICLES, type VehicleMap } from '../world/vehicle_sync';
import { createControls, type SimSettings } from '../ui/controls';
import { boxArrays, wheelArrays } from './geometry';
import vsFlatGLSL from '../../assets/shaders/vs_flat.glsl?raw';
import fsFlatGLSL from '../../assets/shaders/fs_flat.glsl?raw';

const LIGHT_DIRECTION = [-0.4, -1, -0.6];
const AMBIENT = [0.32, 0.3, 0.45, 1];
const CAMERA_AZIMUTH = 0.6;
const CAMERA_ELEVATION = 0.95;
const CAMERA_DISTANCE_FACTOR = 1.05;

export class CityScene extends Scene {
    private readonly settings: SimSettings;
    private readonly layout: CityLayout;
    private readonly view: Camera3D;
    private vehicles: VehicleMap = EMPTY_VEHICLES;
    private lightGreen: ReadonlyMap<string, boolean> = new Map();
    private frameReceivedAt = 0;

    constructor(gl: WebGL2RenderingContext, city: CityData, settings: SimSettings) {
        super(gl, { flat: { vs: vsFlatGLSL, fs: fsFlatGLSL } });
        this.settings = settings;
        this.layout = buildCityLayout(city);
        this.addObject('box', 'flat', boxArrays(), PALETTE.road);
        this.addObject('wheel', 'flat', wheelArrays(), PALETTE.wheel);

        const [cx, cy, cz] = this.layout.center;
        this.view = new Camera3D(0, this.layout.extent * CAMERA_DISTANCE_FACTOR,
            CAMERA_AZIMUTH, CAMERA_ELEVATION, [cx, cy, cz], [cx, cy, cz]);
        this.view.setupControls();
    }

    // Called once per /step frame; vehicles interpolate from this moment on.
    showFrame(vehicles: VehicleMap, lights: readonly LightState[], receivedAt: number): void {
        this.vehicles = vehicles;
        this.lightGreen = new Map(lights.map((light) => [light.id, light.green]));
        this.frameReceivedAt = receivedAt;
    }

    setupUI(): void {
        createControls(this.settings);
    }

    protected render(_deltaTime: number): void {
        const { gl } = this;
        twgl.resizeCanvasToDisplaySize(gl.canvas as HTMLCanvasElement);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        const [r, g, b] = PALETTE.background;
        gl.clearColor(r, g, b, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);

        const program = this.getProgram('flat');
        gl.useProgram(program.program);
        twgl.setUniforms(program, { u_lightDirection: LIGHT_DIRECTION, u_ambientColor: AMBIENT });

        this.view.checkKeys();
        const viewProjection = this.view.setupViewProjection(gl);
        const alpha = frameAlpha(performance.now() - this.frameReceivedAt, this.settings.stepIntervalMs);

        for (const item of this.layout.statics) {
            this.drawItem(item, viewProjection);
        }
        for (const item of this.lampItems()) {
            this.drawItem(item, viewProjection);
        }
        for (const item of vehiclesDrawItems(this.vehicles, alpha)) {
            this.drawItem(item, viewProjection);
        }
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

    private drawItem(item: DrawItem, viewProjection: Mat4): void {
        this.drawObject(item.shape, {
            u_worldViewProjection: M4.multiply(viewProjection, item.world),
            u_worldInverseTransform: item.normal,
            u_color: item.color,
            u_emissive: item.emissive,
        });
    }
}
