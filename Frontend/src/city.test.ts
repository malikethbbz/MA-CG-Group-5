import { describe, expect, it } from 'vitest';
import { M4, V3, type Mat4 } from '../libs/3d-lib';
import type { CityData, Direction, RoadCell } from './api_connection';
import { buildCity, HELIPAD_ROOF, plazaCells, streetArrays, type DrawItem } from './city';
import { COLORS } from './config';
import streetObj from '../assets/models/street/street.obj?raw';
import ambulanceSource from '../../Backend/traffic_base/ambulance.py?raw';
import reformaMap from '../../Backend/city_files/2025_reforma.txt?raw';
import baseMap from '../../Backend/city_files/2025_base.txt?raw';

const point = (m: Mat4, x: number, y: number, z: number): number[] => [...M4.transformPoint(m, V3.create(x, y, z))];

function city(roads: RoadCell[], extra: Partial<CityData> = {}): CityData {
    return {
        width: 10, height: 10, roads, obstacles: [], destinations: [], lights: [],
        hospital: null, helipads: [], landmarks: [], ...extra,
    };
}

// The buildings and the monument of a map file, the way the server reads it
// (file row 0 is the top, so z = height - row - 1)
function mapCity(text: string): CityData {
    const rows = text.split('\n').map((row) => row.trim()).filter(Boolean);
    const obstacles: CityData['obstacles'] = [];
    const landmarks: CityData['landmarks'] = [];
    rows.forEach((row, r) => [...row].forEach((char, x) => {
        const z = rows.length - r - 1;
        if (char === '#') {
            obstacles.push({ x, z });
        } else if (char === 'A') {
            landmarks.push({ x, z });
        }
    }));
    return { ...city([]), obstacles, landmarks };
}

describe('streetArrays', () => {
    const arrays = streetArrays(streetObj) as Record<string, { data: number[] }>;
    const position = arrays.a_position.data;
    const normal = arrays.a_normal.data;
    const uv = arrays.a_texCoord.data;

    it('fits the street model into a unit cube, with the texture once across and along it', () => {
        expect(Math.min(...position)).toBeCloseTo(-0.5);
        expect(Math.max(...position)).toBeCloseTo(0.5);
        for (let i = 0; i < position.length / 3; i++) {
            // u runs along local z (the lane), v across it along local x
            expect(uv[2 * i]).toBeCloseTo(position[3 * i + 2] + 0.5);
            expect(uv[2 * i + 1]).toBeCloseTo(position[3 * i] + 0.5);
        }
    });

    it('keeps a top face that points up and is counter-clockwise seen from above', () => {
        let topTriangles = 0;
        for (let t = 0; t < position.length / 9; t++) {
            if (normal[9 * t + 1] < 0.99) {
                continue;
            }
            topTriangles++;
            const [a, b, c] = [0, 1, 2].map((k) => V3.create(position[9 * t + 3 * k], position[9 * t + 3 * k + 1], position[9 * t + 3 * k + 2]));
            const cross = V3.cross(V3.subtract(b, a), V3.subtract(c, a));
            // Front faces are counter-clockwise, so the face normal must point up as well
            expect(cross[1]).toBeGreaterThan(0);
        }
        expect(topTriangles).toBe(2);
    });
});

describe('street tiles', () => {
    const streets = (items: DrawItem[]) => items.filter((item) => item.shape === 'street');

    // Texture v (across the lane) where a tile's local x edge lands in the world
    function edgeV(tile: DrawItem, worldPoint: (p: number[]) => boolean): number | undefined {
        for (const side of [-0.5, 0.5]) {
            if (worldPoint(point(tile.world, side, 0.5, 0))) {
                return tile.band![0] + tile.band![1] * (side + 0.5);
            }
        }
        return undefined;
    }

    for (const [direction, across] of [['Up', 'x'], ['Down', 'x'], ['Left', 'z'], ['Right', 'z']] as [Direction, string][]) {
        it(`puts the dashes between the two lanes of a street going ${direction}, the yellow lines outside`, () => {
            // Two lanes side by side at 3 and 4 across the street, cells 0..9 along it
            const roads: RoadCell[] = [];
            for (let along = 0; along < 10; along++) {
                for (const lane of [3, 4]) {
                    roads.push(across === 'x' ? { x: lane, z: along, direction } : { x: along, z: lane, direction });
                }
            }
            const tiles = streets(buildCity(city(roads)).statics);
            const acrossOf = (p: number[]) => (across === 'x' ? p[0] : p[2]);
            for (const tile of tiles) {
                expect(edgeV(tile, (p) => Math.abs(acrossOf(p) - 3.5) < 1e-6)).toBeCloseTo(0.5);
                const outer = edgeV(tile, (p) => Math.abs(acrossOf(p) - 3.5) > 0.9);
                expect([0, 1]).toContain(outer);
            }
        });
    }

    it('shows plain asphalt next to a crossing street', () => {
        const roads: RoadCell[] = [
            { x: 3, z: 5, direction: 'Up' }, { x: 4, z: 5, direction: 'Right' }, { x: 3, z: 6, direction: 'Up' },
        ];
        const tiles = streets(buildCity(city(roads)).statics);
        const at = (x: number, z: number) => tiles.find((t) => Math.abs(t.world[12] - x) < 1e-6 && Math.abs(t.world[14] - z) < 1e-6)!;
        expect(at(3, 5).band).toEqual([0.15, 0.2]);
        expect(at(3, 6).band).not.toEqual([0.15, 0.2]);
    });
});

