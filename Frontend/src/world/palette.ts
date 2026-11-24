/*
 * Cyberpunk palette. Colors are linear RGBA in [0, 1], as the shaders expect.
 */

import type { Color } from '../../libs/color';

export function hex(code: string): Color {
    const value = parseInt(code.replace('#', ''), 16);
    return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 1];
}

export const PALETTE = {
    background: hex('#05040d'),
    ground: hex('#0b0a18'),
    road: hex('#1c1b2e'),
    roadEdge: hex('#2d2b4a'),
    buildings: [hex('#1a1240'), hex('#121f4d'), hex('#24123d'), hex('#0f2a3d')],
    buildingTrim: hex('#6b1f8a'),
    destination: hex('#ff2bd6'),
    lightPole: hex('#3a3950'),
    lightGreen: hex('#39ff6a'),
    lightRed: hex('#ff2a4d'),
    wheel: hex('#d8d8e8'),
    cabin: hex('#0a0a14'),
    unknownVehicle: hex('#f5ff3b'),
};

// Body color per vehicle kind; kinds the server adds later only need a row here.
const VEHICLE_COLORS: Readonly<Record<string, Color>> = {
    car: hex('#00f0ff'),
    ambulance: hex('#f4f4ff'),
    police: hex('#3d5afe'),
    rogue: hex('#ff9100'),
    swat: hex('#9d4dff'),
};

export function vehicleColor(kind: string): Color {
    return VEHICLE_COLORS[kind] ?? PALETTE.unknownVehicle;
}

// A lamp the server has not reported yet stays unlit rather than guessing a color.
export function lampColor(green: boolean | undefined): Color {
    if (green === undefined) {
        return PALETTE.lightPole;
    }
    return green ? PALETTE.lightGreen : PALETTE.lightRed;
}
