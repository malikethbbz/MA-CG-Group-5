import { describe, expect, it } from 'vitest';
import { cameraAction, CameraKeys } from './camera_keys';

describe('cameraAction', () => {
    it('zooms in on "+" whether it is typed with Shift, on the numpad, or on its own key', () => {
        expect(cameraAction('Equal', '+')).toBe('zoomIn');
        expect(cameraAction('Equal', '=')).toBe('zoomIn');
        expect(cameraAction('NumpadAdd', '+')).toBe('zoomIn');
        // Spanish layout: "+" has its own key next to Enter
        expect(cameraAction('BracketRight', '+')).toBe('zoomIn');
        expect(cameraAction('Minus', '-')).toBe('zoomOut');
    });

    it('pans with W A S D even with Caps Lock or Shift on', () => {
        expect(cameraAction('KeyW', 'W')).toBe('panUp');
        expect(cameraAction('KeyA', 'a')).toBe('panLeft');
    });

    it('ignores keys the camera does not use', () => {
        expect(cameraAction('KeyQ', 'q')).toBeUndefined();
    });
});

describe('CameraKeys', () => {
    it('releases "+" when Shift is let go before the key (keyup reports "=")', () => {
        const keys = new CameraKeys();
        keys.press('Equal', '+');
        keys.release('Equal', '=');
        keys.takeFrame();
        expect(keys.takeFrame().size).toBe(0);
    });

    it('applies a tap that starts and ends between two frames exactly once', () => {
        const keys = new CameraKeys();
        keys.press('Equal', '=');
        keys.release('Equal', '=');
        expect([...keys.takeFrame()]).toEqual(['zoomIn']);
        expect(keys.takeFrame().size).toBe(0);
    });

    it('keeps applying a held key on every frame', () => {
        const keys = new CameraKeys();
        keys.press('ArrowLeft', 'ArrowLeft');
        expect(keys.takeFrame().has('rotateLeft')).toBe(true);
        expect(keys.takeFrame().has('rotateLeft')).toBe(true);
    });

    it('drops every held key when the window loses focus', () => {
        const keys = new CameraKeys();
        keys.press('KeyW', 'w');
        keys.press('Minus', '-');
        keys.releaseAll();
        expect(keys.takeFrame().size).toBe(0);
    });

    it('reports whether a key was a camera key, so only those are kept from the page', () => {
        const keys = new CameraKeys();
        expect(keys.press('ArrowUp', 'ArrowUp')).toBe(true);
        expect(keys.press('Tab', 'Tab')).toBe(false);
    });
});
