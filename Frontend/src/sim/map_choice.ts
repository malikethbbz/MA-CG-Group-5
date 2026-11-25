/*
 * The map lives in the URL (?map=...), so a link opens the same city and switching
 * maps is a plain reload that rebuilds the city from /city.
 */

import { DEFAULT_MAP, MAP_CHOICES } from '../config';

const KNOWN_MAPS = new Set(Object.values(MAP_CHOICES));

// Unknown or missing values fall back to the default instead of failing /init.
export function mapFromUrl(search: string): string {
    const requested = new URLSearchParams(search).get('map');
    return requested !== null && KNOWN_MAPS.has(requested) ? requested : DEFAULT_MAP;
}

export function urlForMap(href: string, map: string): string {
    const url = new URL(href);
    if (map === DEFAULT_MAP) {
        url.searchParams.delete('map');
    } else {
        url.searchParams.set('map', map);
    }
    return url.toString();
}
