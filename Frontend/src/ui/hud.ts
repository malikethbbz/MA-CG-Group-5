/*
 * On-page status line and stats overlay. Text only goes in through textContent.
 */

import type { Stats } from '../api/contract';

export type StatusTone = 'info' | 'error' | 'done';

export interface Hud {
    // holdMs keeps the message up even if clearStatus is called sooner
    showStatus(message: string, tone: StatusTone, holdMs?: number): void;
    clearStatus(): void;
    showStats(stats: Stats): void;
}

function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`index.html is missing the #${id} element.`);
    }
    return found;
}

function formatAverage(value: number | null): string {
    return value === null ? '-' : value.toFixed(1);
}

export function statsRows(stats: Stats): [string, string][] {
    return [
        ['Step', String(stats.step)],
        ['Spawned', String(stats.spawned)],
        ['Arrived', String(stats.arrived)],
        ['Active', String(stats.active)],
        ['Avg trip (steps)', formatAverage(stats.avgTripSteps)],
        ['Avg wait (steps)', formatAverage(stats.avgWaitSteps)],
    ];
}

export function createHud(): Hud {
    const status = element('status');
    const stats = element('stats');
    let holdUntil = 0;
    return {
        showStatus(message, tone, holdMs = 0) {
            status.textContent = message;
            status.dataset.tone = tone;
            status.hidden = false;
            holdUntil = performance.now() + holdMs;
        },
        clearStatus() {
            if (performance.now() >= holdUntil) {
                status.hidden = true;
            }
        },
        showStats(current) {
            const rows = statsRows(current).map(([label, value]) => {
                const row = document.createElement('div');
                const term = document.createElement('dt');
                const detail = document.createElement('dd');
                term.textContent = label;
                detail.textContent = value;
                row.append(term, detail);
                return row;
            });
            stats.replaceChildren(...rows);
        },
    };
}
