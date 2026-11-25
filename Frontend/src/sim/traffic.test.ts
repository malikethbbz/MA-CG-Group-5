import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAFFIC, TRAFFIC_PRESETS } from '../config';
import { trafficName, trafficPreset } from './traffic';

describe('traffic presets', () => {
    it('keeps the assignment rate as the default', () => {
        expect(trafficPreset(DEFAULT_TRAFFIC)).toEqual({ spawnInterval: 10, spawnPoints: 'corners' });
    });

    it('only uses edge spawning at interval 1, where it adds traffic', () => {
        for (const preset of Object.values(TRAFFIC_PRESETS)) {
            expect(preset.spawnPoints === 'edges').toBe(preset.spawnInterval === 1);
        }
    });

    it('round-trips every preset through its options', () => {
        for (const name of Object.keys(TRAFFIC_PRESETS)) {
            expect(trafficName(trafficPreset(name))).toBe(name);
        }
    });

    it('falls back to the default for unknown names and options', () => {
        expect(trafficPreset('nope')).toEqual(trafficPreset(DEFAULT_TRAFFIC));
        expect(trafficName({ spawnInterval: 7, spawnPoints: 'edges' })).toBe(DEFAULT_TRAFFIC);
    });
});
