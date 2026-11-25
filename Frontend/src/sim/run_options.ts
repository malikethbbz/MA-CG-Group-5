/*
 * Which GUI settings go to POST /init, and which /init failures are worth retrying.
 */

import { ApiError, type InitOptions } from '../api/client';
import { DEFAULT_SPAWN_POINTS, type SpawnPoints } from '../config';

export interface RunOptions {
    readonly spawnInterval: number;
    readonly spawnPoints: SpawnPoints;
}

// spawnPoints is only sent when it differs from the server default, so a server that
// does not know the option yet still starts the default run.
export function initOptions(run: RunOptions): InitOptions {
    return run.spawnPoints === DEFAULT_SPAWN_POINTS
        ? { spawnInterval: run.spawnInterval }
        : { spawnInterval: run.spawnInterval, spawnPoints: run.spawnPoints };
}

// A 4xx means the server rejected the request itself; sending it again cannot help.
export function isClientError(error: unknown): boolean {
    return error instanceof ApiError && error.status !== null && error.status >= 400 && error.status < 500;
}
