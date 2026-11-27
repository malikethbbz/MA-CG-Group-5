/*
 * Settings and colors shared by the whole frontend.
 *
 * Team 5 - TC2008B
 * 2026-11
 */

import type { Color } from '../libs/color';

// Override with VITE_SERVER_URL (e.g. `VITE_SERVER_URL=http://host:8585/ npm run dev`)
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8585/';

// How long to wait before trying again while the server is down
export const RETRY_DELAY_MS = 1500;

// Maps the server can load; the assignment's map is the default
export const MAP_CHOICES: Record<string, string> = {
    'Original (2025)': '2025_base.txt',
    'Glorieta Reforma': '2025_reforma.txt',
};
export const DEFAULT_MAP = '2025_base.txt';

// '#rrggbb' to an RGBA color in [0, 1], as the shaders expect
export function hex(code: string): Color {
    const value = parseInt(code.replace('#', ''), 16);
    return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 1];
}

// Night city palette: violet ground and buildings, neon accents
export const COLORS = {
    background: hex('#2a1450'),
    ground: hex('#120c2e'),
    sidewalk: hex('#3a2f6e'),
    buildings: [hex('#3a3590'), hex('#45348f'), hex('#2f3f8f'), hex('#4f3488')],
    roof: hex('#6a5fc0'),
    helipad: hex('#39ff6a'),
    hospital: hex('#e8e8f4'),
    hospitalCross: hex('#ff2a3a'),
    destination: hex('#ff2bd6'),
    lightPole: hex('#3a3950'),
    lightGreen: hex('#39ff6a'),
    lightRed: hex('#ff2a4d'),
    lampPink: hex('#ff4fc8'),
    lampCyan: hex('#3ff0ff'),
    plaza: hex('#1f6a5a'),
    monumentStone: hex('#cfc6ee'),
    monumentGold: hex('#ffc23d'),
    cars: [hex('#00f0ff'), hex('#ff7ad9'), hex('#ffd21f'), hex('#3d8bff'), hex('#9dff4d'), hex('#ff8a3d')],
    motorcycle: hex('#b6ff1a'),
    ambulance: hex('#f4f4ff'),
    cabin: hex('#0a0a14'),
    wheel: hex('#202028'),
    sirenRed: hex('#ff1f3d'),
    sirenBlue: hex('#2f6bff'),
};
