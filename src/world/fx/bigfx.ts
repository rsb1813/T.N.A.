// Strategic-scale explosions with their own timeline: tactical nuclear burst (flash, fireball, Wilson
// condensation shell, ground shock ring, mushroom cloud growing ~20 s) and MOUK (blue-white implosion,
// then a burst with a spherical bloom cloud and halo ring — deliberately unlike a mushroom).
import * as THREE from 'three';
import { GLSL_FOG_FACTOR, GLSL_FRAG_PARS, GLSL_NOISE, GLSL_VERT_END, GLSL_VERT_PARS } from '../glsl';
import type { ParticlePool } from './particles';

export interface BigFxContext {
  scene: THREE.Scene;
  alpha: ParticlePool;
  add: ParticlePool;
  /** Screen flash request (0..1) with tint */
  flash(amount: number, color: THREE.Color): void;
  /** Camera shake after a delay (shock wave arrival) */
  shakeLater(delay: number, amount: number): void;
  /** Light pulse at a position */
  light(pos: THREE.Vector3, intensity: number, color: THREE.Color, duration: number): void;
  camera: THREE.Camera;
}

const FIREBALL_VERT = /* glsl */ `
${GLSL_VERT_PARS}
${GLSL_NOISE}
uniform float uTime;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = position;
  float n = tnaNoise3(position * 2.6 + vec3(0.0, -uTime * 0.5, uTime * 0.2));
  vec3 p = position * (1.0 + 0.16 * (n - 0.5));
  vN = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  ${GLSL_VERT_END}
}
`;

const FIREBALL_FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_NOISE}
uniform float uTime;
uniform float uHeat;
uniform float uAlpha;
uniform float uBlue;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
vec3 ramp(float h) {
  vec3 c0 = vec3(0.12, 0.09, 0.08);
  vec3 c1 = vec3(1.4, 0.32, 0.06);
  vec3 c2 = vec3(3.2, 1.5, 0.35);
  vec3 c3 = vec3(6.0, 5.2, 4.2);
  vec3 c = h < 0.33 ? mix(c0, c1, h / 0.33) : (h < 0.66 ? mix(c1, c2, (h - 0.33) / 0.33) : mix(c2, c3, (h - 0.66) / 0.34));
  vec3 b0 = vec3(0.16, 0.12, 0.28);
  vec3 b1 = vec3(0.9, 0.5, 2.2);
  vec3 b2 = vec3(1.8, 2.8, 5.0);
  vec3 b3 = vec3(5.5, 6.0, 7.0);
  vec3 bc = h < 0.33 ? mix(b0, b1, h / 0.33) : (h < 0.66 ? mix(b1, b2, (h - 0.33) / 0.33) : mix(b2, b3, (h - 0.66) / 0.34));
  return mix(c, bc, uBlue);
}
void main() {
  #include <logdepthbuf_fragment>
  float n = tnaNoise3(vObj * 3.1 + vec3(0.0, -uTime * 0.7, 0.0)) * 0.6 + tnaNoise3(vObj * 7.3 - uTime * 0.4) * 0.4;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float h = clamp(uHeat + (n - 0.5) * 0.55 + (facing - 0.6) * 0.35, 0.0, 1.0);
  vec3 col = ramp(h);
  float a = uAlpha * smoothstep(0.0, 0.35, facing + 0.15);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const SHELL_VERT = /* glsl */ `
${GLSL_VERT_PARS}
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vN = normalize(normalMatrix * normal);
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  ${GLSL_VERT_END}
}
`;

/** uMode 0 = fresnel shell, 1 = flat ring (uv.x = radial position 0..1 across the ring band) */
const SHELL_FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_FOG_FACTOR}
uniform vec3 uColor;
uniform float uAlpha;
uniform float uMode;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float a;
  if (uMode < 0.5) {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    a = pow(f, 2.5);
  } else {
    float r = vUv.x;
    a = smoothstep(0.0, 0.55, r) * (1.0 - smoothstep(0.75, 1.0, r));
  }
  a *= uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 - tnaFogFactor()), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function fireballMaterial(blue: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'tna_fireball',
    vertexShader: FIREBALL_VERT,
    fragmentShader: FIREBALL_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uHeat: { value: 1 }, uAlpha: { value: 1 }, uBlue: { value: blue ? 1 : 0 } }]),
  });
}

function shellMaterial(color: THREE.Color, mode: 0 | 1, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: mode ? 'tna_shock_ring' : 'tna_shock_shell',
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: color.clone() }, uAlpha: { value: 0 }, uMode: { value: mode } }]),
  });
}