describe('buildCity', () => {
    it('gives each traffic light one lamp, keyed by its id, on top of its pole', () => {
        const layout = buildCity(city([], { lights: [{ id: '12', x: 2, z: 0, direction: 'Right' }] }));
        expect([...layout.lamps.keys()]).toEqual(['12']);
        expect(layout.lamps.get('12')!.world[13]).toBeGreaterThan(0.5);
    });

    it('builds the hospital and its helipads as tall as the roof the server parks ambulances on', () => {
        // The server's constant, read from its source so the two sides cannot drift apart
        const serverRoof = Number(/^ROOF_ALTITUDE = ([\d.]+)/m.exec(ambulanceSource)?.[1]);
        expect(serverRoof).toBe(HELIPAD_ROOF);
        const obstacles = [{ x: 2, z: 2 }, { x: 3, z: 2 }, { x: 7, z: 7 }];
        const statics = buildCity(city([], { obstacles, hospital: { x: 2, z: 2 }, helipads: [{ x: 3, z: 2 }] })).statics;
        const roofAt = (x: number) => Math.max(...statics
            .filter((item) => Math.abs(item.world[12] - x) < 1e-6 && Math.abs(item.world[14] - 2) < 1e-6)
            .map((item) => point(item.world, 0, -0.5, 0)[1]));
        expect(roofAt(2)).toBeCloseTo(HELIPAD_ROOF);
        expect(roofAt(3)).toBeCloseTo(HELIPAD_ROOF);
        expect(statics.filter((item) => item.color === COLORS.hospitalCross)).toHaveLength(2);
        expect(statics.filter((item) => item.color === COLORS.helipad)).toHaveLength(1);
    });
});

