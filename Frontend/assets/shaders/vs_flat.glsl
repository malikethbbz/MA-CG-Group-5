#version 300 es
in vec4 a_position;
in vec3 a_normal;
in vec4 a_color;

uniform mat4 u_world;
// Set once per frame; the GPU does the per-object multiply instead of JavaScript
uniform mat4 u_viewProjection;
uniform mat4 u_worldInverseTransform;

out vec3 v_normal;
out vec4 v_color;
out vec3 v_worldPosition;
// Mesh-space position and normal, for the window pattern on building sides
out vec3 v_localPosition;
out vec3 v_localNormal;
// World height of the mesh, so windows keep a fixed floor height
out float v_heightScale;

void main() {
    vec4 world = u_world * a_position;
    gl_Position = u_viewProjection * world;
    v_normal = mat3(u_worldInverseTransform) * a_normal;
    v_color = a_color;
    v_worldPosition = world.xyz;
    v_localPosition = a_position.xyz;
    v_localNormal = a_normal;
    v_heightScale = length(u_world[1].xyz);
}
