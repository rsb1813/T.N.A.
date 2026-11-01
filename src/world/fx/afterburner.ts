// Engine exhaust: per nozzle an outer plume cone + inner core cone (additive animated shader with shock
// diamonds) and a cluster of billboards (nozzle glow + diamond knots) that reads well from the chase camera.
// level(): 0 = engine off, 0..1 = military power (faint hot core), 1..2 = afterburner stage.
import * as THREE from 'three';
import { GLSL_FOG_FACTOR, GLSL_FRAG_PARS, GLSL_NOISE, GLSL_VERT_END, GLSL_VERT_PARS } from '../glsl';
import { getParticleTexture } from '../textures';

const PLUME_VERT = /* glsl */ `
${GLSL_VERT_PARS}
varying float vX;
varying vec3 vN;
varying vec3 vV;
varying float vAng;
void main() {
  vX = uv.y;
  vAng = uv.x;
  vN = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  ${GLSL_VERT_END}
}
`;

const PLUME_FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_FOG_FACTOR}
${GLSL_NOISE}
uniform float uLevel;
uniform float uTime;
uniform float uSeed;
uniform float uCore;
uniform float uDiamonds;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying float vX;
varying vec3 vN;
varying vec3 vV;
varying float vAng;
void main() {
  #include <logdepthbuf_fragment>
  float ab = clamp(uLevel - 1.0, 0.0, 1.0);
  float mil = clamp(uLevel, 0.0, 1.0);
  float x = vX;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(facing, uCore > 0.5 ? 1.2 : 2.2);
  float n = tnaNoise(vec2(vAng * 9.0 + uSeed, x * 7.0 - uTime * 26.0));
  float n2 = tnaNoise(vec2(vAng * 4.0 - uSeed, x * 3.0 - uTime * 11.0));
  float flick = 0.72 + 0.28 * n * (0.6 + 0.4 * n2);
  float fall = pow(1.0 - x, uCore > 0.5 ? 1.0 : 1.6) * smoothstep(0.0, 0.06, x + 0.02);
  float dia = pow(0.5 + 0.5 * cos(x * uDiamonds * 6.2831853), 8.0) * (1.0 - smoothstep(0.15, 0.85, x));
  vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.45, x));
  col = mix(col, uColC, smoothstep(0.4, 1.0, x));
  float inten;
  if (uCore > 0.5) {
    inten = (body * fall * (0.7 + 1.8 * ab) + dia * 2.4 * ab) * flick;
    col = mix(col, vec3(1.0, 0.97, 0.92), 0.35 * dia);
  } else {
    inten = body * fall * flick * (0.35 + 1.25 * ab);
  }
  inten *= ab > 0.0 ? 1.0 : mil * 0.35;
  gl_FragColor = vec4(col * inten * (1.0 - tnaFogFactor()), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
${GLSL_VERT_PARS}
attribute vec3 aCenter;
uniform float uRadius;
uniform float uLength;
uniform float uLevel;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  float ab = clamp(uLevel - 1.0, 0.0, 1.0);
  float mil = clamp(uLevel, 0.0, 1.0);
  float idx = aCenter.y;
  vec3 local = vec3(0.0, 0.0, aCenter.x * (idx < 0.5 ? uRadius : uLength));
  vec4 mvPosition = modelViewMatrix * vec4(local, 1.0);
  // how directly the camera looks up the exhaust (from behind)
  vec3 axis = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  float behind = clamp(dot(axis, normalize(-mvPosition.xyz)), 0.0, 1.0);
  float size;
  float flick = 0.85 + 0.15 * sin(uTime * 61.0 + uSeed + idx * 3.1);
  if (idx < 0.5) {
    // nozzle glow: strongest seen from behind
    size = uRadius * (2.2 + 2.2 * ab) * (0.7 + 0.3 * behind);
    vCol = mix(vec3(1.0, 0.45, 0.15) * mil * 0.6, vec3(0.75, 0.82, 1.0) * 2.2, ab) * (0.45 + 0.75 * behind) * flick;
  } else {
    // shock diamond knot
    float k = idx - 1.0;
    size = uRadius * (0.95 - k * 0.12) * (0.6 + 0.4 * ab);
    vCol = vec3(1.0, 0.86, 0.72) * (1.6 - k * 0.32) * smoothstep(0.15, 0.6, ab) * flick;
  }
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = (position.xy + 0.5) * 0.5;
  vA = 1.0;
  ${GLSL_VERT_END}
}
`;

const GLOW_FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_FOG_FACTOR}
uniform sampler2D uTex;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(uTex, vUv).a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * (1.0 - tnaFogFactor()), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Diamond knot positions along the plume, as fractions of plume length */
const DIAMONDS = [0.12, 0.24, 0.36, 0.48];

let plumeGeo: THREE.BufferGeometry | null = null;
let coreGeo: THREE.BufferGeometry | null = null;
let glowGeo: THREE.BufferGeometry | null = null;

function sharedGeometry(): { plume: THREE.BufferGeometry; core: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  if (!plumeGeo) {
    // unit plume along +Z from z = 0 (nozzle, radius 1) to z = 1 (tail)
    plumeGeo = new THREE.CylinderGeometry(0.32, 1, 1, 18, 10, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    coreGeo = new THREE.CylinderGeometry(0.05, 0.78, 1, 14, 12, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    // glow quads: [0] nozzle glow (z = 0.25 radius), [1..] diamonds (z = fraction of length)
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.BufferGeometry();
    const n = 1 + DIAMONDS.length;
    const pos: number[] = [];
    const center: number[] = [];
    const idx: number[] = [];
    const qp = quad.attributes.position;
    const qi = quad.index!;
    for (let k = 0; k < n; k++) {
      const zf = k === 0 ? 0.25 : DIAMONDS[k - 1];
      for (let v = 0; v < qp.count; v++) {
        pos.push(qp.getX(v), qp.getY(v), 0);
        center.push(zf, k, 0);
      }
      for (let i = 0; i < qi.count; i++) idx.push(qi.getX(i) + k * qp.count);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(center, 3));
    g.setIndex(idx);
    quad.dispose();
    glowGeo = g;
  }
  return { plume: plumeGeo, core: coreGeo!, glow: glowGeo! };
}

export function disposeAfterburnerGeometry(): void {
  plumeGeo?.dispose();
  coreGeo?.dispose();
  glowGeo?.dispose();
  plumeGeo = coreGeo = glowGeo = null;
}

function plumeMaterial(core: boolean, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: core ? 'tna_ab_core' : 'tna_ab_plume',
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uCore: { value: core ? 1 : 0 },
        uDiamonds: { value: core ? 4.2 : 0 },
        uColA: { value: core ? new THREE.Color(0.75, 0.85, 1.6) : new THREE.Color(1.4, 0.75, 0.42) },
        uColB: { value: core ? new THREE.Color(1.5, 1.2, 0.9) : new THREE.Color(1.3, 0.45, 0.16) },
        uColC: { value: core ? new THREE.Color(1.2, 0.5, 0.25) : new THREE.Color(0.9, 0.22, 0.32) },
      },
    ]),
  });
}

export class AfterburnerFx {
  private readonly groups: THREE.Group[] = [];
  private readonly plumeMat: THREE.ShaderMaterial;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly plumes: THREE.Mesh[] = [];
  private readonly cores: THREE.Mesh[] = [];
  private readonly radius: number;
  stopped = false;

  constructor(
    readonly target: THREE.Object3D,
    nozzles: THREE.Vector3[],
    private readonly level: () => number,
  ) {
    const seed = Math.random() * 100;
    const geo = sharedGeometry();
    this.plumeMat = plumeMaterial(false, seed);
    this.coreMat = plumeMaterial(true, seed + 7);
    this.glowMat = new THREE.ShaderMaterial({
      name: 'tna_ab_glow',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uRadius: { value: 0.5 }, uLength: { value: 4 }, uLevel: { value: 0 }, uTime: { value: 0 }, uSeed: { value: seed }, uTex: { value: null } },
      ]),
    });
    this.glowMat.uniforms.uTex.value = getParticleTexture();
    this.radius = AfterburnerFx.estimateRadius(target, nozzles.length);
    this.glowMat.uniforms.uRadius.value = this.radius;
    for (const n of nozzles) {
      const g = new THREE.Group();
      g.name = 'tna_afterburner';
      g.position.copy(n);
      const plume = new THREE.Mesh(geo.plume, this.plumeMat);
      const core = new THREE.Mesh(geo.core, this.coreMat);
      const glow = new THREE.Mesh(geo.glow, this.glowMat);
      for (const m of [plume, core, glow]) {
        m.frustumCulled = false;
        m.renderOrder = 24;
      }
      g.add(plume, core, glow);
      target.add(g);
      this.groups.push(g);
      this.plumes.push(plume);
      this.cores.push(core);
    }
  }

  /** Nozzle radius from the model's length (twin engines are smaller) */
  static estimateRadius(target: THREE.Object3D, count: number): number {
    const box = new THREE.Box3().setFromObject(target);
    const len = box.isEmpty() ? 15 : Math.max(box.max.z - box.min.z, 4);
    return THREE.MathUtils.clamp(len * (count > 1 ? 0.028 : 0.036), 0.2, 1.1);
  }

  update(time: number): void {
    const lv = THREE.MathUtils.clamp(this.level(), 0, 2);
    const ab = Math.max(0, lv - 1);
    const r = this.radius;
    const L = r * (lv > 1 ? 2.4 + 9 * ab : 1.6 * Math.min(1, lv));
    const coreL = r * (lv > 1 ? 1.6 + 5.4 * ab : 1.1 * Math.min(1, lv));
    const visible = lv > 0.02;
    for (let i = 0; i < this.groups.length; i++) {
      this.groups[i].visible = visible;
      this.plumes[i].scale.set(r * (0.95 + 0.15 * ab), r * (0.95 + 0.15 * ab), Math.max(0.01, L));
      this.cores[i].scale.set(r, r, Math.max(0.01, coreL));
    }
    for (const m of [this.plumeMat, this.coreMat, this.glowMat]) {
      m.uniforms.uLevel.value = lv;
      m.uniforms.uTime.value = time;
    }
    this.glowMat.uniforms.uLength.value = Math.max(0.01, coreL * 1.05);
  }

  dispose(): void {
    for (const g of this.groups) g.removeFromParent();
    this.groups.length = 0;
    this.plumeMat.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.stopped = true;
  }
}
