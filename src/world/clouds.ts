// Weather clouds: instanced camera-facing puffs arranged in clusters/layers on a tile that wraps around the
// camera (infinite coverage). Sorted back-to-front a few times per second. Storms add lightning.
import * as THREE from 'three';
import type { Weather } from '../core/environment';
import type { BiomeDef } from './biomes';
import { GLSL_FRAG_PARS, GLSL_VERT_END, GLSL_VERT_PARS } from './glsl';
import type { SkyState } from './sky';
import { getCloudTexture } from './textures';

interface Puff {
  x: number;
  y: number;
  z: number;
  size: number;
  lit: number;
  alpha: number;
  frame: number;
  rot: number;
}

interface LayerPreset {
  /** Wrap tile size (m) */
  tile: number;
  clusters: number;
  puffsPerCluster: [number, number];
  clusterRadius: [number, number];
  /** Altitude offset from biome cloudBase (m) */
  baseOffset: number;
  /** Continuous sheet (overcast/storm) */
  sheet?: { spacing: number; size: [number, number]; thickness: number; alpha: number; baseOffset: number };
  towers?: { count: number; height: number; radius: number };
  alpha: number;
}

const PRESETS: Record<Weather, LayerPreset> = {
  clear: { tile: 70_000, clusters: 22, puffsPerCluster: [4, 7], clusterRadius: [350, 700], baseOffset: 300, alpha: 0.75 },
  scattered: { tile: 70_000, clusters: 230, puffsPerCluster: [6, 13], clusterRadius: [500, 1500], baseOffset: 0, alpha: 0.88 },
  overcast: {
    tile: 46_000,
    clusters: 60,
    puffsPerCluster: [5, 9],
    clusterRadius: [500, 1100],
    baseOffset: -500,
    sheet: { spacing: 1050, size: [1700, 2500], thickness: 650, alpha: 0.78, baseOffset: 200 },
    alpha: 0.85,
  },
  storm: {
    tile: 42_000,
    clusters: 50,
    puffsPerCluster: [5, 9],
    clusterRadius: [500, 1100],
    baseOffset: -650,
    sheet: { spacing: 1000, size: [1800, 2600], thickness: 1100, alpha: 0.9, baseOffset: 100 },
    towers: { count: 7, height: 7500, radius: 2600 },
    alpha: 0.92,
  },
};

const VERT = /* glsl */ `
${GLSL_VERT_PARS}
attribute vec4 aCenter;
attribute vec4 aInfo;
uniform vec2 uFade;
varying vec2 vUv;
varying float vLit;
varying float vAlpha;
void main() {
  float size = aCenter.w;
  vec3 c = aCenter.xyz;
  vec4 mvPosition = viewMatrix * vec4(c, 1.0);
  float cr = cos(aInfo.w);
  float sr = sin(aInfo.w);
  vec2 q = position.xy;
  vec2 rc = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr) * size;
  mvPosition.xy += rc;
  gl_Position = projectionMatrix * mvPosition;
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  float wy = dot(camRight * rc.x + camUp * rc.y, vec3(0.0, 1.0, 0.0)) / size;
  vLit = clamp(aInfo.x + wy * 0.55, 0.0, 1.0);
  float fr = aInfo.z;
  vUv = (q + 0.5) * 0.5 + vec2(mod(fr, 2.0), floor(fr * 0.5)) * 0.5;
  float d = length(mvPosition.xyz);
  float hd = length(c.xz - cameraPosition.xz);
  vAlpha = aInfo.y * smoothstep(size * 0.25, size * 0.9, d) * (1.0 - smoothstep(uFade.x, uFade.y, hd));
  ${GLSL_VERT_END}
}
`;

const FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
uniform sampler2D uTex;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uFlash;
varying vec2 vUv;
varying float vLit;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = mix(uShade, uLit, smoothstep(0.0, 1.0, vLit));
  col += vec3(0.8, 0.85, 1.0) * uFlash * (0.5 + 0.5 * vLit);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const BOLT_VERT = /* glsl */ `
${GLSL_VERT_PARS}
attribute float aSide;
varying float vSide;
void main() {
  vSide = aSide;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${GLSL_VERT_END}
}
`;

