import { describe, expect, it } from 'vitest';
import { BLEND_CELLS, findGlorieta, RING_LANES, warpPoint, warpPose, type Glorieta } from './glorieta';
import { vehiclesDrawItems } from './vehicle_items';
import { EMPTY_VEHICLES, syncVehicles } from './vehicle_sync';
import { cityFromMap } from './map_fixture';

const reforma = cityFromMap('2025_reforma.txt');

function glorieta(): Glorieta {
    const g = findGlorieta(reforma);
    if (g === null) {
        throw new Error('no glorieta on the Reforma map');
    }
    return g;
}

const radiusOf = (g: Glorieta, [x, z]: [number, number]) => Math.hypot(x - g.centre[0], z - g.centre[1]);

// Cells of the two ring lanes, from the map: road cells inside the ring's outer edge
function ringCells(g: Glorieta): { x: number; z: number; inset: number }[] {
    return [...reforma.roads, ...reforma.lights]
        .map((cell) => ({
            ...cell,
            inset: Math.min(g.outer[0] - Math.abs(cell.x - g.centre[0]), g.outer[1] - Math.abs(cell.z - g.centre[1])),
        }))
        .filter((cell) => cell.inset > 0 && cell.inset < RING_LANES);
}

describe('findGlorieta', () => {
    it('finds the island around the Reforma monument and nothing on the base map', () => {
        const g = glorieta();
        expect(g.centre).toEqual([15, 20]);
        expect(g.island).toEqual([2.5, 1.5]);
        expect(g.plaza.size).toBe(15);
        expect(g.plaza.has('15,20')).toBe(true);
        expect(findGlorieta(cityFromMap('2025_base.txt'))).toBeNull();
    });

    it('does not mistake a city block next to a landmark for an island', () => {
        const block = Array.from({ length: 36 }, (_, i) => ({ x: i % 6, z: Math.floor(i / 6) }));
        const city = { ...reforma, obstacles: block, landmarks: [{ kind: 'monument' as const, x: 2, z: 2 }] };
        expect(findGlorieta(city)).toBeNull();
    });
});

