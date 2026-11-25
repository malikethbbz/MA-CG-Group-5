#version 300 es
// One triangle that covers the whole screen; the sky is drawn before the city.
in vec2 a_position;

out vec2 v_ndc;

void main() {
    v_ndc = a_position;
    gl_Position = vec4(a_position, 1.0, 1.0);
}