/** Ring band geometry in XZ with uv.x = 0 (inner) .. 1 (outer); unit outer radius */
function ringGeometry(inner: number): THREE.BufferGeometry {
  const seg = 128;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(c * inner, 0, s * inner, c, 0, s);
    uv.push(0, i / seg, 1, i / seg);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

let sphereGeo: THREE.SphereGeometry | null = null;
let ringGeo: THREE.BufferGeometry | null = null;

function shared(): { sphere: THREE.SphereGeometry; ring: THREE.BufferGeometry } {
  sphereGeo ??= new THREE.SphereGeometry(1, 40, 24);
  ringGeo ??= ringGeometry(0.82);
  return { sphere: sphereGeo, ring: ringGeo };
}

export function disposeBigFxGeometry(): void {
  sphereGeo?.dispose();
  ringGeo?.dispose();
  sphereGeo = null;
  ringGeo = null;
}

const _v = new THREE.Vector3();
const rnd = Math.random;

function randomDir(out: THREE.Vector3): THREE.Vector3 {
  const u = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

export abstract class BigFx {
  protected t = 0;
  protected readonly meshes: THREE.Mesh[] = [];
  protected readonly materials: THREE.ShaderMaterial[] = [];
  protected readonly group = new THREE.Group();

  constructor(
    protected readonly ctx: BigFxContext,
    protected readonly origin: THREE.Vector3,
    protected readonly scale: number,
  ) {
    this.group.position.copy(origin);
    ctx.scene.add(this.group);
  }

  protected mesh(geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 18;
    this.group.add(m);
    this.meshes.push(m);
    this.materials.push(mat);
    return m;
  }

  /** returns false when finished */
  abstract update(dt: number): boolean;

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.materials) m.dispose();
  }
}

/** Tactical nuclear burst. scale 1 ≈ 10 kt (fireball ~350 m, cloud top ~3 km). groundY = terrain under it */
export class NuclearFx extends BigFx {
  private readonly fireball: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly fireMat: THREE.ShaderMaterial;
  private readonly shellMat: THREE.ShaderMaterial;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly heightAboveGround: number;
  private stemTimer = 0;
  private capTimer = 0;

  constructor(ctx: BigFxContext, origin: THREE.Vector3, scale: number, groundY: number) {
    super(ctx, origin, scale);
    const g = shared();
    this.fireMat = fireballMaterial(false);
    this.shellMat = shellMaterial(new THREE.Color(0.95, 0.96, 1.0), 0, false);
    this.ringMat = shellMaterial(new THREE.Color(0.92, 0.9, 0.86), 1, false);
    this.fireball = this.mesh(g.sphere, this.fireMat);
    this.shell = this.mesh(g.sphere, this.shellMat);
    this.ring = this.mesh(g.ring, this.ringMat);
    this.heightAboveGround = Math.max(0, origin.y - groundY);
    this.ring.position.y = groundY - origin.y + 3;
    this.ring.visible = this.heightAboveGround < 1500 * scale;
    const dist = ctx.camera.position.distanceTo(origin);
    ctx.flash(Math.min(1, 1.25 - dist / 160_000), new THREE.Color(1, 0.97, 0.9));
    ctx.light(origin, 4e9 * scale, new THREE.Color(1, 0.9, 0.75), 2.2);
    ctx.shakeLater(dist / 340, Math.min(1, 1.4 - dist / 25_000));
    this.surge(groundY);
  }

