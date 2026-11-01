// Camera-facing trail ribbons (missile smoke, wingtip vortices). Each ribbon is a polyline of timestamped
// points; width grows and opacity fades with each point's age, so a trail lingers after its emitter dies.
import * as THREE from 'three';
import { GLSL_FRAG_PARS, GLSL_NOISE, GLSL_VERT_END, GLSL_VERT_PARS } from '../glsl';

export interface RibbonStyle {
  /** Point lifetime (s) */
  life: number;
  /** Width at birth / at end of life (m) */
  width0: number;
  width1: number;
  /** Opacity multiplier */
  alpha: number;
  color: THREE.Color;
  /** Seconds over which the newest points fade in (hides the joint at the emitter) */
  headFade: number;
  /** Lit by scene light (smoke) or self-coloured (vapour stays bright) */
  lit: boolean;
}

const VERT = /* glsl */ `
${GLSL_VERT_PARS}
attribute vec3 aTangent;
attribute vec4 aInfo;
uniform float uTime;
uniform float uLife;
uniform vec2 uWidth;
uniform float uHeadFade;
varying float vAlpha;
varying float vSide;
varying float vDist;
varying float vAge;
void main() {
  float age = uTime - aInfo.x;
  float t = clamp(age / uLife, 0.0, 1.0);
  vec3 p = position;
  vec3 T = aTangent;
  vec3 toCam = cameraPosition - p;
  vec3 side = cross(T, toCam);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = mix(uWidth.x, uWidth.y, sqrt(t));
  p += side * aInfo.y * w * 0.5;
  vAlpha = aInfo.w * pow(1.0 - t, 1.4) * smoothstep(0.0, uHeadFade, age) * step(age, uLife);
  vSide = aInfo.y;
  vDist = aInfo.z;
  vAge = age;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${GLSL_VERT_END}
}
`;

const FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_NOISE}
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uAlpha;
varying float vAlpha;
varying float vSide;
varying float vDist;
varying float vAge;
void main() {
  #include <logdepthbuf_fragment>
  float edge = 1.0 - vSide * vSide;
  float n = tnaNoise(vec2(vDist * 0.045 - vAge * 0.3, vSide * 1.7 + vAge * 0.15));
  float n2 = tnaNoise(vec2(vDist * 0.16, vSide * 3.0 - vAge * 0.4));
  float a = uAlpha * vAlpha * pow(edge, 1.2) * (0.55 + 0.45 * n) * (0.8 + 0.2 * n2);
  if (a < 0.003) discard;
  vec3 col = uColor * uLight * (0.85 + 0.25 * n2);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const _t = new THREE.Vector3();

export class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geom: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly tan: Float32Array;
  private readonly info: Float32Array;
  /** points written (the last one is the moving head) */
  private n = 0;
  private dist = 0;
  private lastCommitTime = 0;
  private newestBirth = -1e9;
  private dirtyFrom = 0;
  /** still being fed by an emitter */
  active = false;
  private life = 1;

  constructor(readonly capacity: number) {
    const v = capacity * 2;
    this.pos = new Float32Array(v * 3);
    this.tan = new Float32Array(v * 3);
    this.info = new Float32Array(v * 4);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aTangent', new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array((capacity - 1) * 6);
    for (let i = 0; i < capacity - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    this.geom.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geom.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      name: 'tna_fx_ribbon',
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uLife: { value: 10 },
          uWidth: { value: new THREE.Vector2(1, 6) },
          uHeadFade: { value: 0.1 },
          uColor: { value: new THREE.Color(1, 1, 1) },
          uLight: { value: new THREE.Color(1, 1, 1) },
          uAlpha: { value: 1 },
        },
      ]),
    });
    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
    this.mesh.visible = false;
  }

  start(style: RibbonStyle, p: THREE.Vector3, time: number, alpha: number): void {
    const u = this.material.uniforms;
    u.uLife.value = style.life;
    u.uWidth.value.set(style.width0, style.width1);
    u.uHeadFade.value = style.headFade;
    u.uColor.value.copy(style.color);
    u.uAlpha.value = style.alpha;
    this.material.userData.lit = style.lit;
    this.life = style.life;
    this.n = 0;
    this.dist = 0;
    this.dirtyFrom = 0;
    this.active = true;
    this.writePoint(0, p, time, alpha);
    this.writePoint(1, p, time, alpha);
    this.n = 2;
    this.lastCommitTime = time;
    this.newestBirth = time;
    this.mesh.visible = true;
  }

  private writePoint(i: number, p: THREE.Vector3, time: number, alpha: number): void {
    const o3 = i * 6;
    const o4 = i * 8;
    if (i > 0) {
      const j = (i - 1) * 6;
      _t.set(p.x - this.pos[j], p.y - this.pos[j + 1], p.z - this.pos[j + 2]);
    } else {
      _t.set(0, 0, 1);
    }
    const seg = _t.length();
    if (seg > 1e-4) _t.multiplyScalar(1 / seg);
    else if (i > 0) _t.set(this.tan[(i - 1) * 6], this.tan[(i - 1) * 6 + 1], this.tan[(i - 1) * 6 + 2]);
    const d = i > 0 ? this.info[(i - 1) * 8 + 2] + seg : 0;
    for (let s = 0; s < 2; s++) {
      this.pos[o3 + s * 3] = p.x;
      this.pos[o3 + s * 3 + 1] = p.y;
      this.pos[o3 + s * 3 + 2] = p.z;
      this.tan[o3 + s * 3] = _t.x;
      this.tan[o3 + s * 3 + 1] = _t.y;
      this.tan[o3 + s * 3 + 2] = _t.z;
      this.info[o4 + s * 4] = time;
      this.info[o4 + s * 4 + 1] = s === 0 ? -1 : 1;
      this.info[o4 + s * 4 + 2] = d;
      this.info[o4 + s * 4 + 3] = alpha;
    }
    if (i === 1) {
      // first segment: give point 0 the same tangent
      for (let s = 0; s < 2; s++) {
        this.tan[s * 3] = _t.x;
        this.tan[s * 3 + 1] = _t.y;
        this.tan[s * 3 + 2] = _t.z;
      }
    }
    this.dist = d;
    if (i < this.dirtyFrom) this.dirtyFrom = i;
  }

  /**
   * Feed the emitter position. The head point follows every frame; a fixed point is committed when
   * `interval` seconds or `minDist` metres have passed. Returns false when the buffer is full.
   */
  feed(p: THREE.Vector3, time: number, alpha: number, interval: number, minDist: number): boolean {
    if (!this.active) return false;
    const head = this.n - 1;
    const prev = (head - 1) * 6;
    const dx = p.x - this.pos[prev];
    const dy = p.y - this.pos[prev + 1];
    const dz = p.z - this.pos[prev + 2];
    if (time - this.lastCommitTime >= interval || dx * dx + dy * dy + dz * dz >= minDist * minDist) {
      if (this.n >= this.capacity) {
        this.active = false;
        return false;
      }
      this.writePoint(head, p, time, alpha);
      this.writePoint(head + 1, p, time, alpha);
      this.n++;
      this.lastCommitTime = time;
    } else {
      this.writePoint(head, p, time, alpha);
    }
    this.newestBirth = time;
    return true;
  }

  /** Stop feeding; existing points fade out over their lifetime */
  finish(): void {
    this.active = false;
  }

  /** True while any point is still visible */
  visibleAt(time: number): boolean {
    return this.active || time - this.newestBirth < this.life;
  }

  update(time: number, light: THREE.Color): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    if (this.material.userData.lit) u.uLight.value.copy(light);
    else u.uLight.value.setRGB(1, 1, 1);
    if (this.dirtyFrom < this.n) {
      const from = Math.max(0, this.dirtyFrom - 1);
      const cnt = this.n - from;
      const a = this.geom.attributes;
      (a.position as THREE.BufferAttribute).clearUpdateRanges();
      (a.position as THREE.BufferAttribute).addUpdateRange(from * 6, cnt * 6);
      (a.aTangent as THREE.BufferAttribute).clearUpdateRanges();
      (a.aTangent as THREE.BufferAttribute).addUpdateRange(from * 6, cnt * 6);
      (a.aInfo as THREE.BufferAttribute).clearUpdateRanges();
      (a.aInfo as THREE.BufferAttribute).addUpdateRange(from * 8, cnt * 8);
      a.position.needsUpdate = true;
      a.aTangent.needsUpdate = true;
      a.aInfo.needsUpdate = true;
      this.dirtyFrom = this.n;
    }
    this.geom.setDrawRange(0, Math.max(0, this.n - 1) * 6);
  }

  hide(): void {
    this.mesh.visible = false;
    this.active = false;
    this.n = 0;
    this.geom.setDrawRange(0, 0);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geom.dispose();
    this.material.dispose();
  }
}

/** Fixed-size pool of ribbons sharing one capacity; ribbons return to the pool once fully faded */
export class RibbonPool {
  readonly group = new THREE.Group();
  private readonly all: Ribbon[] = [];
  private readonly free: Ribbon[] = [];
  private readonly busy = new Set<Ribbon>();

  constructor(
    private readonly max: number,
    private readonly points: number,
  ) {
    this.group.name = 'tna_fx_ribbons';
  }

  acquire(): Ribbon | null {
    let r = this.free.pop();
    if (!r) {
      if (this.all.length >= this.max) return null;
      r = new Ribbon(this.points);
      this.all.push(r);
      this.group.add(r.mesh);
    }
    this.busy.add(r);
    return r;
  }

  get activeCount(): number {
    return this.busy.size;
  }

  update(time: number, light: THREE.Color): void {
    for (const r of this.busy) {
      if (!r.visibleAt(time)) {
        r.hide();
        this.busy.delete(r);
        this.free.push(r);
        continue;
      }
      r.update(time, light);
    }
  }

  dispose(): void {
    for (const r of this.all) r.dispose();
    this.all.length = 0;
    this.free.length = 0;
    this.busy.clear();
    this.group.removeFromParent();
  }
}
