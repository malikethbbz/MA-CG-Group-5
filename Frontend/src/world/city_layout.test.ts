import { describe, expect, it } from 'vitest';
import type { CityData } from '../api/contract';
import { CELL_SIZE } from '../config';
import { M4, V3 } from '../../libs/3d-lib';
import ambulanceSource from '../../../Backend/traffic_base/ambulance.py?raw';
import { buildCityLayout, buildingHeight, HELIPAD_ROOF } from './city_layout';
import { cityFromMap } from './map_fixture';
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

describe('helipads', () => {
    const top = (world: Float32Array) => M4.transformPoint(world, V3.create(0, 0.5, 0))[1];
    const at = (world: Float32Array) => {
        const [x, , z] = M4.transformPoint(world, V3.create(0, 0, 0));
        return `${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`;
    };

    it('builds each pad exactly as tall as the altitude the server parks ambulances at', () => {
        // The server's constant, read from its source so the two sides cannot drift apart
        const serverRoof = Number(/^ROOF_ALTITUDE = ([\d.]+)/m.exec(ambulanceSource)?.[1]);
        expect(serverRoof).toBe(HELIPAD_ROOF);
        const city = { ...cityFromMap('2025_base.txt'), helipads: [{ x: 2, z: 2 }, { x: 33, z: 32 }] };
        const walls = buildCityLayout(city).statics.filter((item) => item.windowSeed !== undefined);
        const height = new Map(walls.map((item) => [at(item.world), top(item.world)]));
        expect(height.get('2,2')).toBeCloseTo(HELIPAD_ROOF * CELL_SIZE);
        expect(height.get('33,32')).toBeCloseTo(HELIPAD_ROOF * CELL_SIZE);
        // Other towers keep their own heights, so the pads are not just the default
        const others = [...height.entries()].filter(([id]) => id !== '2,2' && id !== '33,32').map(([, h]) => h);
        expect(others.filter((h) => Math.abs(h - HELIPAD_ROOF) > 0.05).length).toBeGreaterThan(others.length / 2);
        const marks = buildCityLayout(city).statics.filter((item) => item.color === PALETTE.helipad);
        expect(marks).toHaveLength(6);
    });
});