  /** Ground base surge: fast radial dust ring */
  private surge(groundY: number): void {
    if (this.heightAboveGround > 1800 * this.scale) return;
    const s = this.scale;
    const p = this.ctx.alpha.spec;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
      const R = (1500 + rnd() * 700) * s;
      const k = 0.45;
      const v = (R * k) / (1 - Math.exp(-k * 9));
      p.x = this.origin.x + Math.cos(a) * 80 * s;
      p.y = groundY + 40 * s;
      p.z = this.origin.z + Math.sin(a) * 80 * s;
      p.vx = Math.cos(a) * v;
      p.vy = 6 * s;
      p.vz = Math.sin(a) * v;
      p.life = 14 + rnd() * 6;
      p.delay = 0.25;
      p.size0 = 160 * s;
      p.size1 = (420 + rnd() * 200) * s;
      p.rot = rnd() * 6.28;
      p.spin = (rnd() - 0.5) * 0.1;
      p.drag = k;
      p.gravity = 0.8;
      p.stretch = 0;
      p.frame = 1 + (i & 1);
      p.flicker = false;
      p.r0 = 0.62; p.g0 = 0.56; p.b0 = 0.48; p.a0 = 0.7;
      p.r1 = 0.55; p.g1 = 0.52; p.b1 = 0.48; p.a1 = 0;
      this.ctx.alpha.emit();
    }
  }

  private emitCap(n: number): void {
    const s = this.scale;
    const Hc = 2900 * s;
    const k = 0.12;
    const T = 20;
    const norm = 1 - Math.exp(-k * T);
    const pa = this.ctx.alpha.spec;
    const pf = this.ctx.add.spec;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const Rc = (500 + rnd() * 900) * s;
      const up = Hc * (0.85 + rnd() * 0.3) - (Rc - 900 * s) * 0.25;
      const vy = (up * k) / norm;
      const vr = (Rc * k) / norm;
      for (const p of [pa, pf]) {
        p.x = this.origin.x + Math.cos(a) * 60 * s;
        p.y = this.origin.y;
        p.z = this.origin.z + Math.sin(a) * 60 * s;
        p.vx = Math.cos(a) * vr;
        p.vy = vy;
        p.vz = Math.sin(a) * vr;
        p.drag = k;
        p.gravity = 0;
        p.stretch = 0;
        p.delay = 0;
        p.rot = rnd() * 6.28;
        p.spin = (rnd() - 0.5) * 0.15;
        p.flicker = false;
      }
      pa.life = 30 + rnd() * 10;
      pa.size0 = 260 * s;
      pa.size1 = (650 + rnd() * 300) * s;
      pa.frame = 1 + (i & 1);
      pa.r0 = 0.85; pa.g0 = 0.42; pa.b0 = 0.2; pa.a0 = 0.92;
      pa.r1 = 0.42; pa.g1 = 0.38; pa.b1 = 0.36; pa.a1 = 0;
      this.ctx.alpha.emit();
      if (i % 2 === 0) {
        pf.life = 6 + rnd() * 4;
        pf.size0 = 220 * s;
        pf.size1 = 420 * s;
        pf.frame = 3;
        pf.r0 = 2.6; pf.g0 = 1.0; pf.b0 = 0.3; pf.a0 = 0.6;
        pf.r1 = 0.9; pf.g1 = 0.2; pf.b1 = 0.05; pf.a1 = 0;
        this.ctx.add.emit();
      }
    }
  }

  private emitStem(n: number): void {
    const s = this.scale;
    const Hc = 2900 * s;
    const p = this.ctx.alpha.spec;
    const groundY = this.origin.y - this.heightAboveGround;
    for (let i = 0; i < n; i++) {
      const k = 0.15;
      const h = Hc * (0.1 + rnd() * 0.8);
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 120 * s;
      p.x = this.origin.x + Math.cos(a) * r;
      p.y = groundY + 30 * s;
      p.z = this.origin.z + Math.sin(a) * r;
      p.vx = Math.cos(a) * 6 * s;
      p.vy = (h * k) / (1 - Math.exp(-k * 18));
      p.vz = Math.sin(a) * 6 * s;
      p.life = 26 + rnd() * 8;
      p.delay = 0;
      p.size0 = 140 * s;
      p.size1 = (300 + rnd() * 140) * s * (0.6 + 0.6 * (h / Hc));
      p.rot = rnd() * 6.28;
      p.spin = (rnd() - 0.5) * 0.1;
      p.drag = k;
      p.gravity = 0;
      p.stretch = 0;
      p.frame = 2;
      p.flicker = false;
      p.r0 = 0.7; p.g0 = 0.48; p.b0 = 0.32; p.a0 = 0.85;
      p.r1 = 0.45; p.g1 = 0.4; p.b1 = 0.37; p.a1 = 0;
      this.ctx.alpha.emit();
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    const t = this.t;
    const s = this.scale;
    // fireball: rapid growth, rises, cools, fades into the cap
    const R = 350 * s * (1 - Math.exp(-t / 0.45));
    this.fireball.scale.setScalar(Math.max(1, R));
    this.fireball.position.y = Math.min(2900 * s * 0.9, 90 * s * t + 0.02 * s * t * t * 60);
    this.fireMat.uniforms.uTime.value = t;
    this.fireMat.uniforms.uHeat.value = Math.max(0, 1 - t / 7);
    this.fireMat.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(t, 5, 12);
    this.fireball.visible = t < 12;
    // Wilson condensation shell
    const shellR = 600 * s * t + 200 * s;
    this.shell.scale.setScalar(shellR);
    this.shellMat.uniforms.uAlpha.value = t < 2.6 ? 0.42 * (1 - t / 2.6) : 0;
    this.shell.visible = t < 2.6;
    // ground shock ring
    const ringR = 520 * s * t + 100 * s;
    this.ring.scale.setScalar(ringR);
    this.ringMat.uniforms.uAlpha.value = 0.55 * (1 - THREE.MathUtils.smoothstep(t, 2, 11));
    // cloud emission schedule
    if (t > 0.35 && t < 4.5) {
      this.capTimer += dt;
      while (this.capTimer > 0.025) {
        this.capTimer -= 0.025;
        this.emitCap(1);
      }
    }
    if (t > 0.5 && t < 11) {
      this.stemTimer += dt;
      while (this.stemTimer > 0.07) {
        this.stemTimer -= 0.07;
        this.emitStem(1);
      }
    }
    return t < 14;
  }
}

