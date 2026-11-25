import { describe, expect, it } from 'vitest';
import type { CityData } from '../api/contract';
import { CELL_SIZE } from '../config';
import { buildCityLayout, buildingHeight } from './city_layout';
import { lampColor, PALETTE, vehicleColor } from './palette';

const CITY: CityData = {
    width: 4, height: 3,
    roads: [{ x: 0, z: 0, direction: 'Right' }, { x: 1, z: 0, direction: 'Right' }],
    obstacles: [{ x: 2, z: 2 }, { x: 3, z: 2 }],
    destinations: [{ x: 0, z: 2 }],
    lights: [{ id: '12', x: 2, z: 0, direction: 'Right' }],
    helipads: [], landmarks: [],
};

describe('buildCityLayout', () => {
    it('gives each traffic light one lamp, keyed by the light id', () => {
        const layout = buildCityLayout(CITY);
        expect(layout.lamps.map((lamp) => lamp.id)).toEqual(['12']);
    });

    it('puts the lamp on top of its pole, beside the lane of its cell', () => {
        const lamp = buildCityLayout(CITY).lamps[0].world;
        // translation column: x stays on the cell, z is pushed to the side of the lane
        expect(lamp[12]).toBeCloseTo(2 * CELL_SIZE);
        expect(Math.abs(lamp[14])).toBeGreaterThan(0.3 * CELL_SIZE);
        expect(lamp[13]).toBeGreaterThan(0.5 * CELL_SIZE);
    });

    it('centres the camera target on the map', () => {
        expect(buildCityLayout(CITY).center).toEqual([1.5 * CELL_SIZE, 0, 1 * CELL_SIZE]);
    });
});

describe('buildingHeight', () => {
    it('is the same for a cell on every call and varies across cells', () => {
        expect(buildingHeight(7, 3)).toBe(buildingHeight(7, 3));
        const heights = new Set(Array.from({ length: 20 }, (_, i) => buildingHeight(i, 5).toFixed(3)));
        expect(heights.size).toBeGreaterThan(10);
    });

    it('stays between the minimum and maximum building height', () => {
        for (let x = 0; x < 30; x++) {
            for (let z = 0; z < 30; z++) {
                const h = buildingHeight(x, z);
                expect(h).toBeGreaterThanOrEqual(0.6);
                expect(h).toBeLessThan(3.0);
            }
        }
    });
});

describe('palette lookups', () => {
    it('shows a lamp green, red, or unlit when the server has not reported it', () => {
        expect(lampColor(true)).toBe(PALETTE.lightGreen);
        expect(lampColor(false)).toBe(PALETTE.lightRed);
        expect(lampColor(undefined)).toBe(PALETTE.lightPole);
    });

    it('colors known kinds distinctly and falls back for unknown ones', () => {
        const kinds = ['car', 'motorcycle', 'ambulance', 'police', 'rogue', 'swat'];
        const colors = new Set(kinds.map((kind) => vehicleColor(kind).join()));
        expect(colors.size).toBe(kinds.length);
        expect(vehicleColor('hovercraft')).toBe(PALETTE.unknownVehicle);
    });
});
