// GPU particle pool: each particle's motion is analytic (initial velocity + drag + constant vertical
// acceleration), evaluated in the vertex shader from its birth time. The CPU writes a particle once at spawn
// and never touches it again — no per-frame CPU cost, no allocations.
import * as THREE from 'three';
import { GLSL_FOG_FACTOR, GLSL_FRAG_PARS, GLSL_VERT_END, GLSL_VERT_PARS } from '../glsl';
import { getParticleTexture } from '../textures';

/** Mutable spawn description — fill `pool.spec` and call `emit()` (no allocation per particle) */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** seconds */
  life: number;
  /** spawn delay (s) — particle is invisible until then */
  delay: number;
  size0: number;
  size1: number;
  rot: number;
  spin: number;
  /** velocity damping (1/s) */
  drag: number;
  /** vertical acceleration (m/s², negative = falls, positive = buoyant) */
  gravity: number;
  /** elongation along velocity (s): streak length = size + stretch * speed */
  stretch: number;
  /** atlas frame 0 glow, 1 smoke, 2 ragged smoke, 3 flame */
  frame: number;
  flicker: boolean;
  /** start/end colour (linear, may exceed 1 for additive HDR) and alpha */
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  r1: number;
  g1: number;
  b1: number;
  a1: number;
}

export function makeSpec(): ParticleSpec {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, size0: 1, size1: 1, rot: 0, spin: 0, drag: 0, gravity: 0, stretch: 0,
    frame: 0, flicker: false, r0: 1, g0: 1, b0: 1, a0: 1, r1: 1, g1: 1, b1: 1, a1: 0,
  };
}

const VERT = /* glsl */ `
${GLSL_VERT_PARS}
attribute vec4 aPos;
attribute vec4 aVel;
attribute vec4 aSize;
attribute vec4 aPhys;
attribute vec4 aCol0;
attribute vec4 aCol1;
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vLit;
void main() {
  float age = uTime - aPos.w;
  float life = aVel.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float t = age / life;
  float k = aPhys.x;
  float ek = exp(-k * age);
  vec3 disp = k > 1e-4 ? aVel.xyz * ((1.0 - ek) / k) : aVel.xyz * age;
  vec3 p = aPos.xyz + disp;
  p.y += 0.5 * aPhys.y * age * age;
  vec3 vel = aVel.xyz * ek + vec3(0.0, aPhys.y * age, 0.0);
  float size = mix(aSize.x, aSize.y, 1.0 - (1.0 - t) * (1.0 - t));
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  vec2 c = position.xy;
  vec2 off;
  if (aPhys.z > 0.0) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float l = length(vv.xy);
    vec2 dir = l > 1e-4 ? vv.xy / l : vec2(0.0, 1.0);
    float L = size + aPhys.z * l;
    off = dir * (c.y - 0.5) * L + vec2(-dir.y, dir.x) * c.x * size;
  } else {
    float rot = aSize.z + aSize.w * age;
    float cr = cos(rot);
    float sr = sin(rot);
    off = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * size;
  }
  mvPosition.xy += off;
  gl_Position = projectionMatrix * mvPosition;
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vLit = 0.82 + 0.3 * dot(camRight * off.x + camUp * off.y, vec3(0.0, 1.0, 0.0)) / max(size, 1e-3);
  float fr = mod(aPhys.w, 4.0);
  vUv = (c + 0.5) * 0.5 + vec2(mod(fr, 2.0), floor(fr * 0.5)) * 0.5;
  vCol = mix(aCol0, aCol1, t);
  vCol.a *= smoothstep(0.0, 0.05, t);
  if (aPhys.w >= 4.0) vCol.a *= 0.15 + 0.85 * step(0.55, fract(sin(aPos.w * 91.7 + floor(uTime * 24.0) * 1.37) * 43758.5));
  ${GLSL_VERT_END}
}
`;

