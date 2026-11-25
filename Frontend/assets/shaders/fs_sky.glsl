#version 300 es
precision highp float;
// STAR_COUNT is defined by render/sky_pass.ts from world/sky.ts

in vec2 v_ndc;

// Turns a screen point back into a world-space ray
uniform mat4 u_inverseViewProjection;
// Horizontal camera axes, so the ring stays centred behind the city
uniform vec3 u_forward;
uniform vec3 u_right;
uniform float u_time;
// (azimuth, elevation, angular size, brightness) per star
uniform vec4 u_stars[STAR_COUNT];
uniform float u_ringElevation;
uniform float u_ringRadius;

uniform vec3 u_zenith;
uniform vec3 u_midSky;
uniform vec3 u_horizon;
uniform vec3 u_haze;
// How much haze is added right at the horizon; the fog color matches that sum
uniform float u_hazeStrength;
uniform vec3 u_ring;
uniform vec3 u_star;

out vec4 outColor;

const float PI = 3.14159265;

vec3 rayDirection() {
    vec4 near = u_inverseViewProjection * vec4(v_ndc, -1.0, 1.0);
    vec4 far = u_inverseViewProjection * vec4(v_ndc, 1.0, 1.0);
    return normalize(far.xyz / far.w - near.xyz / near.w);
}

vec3 gradient(float elevation) {
    vec3 low = mix(u_horizon, u_midSky, smoothstep(0.0, 0.16, elevation));
    return mix(low, u_zenith, smoothstep(0.1, 0.55, elevation));
}

vec3 ring(vec3 dir, float elevation) {
    float across = atan(dot(dir, u_right), dot(dir, u_forward));
    float d = length(vec2(across, elevation - u_ringElevation));
    float edge = abs(d - u_ringRadius);
    float core = exp(-edge * edge / 0.00003);
    float glow = exp(-edge / 0.018) * 0.55 + exp(-edge / 0.09) * 0.25;
    // The lower half sinks behind the horizon
    float visible = smoothstep(-0.015, 0.02, elevation);
    return u_ring * (core * 1.6 + glow) * visible;
}

vec3 stars(float azimuth, float elevation) {
    vec3 light = vec3(0.0);
    for (int i = 0; i < STAR_COUNT; i++) {
        vec4 s = u_stars[i];
        float da = mod(azimuth - s.x + PI, 2.0 * PI) - PI;
        float d = length(vec2(da * cos(elevation), elevation - s.y));
        float twinkle = 0.75 + 0.25 * sin(u_time * (1.0 + fract(s.x * 7.3)) + s.y * 40.0);
        light += u_star * s.w * twinkle * smoothstep(s.z, 0.0, d);
    }
    return light;
}

void main() {
    vec3 dir = rayDirection();
    float elevation = asin(clamp(dir.y, -1.0, 1.0));
    float azimuth = atan(dir.x, dir.z);
    // Below the horizon only the haze shows (past the fogged ground), flat so it
    // matches the fog color the scene shader fades far geometry into
    float above = max(elevation, 0.0);
    vec3 color = gradient(above) + u_haze * exp(-above * 24.0) * u_hazeStrength;
    color += ring(dir, elevation);
    if (elevation > 0.08) {
        color += stars(azimuth, elevation);
    }
    outColor = vec4(color, 1.0);
}
