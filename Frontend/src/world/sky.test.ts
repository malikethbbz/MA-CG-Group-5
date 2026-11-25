import { describe, expect, it } from 'vitest';
import {
    seededRandom, STAR_COUNT, STAR_MAX_ELEVATION, STAR_MIN_ELEVATION, starField, starUniforms,
} from './sky';

describe('seededRandom', () => {
    it('repeats the same sequence for the same seed and differs for another seed', () => {
        const a = seededRandom(7);
        const b = seededRandom(7);
        const c = seededRandom(8);
        const seqA = Array.from({ length: 8 }, a);
        expect(Array.from({ length: 8 }, b)).toEqual(seqA);
        expect(Array.from({ length: 8 }, c)).not.toEqual(seqA);
    });

    it('stays in [0, 1) and is not stuck on a few values', () => {
        const random = seededRandom(123);
        const values = Array.from({ length: 2000 }, random);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...values)).toBeLessThan(1);
        expect(new Set(values.map((v) => v.toFixed(3))).size).toBeGreaterThan(800);
    });
});

describe('starField', () => {
    it('is the same field on every load', () => {
        expect(starField()).toEqual(starField());
        expect(starField(1)).not.toEqual(starField(2));
    });

    it('keeps every star in the upper sky, all the way around the horizon', () => {
        const stars = starField();
        expect(stars).toHaveLength(STAR_COUNT);
        for (const star of stars) {
            expect(star.elevation).toBeGreaterThanOrEqual(STAR_MIN_ELEVATION);
            expect(star.elevation).toBeLessThanOrEqual(STAR_MAX_ELEVATION);
            expect(Math.abs(star.azimuth)).toBeLessThanOrEqual(Math.PI);
        }
        // Every quarter of the horizon gets stars, whichever way the camera turns
        const quarters = new Set(stars.map((s) => Math.floor((s.azimuth + Math.PI) / (Math.PI / 2))));
        expect(quarters.size).toBe(4);
    });

    it('flattens into one vec4 per star, in the order the shader reads', () => {
        const stars = starField(5, 3);
        const flat = starUniforms(stars);
        expect(flat).toHaveLength(12);
        expect(flat.slice(4, 8)).toEqual([stars[1].azimuth, stars[1].elevation, stars[1].size, stars[1].brightness]);
    });
});
