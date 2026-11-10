export const ARC_VERTEX = `#version 300 es
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
uniform float uSweep;
uniform float uRise;
uniform float uSize;
uniform vec4 uInner;
uniform vec4 uOuter;

out vec2 vUv;
out vec4 vColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void hide() {
  gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
  vColor = vec4(0.0);
}

void place(vec2 position) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);
}

void main() {
  int count = int(uParticles);
  int slot = gl_InstanceID / count;
  int index = gl_InstanceID - slot * count;
  vec4 emitter = texelFetch(uEmitters, ivec2(slot * 2, 0), 0);
  vec4 extra = texelFetch(uEmitters, ivec2(slot * 2 + 1, 0), 0);
  float age = uTime - emitter.z;
  vUv = aPosition + 0.5;

  if (emitter.z < 0.0 || age < 0.0 || age > uLifetime) {
    hide();
    return;
  }

  float k = age / uLifetime;
  float u = float(index) / max(1.0, uParticles - 1.0);
  float swept = clamp(k * 2.2, 0.0, 1.0);

  if (u > swept) {
    hide();
    return;
  }

  float seed = emitter.w + float(index) * 1.618;
  float facing = atan(extra.y * 2.0, extra.x);
  float angle = facing + uSweep * (u - 0.5);
  float radius = uRadius * (0.85 + 0.15 * hash(seed));
  vec2 offset = vec2(cos(angle) * radius, sin(angle) * radius * 0.5 - uRise);
  float edge = 1.0 - abs(u - 0.5) * 2.0;
  float size = uSize * (0.5 + 0.5 * edge);
  vec4 color = mix(uInner, uOuter, k);
  float fade = pow(1.0 - k, 1.2) * (1.0 - 0.6 * smoothstep(0.0, 0.5, swept - u));
  vColor = vec4(color.rgb, color.a * fade);
  place(emitter.xy + offset + aPosition * size);
}
`
