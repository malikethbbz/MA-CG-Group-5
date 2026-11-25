/*
 * Restarts the simulation when a run option (traffic, spawn points) changes.
 * Restarts run one after another so /init calls never race, and only the latest
 * request starts polling. If the server refuses the new options (a 4xx), its model is
 * untouched, so polling resumes on the previous run and the caller is told which
 * options are still in effect.
 */

import { isClientError, type RunOptions } from './run_options';

export interface RestarterDeps {
    // The options the GUI asks for right now
    readonly wanted: () => RunOptions;
    // POST /init; retries transient failures itself, throws when the server refuses
    readonly init: (run: RunOptions) => Promise<void>;
    readonly stopRun: () => void;
    readonly startRun: () => void;
    readonly onRefused: (error: unknown, kept: RunOptions) => void;
    readonly onFailed: (error: unknown) => void;
}

export interface Restarter {
    // Resolves once this request has been handled (or skipped for a newer one)
    restart(): Promise<void>;
}

export function createRestarter(deps: RestarterDeps, initial: RunOptions): Restarter {
    let applied = initial;
    let latest = 0;
    let queue = Promise.resolve();

    const handle = async (request: number): Promise<void> => {
        if (request !== latest) {
            return;
        }
        const run = deps.wanted();
        try {
            await deps.init(run);
            applied = run;
        } catch (error) {
            if (!isClientError(error)) {
                throw error;
            }
            deps.onRefused(error, applied);
        }
        if (request === latest) {
            deps.startRun();
        }
    };

    return {
        restart() {
            const request = ++latest;
            deps.stopRun();
            queue = queue.then(() => handle(request)).catch(deps.onFailed);
            return queue;
        },
    };
}
