export const RING_BURST_VERTEX = `#version 300 es
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
  float seed = emitter.w + float(index) * 1.618;
  float life = uLifetime * (0.75 + 0.25 * hash(seed));
  vUv = aPosition + 0.5;

  if (emitter.z < 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vColor = vec4(0.0);
    return;
  }

  float k = age / life;
  float ringCount = floor(uParticles * 0.66);
  vec2 offset;
  float size;
  vec4 color;

  if (float(index) < ringCount) {
    float angle = 6.2831853 * float(index) / ringCount + uSpin * age;
    float radius = uRadius * (0.3 + 0.7 * (1.0 - pow(1.0 - k, 3.0)));
    offset = vec2(cos(angle) * radius, sin(angle) * radius * 0.5 - uRise * k);
    size = uSize * (1.0 - 0.5 * k);
    color = mix(uInner, uOuter, k);
  } else {
    float lane = hash(seed * 3.1) - 0.5;
    offset = vec2(lane * uRadius * 0.6, -uRise * 1.8 * k * (0.4 + 0.6 * hash(seed * 7.7)) - 8.0);
    size = uSize * 0.6;
    color = uInner;
  }

  float fade = smoothstep(0.0, 0.08, k) * pow(1.0 - k, 1.5);
  vColor = vec4(color.rgb, color.a * fade);
  vec2 position = emitter.xy + offset + aPosition * size;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);
}
`

export const RING_BURST_FRAGMENT = `#version 300 es
precision mediump float;

in vec2 vUv;
in vec4 vColor;

out vec4 finalColor;

void main() {
  float distance = length(vUv - 0.5) * 2.0;
  float glow = pow(clamp(1.0 - distance, 0.0, 1.0), 2.0);
  finalColor = vec4(vColor.rgb * vColor.a * glow, vColor.a * glow);
}
`
