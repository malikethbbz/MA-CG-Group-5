import { describe, expect, it } from 'vitest';
import type { CityData, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { PedestrianCrowd } from './pedestrian_crowd';
import {
    BOB_HEIGHT, PEDESTRIAN_COUNT, placeWalker, spawnWalkers, WALK_HALF_SPAN, type Walker, type WalkerPlace,
} from './pedestrians';
import { sidewalkItem, sidewalks, WALL_OFFSET } from './sidewalks';

// Two blocks of buildings split by a road along x = 3, with roads around the edge
function twoBlocks(): CityData {
    const roads: CityData['roads'] = [];
    const obstacles: GridCell[] = [];
    for (let x = 0; x < 7; x++) {
        for (let z = 0; z < 6; z++) {
            const road = x === 0 || x === 3 || x === 6 || z === 0 || z === 5;
            if (road) {
                roads.push({ x, z, direction: 'Up' });
            } else {
                obstacles.push({ x, z });
            }
        }
    }
    return { width: 7, height: 6, roads, obstacles, destinations: [], lights: [], helipads: [], landmarks: [] };
}

const key = (x: number, z: number) => `${x},${z}`;
const place = (): WalkerPlace => ({ x: 0, z: 0, bob: 0 });

describe('sidewalks', () => {
    it('runs a strip along every side of a building that touches a road', () => {
        const walks = sidewalks(twoBlocks());
        // Building (1, 1) is a corner: road on its -x and -z sides
        expect(walks.filter((w) => w.cell.x === 1 && w.cell.z === 1).map((w) => w.side)).toEqual([[-1, 0], [0, -1]]);
        // Building (2, 2) touches the middle road on +x only
        expect(walks.filter((w) => w.cell.x === 2 && w.cell.z === 2).map((w) => w.side)).toEqual([[1, 0]]);
    });

    it('draws each strip between the wall and the curb of its own cell', () => {
        for (const walk of sidewalks(twoBlocks())) {
            const world = sidewalkItem(walk).world;
            const offset = (walk.side[0] * (world[12] / CELL_SIZE - walk.cell.x)) + (walk.side[1] * (world[14] / CELL_SIZE - walk.cell.z));
            expect(offset).toBeGreaterThan(WALL_OFFSET);
            expect(offset).toBeLessThan(0.5);
        }
    });
});

describe('spawnWalkers', () => {
    const walks = sidewalks(twoBlocks());

    it('is the same crowd on every load, and another seed gives another crowd', () => {
        expect(spawnWalkers(walks)).toEqual(spawnWalkers(walks));
        expect(spawnWalkers(walks, 1)).not.toEqual(spawnWalkers(walks, 2));
    });

    it('never makes more than the fixed count, and none without sidewalks', () => {
        const many = Array.from({ length: 40 }, () => walks).flat();
        expect(spawnWalkers(many)).toHaveLength(PEDESTRIAN_COUNT);
        expect(spawnWalkers([])).toEqual([]);
    });
});

describe('placeWalker', () => {
    const city = twoBlocks();
    const roads = new Set(city.roads.map((r) => key(r.x, r.z)));
    const walkers = spawnWalkers(sidewalks(city));

    it('never puts a walker on a road cell or inside its building, at any time', () => {
        for (const walker of walkers) {
            for (let t = 0; t < 60_000; t += 1_337) {
                const p = placeWalker(walker, t, place());
                expect(roads.has(key(Math.round(p.x), Math.round(p.z)))).toBe(false);
                expect(Math.abs(p.x - walker.walk.cell.x)).toBeLessThan(0.5);
                expect(Math.abs(p.z - walker.walk.cell.z)).toBeLessThan(0.5);
                const out = walker.walk.side[0] * (p.x - walker.walk.cell.x) + walker.walk.side[1] * (p.z - walker.walk.cell.z);
                expect(out).toBeGreaterThan(WALL_OFFSET);
            }
        }
    });

    it('paces the whole stretch back and forth without jumping', () => {
        const walker: Walker = { ...walkers[0], phase: 0, speed: 0.2 };
        const [sx, sz] = walker.walk.side;
        const along = (t: number) => {
            const p = placeWalker(walker, t, place());
            return sz !== 0 ? p.x - walker.walk.cell.x : p.z - walker.walk.cell.z;
        };
        const lapMs = (4 * WALK_HALF_SPAN / walker.speed) * 1000;
        const samples = Array.from({ length: 200 }, (_, i) => along((i / 200) * lapMs));
        expect(Math.min(...samples)).toBeCloseTo(-WALK_HALF_SPAN, 1);
        expect(Math.max(...samples)).toBeCloseTo(WALK_HALF_SPAN, 1);
        for (let i = 1; i < samples.length; i++) {
            expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.05);
        }
        expect(along(lapMs)).toBeCloseTo(along(0));
        expect(sx === 0 || sz === 0).toBe(true);
    });

    it('bobs each step, never below the ground or above the step height', () => {
        const bobs = Array.from({ length: 100 }, (_, i) => placeWalker(walkers[3], i * 37, place()).bob);
        expect(Math.min(...bobs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...bobs)).toBeLessThanOrEqual(BOB_HEIGHT);
        expect(Math.max(...bobs) - Math.min(...bobs)).toBeGreaterThan(0.5 * BOB_HEIGHT);
    });
});

describe('PedestrianCrowd', () => {
    const walkers = spawnWalkers(sidewalks(twoBlocks()), 5, 12);

    it('moves the same matrices in place each frame, to where placeWalker says', () => {
        const crowd = new PedestrianCrowd(walkers);
        const before = crowd.items.map((item) => item.world);
        crowd.update(4_000);
        crowd.items.forEach((item, i) => expect(item.world).toBe(before[i]));
        const p = placeWalker(walkers[2], 4_000, place());
        const body = crowd.items[4].world;
        const head = crowd.items[5].world;
        expect(body[12]).toBeCloseTo(p.x * CELL_SIZE);
        expect(body[14]).toBeCloseTo(p.z * CELL_SIZE);
        expect(head[13]).toBeGreaterThan(body[13]);
    });
});
