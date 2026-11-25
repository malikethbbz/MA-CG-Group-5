/*
 * Which GUI settings go to POST /init, and which /init failures are worth retrying.
 */

import { ApiError, type InitOptions } from '../api/client';
import { DEFAULT_MAP, DEFAULT_SPAWN_POINTS, type SpawnPoints } from '../config';

export interface RunOptions {
    readonly map: string;
    readonly spawnInterval: number;
    readonly spawnPoints: SpawnPoints;
}

// map and spawnPoints are only sent when they differ from the server defaults, so a
// server that does not know an option yet still starts the default run.
export function initOptions(run: RunOptions): InitOptions {
    return {
        spawnInterval: run.spawnInterval,
        ...(run.spawnPoints === DEFAULT_SPAWN_POINTS ? {} : { spawnPoints: run.spawnPoints }),
        ...(run.map === DEFAULT_MAP ? {} : { map: run.map }),
    };
}

// A 4xx means the server rejected the request itself; sending it again cannot help.
export function isClientError(error: unknown): boolean {
    return error instanceof ApiError && error.status !== null && error.status >= 400 && error.status < 500;
}