const FRAG_ADD = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_FOG_FACTOR}
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vCol;
varying float vLit;
void main() {
  #include <logdepthbuf_fragment>
  vec4 tx = texture2D(uTex, vUv);
  float a = tx.a * vCol.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * (1.0 - tnaFogFactor()), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FRAG_ALPHA = /* glsl */ `
${GLSL_FRAG_PARS}
uniform sampler2D uTex;
uniform vec3 uLight;
varying vec2 vUv;
varying vec4 vCol;
varying float vLit;
void main() {
  #include <logdepthbuf_fragment>
  vec4 tx = texture2D(uTex, vUv);
  float a = tx.a * vCol.a;
  if (a < 0.003) discard;
  vec3 col = vCol.rgb * uLight * clamp(vLit, 0.45, 1.2);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  readonly spec: ParticleSpec = makeSpec();
  readonly material: THREE.ShaderMaterial;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly size: Float32Array;
  private readonly phys: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly expiry: Float32Array;
  private cursor = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  time = 0;

  constructor(
    readonly capacity: number,
    readonly additive: boolean,
  ) {
    this.geom = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geom.index = quad.index;
    this.geom.setAttribute('position', quad.attributes.position);
    const mk = (): [THREE.InstancedBufferAttribute, Float32Array] => {
      const arr = new Float32Array(capacity * 4);
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return [a, arr];
    };
    const [aPos, pos] = mk();
    const [aVel, vel] = mk();
    const [aSize, size] = mk();
    const [aPhys, phys] = mk();
    const [aCol0, col0] = mk();
    const [aCol1, col1] = mk();
    this.pos = pos;
    this.vel = vel;
    this.size = size;
    this.phys = phys;
    this.col0 = col0;
    this.col1 = col1;
    // all particles start dead (age >= life)
    for (let i = 0; i < capacity; i++) {
      pos[i * 4 + 3] = -1e6;
      vel[i * 4 + 3] = 0;
    }
    this.attrs = [aPos, aVel, aSize, aPhys, aCol0, aCol1];
    this.geom.setAttribute('aPos', aPos);
    this.geom.setAttribute('aVel', aVel);
    this.geom.setAttribute('aSize', aSize);
    this.geom.setAttribute('aPhys', aPhys);
    this.geom.setAttribute('aCol0', aCol0);
    this.geom.setAttribute('aCol1', aCol1);
    this.geom.instanceCount = capacity;
    this.expiry = new Float32Array(capacity).fill(-1);
    this.material = new THREE.ShaderMaterial({
      name: additive ? 'tna_fx_add' : 'tna_fx_alpha',
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uTex: { value: null }, uLight: { value: new THREE.Color(1, 1, 1) } },
      ]),
    });
    this.material.uniforms.uTex.value = getParticleTexture();
    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 22 : 20;
    this.mesh.name = additive ? 'tna_fx_additive' : 'tna_fx_alpha';
  }

  /** Number of particles alive right now */
  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.expiry[i] > this.time) n++;
    return n;
  }

  /** Find a free slot: first expired within a short probe, else the one expiring soonest */
  private alloc(): number {
    const cap = this.capacity;
    let best = this.cursor;
    let bestExp = Infinity;
    for (let n = 0; n < 48; n++) {
      const i = (this.cursor + n) % cap;
      const e = this.expiry[i];
      if (e <= this.time) {
        this.cursor = (i + 1) % cap;
        return i;
      }
      if (e < bestExp) {
        bestExp = e;
        best = i;
      }
    }
    this.cursor = (best + 1) % cap;
    return best;
  }

  emit(s: ParticleSpec = this.spec): void {
    const i = this.alloc();
    const o = i * 4;
    const birth = this.time + s.delay;
    this.pos[o] = s.x;
    this.pos[o + 1] = s.y;
    this.pos[o + 2] = s.z;
    this.pos[o + 3] = birth;
    this.vel[o] = s.vx;
    this.vel[o + 1] = s.vy;
    this.vel[o + 2] = s.vz;
    this.vel[o + 3] = s.life;
    this.size[o] = s.size0;
    this.size[o + 1] = s.size1;
    this.size[o + 2] = s.rot;
    this.size[o + 3] = s.spin;
    this.phys[o] = s.drag;
    this.phys[o + 1] = s.gravity;
    this.phys[o + 2] = s.stretch;
    this.phys[o + 3] = (s.frame & 3) + (s.flicker ? 4 : 0);
    this.col0[o] = s.r0;
    this.col0[o + 1] = s.g0;
    this.col0[o + 2] = s.b0;
    this.col0[o + 3] = s.a0;
    this.col1[o] = s.r1;
    this.col1[o + 1] = s.g1;
    this.col1[o + 2] = s.b1;
    this.col1[o + 3] = s.a1;
    this.expiry[i] = birth + s.life;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (this.dirtyMax >= 0) {
      const start = this.dirtyMin * 4;
      const count = (this.dirtyMax - this.dirtyMin + 1) * 4;
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(start, count);
        a.needsUpdate = true;
      }
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
  }

  setLight(c: THREE.Color): void {
    this.material.uniforms.uLight.value.copy(c);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geom.dispose();
    this.material.dispose();
  }
}
