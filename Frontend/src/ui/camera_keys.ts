/*
 * Keyboard state for the camera, fixing three problems of the course Camera3D,
 * which stores `keysPressed[event.key]` and only acts while a key is held:
 *   - "+" is Shift+"=" on many layouts. Releasing Shift first makes the keyup report
 *     "=", so "+" stayed pressed forever; keys are matched by physical `code` here.
 *   - A tap that starts and ends between two animation frames was never seen; a
 *     press now always counts for at least one frame.
 *   - Keys held while the window lost focus never got a keyup; blur clears them.
 * Pure (no DOM), so it is unit-tested; render/city_camera.ts wires it to the window.
 */

export type CameraAction =
    | 'rotateLeft' | 'rotateRight' | 'rotateUp' | 'rotateDown'
    | 'panLeft' | 'panRight' | 'panUp' | 'panDown'
    | 'zoomIn' | 'zoomOut';

// Physical key codes, so Shift, Caps Lock and the keyboard layout do not matter.
const ACTIONS_BY_CODE: Readonly<Record<string, CameraAction>> = {
    ArrowLeft: 'rotateLeft',
    ArrowRight: 'rotateRight',
    ArrowUp: 'rotateUp',
    ArrowDown: 'rotateDown',
    KeyA: 'panLeft',
    KeyD: 'panRight',
    KeyW: 'panUp',
    KeyS: 'panDown',
    Equal: 'zoomIn',
    NumpadAdd: 'zoomIn',
    Minus: 'zoomOut',
    NumpadSubtract: 'zoomOut',
};

// Layouts where "+" or "-" has its own key (e.g. Spanish) report other codes.
const ACTIONS_BY_KEY: Readonly<Record<string, CameraAction>> = {
    '+': 'zoomIn',
    '-': 'zoomOut',
};

export function cameraAction(code: string, key: string): CameraAction | undefined {
    return ACTIONS_BY_CODE[code] ?? ACTIONS_BY_KEY[key];
}

export class CameraKeys {
    // Physical keys down right now, with the action each one drives
    private readonly held = new Map<string, CameraAction>();
    // Pressed since the last frame, even if already released
    private readonly tapped = new Set<CameraAction>();

    press(code: string, key: string): boolean {
        const action = cameraAction(code, key);
        if (!action) {
            return false;
        }
        this.held.set(code || key, action);
        this.tapped.add(action);
        return true;
    }

    release(code: string, key: string): void {
        this.held.delete(code || key);
    }

    releaseAll(): void {
        this.held.clear();
        this.tapped.clear();
    }

    // The actions to apply this frame; call once per frame.
    takeFrame(): ReadonlySet<CameraAction> {
        const active = new Set<CameraAction>([...this.held.values(), ...this.tapped]);
        this.tapped.clear();
        return active;
    }
}
