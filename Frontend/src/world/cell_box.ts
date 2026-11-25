/*
 * World matrix for a box standing on a grid cell, the building block of the static city.
 */

import { M4, V3, type Mat4 } from '../../libs/3d-lib';
import type { GridCell } from '../api/contract';
import { CELL_SIZE } from '../config';

// A box centred on cell (x, z), shifted by `shift` cells, with its base at height
// `base` (world units). `size` is in cells.
export function cellBox(cell: GridCell, base: number, size: readonly [number, number, number],
    shift: readonly [number, number] = [0, 0]): Mat4 {
    const centre = V3.create(
        (cell.x + shift[0]) * CELL_SIZE,
        base + 0.5 * size[1] * CELL_SIZE,
        (cell.z + shift[1]) * CELL_SIZE,
    );
    const scale = V3.create(size[0] * CELL_SIZE, size[1] * CELL_SIZE, size[2] * CELL_SIZE);
    return M4.multiply(M4.translation(centre), M4.scale(scale));
}
