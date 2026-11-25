/*
 * Test helper: CityData built straight from a map file in Backend/city_files, the way
 * the server lays it out (file row 0 is the top, so z = height - row - 1). Lights take
 * the direction of the road feeding them, as the server infers it.
 */

import type { CityData, Direction, GridCell, RoadCell } from '../api/contract';
import baseMap from '../../../Backend/city_files/2025_base.txt?raw';
import reformaMap from '../../../Backend/city_files/2025_reforma.txt?raw';

const MAPS: Readonly<Record<string, string>> = {
    '2025_base.txt': baseMap,
    '2025_reforma.txt': reformaMap,
};

const ARROWS: Readonly<Record<string, Direction>> = { '>': 'Right', '<': 'Left', '^': 'Up', 'v': 'Down' };
const STEPS: Readonly<Record<Direction, readonly [number, number]>> = {
    Right: [1, 0], Left: [-1, 0], Up: [0, 1], Down: [0, -1],
};

export function cityFromMap(name: string): CityData {
    const rows = MAPS[name].split('\n').map((row) => row.trim()).filter(Boolean);
    const height = rows.length;
    const roads: RoadCell[] = [];
    const obstacles: GridCell[] = [];
    const destinations: GridCell[] = [];
    const lightCells: GridCell[] = [];
    const landmarks: CityData['landmarks'] = [];
    rows.forEach((row, r) => [...row].forEach((char, x) => {
        const z = height - r - 1;
        if (char in ARROWS) {
            roads.push({ x, z, direction: ARROWS[char] });
        } else if (char === 's' || char === 'S') {
            lightCells.push({ x, z });
        } else if (char === '#') {
            obstacles.push({ x, z });
        } else if (char === 'D') {
            destinations.push({ x, z });
        } else if (char === 'A') {
            landmarks.push({ kind: 'monument', x, z });
        }
    }));
    const known = new Map(roads.map((road) => [`${road.x},${road.z}`, road.direction]));
    const lights: CityData['lights'] = [];
    let pending = lightCells;
    while (pending.length > 0) {
        const left = pending.filter((cell) => {
            const direction = (Object.keys(STEPS) as Direction[]).find((d) =>
                known.get(`${cell.x - STEPS[d][0]},${cell.z - STEPS[d][1]}`) === d);
            if (direction === undefined) {
                return true;
            }
            known.set(`${cell.x},${cell.z}`, direction);
            lights.push({ ...cell, id: `light-${cell.x}-${cell.z}`, direction });
            return false;
        });
        if (left.length === pending.length) {
            throw new Error(`cannot infer light directions in ${name}`);
        }
        pending = left;
    }
    return { width: rows[0].length, height, roads, obstacles, destinations, lights, helipads: [], landmarks };
}