describe('warpPoint', () => {
    it('lays both ring lanes on concentric circles, the outer lane outside', () => {
        const g = glorieta();
        const cells = ringCells(g);
        // 9 x 7 ring with a 5 x 3 island: 48 lane cells
        expect(cells).toHaveLength(48);
        for (const cell of cells) {
            const r = radiusOf(g, warpPoint(g, cell.x, cell.z));
            expect(r).toBeCloseTo(g.radius - cell.inset, 6);
        }
    });

    it('keeps the order cars drive round the ring, counter-clockwise', () => {
        const g = glorieta();
        // Ordered by plain angle on the grid, independent of the warp's own maths
        const gridAngle = (x: number, z: number) => Math.atan2(z - g.centre[1], x - g.centre[0]);
        const lane = ringCells(g).filter((c) => c.inset === 0.5)
            .sort((p, q) => gridAngle(p.x, p.z) - gridAngle(q.x, q.z));
        const angles = lane.map((c) => {
            const [x, z] = warpPoint(g, c.x, c.z);
            return gridAngle(x, z);
        });
        const steps = angles.map((angle, i) => {
            const next = angles[(i + 1) % angles.length];
            return (((next - angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        });
        expect(lane).toHaveLength(28);
        // Every step turns the same way and the lap closes once
        expect(steps.every((s) => s > 0 && s < Math.PI / 4)).toBe(true);
        expect(steps.reduce((sum, s) => sum + s, 0)).toBeCloseTo(2 * Math.PI, 6);
    });

    it('has no seam: walking out from the monument, the drawn point never jumps', () => {
        const g = glorieta();
        const step = 0.01;
        let worstJump = 0;
        for (let k = 0; k < 64; k++) {
            const angle = (2 * Math.PI * (k + 0.5)) / 64;
            let previous = warpPoint(g, g.centre[0], g.centre[1]);
            for (let r = step; r < 12; r += step) {
                const here = warpPoint(g, g.centre[0] + r * Math.cos(angle), g.centre[1] + r * Math.sin(angle));
                worstJump = Math.max(worstJump, Math.hypot(here[0] - previous[0], here[1] - previous[1]));
                previous = here;
            }
        }
        // A smooth bend moves at most a few times the walking step
        expect(worstJump).toBeLessThan(5 * step);
    });

    it('bends the city without tearing or folding it', () => {
        const g = glorieta();
        const h = 0.05;
        let worstStretch = 0;
        for (let x = g.centre[0] - 12; x <= g.centre[0] + 12; x += 0.37) {
            for (let z = g.centre[1] - 12; z <= g.centre[1] + 12; z += 0.37) {
                const p = warpPoint(g, x, z);
                const px = warpPoint(g, x + h, z);
                const pz = warpPoint(g, x, z + h);
                const ex = [(px[0] - p[0]) / h, (px[1] - p[1]) / h];
                const ez = [(pz[0] - p[0]) / h, (pz[1] - p[1]) / h];
                // A positive Jacobian: the warped grid never flips over itself
                expect(ex[0] * ez[1] - ex[1] * ez[0], `fold at ${x}, ${z}`).toBeGreaterThan(0);
                // The island's flat plaza may stretch onto its disk; lanes and buildings may not
                const inset = Math.min(g.outer[0] - Math.abs(x - g.centre[0]), g.outer[1] - Math.abs(z - g.centre[1]));
                if (inset < RING_LANES) {
                    worstStretch = Math.max(worstStretch, Math.hypot(ex[0], ex[1]), Math.hypot(ez[0], ez[1]));
                }
            }
        }
        // Nearby points stay nearby: a seam would stretch without bound. The worst real
        // stretch, ~1.7, is just off the ring's corners, which are pulled in the most.
        expect(worstStretch).toBeLessThan(2);
    });

    it('leaves the monument in place and the rest of the city on its grid', () => {
        const g = glorieta();
        expect(warpPoint(g, 15, 20)).toEqual([15, 20]);
        const far = g.outer[0] + BLEND_CELLS + 0.01;
        for (const [x, z] of [[g.centre[0] + far, 20], [3, 3], [30, 31]]) {
            expect(warpPoint(g, x, z)).toEqual([x, z]);
        }
    });

    it('fits the whole plaza inside the inner lane', () => {
        const g = glorieta();
        for (const id of g.plaza) {
            const [x, z] = id.split(',').map(Number);
            for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
                expect(radiusOf(g, warpPoint(g, x + dx, z + dz))).toBeLessThanOrEqual(g.radius - RING_LANES + 1e-9);
            }
        }
    });
});

describe('warpPose', () => {
    const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

    it('turns a car on the ring to drive along the circle, counter-clockwise', () => {
        const g = glorieta();
        // Side cells only: at the corners Reforma enters and leaves the ring, so a car
        // there may rightly head in or out
        const sides = ringCells(g).filter((c) =>
            Math.abs(c.x - g.centre[0]) < g.island[0] || Math.abs(c.z - g.centre[1]) < g.island[1]);
        expect(sides).toHaveLength(2 * RING_LANES * (5 + 3));
        for (const cell of sides) {
            const road = [...reforma.roads, ...reforma.lights].find((r) => r.x === cell.x && r.z === cell.z);
            const ahead = { Right: [1, 0], Left: [-1, 0], Up: [0, 1], Down: [0, -1] }[road!.direction];
            const pose = warpPose(g, { x: cell.x, y: 0, z: cell.z, yaw: yawOf(ahead[0], ahead[1]) });
            const radial = [pose.x - g.centre[0], pose.z - g.centre[1]];
            const heading = [Math.sin(pose.yaw), Math.cos(pose.yaw)];
            const r = Math.hypot(radial[0], radial[1]);
            // cross > 0: heading turns counter-clockwise round the centre (x toward z)
            const cross = (radial[0] * heading[1] - radial[1] * heading[0]) / r;
            const along = (radial[0] * heading[0] + radial[1] * heading[1]) / r;
            expect(cross, `car at ${cell.x}, ${cell.z} drives the wrong way`).toBeGreaterThan(0.95);
            expect(Math.abs(along)).toBeLessThan(0.3);
        }
    });

    it('leaves a car away from the roundabout exactly as the server placed it', () => {
        const pose = { x: 3, y: 0, z: 3, yaw: 1.2 };
        expect(warpPose(glorieta(), pose)).toEqual(pose);
        expect(warpPose(null, pose)).toBe(pose);
    });

    it('draws vehicles rigid: placed on the circle on the CPU, never bent by the shader', () => {
        const g = glorieta();
        const frame = [{ id: 'c1', kind: 'car', x: 19, y: 0, z: 23, heading: { x: -1, z: 0 }, state: 'driving' }];
        const { vehicles } = syncVehicles(EMPTY_VEHICLES, frame);
        const items = vehiclesDrawItems(vehicles, 1, undefined, 0, g);
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((item) => item.unwarped === true)).toBe(true);
        // The car's centre sits where the warp puts its cell, not on the grid
        const [wx, wz] = warpPoint(g, 19, 23);
        const xs = items.map((item) => item.world[12]);
        const zs = items.map((item) => item.world[14]);
        expect(Math.abs(xs.reduce((a, b) => a + b) / xs.length - wx)).toBeLessThan(0.2);
        expect(Math.abs(zs.reduce((a, b) => a + b) / zs.length - wz)).toBeLessThan(0.2);
        expect(Math.hypot(wx - 19, wz - 23)).toBeGreaterThan(0.5);
    });
});
