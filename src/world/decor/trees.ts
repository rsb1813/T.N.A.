// Instanced low-poly trees around the camera (near-only). Placement is a deterministic jittered grid
// driven by the terrain forest mask; regeneration runs incrementally over several frames.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TreeStyle } from '../biomes';
import { hash2i } from '../noise';
import type { SurfaceSample, Terrain } from '../terrain/terrain';

interface StyleDef {
  cell: number;
  /** Probability of a tree in a cell outside forest */
  scatter: number;
  /** Probability inside full forest */
  forest: number;
  scale: [number, number];
  variants: Array<() => THREE.BufferGeometry>;
  tints: number[];
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  const c = new THREE.Color().setHex(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

const TRUNK = 0x5a4632;

const STYLES: Record<TreeStyle, StyleDef> = {
  temperate: {
    cell: 30,
    scatter: 0.025,
    forest: 0.85,
    scale: [0.8, 1.35],
    variants: [
      // conifer
      () =>
        mergeGeometries([
          colored(new THREE.CylinderGeometry(0.35, 0.45, 3, 5).translate(0, 1.5, 0), TRUNK),
          colored(new THREE.ConeGeometry(3.2, 7.5, 7).translate(0, 5.6, 0), 0x2f5a2a),
          colored(new THREE.ConeGeometry(2.4, 5.5, 7).translate(0, 8.8, 0), 0x355f2e),
        ])!,
      // broadleaf
      () =>
        mergeGeometries([
          colored(new THREE.CylinderGeometry(0.35, 0.5, 4, 5).translate(0, 2, 0), TRUNK),
          colored(new THREE.IcosahedronGeometry(3.8, 0).scale(1, 0.9, 1).translate(0, 6.6, 0), 0x4a7a32),
        ])!,
    ],
    tints: [0xffffff, 0xe8f0d8, 0xd8e4c4, 0xf4f0d0],
  },
  jungle: {
    cell: 24,
    scatter: 0.06,
    forest: 0.95,
    scale: [0.85, 1.5],
    variants: [
      () =>
        mergeGeometries([
          colored(new THREE.CylinderGeometry(0.45, 0.7, 9, 5).translate(0, 4.5, 0), TRUNK),
          colored(new THREE.IcosahedronGeometry(5.5, 0).scale(1.15, 0.6, 1.15).translate(0, 10.5, 0), 0x2f6c27),
        ])!,
      // palm-like
      () =>
        mergeGeometries([
          colored(new THREE.CylinderGeometry(0.3, 0.45, 11, 5).translate(0, 5.5, 0), 0x6a563c),
          colored(new THREE.ConeGeometry(4.2, 2.4, 6).rotateX(Math.PI).translate(0, 11.5, 0), 0x3f7f2c),
        ])!,
    ],
    tints: [0xffffff, 0xdcebcc, 0xc8dcb4, 0xe8f0d0],
  },
  savanna: {
    cell: 55,
    scatter: 0.06,
    forest: 0.45,
    scale: [0.8, 1.3],
    variants: [
      // acacia: flat umbrella crown
      () =>
        mergeGeometries([
          colored(new THREE.CylinderGeometry(0.25, 0.4, 5, 5).translate(0, 2.5, 0), 0x6a5034),
          colored(new THREE.CylinderGeometry(5.2, 3.6, 1.6, 8).translate(0, 5.6, 0), 0x6f7f34),
        ])!,
      // bush
      () => colored(new THREE.IcosahedronGeometry(1.8, 0).scale(1.3, 0.8, 1.3).translate(0, 1.1, 0), 0x6a7a36),
    ],
    tints: [0xffffff, 0xf0e8c8, 0xe0dcb0, 0xd8e0b8],
  },
};

const MAX_PER_VARIANT = 7000;
const _surf: SurfaceSample = { forest: 0, fields: 0, urban: 0, scorch: 0, moisture: 0, flat: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

export class TreeField {
  readonly group = new THREE.Group();
  private readonly style: StyleDef;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  /** staging buffers filled incrementally, then copied into the meshes */
  private readonly stage: Float32Array[];
  private readonly stageCol: Float32Array[];
  private readonly stageCount: number[];
  private readonly center = new THREE.Vector2(Infinity, Infinity);
  private readonly pending = new THREE.Vector2();
  private row = -1;
  private rows = 0;
  private readonly radius: number;
  private readonly forestCache = new Map<number, number>();

  constructor(
    private readonly terrain: Terrain,
    styleId: TreeStyle,
    private readonly density: number,
    private readonly seed: number,
    radius = 2600,
  ) {
    this.style = STYLES[styleId];
    this.radius = radius;
    this.material = new THREE.MeshStandardMaterial({ name: 'tna_trees', vertexColors: true, roughness: 0.9, flatShading: true, envMapIntensity: 0.25 });
    this.stage = [];
    this.stageCol = [];
    this.stageCount = [];
    for (const make of this.style.variants) {
      const geo = make();
      const mesh = new THREE.InstancedMesh(geo, this.material, MAX_PER_VARIANT);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_VARIANT * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.group.add(mesh);
      this.stage.push(new Float32Array(MAX_PER_VARIANT * 16));
      this.stageCol.push(new Float32Array(MAX_PER_VARIANT * 3));
      this.stageCount.push(0);
    }
    this.group.name = 'tna_trees';
  }

  get instanceCount(): number {
    let n = 0;
    for (const m of this.meshes) n += m.count;
    return n;
  }

  /** Forest density sampled on 4x4-cell super cells (cached) */
  private forestAt(ci: number, cj: number): number {
    const si = Math.floor(ci / 4);
    const sj = Math.floor(cj / 4);
    const key = si * 100003 + sj;
    let f = this.forestCache.get(key);
    if (f === undefined) {
      const cell = this.style.cell * 4;
      const x = (si + 0.5) * cell;
      const z = (sj + 0.5) * cell;
      const h = this.terrain.heightAt(x, z);
      this.terrain.surfaceAt(x, z, h, this.terrain.slopeAt(x, z), _surf);
      f = _surf.forest;
      if (_surf.urban > 0.2 || _surf.flat > 0.3) f = -1;
      if (this.forestCache.size > 40000) this.forestCache.clear();
      this.forestCache.set(key, f);
    }
    return f;
  }

  private processRow(): void {
    const st = this.style;
    const cell = st.cell;
    const R = this.radius;
    const cx = this.pending.x;
    const cz = this.pending.y;
    const j0 = Math.floor((cz - R) / cell);
    const j = j0 + this.row;
    const i0 = Math.floor((cx - R) / cell);
    const i1 = Math.floor((cx + R) / cell);
    const t = this.terrain;
    const nv = this.meshes.length;
    for (let i = i0; i <= i1; i++) {
      const h0 = hash2i(i, j, this.seed);
      const forest = this.forestAt(i, j);
      if (forest < 0) continue;
      const pr = (st.scatter + (st.forest - st.scatter) * forest) * this.density;
      if (h0 >= pr) continue;
      const x = (i + 0.15 + 0.7 * hash2i(i, j, this.seed + 1)) * cell;
      const z = (j + 0.15 + 0.7 * hash2i(i, j, this.seed + 2)) * cell;
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > R) continue;
      const h = t.rawHeightAt(x, z);
      if (h < 3) continue;
      // reject steep ground cheaply
      const hx = t.rawHeightAt(x + 6, z);
      const hz = t.rawHeightAt(x, z + 6);
      if (Math.abs(hx - h) > 4.5 || Math.abs(hz - h) > 4.5) continue;
      const v = Math.floor(hash2i(i, j, this.seed + 3) * nv) % nv;
      const n = this.stageCount[v];
      if (n >= MAX_PER_VARIANT) continue;
      const fade = Math.min(1, (R - d) / (R * 0.18));
      const sc = (st.scale[0] + (st.scale[1] - st.scale[0]) * hash2i(i, j, this.seed + 4)) * (0.35 + 0.65 * fade);
      _q.setFromAxisAngle(_up, hash2i(i, j, this.seed + 5) * Math.PI * 2);
      _p.set(x, h - 0.4, z);
      _s.set(sc, sc * (0.85 + 0.35 * hash2i(i, j, this.seed + 6)), sc);
      _m.compose(_p, _q, _s);
      _m.toArray(this.stage[v], n * 16);
      _c.setHex(st.tints[Math.floor(hash2i(i, j, this.seed + 7) * st.tints.length) % st.tints.length]);
      this.stageCol[v][n * 3] = _c.r;
      this.stageCol[v][n * 3 + 1] = _c.g;
      this.stageCol[v][n * 3 + 2] = _c.b;
      this.stageCount[v] = n + 1;
    }
  }

  private commit(): void {
    for (let v = 0; v < this.meshes.length; v++) {
      const mesh = this.meshes[v];
      const n = this.stageCount[v];
      (mesh.instanceMatrix.array as Float32Array).set(this.stage[v].subarray(0, n * 16));
      (mesh.instanceColor!.array as Float32Array).set(this.stageCol[v].subarray(0, n * 3));
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, n * 3);
      mesh.instanceColor!.needsUpdate = true;
      mesh.count = n;
    }
    this.center.copy(this.pending);
  }

  /** agl = camera height above ground; budgetMs = time allowed for incremental placement this frame */
  update(cam: THREE.Vector3, agl: number, budgetMs: number): void {
    const visible = agl < 3200;
    this.group.visible = visible;
    if (!visible) return;
    if (this.row < 0) {
      const dx = cam.x - this.center.x;
      const dz = cam.z - this.center.y;
      if (dx * dx + dz * dz < 380 * 380) return;
      this.pending.set(cam.x, cam.z);
      this.row = 0;
      this.rows = Math.floor((cam.z + this.radius) / this.style.cell) - Math.floor((cam.z - this.radius) / this.style.cell) + 1;
      for (let v = 0; v < this.stageCount.length; v++) this.stageCount[v] = 0;
    }
    const t0 = performance.now();
    while (this.row < this.rows) {
      this.processRow();
      this.row++;
      if (performance.now() - t0 > budgetMs) break;
    }
    if (this.row >= this.rows) {
      this.commit();
      this.row = -1;
    }
  }

  /** Generate synchronously around a position (loading / sandbox) */
  prewarm(cam: THREE.Vector3, agl: number): void {
    this.center.set(Infinity, Infinity);
    this.row = -1;
    this.update(cam, agl, Infinity);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
  }
}
