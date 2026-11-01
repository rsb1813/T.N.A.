// Quadtree chunk renderer: builds terrain meshes incrementally within a per-frame time budget,
// keeps coverage hole-free (a node only splits when all children are ready), hides cracks with skirts.
import * as THREE from 'three';
import { LodNodeCache, DEFAULT_LOD, lodKey, maxLevel, nodeDistance, rootsAround, shouldSplit, type LodNode, type LodParams } from './lod';
import type { Terrain, SurfaceSample } from './terrain';

export interface TerrainRendererOptions {
  lod?: Partial<LodParams>;
  /** Quads per chunk edge (default 32) */
  resolution?: number;
  /** Max built chunks kept in memory (default 640) */
  maxCached?: number;
}

interface ChunkEntry {
  node: LodNode;
  /** null = entirely under water, nothing to draw */
  mesh: THREE.Mesh | null;
  lastShown: number;
}

export interface TerrainRenderStats {
  built: number;
  visible: number;
  queued: number;
  buildsThisFrame: number;
  buildMsThisFrame: number;
  triangles: number;
}

const _surf: SurfaceSample = { forest: 0, fields: 0, urban: 0, scorch: 0, moisture: 0, flat: 0 };
const _ground = new THREE.Color();
const _dry = new THREE.Color();

