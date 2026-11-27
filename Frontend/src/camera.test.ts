import { describe, expect, it } from 'vitest';
import { cameraMove, CityCamera, ZOOM_IN, ZOOM_OUT } from './camera';

const camera = () => new CityCamera(20, 0.6, 0.4, [10, 2, 10], 36);

describe('camera keys', () => {
    it('zooms in on "+" whether it is typed with Shift, on the numpad, or on its own key', () => {
        expect(cameraMove('Equal', '+')).toBe(ZOOM_IN);
        expect(cameraMove('Equal', '=')).toBe(ZOOM_IN);
        expect(cameraMove('NumpadAdd', '+')).toBe(ZOOM_IN);
        // Spanish layout: "+" has its own key next to Enter
        expect(cameraMove('BracketRight', '+')).toBe(ZOOM_IN);
        expect(cameraMove('Minus', '-')).toBe(ZOOM_OUT);
        expect(cameraMove('KeyQ', 'q')).toBeUndefined();
    });

    it('releases "+" when Shift is let go before the key (keyup reports "=")', () => {
        const c = camera();
        c.press('Equal', '+');
        c.release('Equal', '=');
        c.checkKeys();
        const distance = c.distance;
        c.checkKeys();
        expect(c.distance).toBe(distance);
    });

    it('applies a tap that starts and ends between two frames exactly once', () => {
        const c = camera();
        c.press('Equal', '=');
        c.release('Equal', '=');
        c.checkKeys();
        expect(c.distance).toBeCloseTo(20 - c.zoomSpeed);
        c.checkKeys();
        expect(c.distance).toBeCloseTo(20 - c.zoomSpeed);
    });

    it('keeps applying a held key on every frame, and nothing after losing focus', () => {
        const c = camera();
        expect(c.press('ArrowLeft', 'ArrowLeft')).toBe(true);
        expect(c.press('Tab', 'Tab')).toBe(false);
        c.checkKeys();
        c.checkKeys();
        expect(c.azimuth).toBeCloseTo(0.6 - 2 * c.rotationSpeed);
        c.held.clear();
        c.checkKeys();
        expect(c.azimuth).toBeCloseTo(0.6 - 2 * c.rotationSpeed);
    });
});

describe('CityCamera', () => {
    it('never pans the point it looks at below the ground', () => {
        const c = camera();
        for (let frame = 0; frame < 500; frame++) {
            c.pan(0, -1);
        }
        expect(c.targetArray[1]).toBeCloseTo(0);
        expect(c.posArray[1]).toBeGreaterThan(0);
    });

    it('zooms between street level and a bit past the whole map', () => {
        const c = camera();
        for (let frame = 0; frame < 500; frame++) {
            c.zoom(-1);
        }
        expect(c.distance).toBeLessThan(5);
        for (let frame = 0; frame < 500; frame++) {
            c.zoom(1);
        }
        expect(c.distance).toBeGreaterThan(36);
        expect(c.distance).toBeLessThan(60);
    });

    it('keeps the azimuth between -PI and PI however long it rotates, for the GUI slider', () => {
        const c = new CityCamera(20, 3.1, 0.4, [0, 0, 0], 36);
        for (let frame = 0; frame < 1000; frame++) {
            c.rotate(1, 0);
            expect(Math.abs(c.azimuth)).toBeLessThanOrEqual(Math.PI);
        }
        const turned = 3.1 + 1000 * c.rotationSpeed;
        expect(Math.cos(c.azimuth)).toBeCloseTo(Math.cos(turned));
        expect(Math.sin(c.azimuth)).toBeCloseTo(Math.sin(turned));
    });
});
