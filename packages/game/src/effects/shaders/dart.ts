export const DART_VERTEX = `#version 300 es
precision highp float;

in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform sampler2D uEmitters;
uniform float uTime;
uniform float uParticles;
uniform float uLifetime;
uniform float uRise;
uniform float uArc;
uniform float uSize;
uniform float uLag;
uniform vec4 uInner;
uniform vec4 uOuter;

out vec2 vUv;
out vec4 vColor;

void hide() {
  gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
  vColor = vec4(0.0);
}

void main() {
  int count = int(uParticles);
  int slot = gl_InstanceID / count;
  int index = gl_InstanceID - slot * count;
  vec4 emitter = texelFetch(uEmitters, ivec2(slot * 2, 0), 0);
  vec4 extra = texelFetch(uEmitters, ivec2(slot * 2 + 1, 0), 0);
  float lag = float(index) / max(1.0, uParticles - 1.0);
  float age = uTime - emitter.z - lag * uLag * uLifetime;
  vUv = aPosition + 0.5;

  if (emitter.z < 0.0 || age < 0.0 || age > uLifetime) {
    hide();
    return;
  }

  float t = age / uLifetime;
  float reach = sin(t * 3.14159265);
  vec2 from = emitter.xy + vec2(0.0, -uRise);
  vec2 to = emitter.xy + extra.xy + vec2(0.0, -uRise * 0.5);
  vec2 side = normalize(vec2(-(to.y - from.y), to.x - from.x) + vec2(0.0001));
  float bend = (t < 0.5 ? 1.0 : -1.0) * sin(reach * 3.14159265) * uArc;
  vec2 center = mix(from, to, reach) + side * bend;
  float size = uSize * (1.0 - 0.75 * lag);
  vec4 color = mix(uInner, uOuter, lag);
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vColor = color;
  gl_Position = vec4((mvp * vec3(center + aPosition * size, 1.0)).xy, 0.0, 1.0);
}
`