const BOLT_FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
uniform float uIntensity;
varying float vSide;
void main() {
  #include <logdepthbuf_fragment>
  float core = 1.0 - abs(vSide);
  vec3 col = vec3(0.75, 0.82, 1.0) * (pow(core, 3.0) * 6.0 + core) * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BOLT_SEGMENTS = 18;

export class CloudSystem {
  readonly group = new THREE.Group();
  /** 0..1 lightning flash level (for audio thunder / overlays) */
  lightning = 0;
  private readonly puffs: Puff[] = [];
  private readonly mesh: THREE.Mesh | null = null;
  private readonly geom: THREE.InstancedBufferGeometry | null = null;
  private readonly material: THREE.ShaderMaterial;
  private readonly centerAttr: THREE.InstancedBufferAttribute | null = null;
  private readonly infoAttr: THREE.InstancedBufferAttribute | null = null;
  private readonly keys: Float32Array;
  private readonly order: Uint32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wz: Float32Array;
  private readonly tile: number;
  private readonly lastSort = new THREE.Vector3(Infinity, 0, 0);
  private sortTimer = 0;
  private nextStrike = 4;
  private boltMesh: THREE.Mesh | null = null;
  private boltMat: THREE.ShaderMaterial | null = null;
  private boltLife = 0;
  private readonly storm: boolean;
  private flashPulses: number[] = [];

  constructor(
    weather: Weather,
    biome: BiomeDef,
    seed: number,
    private readonly sunDir: THREE.Vector3,
    private readonly onFlash: (amount: number) => void,
  ) {
    const preset = PRESETS[weather] ?? PRESETS.clear;
    this.tile = preset.tile;
    this.storm = weather === 'storm';
    this.generate(preset, biome, seed);
    const n = this.puffs.length;
    this.keys = new Float32Array(n);
    this.order = new Uint32Array(n);
    this.wx = new Float32Array(n);
    this.wy = new Float32Array(n);
    this.wz = new Float32Array(n);
    this.material = new THREE.ShaderMaterial({
      name: 'tna_clouds',
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTex: { value: null },
          uLit: { value: new THREE.Color(1, 1, 1) },
          uShade: { value: new THREE.Color(0.6, 0.65, 0.72) },
          uFlash: { value: 0 },
          uFade: { value: new THREE.Vector2(this.tile * 0.36, this.tile * 0.49) },
        },
      ]),
    });
    this.material.uniforms.uTex.value = getCloudTexture();
    this.group.name = 'tna_clouds';
    if (n > 0) {
      const geom = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1);
      geom.index = quad.index;
      geom.setAttribute('position', quad.attributes.position);
      this.centerAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      this.infoAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      this.centerAttr.setUsage(THREE.DynamicDrawUsage);
      this.infoAttr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('aCenter', this.centerAttr);
      geom.setAttribute('aInfo', this.infoAttr);
      geom.instanceCount = n;
      this.geom = geom;
      this.mesh = new THREE.Mesh(geom, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 10;
      this.group.add(this.mesh);
    }
    if (this.storm) this.createBolt();
  }

  get count(): number {
    return this.puffs.length;
  }

  private generate(p: LayerPreset, biome: BiomeDef, seed: number): void {
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const T = p.tile;
    const base = biome.cloudBase + p.baseOffset;
    const sun = this.sunDir;
    const sunH = Math.hypot(sun.x, sun.z) || 1;
    const addCluster = (cx: number, cz: number, cy: number, R: number, count: number, alpha: number, tall: number): void => {
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * R;
        const dx = Math.cos(a) * r;
        const dz = Math.sin(a) * r;
        const dome = 1 - (r / R) * (r / R);
        const dy = (0.15 + 0.85 * rnd()) * dome * R * 0.55 * tall;
        const sunSide = (dx * sun.x + dz * sun.z) / (R * sunH);
        const top = dy / (R * 0.55 * tall + 1);
        this.puffs.push({
          x: cx + dx,
          y: cy + dy,
          z: cz + dz,
          size: R * (0.75 + 0.55 * rnd()) * (0.75 + 0.35 * dome),
          lit: Math.min(1, Math.max(0, 0.32 + 0.48 * top + 0.22 * sunSide)),
          alpha: alpha * (0.75 + 0.25 * rnd()),
          frame: Math.floor(rnd() * 4),
          rot: rnd() * Math.PI * 2,
        });
      }
    };
    for (let c = 0; c < p.clusters; c++) {
      const R = p.clusterRadius[0] + rnd() * (p.clusterRadius[1] - p.clusterRadius[0]);
      const n = Math.round(p.puffsPerCluster[0] + rnd() * (p.puffsPerCluster[1] - p.puffsPerCluster[0]));
      addCluster((rnd() - 0.5) * T, (rnd() - 0.5) * T, base + (rnd() - 0.5) * 400, R, n, p.alpha, 1);
    }
    if (p.sheet) {
      const sh = p.sheet;
      const cells = Math.floor(T / sh.spacing);
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const x = -T / 2 + (i + rnd()) * sh.spacing;
          const z = -T / 2 + (j + rnd()) * sh.spacing;
          const layers = 2;
          for (let l = 0; l < layers; l++) {
            const top = (l + rnd() * 0.5) / layers;
            this.puffs.push({
              x,
              y: biome.cloudBase + sh.baseOffset + top * sh.thickness,
              z,
              size: sh.size[0] + rnd() * (sh.size[1] - sh.size[0]),
              lit: 0.25 + 0.6 * top + 0.1 * rnd(),
              alpha: sh.alpha * (0.7 + 0.3 * rnd()),
              frame: 2 + Math.floor(rnd() * 2),
              rot: rnd() * Math.PI * 2,
            });
          }
        }
      }
    }
    if (p.towers) {
      const tw = p.towers;
      for (let k = 0; k < tw.count; k++) {
        const cx = (rnd() - 0.5) * T * 0.9;
        const cz = (rnd() - 0.5) * T * 0.9;
        const levels = 9;
        for (let l = 0; l < levels; l++) {
          const f = l / (levels - 1);
          // anvil: wider at the top
          const R = tw.radius * (0.55 + 0.35 * Math.sin(f * 2.2) + (f > 0.8 ? (f - 0.8) * 4 : 0));
          addCluster(cx, cz, biome.cloudBase + f * tw.height, R, 14, 0.95, 0.5);
        }
      }
    }
  }

  setSky(s: SkyState): void {
    this.material.uniforms.uLit.value.copy(s.cloudLit);
    this.material.uniforms.uShade.value.copy(s.cloudShade);
  }

  private resort(cam: THREE.Vector3): void {
    const T = this.tile;
    const n = this.puffs.length;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[i];
      let dx = p.x - cam.x;
      let dz = p.z - cam.z;
      dx -= Math.round(dx / T) * T;
      dz -= Math.round(dz / T) * T;
      const dy = p.y - cam.y;
      this.wx[i] = cam.x + dx;
      this.wy[i] = p.y;
      this.wz[i] = cam.z + dz;
      this.keys[i] = dx * dx + dy * dy + dz * dz;
      this.order[i] = i;
    }
    const keys = this.keys;
    this.order.sort((a, b) => keys[b] - keys[a]);
    const c = this.centerAttr!.array as Float32Array;
    const f = this.infoAttr!.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = this.order[k];
      const p = this.puffs[i];
      c[k * 4] = this.wx[i];
      c[k * 4 + 1] = this.wy[i];
      c[k * 4 + 2] = this.wz[i];
      c[k * 4 + 3] = p.size;
      f[k * 4] = p.lit;
      f[k * 4 + 1] = p.alpha;
      f[k * 4 + 2] = p.frame;
      f[k * 4 + 3] = p.rot;
    }
    this.centerAttr!.needsUpdate = true;
    this.infoAttr!.needsUpdate = true;
    this.lastSort.copy(cam);
  }

  private createBolt(): void {
    const verts = (BOLT_SEGMENTS + 1) * 2;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const side = new Float32Array(verts);
    for (let i = 0; i < verts; i++) side[i] = i % 2 === 0 ? -1 : 1;
    geom.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const idx: number[] = [];
    for (let i = 0; i < BOLT_SEGMENTS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geom.setIndex(idx);
    this.boltMat = new THREE.ShaderMaterial({
      name: 'tna_lightning',
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uIntensity: { value: 0 } }]),
    });
    this.boltMesh = new THREE.Mesh(geom, this.boltMat);
    this.boltMesh.frustumCulled = false;
    this.boltMesh.visible = false;
    this.group.add(this.boltMesh);
  }

  private strike(cam: THREE.Vector3, groundAt: (x: number, z: number) => number, cloudBase: number): void {
    const a = Math.random() * Math.PI * 2;
    const d = 5000 + Math.random() * 14000;
    let x = cam.x + Math.cos(a) * d;
    let z = cam.z + Math.sin(a) * d;
    const top = cloudBase + 200;
    const bottom = groundAt(x, z);
    const pos = this.boltMesh!.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    // camera-facing width axis
    const vx = x - cam.x;
    const vz = z - cam.z;
    const vl = Math.hypot(vx, vz) || 1;
    const wx = -vz / vl;
    const wz = vx / vl;
    const width = 18 + Math.random() * 10;
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const f = i / BOLT_SEGMENTS;
      const y = top + (bottom - top) * f;
      if (i > 0) {
        x += (Math.random() - 0.5) * 420;
        z += (Math.random() - 0.5) * 420;
      }
      arr[i * 6] = x - wx * width;
      arr[i * 6 + 1] = y;
      arr[i * 6 + 2] = z - wz * width;
      arr[i * 6 + 3] = x + wx * width;
      arr[i * 6 + 4] = y;
      arr[i * 6 + 5] = z + wz * width;
    }
    pos.needsUpdate = true;
    this.boltMesh!.visible = true;
    this.boltLife = 0.22;
    this.flashPulses = [0, 0.07, 0.16];
  }

  update(dt: number, cam: THREE.Vector3, groundAt: (x: number, z: number) => number, cloudBase: number): void {
    if (this.mesh) {
      this.sortTimer -= dt;
      if (this.sortTimer <= 0 || cam.distanceToSquared(this.lastSort) > 150 * 150) {
        this.resort(cam);
        this.sortTimer = 0.35;
      }
    }
    if (!this.storm) return;
    this.nextStrike -= dt;
    if (this.nextStrike <= 0 && this.boltMesh) {
      this.strike(cam, groundAt, cloudBase);
      this.nextStrike = 3 + Math.random() * 9;
    }
    let flash = 0;
    if (this.flashPulses.length) {
      for (let i = this.flashPulses.length - 1; i >= 0; i--) {
        this.flashPulses[i] -= dt;
        if (this.flashPulses[i] <= 0 && this.flashPulses[i] > -dt * 1.5) flash = 1;
        if (this.flashPulses[i] < -0.5) this.flashPulses.splice(i, 1);
      }
    }
    if (flash > 0) this.onFlash(0.9 + Math.random() * 0.1);
    this.lightning = Math.max(0, this.lightning - dt * 5, flash);
    this.material.uniforms.uFlash.value = this.lightning * 0.8;
    if (this.boltMesh && this.boltLife > 0) {
      this.boltLife -= dt;
      this.boltMat!.uniforms.uIntensity.value = this.boltLife > 0 ? (0.6 + 0.4 * Math.sin(this.boltLife * 90)) * 1.8 : 0;
      if (this.boltLife <= 0) this.boltMesh.visible = false;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geom?.dispose();
    this.material.dispose();
    this.boltMesh?.geometry.dispose();
    this.boltMat?.dispose();
  }
}
