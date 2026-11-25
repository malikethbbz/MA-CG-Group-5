import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../config';
import { mapFromUrl, urlForMap } from './map_choice';

describe('mapFromUrl', () => {
    it('reads a known map from the query string', () => {
        expect(mapFromUrl('?map=2025_reforma.txt')).toBe('2025_reforma.txt');
    });

    it('falls back to the default for a missing or unknown map', () => {
        expect(mapFromUrl('')).toBe(DEFAULT_MAP);
        expect(mapFromUrl('?map=../city_server.py')).toBe(DEFAULT_MAP);
    });
});

describe('urlForMap', () => {
    it('round-trips through mapFromUrl and keeps other parameters', () => {
        const url = new URL(urlForMap('http://localhost:5180/?debug=1', '2025_reforma.txt'));
        expect(mapFromUrl(url.search)).toBe('2025_reforma.txt');
        expect(url.searchParams.get('debug')).toBe('1');
    });

    it('drops the parameter for the default map', () => {
        expect(urlForMap('http://localhost:5180/?map=2025_reforma.txt', DEFAULT_MAP))
            .toBe('http://localhost:5180/');
    });
});
