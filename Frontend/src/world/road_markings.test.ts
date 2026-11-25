import { describe, expect, it } from 'vitest';
import type { CityData, Direction, RoadCell } from '../api/contract';
import { cityFromMap } from './map_fixture';
import {
    ARROW_SPACING, EDGE_CURB, EDGE_DASHED, EDGE_DIVIDER, EDGE_NONE, roadMarkings,
} from './road_markings';

function city(roads: RoadCell[], lights: CityData['lights'] = []): CityData {
    return { width: 20, height: 20, roads, obstacles: [], destinations: [], lights, helipads: [], landmarks: [] };
}

const lane = (z: number, direction: Direction, from = 0, to = 9): RoadCell[] =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, z, direction }));

describe('roadMarkings', () => {
    // Driving Right, perp is (0, -1): edge 0 is the z - 1 side and edge 1 the z + 1 side
    it('dashes between lanes going the same way and puts the divider against the other way', () => {
        const marks = roadMarkings(city([...lane(0, 'Right'), ...lane(-1, 'Right'), ...lane(1, 'Left')]));
        expect(marks.get('4,0')?.edges).toEqual([EDGE_DASHED, EDGE_DIVIDER]);
        expect(marks.get('4,-1')?.edges).toEqual([EDGE_CURB, EDGE_DASHED]);
        // Driving Left, perp is (0, 1): its edge 0 faces z + 1, open ground here
        expect(marks.get('4,1')?.edges).toEqual([EDGE_CURB, EDGE_DIVIDER]);
    });

    it('paints arrows pointing the way of travel, spaced along straight stretches only', () => {
        const marks = roadMarkings(city([...lane(0, 'Left'), ...lane(1, 'Left')]));
        const arrows = [...marks.entries()].filter(([, m]) => m.arrow).map(([id]) => id);
        // Not on the end cells, which have no lane behind or ahead of them
        expect(arrows.sort()).toEqual(['3,0', '3,1', '6,0', '6,1'].sort());
        expect(marks.get('3,0')?.ahead).toEqual([-1, 0]);
        expect(ARROW_SPACING).toBe(3);
    });

    it('draws no lane line or arrow across a crossing street', () => {
        // A two-lane avenue going Right at z 0 and 1, crossed by a Down street at x = 4
        const crossing: RoadCell[] = [-3, -2, -1, 2, 3, 4].map((z) => ({ x: 4, z, direction: 'Down' }));
        const marks = roadMarkings(city([...lane(0, 'Right'), ...lane(1, 'Right'), ...crossing]));
        // Each crossing cell keeps the dash to its neighbour lane, and no line faces the street
        expect(marks.get('4,1')?.edges).toEqual([EDGE_DASHED, EDGE_NONE]);
        expect(marks.get('4,0')?.edges).toEqual([EDGE_NONE, EDGE_DASHED]);
        expect(marks.get('4,1')?.arrow).toBe(false);
        // One cell before the crossing the lanes are plain again
        expect(marks.get('3,1')?.edges).toEqual([EDGE_DASHED, EDGE_CURB]);
    });

    it('puts a stop line on each traffic light and no arrow on it', () => {
        const marks = roadMarkings(city(lane(0, 'Up' as Direction).map((c, i) => ({ ...c, x: 0, z: i })).filter((c) => c.z !== 5),
            [{ id: 'l', x: 0, z: 5, direction: 'Up' }]));
        expect(marks.get('0,5')).toMatchObject({ stopLine: true, arrow: false, ahead: [0, 1] });
        expect(marks.get('0,4')?.stopLine).toBe(false);
    });

    it('marks every road and light of the real Reforma map, with arrows on the ring', () => {
        const reforma = cityFromMap('2025_reforma.txt');
        const marks = roadMarkings(reforma);
        expect(marks.size).toBe(reforma.roads.length + reforma.lights.length);
        const stops = [...marks.values()].filter((m) => m.stopLine);
        expect(stops).toHaveLength(reforma.lights.length);
        // The ring's bounding box: two lanes around the island at x 13..17, z 19..21
        const ringArrows = [...marks.entries()].filter(([id, m]) => {
            const [x, z] = id.split(',').map(Number);
            return m.arrow && x >= 11 && x <= 19 && z >= 17 && z <= 23;
        });
        expect(ringArrows.length).toBeGreaterThan(0);
    });
});
