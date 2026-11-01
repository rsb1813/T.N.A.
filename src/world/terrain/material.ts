// Terrain material: MeshStandardMaterial (lights, fog, log depth kept) with an injected shader that blends
// biome palettes by height/slope/land-cover masks and adds procedural detail near the camera.
import * as THREE from 'three';
import type { BiomeDef } from '../biomes';
import { GLSL_NOISE } from '../glsl';

const VERT_PARS = /* glsl */ `
attribute vec4 aSurf;
varying vec4 vSurf;
varying vec3 vWPos;
varying vec3 vWNormal;
`;

const VERT_MAIN = /* glsl */ `
vSurf = aSurf;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vSurf;
varying vec3 vWPos;
varying vec3 vWNormal;
uniform vec3 uRock;
uniform vec3 uSnow;
uniform vec3 uBeach;
uniform vec3 uForest;
uniform vec3 uForestDark;
uniform vec3 uField0;
uniform vec3 uField1;
uniform vec3 uField2;
uniform vec3 uField3;
uniform vec3 uUrban;
uniform vec3 uScorch;
uniform float uSnowLine;
uniform vec2 uRockSlope;
uniform vec2 uBeachH;
uniform float uNight;
uniform sampler2D uWater;
uniform float uExtent;
${GLSL_NOISE}
`;

const FRAG_ALBEDO = /* glsl */ `
vec3 wp = vWPos;
vec3 nrm = normalize(vWNormal);
float slope = 1.0 - nrm.y;
float dist = length(wp - cameraPosition);
float m1 = tnaNoise(wp.xz * 0.00042);
float m2 = tnaNoise(wp.xz * 0.0029 + 17.0);
vec3 albedo = vColor.rgb * (0.86 + 0.28 * tnaNoise(wp.xz * 0.0011 + 5.0));
albedo = mix(albedo, albedo * vec3(1.08, 1.0, 0.82), smoothstep(0.55, 0.8, m2) * 0.6);

// farmland quilt
if (vSurf.y > 0.004) {
  vec2 fp = mat2(0.94, 0.34, -0.34, 0.94) * wp.xz;
  vec2 cs = vec2(330.0, 215.0);
  vec2 g = fp / cs;
  g.x += floor(g.y) * 0.37;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float h = tnaHash12(cell);
  vec3 fc = h < 0.25 ? uField0 : (h < 0.5 ? uField1 : (h < 0.75 ? uField2 : uField3));
  fc *= 0.88 + 0.24 * tnaHash12(cell + 19.0);
  fc = mix(fc, vColor.rgb, 0.3);
  float rows = 0.95 + 0.05 * sin((h > 0.5 ? f.x * cs.x : f.y * cs.y) * 0.9);
  float ed = min(min(f.x, 1.0 - f.x) * cs.x, min(f.y, 1.0 - f.y) * cs.y);
  float near = 1.0 - smoothstep(10000.0, 28000.0, dist);
  float hedge = (1.0 - smoothstep(2.5, 7.0 + dist * 0.0012, ed)) * near;
  rows = mix(1.0, rows, 1.0 - smoothstep(1500.0, 5000.0, dist));
  vec3 fieldCol = mix(fc * rows, uForestDark * 1.2, hedge * 0.6);
  fieldCol = mix((uField0 + uField1 + uField2 + uField3) * 0.25, fieldCol, near);
  albedo = mix(albedo, fieldCol, smoothstep(0.0, 0.6, vSurf.y));
}

// forest canopy
float canopyN = tnaNoise(wp.xz * 0.045) * 0.6 + tnaNoise(wp.xz * 0.19 + 3.0) * 0.4;
float fmask = smoothstep(0.18, 0.55, vSurf.x + (canopyN - 0.5) * 0.35);
float patchN = tnaNoise(wp.xz * 0.0045 + 31.0);
vec3 forestCol = mix(uForestDark, uForest, clamp(canopyN * 0.7 + patchN * 0.6 - 0.15, 0.0, 1.0));
forestCol *= 0.82 + 0.3 * m2 + 0.12 * (tnaNoise(wp.xz * 0.0009 - 7.0) - 0.5);
forestCol = mix(forestCol, forestCol * vec3(1.12, 1.08, 0.78), smoothstep(0.62, 0.85, patchN) * 0.5);
albedo = mix(albedo, forestCol, fmask);

// city ground with a street grid (80 m blocks, matches building placement)
if (vSurf.z > 0.004) {
  vec2 sp = wp.xz / 80.0;
  vec2 fr = fract(sp);
  vec2 dd = min(fr, 1.0 - fr) * 80.0;
  float sd = min(dd.x, dd.y);
  float street = 1.0 - smoothstep(5.0, 7.0 + dist * 0.0008, sd);
  street *= 1.0 - smoothstep(14000.0, 26000.0, dist);
  vec3 lot = uUrban * (0.8 + 0.32 * tnaHash12(floor(sp) + 3.0));
  vec3 urb = mix(lot, uUrban * 0.5, street);
  albedo = mix(albedo, urb, vSurf.z);
  float lamps = mix(street * (0.5 + 0.5 * step(0.5, tnaHash12(floor(wp.xz / 25.0)))), 0.12, smoothstep(3000.0, 9000.0, dist));
  totalEmissiveRadiance += vec3(1.0, 0.58, 0.25) * lamps * vSurf.z * uNight * 0.3;
}

albedo = mix(albedo, uScorch * (0.8 + 0.4 * m2), vSurf.w);

// rock on steep slopes
float rn = (m2 - 0.5) * 0.12 + (tnaNoise(wp.xz * 0.021) - 0.5) * 0.08;
float rockW = smoothstep(uRockSlope.x + rn, uRockSlope.y + rn, slope);
float strata = 1.0 + 0.1 * sin(wp.y * 0.09 + m1 * 6.0) * (1.0 - smoothstep(1500.0, 5000.0, dist));
vec3 rockCol = mix(uRock * 0.74, uRock * 1.06, tnaNoise(vec2(wp.x + wp.z, wp.y * 2.0) * 0.006)) * strata;
albedo = mix(albedo, rockCol, rockW);

// snow on high, not-too-steep ground
float sn = (m1 - 0.5) * 320.0 + (m2 - 0.5) * 140.0;
float snowW = smoothstep(uSnowLine - 60.0, uSnowLine + 140.0, wp.y + sn) * (1.0 - smoothstep(0.26 + m2 * 0.12, 0.5 + m2 * 0.1, slope));
albedo = mix(albedo, uSnow * (0.92 + 0.1 * tnaNoise(wp.xz * 0.004)), snowW);

// sea beaches near sea level; darker muddy banks along rivers and lakes
vec2 wuv = (wp.xz + uExtent) / (2.0 * uExtent);
float openWater = texture2D(uWater, clamp(wuv, 0.0, 1.0)).g;
float low = (1.0 - smoothstep(uBeachH.x, uBeachH.y, wp.y + (m2 - 0.5) * 3.0)) * (1.0 - rockW) * (1.0 - vSurf.z);
float seaSide = smoothstep(0.06, 0.22, openWater);
albedo = mix(albedo, uBeach, low * seaSide);
albedo = mix(albedo, albedo * vec3(0.62, 0.58, 0.5), low * (1.0 - seaSide) * (1.0 - smoothstep(0.0, 3.0, wp.y)));

// procedural detail near the camera + broad variation everywhere
float df = 1.0 - smoothstep(900.0, 6500.0, dist);
float d1 = tnaNoise(wp.xz * 0.09);
float d2 = tnaNoise(wp.xz * 0.37 + 5.0);
albedo *= 1.0 + ((d1 - 0.5) * 0.28 + (d2 - 0.5) * 0.14) * df;
albedo *= 0.9 + 0.2 * m1;
// darken steep ground a little: reads terrain shape even under a high sun
albedo *= 1.0 - 0.28 * smoothstep(0.03, 0.35, slope) * (1.0 - snowW * 0.6);
diffuseColor.rgb *= albedo;
`;

