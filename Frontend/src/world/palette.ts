/*
 * Cyberpunk palette: a violet-to-pink sky with a pink horizon haze, deep blue-violet
 * buildings with cyan windows. Colors are linear RGBA in [0, 1], as the shaders expect.
 */

import type { Color } from '../../libs/color';

export function hex(code: string): Color {
    const value = parseInt(code.replace('#', ''), 16);
    return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 1];
}

export const PALETTE = {
    ground: hex('#120c2e'),
    road: hex('#1d1840'),
    buildings: [hex('#1d1a5c'), hex('#241a66'), hex('#16225e'), hex('#2b1a5a')],
    // Roofs only a shade lighter than the walls, so the top view is not a sea of purple
    roofLift: 1.18,
    crownPink: hex('#ff3fb4'),
    crownCyan: hex('#2ef2ff'),
    windowCyan: hex('#5ff6ff'),
    windowPink: hex('#ff8ad8'),
    destination: hex('#ff2bd6'),
    lightPole: hex('#3a3950'),
    lampPink: hex('#ff4fc8'),
    lampCyan: hex('#3ff0ff'),
    lightGreen: hex('#39ff6a'),
    lightRed: hex('#ff2a4d'),
    wheel: hex('#d8d8e8'),
    cabin: hex('#0a0a14'),
    headlight: hex('#fff6d6'),
    unknownVehicle: hex('#f5ff3b'),
};

// The sky pass and the fog share these, so far geometry melts into the horizon.
// The fog color is the horizon plus HAZE_STRENGTH of the haze: the sky right at eye level.
export const HAZE_STRENGTH = 0.22;

export const SKY = {
    zenith: hex('#0e0830'),
    midSky: hex('#3e1270'),
    horizon: hex('#7a1f68'),
    haze: hex('#ff6fc0'),
    ring: hex('#ff4fd0'),
    star: hex('#f4e9ff'),
};

// Body color per vehicle kind; kinds the server adds later only need a row here.
const VEHICLE_COLORS: Readonly<Record<string, Color>> = {
    car: hex('#00f0ff'),
    motorcycle: hex('#b6ff1a'),
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

export function scaleColor(color: Color, factor: number): Color {
    return [color[0] * factor, color[1] * factor, color[2] * factor, color[3]];
}
