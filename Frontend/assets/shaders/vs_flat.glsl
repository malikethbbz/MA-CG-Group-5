#version 300 es
in vec4 a_position;
in vec3 a_normal;
in vec4 a_color;

uniform mat4 u_worldViewProjection;
uniform mat4 u_worldInverseTransform;

out vec3 v_normal;
out vec4 v_color;

void main() {
    gl_Position = u_worldViewProjection * a_position;
    v_normal = mat3(u_worldInverseTransform) * a_normal;
    v_color = a_color;
}
