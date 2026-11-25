import { describe, expect, it } from 'vitest';
import { M4, V3 } from '../../libs/3d-lib';
import type { VehicleFrame } from '../api/contract';
import { CELL_SIZE } from '../config';
import { vehicleColor } from './palette';
import { CAR_DESIGNS, carDesign, vehicleLook } from './vehicle_designs';
import { vehiclesDrawItems } from './vehicle_items';
import { vehicleMatrices, type VehicleSpec } from './vehicle_model';
import { MOTORCYCLE_SPEC } from './vehicle_specs';
import { EMPTY_VEHICLES, syncVehicles } from './vehicle_sync';

// Server ids are decimal strings counting up
const IDS = Array.from({ length: 500 }, (_, i) => String(1000 + i));

function footprint(spec: VehicleSpec): { width: number; length: number } {
    const { parts, wheels } = vehicleMatrices(spec, { x: 0, y: 0, z: 0, yaw: 0 }, 0);
    const points = [
        ...parts.flatMap((m) => [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((z) => M4.transformPoint(m, V3.create(x, 0, z))))),
        ...wheels.flatMap((m) => [-0.5, 0.5].flatMap((x) => [-1, 1].map((z) => M4.transformPoint(m, V3.create(x, 0, z))))),
    ];
    const span = (axis: number) => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]));
    return { width: span(0), length: span(2) };
}

describe('car designs', () => {
    it('gives the same id the same design and color every time', () => {
        for (const id of IDS.slice(0, 50)) {
            const first = vehicleLook('car', id);
            const again = vehicleLook('car', id);
            expect(again.spec).toBe(first.spec);
            expect(again.color).toEqual(first.color);
        }
    });

    it('keeps a car its look from one frame to the next while it drives', () => {
        const frame = (z: number): VehicleFrame => ({ id: '1042', kind: 'car', x: 0, y: 0, z, heading: { x: 0, z: 1 }, state: 'driving' });
        const a = syncVehicles(EMPTY_VEHICLES, [frame(0)]).vehicles;
        const b = syncVehicles(a, [frame(1)]).vehicles;
        const colors = (vehicles: typeof a) => vehiclesDrawItems(vehicles, 0.5).map((item) => item.color);
        expect(colors(b)).toEqual(colors(a));
    });

    it('uses every design across a run of server ids, none taking over', () => {
        const counts = new Map<string, number>();
        for (const id of IDS) {
            const name = carDesign(id).name;
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        expect(counts.size).toBe(CAR_DESIGNS.length);
        for (const count of counts.values()) {
            expect(count).toBeLessThan(IDS.length * 0.4);
        }
    });

    it('colors each car from its design palette, with more than one color in use', () => {
        const used = new Set<string>();
        for (const id of IDS) {
            const look = vehicleLook('car', id);
            expect(carDesign(id).colors).toContain(look.color);
            used.add(look.color.join());
        }
        expect(used.size).toBeGreaterThan(CAR_DESIGNS.length);
    });

    for (const design of CAR_DESIGNS) {
        it(`fits the ${design.name} in its lane: under half a cell wide, at most 0.8 long`, () => {
            const { width, length } = footprint(design.spec);
            expect(width).toBeLessThan(0.5 * CELL_SIZE);
            expect(length).toBeLessThanOrEqual(0.8 * CELL_SIZE);
        });
    }

    it('gives designs visibly different proportions', () => {
        const sizes = new Set(CAR_DESIGNS.map((d) => {
            const { width, length } = footprint(d.spec);
            return `${width.toFixed(2)}x${length.toFixed(2)}x${d.spec.roofHeight.toFixed(2)}`;
        }));
        expect(sizes.size).toBe(CAR_DESIGNS.length);
    });

    it('leaves other kinds their own shape and kind color', () => {
        expect(vehicleLook('motorcycle', '7')).toEqual({ spec: MOTORCYCLE_SPEC, color: vehicleColor('motorcycle') });
        expect(vehicleLook('ambulance', '7').color).toBe(vehicleColor('ambulance'));
    });
});