describe('the glorieta plaza', () => {
    it('is the island of buildings around the Reforma monument, and absent on the base map', () => {
        const reforma = mapCity(reformaMap);
        const plaza = plazaCells(reforma);
        // A 5 x 3 island centred on the monument, without its 4 corners (diagonal road)
        const { x, z } = reforma.landmarks[0];
        expect(plaza.size).toBe(11);
        expect(plaza.has(`${x},${z}`)).toBe(true);
        expect(plaza.has(`${x - 2},${z}`) && plaza.has(`${x + 2},${z}`)).toBe(true);
        expect(plaza.has(`${x - 2},${z - 1}`) || plaza.has(`${x + 2},${z + 1}`)).toBe(false);
        expect(plazaCells(mapCity(baseMap)).size).toBe(0);
    });

    it('does not mistake a whole city block next to a monument for an island', () => {
        const block = Array.from({ length: 36 }, (_, i) => ({ x: i % 6, z: Math.floor(i / 6) }));
        expect(plazaCells(city([], { obstacles: block, landmarks: [{ x: 2, z: 2 }] })).size).toBe(0);
    });

    it('draws one floor, a diamond plaza and the monument instead of towers on the island', () => {
        const island = city([], { obstacles: [{ x: 1, z: 0 }], landmarks: [{ x: 1, z: 1 }] });
        const statics = buildCity(island).statics;
        // The glorieta floor is a single slab, not one tile per cell
        expect(statics.filter((item) => item.shape === 'street')).toHaveLength(1);
        expect(statics.filter((item) => item.color === COLORS.plaza)).toHaveLength(1);
        expect(statics.some((item) => item.color === COLORS.monumentGold)).toBe(true);
        expect(statics.some((item) => COLORS.buildings.includes(item.color))).toBe(false);
    });

    it('turns the plaza curb into a diamond whose corners touch the middle of each island edge', () => {
        // The island covers x 0.5..1.5 and z -0.5..1.5, so it is taller than wide
        const island = city([], { obstacles: [{ x: 1, z: 0 }], landmarks: [{ x: 1, z: 1 }] });
        const curb = buildCity(island).statics.find((item) => item.color === COLORS.plazaCurb)!;
        const corners = [[0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]]
            .map(([lx, lz]) => point(curb.world, lx, 0, lz))
            .map(([x, , z]) => `${x.toFixed(3)},${z.toFixed(3)}`)
            .sort();
        expect(corners).toEqual(['0.500,0.500', '1.000,-0.500', '1.000,1.500', '1.500,0.500']);
    });

    it('lays the lane line as dashes along a diamond halfway round the ring', () => {
        // Island half extents (0.5, 1), so the line's diamond has corners at (+-1.5, 0) and (0, +-2)
        const island = city([], { obstacles: [{ x: 1, z: 0 }], landmarks: [{ x: 1, z: 1 }] });
        const dashes = buildCity(island).statics.filter((item) => item.color === COLORS.laneDash);
        expect(dashes).toHaveLength(16);
        for (const dash of dashes) {
            // Both ends of every dash lie on the diamond, so it points along its side
            for (const end of [-0.5, 0.5]) {
                const [x, , z] = point(dash.world, 0, 0, end);
                expect(Math.abs(x - 1) / 1.5 + Math.abs(z - 0.5) / 2).toBeCloseTo(1, 5);
            }
        }
    });

    it('keeps normal street tiles on the outer lane and the floor on the inner lane', () => {
        // Island x 4.5..5.5, z 3.5..5.5: (4, 4) is on the inner lane, (3, 4) on the outer one
        const roads = [{ x: 4, z: 4, direction: 'Up' as const }, { x: 3, z: 4, direction: 'Up' as const },
            { x: 0, z: 0, direction: 'Up' as const }];
        const island = city(roads, { obstacles: [{ x: 5, z: 4 }], landmarks: [{ x: 5, z: 5 }] });
        const tiles = buildCity(island).statics.filter((item) => item.shape === 'street');
        const at = (x: number, z: number) => tiles.some((t) => t.world[12] === x && t.world[14] === z);
        expect(at(4, 4)).toBe(false);
        expect(at(3, 4)).toBe(true);
        expect(at(0, 0)).toBe(true);
    });

    it('points every arrow the way the server drives the ring (+x, +z, -x, -z round it)', () => {
        // Island centred on (1, 0.5)
        const island = city([], { obstacles: [{ x: 1, z: 0 }], landmarks: [{ x: 1, z: 1 }] });
        const pieces = buildCity(island).statics.filter((item) => item.color === COLORS.laneArrow);
        // One arrow on each side of the ring, three pieces each
        expect(pieces).toHaveLength(4 * 3);
        // Each arrow is a shaft and two head pieces; the shaft is the arrow's heading
        const shafts = pieces.filter((_, i) => i % 3 === 0);
        for (const piece of shafts) {
            const [cx, , cz] = point(piece.world, 0, 0, 0);
            const [bx, , bz] = point(piece.world, 0, 0, -0.5);
            const [fx, , fz] = point(piece.world, 0, 0, 0.5);
            // Going +x along the low-z side, +z up the high-x side: x turns onto z
            const turn = (cx - 1) * (fz - bz) - (cz - 0.5) * (fx - bx);
            expect(turn).toBeGreaterThan(0);
        }
    });

    it('closes each arrow head into a tip instead of a fork', () => {
        const island = city([], { obstacles: [{ x: 1, z: 0 }], landmarks: [{ x: 1, z: 1 }] });
        const pieces = buildCity(island).statics.filter((item) => item.color === COLORS.laneArrow);
        // Each arrow is a shaft and then its two head pieces
        for (let i = 0; i < pieces.length; i += 3) {
            const [left, right] = [pieces[i + 1], pieces[i + 2]];
            const gap = (end: number) => {
                const [ax, , az] = point(left.world, 0, 0, end);
                const [bx, , bz] = point(right.world, 0, 0, end);
                return Math.hypot(ax - bx, az - bz);
            };
            expect(gap(0.5)).toBeLessThan(gap(-0.5));
        }
    });

    it('puts one arrow in the middle of each side of the ring, on the inner lane', () => {
        // Island x 0.5..1.5, z -0.5..1.5: the inner lane cells are x = 0 or 2 and z = -1 or 2
        const island = city([], { obstacles: [{ x: 1, z: 0 }], landmarks: [{ x: 1, z: 1 }] });
        const pieces = buildCity(island).statics.filter((item) => item.color === COLORS.laneArrow);
        const shafts = pieces.filter((_, i) => i % 3 === 0);
        const arrows = shafts.map((shaft) => {
            const [x, , z] = point(shaft.world, 0, 0, 0);
            const [bx, , bz] = point(shaft.world, 0, 0, -0.5);
            const [fx, , fz] = point(shaft.world, 0, 0, 0.5);
            // To the nearest half cell (the shaft sits a little behind the arrow's middle),
            // and the heading as a unit step
            const half = (v: number) => (Math.round(v * 2) / 2 + 0).toFixed(1);
            const length = Math.hypot(fx - bx, fz - bz);
            const unit = (v: number) => Math.round(v / length) + 0;
            return `${half(x)},${half(z)} heading ${unit(fx - bx)},${unit(fz - bz)}`;
        }).sort();
        expect(arrows).toEqual([
            '0.0,0.5 heading 0,-1',   // west side, going -z
            '1.0,-1.0 heading 1,0',   // south side, going +x
            '1.0,2.0 heading -1,0',   // north side, going -x
            '2.0,0.5 heading 0,1',    // east side, going +z
        ]);
    });
});