/** MOUK: implosion (~1.4 s) then burst; blue-white palette, spherical bloom + halo ring */
export class MoukFx extends BigFx {
  private readonly fireball: THREE.Mesh;
  private readonly ringH: THREE.Mesh;
  private readonly ringV: THREE.Mesh;
  private readonly fireMat: THREE.ShaderMaterial;
  private readonly ringHMat: THREE.ShaderMaterial;
  private readonly ringVMat: THREE.ShaderMaterial;
  private burst = false;
  private static readonly IMPLODE = 1.4;

  constructor(ctx: BigFxContext, origin: THREE.Vector3, scale: number) {
    super(ctx, origin, scale);
    const g = shared();
    this.fireMat = fireballMaterial(true);
    this.ringHMat = shellMaterial(new THREE.Color(1.2, 1.6, 2.4), 1, true);
    this.ringVMat = shellMaterial(new THREE.Color(1.0, 1.3, 2.2), 1, true);
    this.fireball = this.mesh(g.sphere, this.fireMat);
    this.ringH = this.mesh(g.ring, this.ringHMat);
    this.ringV = this.mesh(g.ring, this.ringVMat);
    this.ringV.rotation.set(Math.PI / 2 - 0.35, 0, 0.3);
    this.fireball.visible = false;
    this.ringH.visible = false;
    this.ringV.visible = false;
    this.implosion();
    const dist = ctx.camera.position.distanceTo(origin);
    ctx.flash(Math.min(0.35, 0.5 - dist / 200_000), new THREE.Color(0.7, 0.8, 1));
  }

  private implosion(): void {
    const s = this.scale;
    const T = MoukFx.IMPLODE;
    const pa = this.ctx.add.spec;
    // inward streaks converging on the core
    for (let i = 0; i < 240; i++) {
      randomDir(_v);
      const R0 = (900 + rnd() * 700) * s;
      const k = 2.2;
      const v = (R0 * k) / (1 - Math.exp(-k * T));
      pa.x = this.origin.x + _v.x * R0;
      pa.y = this.origin.y + _v.y * R0;
      pa.z = this.origin.z + _v.z * R0;
      pa.vx = -_v.x * v;
      pa.vy = -_v.y * v;
      pa.vz = -_v.z * v;
      pa.life = T * (0.85 + rnd() * 0.15);
      pa.delay = rnd() * 0.15;
      pa.size0 = 9 * s;
      pa.size1 = 4 * s;
      pa.rot = 0;
      pa.spin = 0;
      pa.drag = k;
      pa.gravity = 0;
      pa.stretch = 0.06;
      pa.frame = 0;
      pa.flicker = false;
      pa.r0 = 0.6; pa.g0 = 0.8; pa.b0 = 2.2; pa.a0 = 0.2;
      pa.r1 = 2.4; pa.g1 = 3.0; pa.b1 = 4.0; pa.a1 = 1;
      this.ctx.add.emit();
    }
    // shrinking core glow
    pa.x = this.origin.x;
    pa.y = this.origin.y;
    pa.z = this.origin.z;
    pa.vx = pa.vy = pa.vz = 0;
    pa.life = T;
    pa.delay = 0;
    pa.size0 = 1500 * s;
    pa.size1 = 80 * s;
    pa.stretch = 0;
    pa.drag = 0;
    pa.frame = 0;
    pa.r0 = 0.25; pa.g0 = 0.4; pa.b0 = 1.0; pa.a0 = 0.35;
    pa.r1 = 3.0; pa.g1 = 3.6; pa.b1 = 5.0; pa.a1 = 1;
    this.ctx.add.emit();
  }

