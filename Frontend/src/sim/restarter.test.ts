import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createRestarter, type RestarterDeps } from './restarter';
import { retryUntilOk } from './retry';
import { DEFAULT_MAP } from '../config';
import { initOptions, isClientError, type RunOptions } from './run_options';

const NORMAL: RunOptions = { map: DEFAULT_MAP, spawnInterval: 10, spawnPoints: 'corners' };
const EDGES: RunOptions = { map: DEFAULT_MAP, spawnInterval: 10, spawnPoints: 'edges' };
const BUSY: RunOptions = { map: DEFAULT_MAP, spawnInterval: 5, spawnPoints: 'corners' };

function deps(overrides: Partial<RestarterDeps>, wanted: () => RunOptions): RestarterDeps {
    return {
        wanted,
        init: async () => undefined,
        stopRun: vi.fn(),
        startRun: vi.fn(),
        onRefused: vi.fn(),
        onFailed: vi.fn(),
        ...overrides,
    };
}

describe('initOptions', () => {
    it('leaves spawnPoints out for the default corners, so older servers still start', () => {
        expect(initOptions(NORMAL)).toEqual({ spawnInterval: 10 });
        expect(initOptions(EDGES)).toEqual({ spawnInterval: 10, spawnPoints: 'edges' });
    });

    it('sends the map only when it is not the default', () => {
        expect(initOptions({ ...NORMAL, map: '2025_reforma.txt' }))
            .toEqual({ spawnInterval: 10, map: '2025_reforma.txt' });
    });
});

describe('isClientError', () => {
    it('is true for a 4xx from the server only', () => {
        expect(isClientError(new ApiError('bad', 400))).toBe(true);
        expect(isClientError(new ApiError('down', 503))).toBe(false);
        expect(isClientError(new ApiError('offline', null))).toBe(false);
        expect(isClientError(new Error('x'))).toBe(false);
    });
});

describe('retryUntilOk with a refusal', () => {
    it('throws a refused request at once instead of retrying it forever', async () => {
        const task = vi.fn().mockRejectedValue(new ApiError('spawnPoints must be ...', 400));
        const onError = vi.fn();
        let sleeps = 0;
        const sleep = async () => {
            if (++sleeps > 2) {
                throw new Error('kept retrying a refused request');
            }
        };
        await expect(retryUntilOk(task, onError, 10, sleep, (e) => !isClientError(e)))
            .rejects.toThrow('spawnPoints');
        expect(task).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });

    it('still retries a server that is down', async () => {
        const task = vi.fn().mockRejectedValueOnce(new ApiError('down', 503)).mockResolvedValueOnce('ok');
        await expect(retryUntilOk(task, () => undefined, 10, async () => undefined, (e) => !isClientError(e)))
            .resolves.toBe('ok');
        expect(task).toHaveBeenCalledTimes(2);
    });
});

describe('createRestarter', () => {
    it('stops the current run, re-inits with the wanted options, then polls again', async () => {
        const init = vi.fn(async () => undefined);
        const d = deps({ init }, () => EDGES);
        await createRestarter(d, NORMAL).restart();
        expect(d.stopRun).toHaveBeenCalledTimes(1);
        expect(init).toHaveBeenCalledWith(EDGES);
        expect(d.startRun).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous run going and reports it when the server refuses', async () => {
        const init = vi.fn(async (run: RunOptions) => {
            if (run.spawnPoints === 'edges') {
                throw new ApiError('/init failed with 400: unknown spawnPoints', 400);
            }
        });
        let wanted = BUSY;
        const d = deps({ init }, () => wanted);
        const restarter = createRestarter(d, NORMAL);
        await restarter.restart();
        wanted = { ...BUSY, spawnPoints: 'edges' };
        await restarter.restart();
        // The options still in effect are the last ones the server accepted
        expect(d.onRefused).toHaveBeenCalledWith(expect.any(ApiError), BUSY);
        expect(d.startRun).toHaveBeenCalledTimes(2);
        expect(d.onFailed).not.toHaveBeenCalled();
    });

    it('runs /init once per burst of changes, for the latest choice, never in parallel', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const init = vi.fn(async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
        });
        let wanted = NORMAL;
        const d = deps({ init }, () => wanted);
        const restarter = createRestarter(d, NORMAL);
        const first = restarter.restart();
        wanted = BUSY;
        restarter.restart();
        wanted = EDGES;
        await Promise.all([first, restarter.restart()]);
        expect(maxInFlight).toBe(1);
        expect(init.mock.calls.at(-1)).toEqual([EDGES]);
        expect(d.startRun).toHaveBeenCalledTimes(1);
    });

    it('does not start polling for a request overtaken while its /init was in flight', async () => {
        let release: () => void = () => undefined;
        const init = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
            .mockResolvedValue(undefined);
        let wanted = BUSY;
        const d = deps({ init }, () => wanted);
        const restarter = createRestarter(d, NORMAL);
        const first = restarter.restart();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(init).toHaveBeenCalledTimes(1);
        wanted = EDGES;
        const second = restarter.restart();
        release();
        await Promise.all([first, second]);
        expect(init.mock.calls).toEqual([[BUSY], [EDGES]]);
        expect(d.startRun).toHaveBeenCalledTimes(1);
    });

    it('reports an unexpected failure and keeps accepting restarts', async () => {
        const init = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
        const d = deps({ init }, () => BUSY);
        const restarter = createRestarter(d, NORMAL);
        await restarter.restart();
        expect(d.onFailed).toHaveBeenCalledTimes(1);
        await restarter.restart();
        expect(d.startRun).toHaveBeenCalledTimes(1);
    });
});
