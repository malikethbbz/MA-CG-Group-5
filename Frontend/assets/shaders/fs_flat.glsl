#version 300 es
precision highp float;

in vec3 v_normal;
in vec4 v_color;

// Per-object color, tinted by the vertex color of the mesh
uniform vec4 u_color;
// Direction the light travels, in world space
uniform vec3 u_lightDirection;
uniform vec4 u_ambientColor;
// 0 = shaded by the light, 1 = full color regardless of the light (neon, lamps)
uniform float u_emissive;

out vec4 outColor;

void main() {
    vec3 base = u_color.rgb * v_color.rgb;
    float diffuse = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
    vec3 lit = base * (u_ambientColor.rgb + diffuse);
    outColor = vec4(mix(lit, base, u_emissive), u_color.a);
}
