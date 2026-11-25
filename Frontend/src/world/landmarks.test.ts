import { describe, expect, it } from 'vitest';
import { M4, V3 } from '../../libs/3d-lib';
import type { CityData } from '../api/contract';
import { CELL_SIZE } from '../config';
import { buildCityLayout } from './city_layout';
import { monumentItems } from './landmarks';
import { PALETTE } from './palette';
import { streetLamps } from './street_lamps';

const centre = (world: Float32Array) => [...M4.transformPoint(world, V3.create(0, 0, 0))];
const top = (world: Float32Array) => M4.transformPoint(world, V3.create(0, 0.5, 0))[1];

describe('monumentItems', () => {
    const items = monumentItems({ kind: 'monument', x: 7, z: 3 });

    it('stands on its cell: every block is centred on the island', () => {
        for (const item of items) {
            const [x, , z] = centre(item.world);
            expect(Math.abs(x - 7 * CELL_SIZE)).toBeLessThan(0.3 * CELL_SIZE);
            expect(Math.abs(z - 3 * CELL_SIZE)).toBeLessThan(0.3 * CELL_SIZE);
        }
    });

    it('is a tall column topped by a glowing gold figure', () => {
        const gold = items.filter((item) => item.color === PALETTE.monumentGold);
        const stone = items.filter((item) => item.color === PALETTE.monumentStone);
        const highestStone = Math.max(...stone.map((item) => top(item.world)));
        expect(highestStone).toBeGreaterThan(3 * CELL_SIZE);
        // The figure sits above all the stone, and glows
        expect(Math.min(...gold.map((item) => centre(item.world)[1]))).toBeGreaterThan(highestStone);
        expect(gold.every((item) => item.emissive > 0.5)).toBe(true);
    });

    it('spreads two mirrored wings from the figure', () => {
        const gold = items.filter((item) => item.color === PALETTE.monumentGold);
        const xs = gold.map((item) => centre(item.world)[0] - 7 * CELL_SIZE);
        const left = xs.filter((x) => x < -0.1 * CELL_SIZE);
        const right = xs.filter((x) => x > 0.1 * CELL_SIZE);
        expect(left).toHaveLength(1);
        expect(right).toHaveLength(1);
        expect(left[0]).toBeCloseTo(-right[0]);
    });
});

describe('landmarks in the city layout', () => {
    const city: CityData = {
        width: 3, height: 3,
        roads: [{ x: 0, z: 1, direction: 'Up' }, { x: 0, z: 0, direction: 'Up' }],
        obstacles: [{ x: 1, z: 1 }, { x: 1, z: 0 }],
        destinations: [], lights: [], helipads: [],
        landmarks: [{ kind: 'monument', x: 1, z: 1 }],
    };
    const towers = (c: CityData) => buildCityLayout(c).statics.filter((item) => item.windowSeed !== undefined);

    it('draws the monument instead of a tower on its cell', () => {
        expect(towers(city)).toHaveLength(1);
        expect(towers({ ...city, landmarks: [] })).toHaveLength(2);
        const gold = buildCityLayout(city).statics.filter((item) => item.color === PALETTE.monumentGold);
        expect(gold.length).toBeGreaterThan(0);
    });

    it('keeps street lamps off the monument island', () => {
        // (1, 1) is on the lamp spacing and faces the road at (0, 1)
        expect(streetLamps({ ...city, landmarks: [] }).map((l) => l.cell)).toContainEqual({ x: 1, z: 1 });
        expect(streetLamps(city).map((l) => l.cell)).not.toContainEqual({ x: 1, z: 1 });
    });
});
