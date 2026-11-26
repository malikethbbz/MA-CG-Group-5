/*
 * Settings shared by the API client, the world model and the renderer.
 */

// Override with VITE_SERVER_URL (e.g. `VITE_SERVER_URL=http://host:8585/ npm run dev`).
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8585/';

// World units per grid cell. Grid (x, z) cell centres sit at (x, z) * CELL_SIZE.
export const CELL_SIZE = 1;

export const DEFAULT_STEP_INTERVAL_MS = 400;
export const MIN_STEP_INTERVAL_MS = 100;
export const MAX_STEP_INTERVAL_MS = 2000;

// Where cars enter: the four corners (the assignment's rule) or every border road cell.
export type SpawnPoints = 'corners' | 'edges';
export const DEFAULT_SPAWN_POINTS: SpawnPoints = 'corners';

export interface TrafficPreset {
    // Steps between spawns, sent to /init as spawnInterval (1..10)
    readonly spawnInterval: number;
    readonly spawnPoints: SpawnPoints;
}

// One menu instead of two: edge spawning only adds traffic at interval 1 (the server
// caps it at 3 cars per step), and corners at interval 1 gridlocks. Measured peaks on
// the 2025 map: Normal ~28 cars, Packed ~130, Max city ~257 (about 220 at once).
export const TRAFFIC_PRESETS: Readonly<Record<string, TrafficPreset>> = {
    'Normal (assignment)': { spawnInterval: 10, spawnPoints: 'corners' },
    'Busy': { spawnInterval: 5, spawnPoints: 'corners' },
    'Rush hour': { spawnInterval: 3, spawnPoints: 'corners' },
    'Packed': { spawnInterval: 2, spawnPoints: 'corners' },
    'Max city': { spawnInterval: 1, spawnPoints: 'edges' },
};
export const DEFAULT_TRAFFIC = 'Normal (assignment)';

// Maps the server can load. The original map is the assignment's and stays the default.
export const MAP_CHOICES: Readonly<Record<string, string>> = {
    'Original (2025)': '2025_base.txt',
    'Reforma glorieta': '2025_reforma.txt',
};
export const DEFAULT_MAP = '2025_base.txt';

// How long to wait before retrying a failed /init, /city or /step request.
export const RETRY_DELAY_MS = 1500;
