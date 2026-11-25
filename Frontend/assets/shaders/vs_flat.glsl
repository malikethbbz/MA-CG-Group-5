#version 300 es
in vec4 a_position;
in vec3 a_normal;
in vec4 a_color;

uniform mat4 u_world;
// Set once per frame; the GPU does the per-object multiply instead of JavaScript
uniform mat4 u_viewProjection;
uniform mat4 u_worldInverseTransform;

// The glorieta warp, mirroring warpPoint() in src/world/glorieta.ts
uniform float u_ringOn;
uniform vec2 u_ringCentre;
uniform vec2 u_ringIsland;
uniform vec2 u_ringOuter;
uniform float u_ringRadius;
uniform float u_ringLanes;
uniform float u_ringBlend;
// 0 for items already placed on the circle, such as the monument at its centre
uniform float u_warp;

out vec3 v_normal;
out vec4 v_color;
out vec3 v_worldPosition;
// Mesh-space position and normal, for the window pattern on building sides
out vec3 v_localPosition;
out vec3 v_localNormal;
// World height of the mesh, so windows keep a fixed floor height
out float v_heightScale;

const float TAU = 6.28318530718;

float aroundRectangle(vec2 p, vec2 extent) {
    float perimeter = 4.0 * (extent.x + extent.y);
    float t;
    if (extent.x - abs(p.x) <= extent.y - abs(p.y)) {
        t = p.x > 0.0 ? p.y : extent.y + 2.0 * extent.x + (extent.y - p.y);
    } else {
        t = p.y > 0.0 ? extent.y + (extent.x - p.x) : 3.0 * extent.y + 2.0 * extent.x + (p.x + extent.x);
    }
    return fract(t / perimeter);
}

vec2 onCircle(float share, float radius) {
    float angle = TAU * share;
    return radius * vec2(cos(angle), sin(angle));
}

vec2 warpPoint(vec2 q) {
    vec2 p = q - u_ringCentre;
    float inset = min(u_ringOuter.x - abs(p.x), u_ringOuter.y - abs(p.y));
    vec2 bent;
    if (inset >= u_ringLanes) {
        float s = max(abs(p.x) / u_ringIsland.x, abs(p.y) / u_ringIsland.y);
        bent = s == 0.0 ? vec2(0.0)
            : onCircle(aroundRectangle(p / s, u_ringIsland), s * (u_ringRadius - u_ringLanes));
    } else {
        bent = onCircle(aroundRectangle(p, u_ringOuter - inset), u_ringRadius - inset);
    }
    float w = 1.0 - smoothstep(0.0, u_ringBlend, -inset);
    return mix(q, bent + u_ringCentre, w);
}

void main() {
    vec4 world = u_world * a_position;
    v_normal = mat3(u_worldInverseTransform) * a_normal;
    if (u_ringOn > 0.5 && u_warp > 0.5) {
        vec2 warped = warpPoint(world.xz);
        // Turn the normal with the bend, measured from where a step along +x lands
        vec2 along = warpPoint(world.xz + vec2(0.01, 0.0)) - warped;
        float turn = atan(along.y, along.x);
        float c = cos(turn);
        float s = sin(turn);
        v_normal.xz = vec2(c * v_normal.x - s * v_normal.z, s * v_normal.x + c * v_normal.z);
        world.xz = warped;
    }
    gl_Position = u_viewProjection * world;
    v_color = a_color;
    v_worldPosition = world.xyz;
    v_localPosition = a_position.xyz;
    v_localNormal = a_normal;
    v_heightScale = length(u_world[1].xyz);
}
