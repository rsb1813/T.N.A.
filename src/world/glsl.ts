// Shared GLSL snippets. All custom ShaderMaterials must keep logarithmic depth (the game renderer enables it)
// and honour scene fog, so these chunks are spliced into every world/fx shader.

/** Precision-safe hash + value noise (input wrapped to keep float precision far from the origin) */
export const GLSL_NOISE = /* glsl */ `
float tnaHash12(vec2 p) {
  p = mod(p, 2048.0);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tnaHash13(vec3 p) {
  p = mod(p, 2048.0);
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float tnaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = tnaHash12(i);
  float b = tnaHash12(i + vec2(1.0, 0.0));
  float c = tnaHash12(i + vec2(0.0, 1.0));
  float d = tnaHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float tnaNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = tnaHash13(i);
  float n100 = tnaHash13(i + vec3(1, 0, 0));
  float n010 = tnaHash13(i + vec3(0, 1, 0));
  float n110 = tnaHash13(i + vec3(1, 1, 0));
  float n001 = tnaHash13(i + vec3(0, 0, 1));
  float n101 = tnaHash13(i + vec3(1, 0, 1));
  float n011 = tnaHash13(i + vec3(0, 1, 1));
  float n111 = tnaHash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float tnaFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * tnaNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s / 0.9375;
}
`;

/** Fog factor helper usable by additive materials (which must fade to black, not to fog colour) */
export const GLSL_FOG_FACTOR = /* glsl */ `
#ifdef USE_FOG
float tnaFogFactor() {
  #ifdef FOG_EXP2
    return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    return smoothstep(fogNear, fogFar, vFogDepth);
  #endif
}
#else
float tnaFogFactor() { return 0.0; }
#endif
`;

/** Standard vertex preamble pieces */
export const GLSL_VERT_PARS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
`;

/** After gl_Position and mvPosition are set */
export const GLSL_VERT_END = /* glsl */ `
#include <logdepthbuf_vertex>
#include <fog_vertex>
`;

export const GLSL_FRAG_PARS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
`;
