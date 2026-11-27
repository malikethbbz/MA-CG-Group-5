#version 300 es
in vec4 a_position;
in vec3 a_normal;
in vec2 a_texCoord;

// Scene uniforms
uniform vec3 u_lightWorldPosition;
uniform vec3 u_viewWorldPosition;

// Model uniforms
uniform mat4 u_world;
uniform mat4 u_worldInverseTransform;
uniform mat4 u_worldViewProjection;
// Street tiles only: the part of the texture shown across the lane (offset, scale)
uniform vec2 u_texBand;

out vec3 v_normal;
out vec3 v_surfaceToLight;
out vec3 v_surfaceToView;
out vec2 v_texCoord;

void main() {
    // Transform the position of the vertices
    gl_Position = u_worldViewProjection * a_position;

    // Transform the normal vector along with the object
    v_normal = mat3(u_worldInverseTransform) * a_normal;

    // Get world position of the surface
    vec3 surfaceWorldPosition = (u_world * a_position).xyz;

    // Direction from the surface to the light and to the view
    v_surfaceToLight = u_lightWorldPosition - surfaceWorldPosition;
    v_surfaceToView = u_viewWorldPosition - surfaceWorldPosition;

    // u runs along the lane; v across it, squeezed into the lane's band
    v_texCoord = vec2(a_texCoord.x, u_texBand.x + u_texBand.y * a_texCoord.y);
}
