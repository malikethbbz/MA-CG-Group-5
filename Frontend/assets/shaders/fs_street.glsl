#version 300 es
precision highp float;

in vec3 v_normal;
in vec3 v_surfaceToLight;
in vec3 v_surfaceToView;
in vec2 v_texCoord;

// Scene uniforms
uniform vec4 u_ambientLight;
uniform vec4 u_diffuseLight;
uniform vec4 u_specularLight;

// Model uniforms
uniform vec4 u_specularColor;
uniform float u_shininess;
uniform sampler2D u_texture;

out vec4 outColor;

void main() {
    // The asphalt and its painted lines come from the street texture
    vec4 color = texture(u_texture, v_texCoord);

    vec3 normal = normalize(v_normal);
    vec3 surfToLigthDirection = normalize(v_surfaceToLight);
    vec3 surfToViewDirection = normalize(v_surfaceToView);

    // Finding the reflection vector
    // https://en.wikipedia.org/wiki/Phong_reflection_model
    vec3 reflectionVector = (2.0 * dot(surfToLigthDirection, normal)
        * normal - surfToLigthDirection);

    float diffuse = max(dot(normal, surfToLigthDirection), 0.0);
    float specular = 0.0;
    if (diffuse > 0.0) {
        specular = pow(max(dot(surfToViewDirection, reflectionVector), 0.0), u_shininess);
    }

    // Compute the three parts of the Phong lighting model
    vec4 ambientColor = color * u_ambientLight;
    vec4 diffuseColor = diffuse * color * u_diffuseLight;
    vec4 specularColor = specular * u_specularColor * u_specularLight;

    outColor = vec4((ambientColor + diffuseColor + specularColor).rgb, 1.0);
}
