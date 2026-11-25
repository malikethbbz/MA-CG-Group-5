/*
 * Pure data for the sky pass: a seeded star field and the eclipse ring position.
 * Angles are in radians: `azimuth` around +y (atan2(x, z), like headingToYaw) and
 * `elevation` above the horizon. No WebGL here.
 */

export interface Star {
    readonly azimuth: number;
    readonly elevation: number;
    // Angular radius of the star's glow, and its peak brightness in [0, 1]
    readonly size: number;
    readonly brightness: number;
}

export const STAR_COUNT = 120;
export const STAR_SEED = 2008;
// Stars stay in the upper sky, above the pink horizon haze.
export const STAR_MIN_ELEVATION = 0.12;
export const STAR_MAX_ELEVATION = 1.2;

// The halo sits low and centred behind the city: on the camera's forward axis.
export const RING_ELEVATION = 0.07;
export const RING_RADIUS = 0.2;

// mulberry32: small, fast, and the same sequence for the same seed in every browser.
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function starField(seed: number = STAR_SEED, count: number = STAR_COUNT): Star[] {
    const random = seededRandom(seed);
    const range = STAR_MAX_ELEVATION - STAR_MIN_ELEVATION;
    return Array.from({ length: count }, () => {
        const azimuth = (random() * 2 - 1) * Math.PI;
        // squaring packs more stars low in the sky, where the default view sees them
        const elevation = STAR_MIN_ELEVATION + range * random() ** 2;
        const size = 0.002 + 0.003 * random();
        const brightness = 0.35 + 0.65 * random();
        return { azimuth, elevation, size, brightness };
    });
}

// Flattened as vec4s (azimuth, elevation, size, brightness) for a uniform array.
export function starUniforms(stars: readonly Star[]): number[] {
    return stars.flatMap((star) => [star.azimuth, star.elevation, star.size, star.brightness]);
}
