// Chunked quadtree LOD selection (pure — no rendering). Roots tile the world on a fixed grid around the
// camera; a node splits while the camera is within size * splitFactor of its bounding box.

export interface LodParams {
  /** Edge length of a root chunk (m) */
  rootSize: number;
  /** Edge length of the finest chunk (m); rootSize / minSize must be a power of two */
  minSize: number;
  /** Split while distance < size * splitFactor */
  splitFactor: number;
  /** Roots whose square lies within this horizontal distance of the camera are drawn */
  viewRadius: number;
}

export const DEFAULT_LOD: LodParams = {
  rootSize: 65_536,
  minSize: 512,
  splitFactor: 2.0,
  viewRadius: 125_000,
};

export interface LodNode {
  readonly key: number;
  readonly level: number;
  readonly ix: number;
  readonly iz: number;
  readonly x0: number;
  readonly z0: number;
  readonly size: number;
  /** Height bounds of the terrain inside (m) */
  minH: number;
  maxH: number;
  /** Scratch: build-queue priority (renderer) */
  priority: number;
}

export type HeightRangeFn = (x0: number, z0: number, size: number, out: [number, number]) => [number, number];

const KEY_OFF = 1 << 15;
const KEY_SPAN = 1 << 16;

/** Unique numeric key for (level, ix, iz) — |ix|, |iz| < 32768 */
export function lodKey(level: number, ix: number, iz: number): number {
  return (level * KEY_SPAN + (ix + KEY_OFF)) * KEY_SPAN + (iz + KEY_OFF);
}

export function nodeSize(params: LodParams, level: number): number {
  return params.rootSize / (1 << level);
}

export function maxLevel(params: LodParams): number {
  return Math.round(Math.log2(params.rootSize / params.minSize));
}

/** 3D distance from a point to the node's bounding box */
export function nodeDistance(node: LodNode, cx: number, cy: number, cz: number): number {
  const dx = cx < node.x0 ? node.x0 - cx : cx > node.x0 + node.size ? cx - node.x0 - node.size : 0;
  const dz = cz < node.z0 ? node.z0 - cz : cz > node.z0 + node.size ? cz - node.z0 - node.size : 0;
  const dy = cy > node.maxH ? cy - node.maxH : cy < node.minH ? node.minH - cy : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function shouldSplit(node: LodNode, params: LodParams, cx: number, cy: number, cz: number): boolean {
  if (node.size <= params.minSize * 1.0001) return false;
  return nodeDistance(node, cx, cy, cz) < node.size * params.splitFactor;
}

/** Caches LodNode objects (with height bounds) so per-frame traversal allocates nothing */
export class LodNodeCache {
  private readonly map = new Map<number, LodNode>();
  private readonly range: [number, number] = [0, 0];

  constructor(
    readonly params: LodParams,
    private readonly heightRange: HeightRangeFn | null,
  ) {}

  get(level: number, ix: number, iz: number): LodNode {
    const key = lodKey(level, ix, iz);
    let n = this.map.get(key);
    if (!n) {
      const size = nodeSize(this.params, level);
      let minH = 0;
      let maxH = 0;
      if (this.heightRange) {
        this.heightRange(ix * size, iz * size, size, this.range);
        minH = this.range[0];
        maxH = this.range[1];
      }
      n = { key, level, ix, iz, x0: ix * size, z0: iz * size, size, minH, maxH, priority: 0 };
      this.map.set(key, n);
    }
    return n;
  }

  child(node: LodNode, q: 0 | 1 | 2 | 3): LodNode {
    return this.get(node.level + 1, node.ix * 2 + (q & 1), node.iz * 2 + (q >> 1));
  }

  get size(): number {
    return this.map.size;
  }

  /** Drop cached nodes far from the camera (bounded memory on long flights) */
  prune(cx: number, cz: number, radius: number): void {
    if (this.map.size < 4096) return;
    for (const [k, n] of this.map) {
      const mx = n.x0 + n.size * 0.5 - cx;
      const mz = n.z0 + n.size * 0.5 - cz;
      if (mx * mx + mz * mz > radius * radius) this.map.delete(k);
    }
  }
}

/** Root nodes whose square lies within params.viewRadius (horizontal) of the camera */
export function rootsAround(cache: LodNodeCache, cx: number, cz: number, out: LodNode[]): LodNode[] {
  const p = cache.params;
  out.length = 0;
  const s = p.rootSize;
  const r = p.viewRadius;
  const i0 = Math.floor((cx - r) / s);
  const i1 = Math.floor((cx + r) / s);
  const j0 = Math.floor((cz - r) / s);
  const j1 = Math.floor((cz + r) / s);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x0 = i * s;
      const z0 = j * s;
      const dx = cx < x0 ? x0 - cx : cx > x0 + s ? cx - x0 - s : 0;
      const dz = cz < z0 ? z0 - cz : cz > z0 + s ? cz - z0 - s : 0;
      if (dx * dx + dz * dz <= r * r) out.push(cache.get(0, i, j));
    }
  }
  return out;
}

/** Ideal leaf set for a camera position (ignores build state) */
export function selectChunks(cache: LodNodeCache, cx: number, cy: number, cz: number, out: LodNode[] = []): LodNode[] {
  out.length = 0;
  const roots: LodNode[] = [];
  rootsAround(cache, cx, cz, roots);
  const stack: LodNode[] = roots.slice();
  while (stack.length) {
    const n = stack.pop()!;
    if (shouldSplit(n, cache.params, cx, cy, cz)) {
      for (let q = 0; q < 4; q++) stack.push(cache.child(n, q as 0 | 1 | 2 | 3));
    } else {
      out.push(n);
    }
  }
  return out;
}
