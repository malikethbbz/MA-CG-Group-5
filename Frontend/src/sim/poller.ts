/*
 * Polls /step at the configured interval. The next request is only scheduled after
 * the previous one settles, so requests never overlap. Failures are reported and
 * retried; polling ends once a frame says the model stopped running.
 */

import type { StepFrame } from '../api/contract';

export type Schedule = (task: () => void, delayMs: number) => void;

export interface PollerOptions {
    fetchStep: () => Promise<StepFrame>;
    intervalMs: () => number;
    retryDelayMs: number;
    onFrame: (frame: StepFrame) => void;
    onError: (error: unknown) => void;
    onFinished: (frame: StepFrame) => void;
    schedule?: Schedule;
}

export interface Poller {
    stop(): void;
}

const defaultSchedule: Schedule = (task, delayMs) => {
    setTimeout(task, delayMs);
};

export function startPolling(options: PollerOptions): Poller {
    const schedule = options.schedule ?? defaultSchedule;
    let stopped = false;

    const tick = async (): Promise<void> => {
        if (stopped) {
            return;
        }
        let frame: StepFrame;
        try {
            frame = await options.fetchStep();
            options.onFrame(frame);
        } catch (error) {
            options.onError(error);
            schedule(tick, options.retryDelayMs);
            return;
        }
        if (!frame.running) {
            stopped = true;
            options.onFinished(frame);
            return;
        }
        schedule(tick, options.intervalMs());
    };

    void tick();
    return {
        stop() {
            stopped = true;
        },
    };
}