function lin(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

export function createTerrainMaterial(
  biome: BiomeDef,
  waterTexture: THREE.Texture,
  extent: number,
): { material: THREE.MeshStandardMaterial; night: { value: number } } {
  const p = biome.palette;
  const mat = new THREE.MeshStandardMaterial({
    name: 'tna_terrain',
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.25,
  });
  const uniforms = {
    uRock: { value: lin(p.rock) },
    uSnow: { value: lin(p.snow) },
    uBeach: { value: lin(p.beach) },
    uForest: { value: lin(p.forest) },
    uForestDark: { value: lin(p.forestDark) },
    uField0: { value: lin(p.fields[0]) },
    uField1: { value: lin(p.fields[1]) },
    uField2: { value: lin(p.fields[2]) },
    uField3: { value: lin(p.fields[3]) },
    uUrban: { value: lin(p.urban) },
    uScorch: { value: lin(p.scorched) },
    uSnowLine: { value: Number.isFinite(biome.snowLine) ? biome.snowLine : 1e6 },
    uRockSlope: { value: new THREE.Vector2(biome.rockSlope[0], biome.rockSlope[1]) },
    uBeachH: { value: new THREE.Vector2(1.5, biome.id === 'arctic' ? 4 : 7) },
    uNight: { value: 0 },
    uWater: { value: waterTexture },
    uExtent: { value: extent },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAG_PARS}\nvoid main() {`)
      .replace('#include <color_fragment>', FRAG_ALBEDO);
  };
  mat.customProgramCacheKey = () => 'tna_terrain_v1';
  return { material: mat, night: uniforms.uNight };
}
