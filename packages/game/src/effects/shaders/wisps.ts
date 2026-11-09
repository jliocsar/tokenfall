export const WISPS_VERTEX = `#version 300 es
precision highp float;

in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform sampler2D uEmitters;
uniform float uTime;
uniform float uParticles;
uniform float uLifetime;
uniform float uTrail;
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
  vec4 extra = texelFetch(uEmitters, ivec2(slot * 2 + 1, 0), 0);
  float age = uTime - emitter.z;
  int trail = int(uTrail);
  int wisp = index / trail;
  int link = index - wisp * trail;
  float wisps = min(extra.x, floor(uParticles / uTrail));
  vUv = aPosition + 0.5;

  if (emitter.z < 0.0 || age < 0.0 || float(wisp) >= wisps) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vColor = vec4(0.0);
    return;
  }

  float seed = emitter.w + float(wisp) * 1.618;
  float t = age - float(link) * 0.07 * uLifetime;
  float angle = 6.2831853 * float(wisp) / wisps + uSpin * t;
  float bob = sin(t * 2.3 + hash(seed) * 6.2831853) * 4.0;
  float radius = uRadius * (0.85 + 0.15 * sin(t * 1.3 + hash(seed * 3.1) * 6.2831853));
  vec2 offset = vec2(cos(angle) * radius, sin(angle) * radius * 0.5 - uRise + bob);
  float tail = float(link) / uTrail;
  float size = uSize * (1.0 - 0.6 * tail);
  vec4 color = mix(uInner, uOuter, tail);
  vColor = vec4(color.rgb, color.a * smoothstep(0.0, 0.6, age));
  vec2 position = emitter.xy + offset + aPosition * size;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);
}
`
