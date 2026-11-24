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

// How long to wait before retrying a failed /init, /city or /step request.
export const RETRY_DELAY_MS = 1500;
