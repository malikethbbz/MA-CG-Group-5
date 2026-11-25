/*
 * Uniforms for the sky pass and the scene fog. Both use the SKY colors, so the far
 * edge of the city fades into the same pink haze the sky has at the horizon.
 */

import { M4, type Mat4 } from '../../libs/3d-lib';
import type { Color } from '../../libs/color';
import { HAZE_STRENGTH, SKY } from '../world/palette';
import { RING_ELEVATION, RING_RADIUS, starField, starUniforms } from '../world/sky';

// Fog starts a bit in front of the camera target and is full past the far side of the map.
const FOG_NEAR_FACTOR = 0.75;
const FOG_FAR_EXTENT_FACTOR = 1.6;

const STARS = starUniforms(starField());

const rgb = (color: Color): number[] => [color[0], color[1], color[2]];

const FOG_COLOR = rgb(SKY.horizon).map((c, i) => c + HAZE_STRENGTH * SKY.haze[i]);

// Prepends #define lines right after the #version line of a GLSL source.
export function withDefines(source: string, defines: Readonly<Record<string, number>>): string {
    const [version, ...rest] = source.split('\n');
    const lines = Object.entries(defines).map(([name, value]) => `#define ${name} ${value}`);
    return [version, ...lines, ...rest].join('\n');
}

export function skyUniforms(viewProjection: Mat4, azimuth: number, timeMs: number): Record<string, unknown> {
    // Camera3D sits at +(sin az, cos az) from its target, so it looks the other way
    const forward = [-Math.sin(azimuth), 0, -Math.cos(azimuth)];
    const right = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
    return {
        u_inverseViewProjection: M4.inverse(viewProjection),
        u_forward: forward,
        u_right: right,
        u_time: timeMs / 1000,
        u_stars: STARS,
        u_ringElevation: RING_ELEVATION,
        u_ringRadius: RING_RADIUS,
        u_zenith: rgb(SKY.zenith),
        u_midSky: rgb(SKY.midSky),
        u_horizon: rgb(SKY.horizon),
        u_haze: rgb(SKY.haze),
        u_hazeStrength: HAZE_STRENGTH,
        u_ring: rgb(SKY.ring),
        u_star: rgb(SKY.star),
    };
}

export function fogUniforms(cameraPosition: Float32Array, cameraDistance: number, extent: number):
    Record<string, unknown> {
    return {
        u_cameraPosition: cameraPosition,
        u_fogColor: FOG_COLOR,
        u_fogNear: cameraDistance * FOG_NEAR_FACTOR,
        u_fogFar: cameraDistance + extent * FOG_FAR_EXTENT_FACTOR,
    };
}
