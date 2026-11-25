/*
 * The course Camera3D with keyboard handling that works for "+" in Chrome (see
 * ui/camera_keys.ts), zoom limits sized to the city instead of a fixed 10..50 so the
 * camera can come down to street level, and a pan that cannot go under the ground.
 */

import { Camera3D } from '../../libs/camera3d';
import { CameraKeys, type CameraAction } from '../ui/camera_keys';

// Distance change per frame while a zoom key is held
const ZOOM_STEP = 0.6;
// Pan per frame while a key is held; the course default (0.5) crossed the map in a second
const PAN_STEP = 0.2;
const MIN_DISTANCE = 3;
const MAX_DISTANCE_FACTOR = 1.6;

type Move = (camera: Camera3D) => void;

const MOVES: Readonly<Record<CameraAction, Move>> = {
    rotateLeft: (c) => c.rotate(-1, 0),
    rotateRight: (c) => c.rotate(1, 0),
    rotateUp: (c) => c.rotate(0, 1),
    rotateDown: (c) => c.rotate(0, -1),
    panLeft: (c) => c.pan(1, 0),
    panRight: (c) => c.pan(-1, 0),
    panUp: (c) => c.pan(0, 1),
    panDown: (c) => c.pan(0, -1),
    zoomIn: (c) => c.zoom(-1),
    zoomOut: (c) => c.zoom(1),
};

export class CityCamera extends Camera3D {
    private readonly keys = new CameraKeys();
    private readonly maxDistance: number;

    constructor(distance: number, azimuth: number, elevation: number, target: number[], extent: number) {
        super(0, distance, azimuth, elevation, target, target);
        this.zoomSpeed = ZOOM_STEP;
        this.panSpeed = PAN_STEP;
        this.maxDistance = extent * MAX_DISTANCE_FACTOR;
    }

    override setupControls(): void {
        window.addEventListener('keydown', (event) => {
            if (this.keys.press(event.code, event.key)) {
                event.preventDefault();
            }
        });
        window.addEventListener('keyup', (event) => this.keys.release(event.code, event.key));
        window.addEventListener('blur', () => this.keys.releaseAll());
    }

    override checkKeys(): void {
        for (const action of this.keys.takeFrame()) {
            MOVES[action](this);
        }
    }

    // W/S pan along the up axis; the point looked at never sinks below the ground,
    // which used to put the camera under the city.
    override pan(deltaX: number, deltaY: number): void {
        super.pan(deltaX, deltaY);
        this.panOffset[1] = Math.max(-this.target.y, this.panOffset[1]);
    }

    override zoom(delta: number): void {
        const next = this.distance + delta * this.zoomSpeed;
        this.distance = Math.max(MIN_DISTANCE, Math.min(this.maxDistance, next));
    }
}
