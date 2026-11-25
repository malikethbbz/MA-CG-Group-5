#version 300 es
in vec4 a_position;
in vec3 a_normal;
in vec4 a_color;

uniform mat4 u_world;
uniform mat4 u_worldViewProjection;
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
    gl_Position = u_worldViewProjection * a_position;
    v_normal = mat3(u_worldInverseTransform) * a_normal;
    v_color = a_color;
    v_worldPosition = (u_world * a_position).xyz;
    v_localPosition = a_position.xyz;
    v_localNormal = a_normal;
    v_heightScale = length(u_world[1].xyz);
}
