// Decorative cities: one InstancedMesh of box buildings on the 80 m street grid the terrain shader draws.
// Windows are procedural (world-space facade pattern) and light up at night.
import * as THREE from 'three';
import { GLSL_NOISE } from '../glsl';
import { hash2i } from '../noise';
import type { Terrain } from '../terrain/terrain';

export interface CitySpec {
  x: number;
  z: number;
  radius: number;
  density?: number;
}

export const CITY_BLOCK = 80;
const MAX_BUILDINGS = 9000;

const PALETTE = [0xb9b3a6, 0xa8a49c, 0xc8c0ae, 0x9fa3a6, 0xd2cbbb, 0x8d9296, 0xb7aa96, 0xa39a8c];
const TOWER_PALETTE = [0x8fa6b8, 0x7c8f9e, 0xa9b6bf, 0x6f8090, 0xb8bcc0];

const VERT_PARS = /* glsl */ `
varying vec3 vBWPos;
varying vec3 vBWNormal;
`;
const VERT_MAIN = /* glsl */ `
#ifdef USE_INSTANCING
  vBWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vBWNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vBWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vBWNormal = normalize(mat3(modelMatrix) * objectNormal);
#endif
`;
const FRAG_PARS = /* glsl */ `
varying vec3 vBWPos;
varying vec3 vBWNormal;
uniform float uNight;
${GLSL_NOISE}
`;
const FRAG_MAIN = /* glsl */ `
{
  vec3 bn = normalize(vBWNormal);
  float wall = 1.0 - step(0.6, abs(bn.y));
  float fx = abs(bn.x) > abs(bn.z) ? vBWPos.z : vBWPos.x;
  vec2 g = vec2(fx / 3.3, vBWPos.y / 3.6);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.82) * wall;
  float dist = length(vBWPos - cameraPosition);
  float far = smoothstep(1800.0, 5000.0, dist);
  win = mix(win, 0.33 * wall, far);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.09, 0.12), win * 0.7);
  if (bn.y > 0.6) diffuseColor.rgb *= 0.72;
  float on = step(0.58, tnaHash12(cell + floor(vBWPos.xz / 40.0) * 17.0 + bn.xz * 5.0));
  float lit = mix(on * win, 0.42 * 0.33 * wall, far);
  totalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * lit * uNight * 2.2;
}
#include <emissivemap_fragment>
`;

export function createBuildingMaterial(): { material: THREE.MeshStandardMaterial; night: { value: number } } {
  const night = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ name: 'tna_buildings', roughness: 0.82, metalness: 0.05, envMapIntensity: 0.35 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAG_PARS}\nvoid main() {`)
      .replace('#include <emissivemap_fragment>', FRAG_MAIN);
  };
  material.customProgramCacheKey = () => 'tna_buildings_v1';
  return { material, night };
}

/** Builds all cities into a single InstancedMesh (null when there are none) */
export function buildCities(cities: readonly CitySpec[], terrain: Terrain, seed: number, material: THREE.Material): THREE.InstancedMesh | null {
  if (!cities.length) return null;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const matrices: number[] = [];
  const colors: number[] = [];
  let count = 0;
  const add = (x: number, z: number, w: number, d: number, h: number, ground: number, color: number): void => {
    if (count >= MAX_BUILDINGS) return;
    p.set(x, ground - 1.5, z);
    s.set(w, h + 1.5, d);
    m.compose(p, q, s);
    matrices.push(...m.elements);
    c.setHex(color);
    colors.push(c.r, c.g, c.b);
    count++;
  };
  let ci = 0;
  for (const city of cities) {
    ci++;
    const density = city.density ?? 1;
    const R = city.radius;
    const i0 = Math.floor((city.x - R * 1.1) / CITY_BLOCK);
    const i1 = Math.floor((city.x + R * 1.1) / CITY_BLOCK);
    const j0 = Math.floor((city.z - R * 1.1) / CITY_BLOCK);
    const j1 = Math.floor((city.z + R * 1.1) / CITY_BLOCK);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bx = (i + 0.5) * CITY_BLOCK;
        const bz = (j + 0.5) * CITY_BLOCK;
        const u = terrain.urbanAt(bx, bz);
        if (u < 0.35) continue;
        const df = Math.hypot(bx - city.x, bz - city.z) / R;
        const r = (k: number): number => hash2i(i * 7 + k, j * 13 - k, seed + ci * 977);
        if (r(0) > u * Math.min(1, 0.55 + 0.45 * density)) continue;
        const ground = terrain.heightAt(bx, bz);
        const half = CITY_BLOCK / 2 - 7; // street half width ~6 m + kerb
        if (df < 0.28 && r(1) < 0.75 * density) {
          // downtown tower (+ podium)
          const w = 22 + r(2) * 20;
          const d = 22 + r(3) * 20;
          const h = (60 + r(4) * 140) * (1 - df * 1.6);
          add(bx, bz, w, d, Math.max(35, h), ground, TOWER_PALETTE[Math.floor(r(5) * TOWER_PALETTE.length)]);
          add(bx + (r(6) - 0.5) * 14, bz + (r(7) - 0.5) * 14, half * 1.7, half * 1.7, 10 + r(8) * 8, ground, PALETTE[Math.floor(r(9) * PALETTE.length)]);
          continue;
        }
        // 2x2 sub-lots: mid-rise near centre, low-rise outskirts
        const mid = df < 0.6;
        for (let k = 0; k < 4; k++) {
          if (r(10 + k) > (mid ? 0.85 : 0.6) * density) continue;
          const sx = (k & 1 ? 1 : -1) * half * 0.5;
          const sz = (k & 2 ? 1 : -1) * half * 0.5;
          const w = half * (0.55 + r(20 + k) * 0.4);
          const d = half * (0.55 + r(30 + k) * 0.4);
          const h = mid ? 14 + r(40 + k) * 34 * (1.2 - df) : 6 + r(40 + k) * 10;
          add(bx + sx, bz + sz, w, d, h, ground, PALETTE[Math.floor(r(50 + k) * PALETTE.length)]);
        }
      }
    }
  }
  if (count === 0) return null;
  const geom = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geom, material, count);
  mesh.name = 'tna_cities';
  (mesh.instanceMatrix.array as Float32Array).set(matrices);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}
