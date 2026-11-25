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

// Traffic presets for the GUI, as /init spawnInterval values (1..10, lower is denser).
// 10 is the assignment's rate; 2 still flows, 1 gridlocks the map.
export const TRAFFIC_LEVELS: Readonly<Record<string, number>> = {
    'Normal': 10,
    'Busy': 5,
    'Rush hour': 3,
    'Gridlock-ish': 2,
};
export const DEFAULT_SPAWN_INTERVAL = 10;

// Where cars enter: the four corners (the assignment's rule) or every border road cell.
export type SpawnPoints = 'corners' | 'edges';
export const SPAWN_POINT_CHOICES: Readonly<Record<string, SpawnPoints>> = {
    'Corners': 'corners',
    'Whole border': 'edges',
};
export const DEFAULT_SPAWN_POINTS: SpawnPoints = 'corners';

// Maps the server can load. The original map is the assignment's and stays the default.
export const MAP_CHOICES: Readonly<Record<string, string>> = {
    'Original (2025)': '2025_base.txt',
    'Reforma glorieta': '2025_reforma.txt',
};
export const DEFAULT_MAP = '2025_base.txt';

// How long to wait before retrying a failed /init, /city or /step request.
export const RETRY_DELAY_MS = 1500;
