/*
 * The status line and the stats overlay on top of the canvas.
 * Text only goes in through textContent, never as HTML.
 *
 * Team 5 - TC2008B
 * 2026-11
 */

import type { Stats } from './api_connection';

export type StatusTone = 'info' | 'error' | 'done';

const average = (value: number | null): string => (value === null ? '-' : value.toFixed(1));

export function statsRows(stats: Stats): string[][] {
    const rows = [
        ['Paso', String(stats.step)],
        ['Generados', String(stats.spawned)],
        ['Llegaron', String(stats.arrived)],
        ['Activos', String(stats.active)],
        ['Viaje promedio (pasos)', average(stats.avgTripSteps)],
        ['Espera promedio (pasos)', average(stats.avgWaitSteps)],
    ];
    if (stats.emergenciesServed !== undefined) {
        rows.push(['Emergencias atendidas', String(stats.emergenciesServed)]);
    }
    return rows;
}

export class Hud {
    status = document.getElementById('status') as HTMLElement;
    stats = document.getElementById('stats') as HTMLElement;
    // A message shown with holdMs stays up even if clearStatus is called sooner
    holdUntil = 0;

    showStatus(message: string, tone: StatusTone, holdMs = 0): void {
        this.status.textContent = message;
        this.status.dataset.tone = tone;
        this.status.hidden = false;
        this.holdUntil = performance.now() + holdMs;
    }

    clearStatus(): void {
        if (performance.now() >= this.holdUntil) {
            this.status.hidden = true;
        }
    }

    showStats(stats: Stats): void {
        const rows = statsRows(stats).map(([label, value]) => {
            const row = document.createElement('div');
            const term = document.createElement('dt');
            const detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = value;
            row.append(term, detail);
            return row;
        });
        this.stats.replaceChildren(...rows);
    }
}
