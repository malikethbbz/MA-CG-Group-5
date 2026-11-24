import { describe, expect, it, vi } from 'vitest';
import type { StepFrame } from '../api/contract';
import { startPolling, type Schedule } from './poller';

function frame(step: number, running: boolean): StepFrame {
    return {
        step, running, lights: [], vehicles: [], events: [],
        stats: { step, running, stopReason: running ? null : 'done', spawned: 0, arrived: 0,
            active: 0, avgTripSteps: null, avgWaitSteps: null },
    };
}

// A manual clock: scheduled tasks only run when the test says so.
function manualSchedule() {
    const queue: { task: () => void; delay: number }[] = [];
    const schedule: Schedule = (task, delay) => {
        queue.push({ task, delay });
    };
    return { schedule, queue };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startPolling', () => {
    it('waits for a response before scheduling the next request', async () => {
        let resolve: (f: StepFrame) => void = () => undefined;
        const fetchStep = vi.fn(() => new Promise<StepFrame>((r) => { resolve = r; }));
        const { schedule, queue } = manualSchedule();
        startPolling({ fetchStep, intervalMs: () => 400, retryDelayMs: 900, schedule,
            onFrame: () => undefined, onError: () => undefined, onFinished: () => undefined });

        await flush();
        expect(fetchStep).toHaveBeenCalledTimes(1);
        expect(queue).toHaveLength(0);
        resolve(frame(1, true));
        await flush();
        expect(queue.map((q) => q.delay)).toEqual([400]);
    });

    it('retries after a failure and keeps going', async () => {
        const fetchStep = vi.fn<() => Promise<StepFrame>>()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(frame(1, true));
        const { schedule, queue } = manualSchedule();
        const onError = vi.fn();
        const onFrame = vi.fn();
        startPolling({ fetchStep, intervalMs: () => 400, retryDelayMs: 900, schedule,
            onFrame, onError, onFinished: () => undefined });

        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(queue.map((q) => q.delay)).toEqual([900]);
        queue.shift()!.task();
        await flush();
        expect(onFrame).toHaveBeenCalledWith(frame(1, true));
        expect(queue.map((q) => q.delay)).toEqual([400]);
    });

    it('stops polling after a frame that is no longer running', async () => {
        const fetchStep = vi.fn(async () => frame(7, false));
        const { schedule, queue } = manualSchedule();
        const onFinished = vi.fn();
        startPolling({ fetchStep, intervalMs: () => 400, retryDelayMs: 900, schedule,
            onFrame: () => undefined, onError: () => undefined, onFinished });

        await flush();
        expect(onFinished).toHaveBeenCalledWith(frame(7, false));
        expect(queue).toHaveLength(0);
    });

    it('reads the interval on every step so the slider applies live', async () => {
        let interval = 400;
        const fetchStep = vi.fn(async () => frame(1, true));
        const { schedule, queue } = manualSchedule();
        startPolling({ fetchStep, intervalMs: () => interval, retryDelayMs: 900, schedule,
            onFrame: () => undefined, onError: () => undefined, onFinished: () => undefined });
        await flush();
        interval = 1200;
        queue.shift()!.task();
        await flush();
        expect(queue.map((q) => q.delay)).toEqual([1200]);
    });
});
