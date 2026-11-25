import { describe, expect, it } from 'vitest';
import { CityCamera } from './city_camera';

describe('CityCamera', () => {
    it('never pans the point it looks at below the ground', () => {
        const camera = new CityCamera(20, 0.6, 0.4, [10, 2, 10], 36);
        for (let frame = 0; frame < 500; frame++) {
            camera.pan(0, -1);
        }
        expect(camera.targetArray[1]).toBeCloseTo(0);
        expect(camera.posArray[1]).toBeGreaterThan(0);
        camera.pan(0, 1);
        expect(camera.targetArray[1]).toBeGreaterThan(0);
    });

    it('zooms between street level and a bit past the whole map', () => {
        const camera = new CityCamera(20, 0.6, 0.4, [0, 0, 0], 36);
        for (let frame = 0; frame < 500; frame++) {
            camera.zoom(-1);
        }
        const nearest = camera.distance;
        for (let frame = 0; frame < 500; frame++) {
            camera.zoom(1);
        }
        expect(nearest).toBeLessThan(5);
        expect(camera.distance).toBeGreaterThan(36);
        expect(camera.distance).toBeLessThan(60);
    });
});
