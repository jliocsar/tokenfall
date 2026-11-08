export const AURA_VERTEX = `#version 300 es
precision highp float;

in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform sampler2D uEmitters;
uniform float uTime;
uniform float uParticles;
uniform float uLifetime;
uniform float uRadius;
uniform float uRise;
uniform float uSize;
uniform float uSpin;
uniform vec4 uInner;
uniform vec4 uOuter;

out vec2 vUv;
out vec4 vColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  int count = int(uParticles);
  int slot = gl_InstanceID / count;
  int index = gl_InstanceID - slot * count;
  vec4 emitter = texelFetch(uEmitters, ivec2(slot * 2, 0), 0);
  float age = uTime - emitter.z;
  vUv = aPosition + 0.5;

  if (emitter.z < 0.0 || age < 0.0) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vColor = vec4(0.0);
    return;
  }

  float seed = emitter.w + float(index) * 1.618;
  float phase = fract(age / uLifetime + hash(seed));
  float angle = 6.2831853 * hash(seed * 2.3) + uSpin * age;
  float radius = uRadius * (0.55 + 0.45 * hash(seed * 5.1));
  vec2 offset = vec2(cos(angle) * radius, sin(angle) * radius * 0.5 - uRise * phase);
  float size = uSize * (1.0 - 0.6 * phase);
  vec4 color = mix(uInner, uOuter, phase);
  float fade = sin(3.14159265 * phase) * smoothstep(0.0, 0.6, age);
  vColor = vec4(color.rgb, color.a * fade);
  vec2 position = emitter.xy + offset + aPosition * size;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);
}
`
