import { describe, expect, it } from 'vitest';
import type { CityData, GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';
import { LAMP_SPACING, streetLampItems, streetLamps } from './street_lamps';

// A 9x9 block: a ring road around a 7x7 block of buildings, plus one traffic light
// on the ring. Every building on the block's edge touches a road.
function ringCity(): CityData {
    const roads: CityData['roads'] = [];
    const obstacles: GridCell[] = [];
    for (let x = 0; x < 9; x++) {
        for (let z = 0; z < 9; z++) {
            const onRing = x === 0 || z === 0 || x === 8 || z === 8;
            if (onRing && !(x === 5 && z === 0)) {
                roads.push({ x, z, direction: 'Right' });
            } else if (!onRing) {
                obstacles.push({ x, z });
            }
        }
    }
    return {
        width: 9, height: 9, roads, obstacles, destinations: [], helipads: [],
        lights: [{ id: 'L', x: 5, z: 0, direction: 'Right' }],
    };
}

const key = (x: number, z: number) => `${x},${z}`;

describe('streetLamps', () => {
    it('places the same lamps whatever order the server lists the buildings in', () => {
        const city = ringCity();
        const shuffled = { ...city, obstacles: [...city.obstacles].reverse() };
        expect(streetLamps(shuffled)).toEqual(streetLamps(city));
        expect(streetLamps(city).length).toBeGreaterThan(4);
    });

    it('only uses building cells on the regular spacing, each facing a road', () => {
        const city = ringCity();
        const roads = new Set(city.roads.map((r) => key(r.x, r.z)));
        for (const lamp of streetLamps(city)) {
            expect((lamp.cell.x + lamp.cell.z) % LAMP_SPACING).toBe(0);
            expect(roads.has(key(lamp.cell.x, lamp.cell.z))).toBe(false);
            expect(roads.has(key(lamp.cell.x + lamp.side[0], lamp.cell.z + lamp.side[1]))).toBe(true);
        }
    });

    it('stands every pole outside every road cell, between the wall and the curb', () => {
        const city = ringCity();
        const lanes = [...city.roads, ...city.lights];
        for (const lamp of streetLamps(city)) {
            const pole = streetLampItems(lamp)[0].world;
            const [px, pz] = [pole[12] / CELL_SIZE, pole[14] / CELL_SIZE];
            for (const lane of lanes) {
                const inside = Math.abs(px - lane.x) < 0.5 && Math.abs(pz - lane.z) < 0.5;
                expect(inside, `pole at (${px}, ${pz}) is on road ${key(lane.x, lane.z)}`).toBe(false);
            }
            // ...and outside the building's 0.86-wide footprint
            expect(Math.max(Math.abs(px - lamp.cell.x), Math.abs(pz - lamp.cell.z))).toBeGreaterThan(0.43);
        }
    });

    it('leaves the curb next to a traffic light to the light', () => {
        // Building (5, 1) is on the spacing and its only road neighbour is the light (5, 0)
        const city = ringCity();
        const atBuilding = (c: CityData) => streetLamps(c).filter((l) => l.cell.x === 5 && l.cell.z === 1);
        expect(atBuilding(city)).toEqual([]);
        const withoutLight = { ...city, lights: [], roads: [...city.roads, { x: 5, z: 0, direction: 'Right' as const }] };
        expect(atBuilding(withoutLight)).toHaveLength(1);
    });
});
