/*
 * The course Camera3D with keyboard handling that works for every key:
 *   arrows rotate, W A S D pan, + / - zoom (= and the numpad work too)
 * Keys are read by their physical `code`, so "+" (Shift + "=") is released even if
 * Shift goes up first; a quick tap between two frames still counts once; and
 * losing focus releases everything. Zoom reaches street level, and panning never
 * takes the camera under the ground.
 *
 * Team 5 - TC2008B
 * 2026-11
 */

import { Camera3D } from '../libs/camera3d';

type Move = (camera: CityCamera) => void;

const ROTATE_LEFT: Move = (c) => c.rotate(-1, 0);
const ROTATE_RIGHT: Move = (c) => c.rotate(1, 0);
const ROTATE_UP: Move = (c) => c.rotate(0, 1);
const ROTATE_DOWN: Move = (c) => c.rotate(0, -1);
const PAN_LEFT: Move = (c) => c.pan(1, 0);
const PAN_RIGHT: Move = (c) => c.pan(-1, 0);
const PAN_UP: Move = (c) => c.pan(0, 1);
const PAN_DOWN: Move = (c) => c.pan(0, -1);
export const ZOOM_IN: Move = (c) => c.zoom(-1);
export const ZOOM_OUT: Move = (c) => c.zoom(1);

// Physical key codes, so Shift, Caps Lock and the keyboard layout do not matter
const MOVES_BY_CODE: Record<string, Move> = {
    ArrowLeft: ROTATE_LEFT, ArrowRight: ROTATE_RIGHT, ArrowUp: ROTATE_UP, ArrowDown: ROTATE_DOWN,
    KeyA: PAN_LEFT, KeyD: PAN_RIGHT, KeyW: PAN_UP, KeyS: PAN_DOWN,
    Equal: ZOOM_IN, NumpadAdd: ZOOM_IN, Minus: ZOOM_OUT, NumpadSubtract: ZOOM_OUT,
};

// Layouts where "+" or "-" has its own key (e.g. Spanish) report other codes
const MOVES_BY_KEY: Record<string, Move> = { '+': ZOOM_IN, '-': ZOOM_OUT };

export function cameraMove(code: string, key: string): Move | undefined {
    return MOVES_BY_CODE[code] ?? MOVES_BY_KEY[key];
}

export class CityCamera extends Camera3D {
    // Keys down right now, and moves pressed since the last frame (even if released)
    held = new Map<string, Move>();
    tapped = new Set<Move>();
    maxDistance: number;

    constructor(distance: number, azimuth: number, elevation: number, target: number[], cityExtent: number) {
        super(0, distance, azimuth, elevation, target, target);
        this.zoomSpeed = 0.6;
        this.panSpeed = 0.2;
        this.maxDistance = 1.6 * cityExtent;
    }

    // Returns whether the key moves the camera, so the page does not scroll with it
    press(code: string, key: string): boolean {
        const move = cameraMove(code, key);
        if (move) {
            this.held.set(code || key, move);
            this.tapped.add(move);
        }
        return move !== undefined;
    }

    release(code: string, key: string): void {
        this.held.delete(code || key);
    }

    override setupControls(): void {
        window.addEventListener('keydown', (event) => {
            if (this.press(event.code, event.key)) {
                event.preventDefault();
            }
        });
        window.addEventListener('keyup', (event) => this.release(event.code, event.key));
        window.addEventListener('blur', () => this.held.clear());
    }

    override checkKeys(): void {
        for (const move of new Set([...this.held.values(), ...this.tapped])) {
            move(this);
        }
        this.tapped.clear();
    }

    // Keeps the azimuth in [-PI, PI], so the GUI slider can show it
    override rotate(deltaAzimuth: number, deltaElevation: number): void {
        super.rotate(deltaAzimuth, deltaElevation);
        this.azimuth = Math.atan2(Math.sin(this.azimuth), Math.cos(this.azimuth));
    }

    // The point looked at never sinks below the ground
    override pan(deltaX: number, deltaY: number): void {
        super.pan(deltaX, deltaY);
        this.panOffset[1] = Math.max(-this.target.y, this.panOffset[1]);
    }

    override zoom(delta: number): void {
        this.distance = Math.max(3, Math.min(this.maxDistance, this.distance + delta * this.zoomSpeed));
    }
}