  private explode(): void {
    const s = this.scale;
    const dist = this.ctx.camera.position.distanceTo(this.origin);
    this.ctx.flash(Math.min(1, 1.3 - dist / 180_000), new THREE.Color(0.82, 0.9, 1));
    this.ctx.light(this.origin, 5e9 * s, new THREE.Color(0.7, 0.8, 1), 2.5);
    this.ctx.shakeLater(dist / 340, Math.min(1, 1.5 - dist / 30_000));
    const pa = this.ctx.add.spec;
    // radial sparks
    for (let i = 0; i < 180; i++) {
      randomDir(_v);
      const v = (900 + rnd() * 1600) * Math.sqrt(s);
      pa.x = this.origin.x;
      pa.y = this.origin.y;
      pa.z = this.origin.z;
      pa.vx = _v.x * v;
      pa.vy = _v.y * v;
      pa.vz = _v.z * v;
      pa.life = 1.4 + rnd() * 1.6;
      pa.delay = 0;
      pa.size0 = 14 * s;
      pa.size1 = 6 * s;
      pa.drag = 1.2;
      pa.gravity = 0;
      pa.stretch = 0.08;
      pa.frame = 0;
      pa.r0 = 3.0; pa.g0 = 3.6; pa.b0 = 5.0; pa.a0 = 1;
      pa.r1 = 0.5; pa.g1 = 0.7; pa.b1 = 2.0; pa.a1 = 0;
      this.ctx.add.emit();
    }
    // spherical bloom cloud (pale violet-grey), slowly rising
    const pb = this.ctx.alpha.spec;
    for (let i = 0; i < 150; i++) {
      randomDir(_v);
      _v.y = _v.y * 0.75 + 0.1;
      _v.normalize();
      const R = (900 + rnd() * 700) * s;
      const k = 0.35;
      const v = (R * k) / (1 - Math.exp(-k * 12));
      pb.x = this.origin.x;
      pb.y = this.origin.y;
      pb.z = this.origin.z;
      pb.vx = _v.x * v;
      pb.vy = _v.y * v;
      pb.vz = _v.z * v;
      pb.life = 24 + rnd() * 10;
      pb.delay = 0.15;
      pb.size0 = 200 * s;
      pb.size1 = (520 + rnd() * 260) * s;
      pb.rot = rnd() * 6.28;
      pb.spin = (rnd() - 0.5) * 0.12;
      pb.drag = k;
      pb.gravity = 2.5;
      pb.stretch = 0;
      pb.frame = 1 + (i & 1);
      pb.flicker = false;
      pb.r0 = 0.82; pb.g0 = 0.84; pb.b0 = 1.05; pb.a0 = 0.85;
      pb.r1 = 0.52; pb.g1 = 0.5; pb.b1 = 0.62; pb.a1 = 0;
      this.ctx.alpha.emit();
    }
    // halo ring of cloud in the horizontal plane
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const R = 2300 * s;
      const k = 0.4;
      const v = (R * k) / (1 - Math.exp(-k * 10));
      pb.x = this.origin.x;
      pb.y = this.origin.y;
      pb.z = this.origin.z;
      pb.vx = Math.cos(a) * v;
      pb.vy = 0;
      pb.vz = Math.sin(a) * v;
      pb.life = 18 + rnd() * 6;
      pb.delay = 0.3;
      pb.size0 = 120 * s;
      pb.size1 = 300 * s;
      pb.drag = k;
      pb.gravity = 1;
      pb.frame = 1;
      pb.r0 = 0.9; pb.g0 = 0.95; pb.b0 = 1.1; pb.a0 = 0.6;
      pb.r1 = 0.6; pb.g1 = 0.62; pb.b1 = 0.72; pb.a1 = 0;
      this.ctx.alpha.emit();
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    const T = MoukFx.IMPLODE;
    if (!this.burst && this.t >= T) {
      this.burst = true;
      this.explode();
      this.fireball.visible = true;
      this.ringH.visible = true;
      this.ringV.visible = true;
    }
    if (this.burst) {
      const tb = this.t - T;
      const s = this.scale;
      this.fireball.scale.setScalar(Math.max(1, 620 * s * (1 - Math.exp(-tb / 0.3))));
      this.fireMat.uniforms.uTime.value = tb;
      this.fireMat.uniforms.uHeat.value = Math.max(0, 1 - tb / 4);
      this.fireMat.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(tb, 2.5, 7);
      this.fireball.visible = tb < 7;
      const r1 = 900 * s * tb + 150 * s;
      this.ringH.scale.setScalar(r1);
      this.ringV.scale.setScalar(r1 * 0.75);
      const ra = 0.9 * (1 - THREE.MathUtils.smoothstep(tb, 0.5, 6));
      this.ringHMat.uniforms.uAlpha.value = ra;
      this.ringVMat.uniforms.uAlpha.value = ra * 0.7;
      this.ringH.visible = this.ringV.visible = tb < 6;
      return tb < 8;
    }
    return true;
  }
}
