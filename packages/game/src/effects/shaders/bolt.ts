export const BOLT_VERTEX = `#version 300 es
precision highp float;

in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform sampler2D uEmitters;
uniform float uTime;
uniform float uParticles;
uniform float uLifetime;
uniform float uTravel;
uniform float uRadius;
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

  float seed = emitter.w + float(index) * 1.618;
  float travel = uLifetime * uTravel;
  float heads = floor(uParticles * 0.5);
  vec2 from = emitter.xy + vec2(0.0, -uRise);
  vec2 to = emitter.xy + extra.xy + vec2(0.0, -uRise * 0.6);
  vec2 center;
  float size;
  vec4 color;
  float alpha;

  if (float(index) < heads) {
    float lag = float(index) / heads;
    float delay = lag * travel * 0.35;
    float t = clamp((age - delay) / travel, 0.0, 1.0);
    vec2 jitter = vec2(hash(seed) - 0.5, hash(seed * 1.7) - 0.5) * uSize * lag;
    center = mix(from, to, t) + jitter;
    size = uSize * (1.0 - 0.7 * lag);
    color = mix(uInner, uOuter, lag);
    alpha = age < travel + delay ? 1.0 : 0.0;
  } else {
    if (age < travel) {
      hide();
      return;
    }

    float k = clamp((age - travel) / max(0.001, uLifetime - travel), 0.0, 1.0);
    float angle = 6.2831853 * hash(seed * 3.3);
    float radius = uRadius * (0.3 + 0.7 * hash(seed * 5.1)) * (1.0 - pow(1.0 - k, 2.0));
    center = to + vec2(cos(angle) * radius, sin(angle) * radius * 0.5 - 6.0 * k);
    size = uSize * (1.0 - 0.6 * k);
    color = mix(uInner, uOuter, k);
    alpha = 1.0 - k;
  }

  vColor = vec4(color.rgb, color.a * alpha);
  place(center + aPosition * size);
}
`
