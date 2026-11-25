#version 300 es
precision highp float;

in vec3 v_normal;
in vec4 v_color;
in vec3 v_worldPosition;
in vec3 v_localPosition;
in vec3 v_localNormal;
in float v_heightScale;

// Per-object color, tinted by the vertex color of the mesh
uniform vec4 u_color;
// Direction the light travels, in world space
uniform vec3 u_lightDirection;
uniform vec3 u_lightColor;
uniform vec4 u_ambientColor;
// 0 = shaded by the light, 1 = full color regardless of the light (neon, lamps)
uniform float u_emissive;

// Window strips on the sides of a unit box (buildings only)
uniform float u_windows;
uniform float u_windowSeed;
uniform vec3 u_windowColor;
uniform vec3 u_windowAltColor;

// Distance fog toward the horizon haze
uniform vec3 u_cameraPosition;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;

out vec4 outColor;

const float FLOOR_HEIGHT = 0.2;
const float COLUMNS = 3.0;

float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// 0 outside a window, otherwise how lit it is; picks the alt color in `alt`
float windowLight(out float alt) {
    alt = 0.0;
    vec3 n = v_localNormal;
    if (u_windows < 0.5 || abs(n.y) > 0.5) {
        return 0.0;
    }
    float across = abs(n.x) > 0.5 ? v_localPosition.z : v_localPosition.x;
    float height = (v_localPosition.y + 0.5) * v_heightScale;
    float roofGap = v_heightScale - height;
    if (height < 0.12 || roofGap < 0.1) {
        return 0.0;
    }
    float floorIndex = floor(height / FLOOR_HEIGHT);
    float column = floor((across + 0.5) * COLUMNS);
    float inBand = step(0.35, fract(height / FLOOR_HEIGHT)) * step(fract(height / FLOOR_HEIGHT), 0.72);
    float inColumn = step(0.18, fract((across + 0.5) * COLUMNS)) * step(fract((across + 0.5) * COLUMNS), 0.82);
    float face = dot(n, vec3(1.0, 2.0, 3.0));
    float pick = hash(vec3(floorIndex, column + face * 5.0, u_windowSeed));
    alt = step(0.88, pick);
    return inBand * inColumn * step(0.42, pick) * (0.65 + 0.35 * fract(pick * 13.0));
}

void main() {
    vec3 base = u_color.rgb * v_color.rgb;
    float diffuse = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
    vec3 lit = base * (u_ambientColor.rgb + diffuse * u_lightColor);
    vec3 color = mix(lit, base, u_emissive);

    float alt;
    float window = windowLight(alt);
    color = mix(color, mix(u_windowColor, u_windowAltColor, alt), window);

    // Neon cuts through the haze a little better than unlit surfaces
    float glow = max(u_emissive, window);
    float fog = smoothstep(u_fogNear, u_fogFar, distance(v_worldPosition, u_cameraPosition));
    outColor = vec4(mix(color, u_fogColor, fog * (1.0 - 0.45 * glow)), u_color.a);
}