const byPriority = (a: LodNode, b: LodNode): number => a.priority - b.priority;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly params: LodParams;
  readonly stats: TerrainRenderStats = { built: 0, visible: 0, queued: 0, buildsThisFrame: 0, buildMsThisFrame: 0, triangles: 0 };

  private readonly res: number;
  private readonly vertsPerChunk: number;
  private readonly index: THREE.BufferAttribute;
  private readonly cache: LodNodeCache;
  private readonly chunks = new Map<number, ChunkEntry>();
  private readonly freeGeoms: THREE.BufferGeometry[] = [];
  private readonly freeMeshes: THREE.Mesh[] = [];
  private readonly allGeoms: THREE.BufferGeometry[] = [];
  private readonly requested = new Map<number, number>();
  private readonly requests: LodNode[] = [];
  private readonly roots: LodNode[] = [];
  private shown: ChunkEntry[] = [];
  private prevShown: ChunkEntry[] = [];
  private frame = 0;
  private readonly maxCached: number;
  private readonly heightScratch: Float32Array;
  private readonly maxLvl: number;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private readonly groundLin: THREE.Color;
  private readonly dryLin: THREE.Color;

  constructor(
    private readonly terrain: Terrain,
    private readonly material: THREE.Material,
    opts: TerrainRendererOptions = {},
  ) {
    this.params = { ...DEFAULT_LOD, ...opts.lod };
    this.res = opts.resolution ?? 32;
    this.maxCached = opts.maxCached ?? 640;
    this.maxLvl = maxLevel(this.params);
    const n1 = this.res + 1;
    this.vertsPerChunk = n1 * n1 + 4 * n1;
    this.heightScratch = new Float32Array((this.res + 3) * (this.res + 3));
    this.index = this.buildIndex();
    this.cache = new LodNodeCache(this.params, (x0, z0, size, out) => terrain.heightRange(x0, z0, size, out));
    this.group.name = 'tna_terrain';
    this.groundLin = new THREE.Color().setHex(terrain.biome.palette.ground);
    this.dryLin = new THREE.Color().setHex(terrain.biome.palette.groundDry);
  }

  /** Per-frame: choose LOD, show/hide chunks, build queued chunks within budgetMs */
  update(camera: THREE.Vector3, budgetMs: number): void {
    this.frame++;
    this.cx = camera.x;
    this.cy = camera.y;
    this.cz = camera.z;
    this.requests.length = 0;
    this.shown.length = 0;
    rootsAround(this.cache, this.cx, this.cz, this.roots);
    for (const r of this.roots) if (!this.chunks.has(r.key)) this.build(r);
    for (const r of this.roots) this.display(r);
    // hide what was visible last frame but not now
    for (const e of this.prevShown) if (e.lastShown !== this.frame && e.mesh) e.mesh.visible = false;
    const tmp = this.prevShown;
    this.prevShown = this.shown;
    this.shown = tmp;

    // build closest requests first
    const reqs = this.requests;
    for (const n of reqs) n.priority = nodeDistance(n, this.cx, this.cy, this.cz) / n.size;
    reqs.sort(byPriority);
    const t0 = now();
    let built = 0;
    for (const n of reqs) {
      if (this.chunks.has(n.key)) continue;
      if (built > 0 && now() - t0 > budgetMs) break;
      this.build(n);
      built++;
    }
    this.stats.buildsThisFrame = built;
    this.stats.buildMsThisFrame = now() - t0;
    this.stats.queued = Math.max(0, reqs.length - built);
    this.stats.built = this.chunks.size;
    let tris = 0;
    let vis = 0;
    for (const e of this.prevShown) {
      if (e.mesh) {
        vis++;
        tris += this.index.count / 3;
      }
    }
    this.stats.visible = vis;
    this.stats.triangles = tris;
    if (this.chunks.size > this.maxCached) this.evict();
    if ((this.frame & 255) === 0) this.cache.prune(this.cx, this.cz, this.params.viewRadius * 2.5);
  }

  /** Build everything the current view wants (loading screens, sandbox captures) */
  prewarm(camera: THREE.Vector3, maxIterations = 64): void {
    for (let i = 0; i < maxIterations; i++) {
      this.update(camera, Infinity);
      if (this.stats.queued === 0 && this.stats.buildsThisFrame === 0) break;
    }
  }

  // ---------------------------------------------------------------- traversal

  private display(node: LodNode): void {
    if (shouldSplit(node, this.params, this.cx, this.cy, this.cz)) {
      let all = true;
      for (let q = 0; q < 4; q++) {
        const cix = node.ix * 2 + (q & 1);
        const ciz = node.iz * 2 + (q >> 1);
        if (!this.canCover(node.level + 1, cix, ciz, 0)) {
          all = false;
          this.request(this.cache.get(node.level + 1, cix, ciz));
        }
      }
      if (all) {
        for (let q = 0; q < 4; q++) this.display(this.cache.child(node, q as 0 | 1 | 2 | 3));
        return;
      }
    }
    const e = this.chunks.get(node.key);
    if (e) {
      this.show(e);
      return;
    }
    // not built: the parent guaranteed finer built chunks cover it
    this.request(node);
    for (let q = 0; q < 4; q++) this.displayFallback(node.level + 1, node.ix * 2 + (q & 1), node.iz * 2 + (q >> 1));
  }

  private displayFallback(level: number, ix: number, iz: number): void {
    const e = this.chunks.get(lodKey(level, ix, iz));
    if (e) {
      this.show(e);
      return;
    }
    for (let q = 0; q < 4; q++) this.displayFallback(level + 1, ix * 2 + (q & 1), iz * 2 + (q >> 1));
  }

  private canCover(level: number, ix: number, iz: number, depth: number): boolean {
    if (this.chunks.has(lodKey(level, ix, iz))) return true;
    if (depth >= 2 || level >= this.maxLvl) return false;
    for (let q = 0; q < 4; q++) {
      if (!this.canCover(level + 1, ix * 2 + (q & 1), iz * 2 + (q >> 1), depth + 1)) return false;
    }
    return true;
  }

  private show(e: ChunkEntry): void {
    if (e.lastShown === this.frame) return;
    e.lastShown = this.frame;
    if (e.mesh) e.mesh.visible = true;
    this.shown.push(e);
  }

  private request(n: LodNode): void {
    if (this.requested.get(n.key) === this.frame) return;
    this.requested.set(n.key, this.frame);
    this.requests.push(n);
  }

  private evict(): void {
    const old: ChunkEntry[] = [];
    for (const e of this.chunks.values()) if (e.lastShown < this.frame - 90 && e.node.level > 0) old.push(e);
    old.sort((a, b) => a.lastShown - b.lastShown);
    const excess = this.chunks.size - Math.floor(this.maxCached * 0.85);
    for (let i = 0; i < old.length && i < excess; i++) this.release(old[i]);
    if (this.requested.size > 8192) this.requested.clear();
  }

  private release(e: ChunkEntry): void {
    this.chunks.delete(e.node.key);
    if (e.mesh) {
      e.mesh.visible = false;
      this.freeGeoms.push(e.mesh.geometry);
      this.freeMeshes.push(e.mesh);
      e.mesh = null;
    }
  }

  // ---------------------------------------------------------------- geometry

  private buildIndex(): THREE.BufferAttribute {
    const n = this.res;
    const n1 = n + 1;
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * n1 + i;
        const b = a + 1;
        const c = a + n1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // skirts: edge vertex order chosen so the strip faces outward
    const base = n1 * n1;
    const edges: number[][] = [[], [], [], []];
    for (let i = 0; i <= n; i++) {
      edges[0].push(i); // north (z min), traverse +x
      edges[1].push(n * n1 + (n - i)); // south (z max), traverse -x
      edges[2].push(i * n1 + n); // east (x max), traverse +z
      edges[3].push((n - i) * n1); // west (x min), traverse -z
    }
    for (let e = 0; e < 4; e++) {
      const top = edges[e];
      const so = base + e * n1;
      for (let i = 0; i < n; i++) {
        const t0 = top[i];
        const t1 = top[i + 1];
        const s0 = so + i;
        const s1 = so + i + 1;
        idx.push(t0, t1, s0, t1, s1, s0);
      }
    }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  }

  /** Skirt vertices duplicate edge vertices in the same order as buildIndex() */
  private skirtSource(e: number, i: number): number {
    const n = this.res;
    const n1 = n + 1;
    switch (e) {
      case 0:
        return i;
      case 1:
        return n * n1 + (n - i);
      case 2:
        return i * n1 + n;
      default:
        return (n - i) * n1;
    }
  }

  private allocGeometry(): THREE.BufferGeometry {
    const g = this.freeGeoms.pop();
    if (g) return g;
    const v = this.vertsPerChunk;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(v * 3), 3));
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(v * 3), 3));
    geom.setAttribute('aSurf', new THREE.BufferAttribute(new Uint8Array(v * 4), 4, true));
    geom.setIndex(this.index);
    geom.boundingSphere = new THREE.Sphere();
    this.allGeoms.push(geom);
    return geom;
  }

  private build(node: LodNode): void {
    const t = this.terrain;
    const n = this.res;
    const n1 = n + 1;
    const W = n + 3;
    const step = node.size / n;
    const H = this.heightScratch;
    let mn = Infinity;
    let mx = -Infinity;
    for (let j = 0; j < W; j++) {
      const z = node.z0 + (j - 1) * step;
      for (let i = 0; i < W; i++) {
        const h = t.rawHeightAt(node.x0 + (i - 1) * step, z);
        H[j * W + i] = h;
        if (i > 0 && j > 0 && i < W - 1 && j < W - 1) {
          if (h < mn) mn = h;
          if (h > mx) mx = h;
        }
      }
    }
    node.minH = mn;
    node.maxH = mx;
    const entry: ChunkEntry = { node, mesh: null, lastShown: -1 };
    this.chunks.set(node.key, entry);
    if (mx < -2.5) return; // fully submerged: the ocean covers it

    const geom = this.allocGeometry();
    const pos = geom.attributes.position.array as Float32Array;
    const nor = geom.attributes.normal.array as Float32Array;
    const col = geom.attributes.color.array as Float32Array;
    const surf = geom.attributes.aSurf.array as Uint8Array;
    const half = node.size * 0.5;
    const cx = node.x0 + half;
    const cz = node.z0 + half;
    const ground = this.groundLin;
    const dry = this.dryLin;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const v = j * n1 + i;
        const hi = (j + 1) * W + (i + 1);
        const h = H[hi];
        const x = node.x0 + i * step;
        const z = node.z0 + j * step;
        pos[v * 3] = x - cx;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = z - cz;
        let nx = Math.max(0, H[hi - 1]) - Math.max(0, H[hi + 1]);
        let ny = 2 * step;
        let nz = Math.max(0, H[hi - W]) - Math.max(0, H[hi + W]);
        const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= il;
        ny *= il;
        nz *= il;
        nor[v * 3] = nx;
        nor[v * 3 + 1] = ny;
        nor[v * 3 + 2] = nz;
        t.surfaceAt(x, z, h, 1 - ny, _surf);
        _ground.copy(dry).lerp(ground, _surf.moisture);
        col[v * 3] = _ground.r;
        col[v * 3 + 1] = _ground.g;
        col[v * 3 + 2] = _ground.b;
        surf[v * 4] = (_surf.forest * 255) | 0;
        surf[v * 4 + 1] = (_surf.fields * 255) | 0;
        surf[v * 4 + 2] = (_surf.urban * 255) | 0;
        surf[v * 4 + 3] = (_surf.scorch * 255) | 0;
      }
    }
    const skirt = Math.max(12, node.size * 0.012);
    const base = n1 * n1;
    for (let e = 0; e < 4; e++) {
      for (let i = 0; i <= n; i++) {
        const src = this.skirtSource(e, i);
        const dst = base + e * n1 + i;
        pos[dst * 3] = pos[src * 3];
        pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt;
        pos[dst * 3 + 2] = pos[src * 3 + 2];
        nor[dst * 3] = nor[src * 3];
        nor[dst * 3 + 1] = nor[src * 3 + 1];
        nor[dst * 3 + 2] = nor[src * 3 + 2];
        col[dst * 3] = col[src * 3];
        col[dst * 3 + 1] = col[src * 3 + 1];
        col[dst * 3 + 2] = col[src * 3 + 2];
        for (let k = 0; k < 4; k++) surf[dst * 4 + k] = surf[src * 4 + k];
      }
    }
    for (const name of ['position', 'normal', 'color', 'aSurf']) geom.attributes[name].needsUpdate = true;
    const hr = (mx - mn) * 0.5 + skirt;
    geom.boundingSphere!.center.set(0, (mx + mn) * 0.5, 0);
    geom.boundingSphere!.radius = Math.sqrt(2 * half * half + hr * hr);

    let mesh = this.freeMeshes.pop();
    if (mesh) {
      mesh.geometry = geom;
    } else {
      mesh = new THREE.Mesh(geom, this.material);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    mesh.position.set(cx, 0, cz);
    mesh.updateMatrix();
    mesh.visible = false;
    entry.mesh = mesh;
  }

  dispose(): void {
    for (const g of this.allGeoms) g.dispose();
    this.allGeoms.length = 0;
    this.freeGeoms.length = 0;
    this.freeMeshes.length = 0;
    this.chunks.clear();
    this.group.clear();
    this.group.removeFromParent();
  }
}
