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

// Road paint on the top of a road tile, in the tile's frame (see road_markings.ts)
uniform float u_marking;
uniform vec2 u_markAhead;
uniform vec2 u_markEdges;
uniform float u_markArrow;
uniform float u_markStop;
uniform float u_markPhase;
uniform vec3 u_paintColor;
uniform vec3 u_dividerColor;

// Distance fog toward the horizon haze
uniform vec3 u_cameraPosition;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;

out vec4 outColor;

const float FLOOR_HEIGHT = 0.2;
const float COLUMNS = 3.0;
// Windows whose hash is below this stay dark: about a quarter of them
const float LIT_SHARE_CUTOFF = 0.25;

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
    return inBand * inColumn * step(LIT_SHARE_CUTOFF, pick) * (0.7 + 0.3 * fract(pick * 13.0));
}

// Matches EDGE_* in road_markings.ts
const float EDGE_DASHED = 1.0;
const float EDGE_DIVIDER = 2.0;
const float EDGE_CURB = 3.0;
const float LINE_HALF = 0.025;

// Paint on one lane edge; `fromEdge` is the distance in from that side of the tile.
float edgePaint(float kind, float fromEdge, float ahead, out float divider) {
    divider = 0.0;
    if (kind == EDGE_DASHED) {
        float dash = step(fract(ahead + u_markPhase), 0.5);
        return dash * step(fromEdge, LINE_HALF);
    }
    if (kind == EDGE_DIVIDER) {
        divider = 1.0;
        return step(fromEdge, 1.5 * LINE_HALF);
    }
    if (kind == EDGE_CURB) {
        return step(0.04, fromEdge) * step(fromEdge, 0.04 + 2.0 * LINE_HALF);
    }
    return 0.0;
}

// 0 for bare road; otherwise paint strength, and whether it is the divider color
float roadPaint(out float divider) {
    divider = 0.0;
    if (u_marking < 0.5 || v_localNormal.y < 0.5) {
        return 0.0;
    }
    vec2 uv = v_localPosition.xz;
    vec2 perp = vec2(u_markAhead.y, -u_markAhead.x);
    float ahead = dot(uv, u_markAhead);
    float side = dot(uv, perp);
    float d0;
    float d1;
    float paint = max(edgePaint(u_markEdges.x, 0.5 - side, ahead, d0), edgePaint(u_markEdges.y, 0.5 + side, ahead, d1));
    divider = max(d0, d1);
    float stopLine = u_markStop * step(0.34, ahead) * step(ahead, 0.44) * step(abs(side), 0.4);
    float shaft = step(-0.3, ahead) * step(ahead, 0.08) * step(abs(side), 0.035);
    float head = step(0.08, ahead) * step(ahead, 0.3) * step(abs(side), 0.8 * (0.3 - ahead));
    float arrow = u_markArrow * max(shaft, head);
    float shapes = max(stopLine, arrow);
    divider *= 1.0 - shapes;
    return max(paint, shapes);
}

void main() {
    vec3 base = u_color.rgb * v_color.rgb;
    float divider;
    float paint = roadPaint(divider);
    base = mix(base, mix(u_paintColor, u_dividerColor, divider), paint);
    float diffuse = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
    vec3 lit = base * (u_ambientColor.rgb + diffuse * u_lightColor);
    // Paint is retroreflective: it stays readable under the night sky
    vec3 color = mix(lit, base, max(u_emissive, 0.7 * paint));

    float alt;
    float window = windowLight(alt);
    color = mix(color, mix(u_windowColor, u_windowAltColor, alt), window);

    // Neon cuts through the haze a little better than unlit surfaces
    float glow = max(u_emissive, window);
    float fog = smoothstep(u_fogNear, u_fogFar, distance(v_worldPosition, u_cameraPosition));
    outColor = vec4(mix(color, u_fogColor, fog * (1.0 - 0.45 * glow)), u_color.a);
}
