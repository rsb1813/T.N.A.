// Deterministic terrain: biome height functions baked into a bicubic heightfield + analytic fine detail.
// Implements TerrainService. Pure CPU code (no WebGL), usable in tests and headless simulation.
import * as THREE from 'three';
import type { EnvironmentOptions } from '../../core/environment';
import type { TerrainService } from '../../core/services';
import { BIOMES, type BiomeDef } from '../biomes';
import { Noise2, hash2i, sstep } from '../noise';

export interface TerrainBuildOptions {
  /** Heightfield resolution (points per side). Default 1536 (~170 m cells for a 100 km map) */
  gridSize?: number;
  /** Extra terrain beyond mapRadius covered by the heightfield (m). Default 30 km */
  margin?: number;
}

export interface FlattenZone {
  x: number;
  z: number;
  radius: number;
  /** Resolved target height (m) */
  height: number;
  /** Width of the smooth blend ring outside radius (m) */
  blend: number;
}

export interface SurfaceSample {
  /** Forest canopy cover 0..1 */
  forest: number;
  /** Farmland patch mask 0..1 */
  fields: number;
  /** Urban ground 0..1 */
  urban: number;
  /** Burnt / cratered ground 0..1 */
  scorch: number;
  /** Ground moisture 0..1 (lush vs dry palette) */
  moisture: number;
  /** Airbase / flatten zone weight 0..1 */
  flat: number;
}

interface Crater {
  x: number;
  z: number;
  r: number;
}

interface CityZone {
  x: number;
  z: number;
  radius: number;
}

/** Catmull-Rom interpolation */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

const CRATER_CELL = 6000;
const BLOCK = 32;
const LOW_STEP = 4;
const LOW_FIELDS = 5;
const _n = new THREE.Vector3();

export class Terrain implements TerrainService {
  readonly mapRadius: number;
  readonly biome: BiomeDef;
  readonly seed: number;
  readonly relief: number;
  /** Half size of the heightfield square (m), centred on the origin */
  readonly extent: number;
  readonly gridSize: number;
  /** Heightfield spacing (m) */
  readonly cell: number;
  /** Raw heights (sea floor negative) */
  readonly heights: Float32Array;
  /** Fine-detail amplitude 0..255 (scaled by biome.detailMeters) */
  readonly detail: Uint8Array;
  readonly flattenZones: readonly FlattenZone[];
  readonly cities: readonly CityZone[];
  /** Highest terrain point incl. detail (m) */
  readonly maxHeight: number;
  readonly minHeight: number;
  /** Conservative max |slope| (rise/run) — used by lineOfSight step sizing */
  readonly maxSlope: number;
  /** Millis spent building the heightfield */
  readonly buildMs: number;

  private readonly invCell: number;
  private readonly lowScratch = new Float64Array(LOW_FIELDS);
  private readonly n1: Noise2;
  private readonly n2: Noise2;
  private readonly n3: Noise2;
  private readonly n4: Noise2;
  private readonly n5: Noise2;
  private readonly nDetail: Noise2;
  private readonly nSurf: Noise2;
  private readonly nCoast: Noise2;
  private readonly coast: EnvironmentOptions['coast'] | null;
  /** Crater table over the heightfield: [x, z, r] per cell, r = 0 means none */
  private readonly craterTable: Float64Array;
  private readonly craterC0: number;
  private readonly craterCells: number;
  private readonly blocksPerSide: number;
  private readonly blockMin: Float32Array;
  private readonly blockMax: Float32Array;
  private readonly lowRange: [number, number];
  private readonly forestT: number;
  private readonly fieldT: number;

  constructor(opts: EnvironmentOptions, build: TerrainBuildOptions = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.biome = BIOMES[opts.biome] ?? BIOMES.temperate;
    this.seed = opts.seed | 0;
    this.relief = opts.relief ?? 1;
    this.mapRadius = opts.mapRadius ?? 100_000;
    this.coast = opts.coast ?? null;
    const margin = build.margin ?? 30_000;
    this.extent = this.mapRadius + margin;
    this.gridSize = Math.max(64, build.gridSize ?? 1536);
    this.cell = (2 * this.extent) / (this.gridSize - 1);
    this.invCell = 1 / this.cell;

    const s = this.seed * 7919;
    this.n1 = new Noise2(s + 1);
    this.n2 = new Noise2(s + 2);
    this.n3 = new Noise2(s + 3);
    this.n4 = new Noise2(s + 4);
    this.n5 = new Noise2(s + 5);
    this.nDetail = new Noise2(s + 6);
    this.nSurf = new Noise2(s + 7);
    this.nCoast = new Noise2(s + 8);
    this.forestT = 0.5 - this.biome.forestCover * 1.05;
    this.fieldT = 0.45 - this.biome.fieldCover * 0.9;

    this.craterC0 = Math.floor(-this.extent / CRATER_CELL) - 2;
    this.craterCells = Math.ceil((2 * this.extent) / CRATER_CELL) + 5;
    this.craterTable = new Float64Array(this.craterCells * this.craterCells * 3);
    if (this.biome.id === 'wasteland') {
      const tmp: Crater = { x: 0, z: 0, r: 0 };
      for (let j = 0; j < this.craterCells; j++) {
        for (let i = 0; i < this.craterCells; i++) {
          const k = (j * this.craterCells + i) * 3;
          if (!this.makeCrater(i + this.craterC0, j + this.craterC0, tmp)) continue;
          this.craterTable[k] = tmp.x;
          this.craterTable[k + 1] = tmp.z;
          this.craterTable[k + 2] = tmp.r;
        }
      }
    }
    this.cities = (opts.cities ?? []).map((c) => ({ x: c.x, z: c.z, radius: c.radius }));
    this.flattenZones = this.resolveFlatten(opts);

    const N = this.gridSize;
    this.heights = new Float32Array(N * N);
    this.detail = new Uint8Array(N * N);
    const detailMeters = this.biome.detailMeters;
    let hMax = -Infinity;
    let hMin = Infinity;
    // Smooth low-frequency fields on a coarse lattice (every LOW_STEP cells), upsampled bilinearly
    const LN = Math.ceil((N - 1) / LOW_STEP) + 1;
    const low = new Float64Array(LN * LN * LOW_FIELDS);
    const L = this.lowScratch;
    for (let j = 0; j < LN; j++) {
      for (let i = 0; i < LN; i++) {
        this.lowFields(-this.extent + i * LOW_STEP * this.cell, -this.extent + j * LOW_STEP * this.cell, L);
        low.set(L, (j * LN + i) * LOW_FIELDS);
      }
    }
    for (let j = 0; j < N; j++) {
      const z = -this.extent + j * this.cell;
      const lj = Math.min(LN - 2, Math.floor(j / LOW_STEP));
      const fz = j / LOW_STEP - lj;
      for (let i = 0; i < N; i++) {
        const x = -this.extent + i * this.cell;
        const li = Math.min(LN - 2, Math.floor(i / LOW_STEP));
        const fx = i / LOW_STEP - li;
        const o00 = (lj * LN + li) * LOW_FIELDS;
        const o10 = o00 + LOW_FIELDS;
        const o01 = o00 + LN * LOW_FIELDS;
        const o11 = o01 + LOW_FIELDS;
        for (let k = 0; k < LOW_FIELDS; k++) {
          const a = low[o00 + k] + (low[o10 + k] - low[o00 + k]) * fx;
          const b = low[o01 + k] + (low[o11 + k] - low[o01 + k]) * fx;
          L[k] = a + (b - a) * fz;
        }
        const raw = this.composeHeight(x, z, this.flattenZones, L);
        const idx = j * N + i;
        this.heights[idx] = raw;
        let amp = this.detailMask(L) * sstep(2, 30, raw);
        if (amp > 0 && this.flattenZones.length) amp *= 1 - this.flattenWeight(x, z);
        this.detail[idx] = Math.round(amp * 255);
        if (raw > hMax) hMax = raw;
        if (raw < hMin) hMin = raw;
      }
    }

    // Coarse min/max blocks (LOD bounds, quick rejects)
    const bps = Math.ceil((N - 1) / BLOCK);
    this.blocksPerSide = bps;
    this.blockMin = new Float32Array(bps * bps);
    this.blockMax = new Float32Array(bps * bps);
    let slopeMax = 0;
    for (let bj = 0; bj < bps; bj++) {
      for (let bi = 0; bi < bps; bi++) {
        let mn = Infinity;
        let mx = -Infinity;
        let amp = 0;
        const j1 = Math.min(N - 1, (bj + 1) * BLOCK);
        const i1 = Math.min(N - 1, (bi + 1) * BLOCK);
        for (let j = bj * BLOCK; j <= j1; j++) {
          const row = j * N;
          for (let i = bi * BLOCK; i <= i1; i++) {
            const h = this.heights[row + i];
            if (h < mn) mn = h;
            if (h > mx) mx = h;
            const a = this.detail[row + i];
            if (a > amp) amp = a;
            if (i < N - 1) {
              const d = Math.abs(this.heights[row + i + 1] - h);
              if (d > slopeMax) slopeMax = d;
            }
            if (j < N - 1) {
              const d = Math.abs(this.heights[row + N + i] - h);
              if (d > slopeMax) slopeMax = d;
            }
          }
        }
        const da = (amp / 255) * detailMeters;
        const pad = 0.08 * (mx - mn) + 2;
        this.blockMin[bj * bps + bi] = mn - da - pad;
        this.blockMax[bj * bps + bi] = mx + da + pad;
      }
    }
    this.maxHeight = Math.max(0, hMax + detailMeters);
    this.minHeight = hMin - detailMeters;
    // grid slope + detail slope (amplitude over ~quarter wavelength)
    this.maxSlope = Math.min(3, (slopeMax / this.cell) * 1.25 + (detailMeters / 60) + 0.05);
    this.lowRange = this.computeLowRange();
    this.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  // ------------------------------------------------------------------ TerrainService

  heightAt(x: number, z: number): number {
    const h = this.rawHeightAt(x, z);
    return h > 0 ? h : 0;
  }

  isWater(x: number, z: number): boolean {
    return this.rawHeightAt(x, z) < 0;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 6;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const top = this.maxHeight + 1;
    if (a.y > top && b.y > top) return true;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1) return true;
    const inv = 1 / len;
    const horizPerM = Math.sqrt(dx * dx + dz * dz) * inv;
    const dyPerM = dy * inv;
    // max clearance loss per metre of ray: terrain rise + ray descent
    const k = this.maxSlope * horizPerM + Math.max(0, -dyPerM) + 1e-3;
    const tol = 1.5;
    const skip = Math.min(25, len * 0.1);
    let t = skip;
    const end = len - skip;
    while (t < end) {
      const y = a.y + dyPerM * t;
      if (y > top) {
        // above every peak: jump to where the ray (if descending) comes back below the top
        if (dyPerM >= 0) return true;
        t += Math.max(1, (y - top) / -dyPerM);
        continue;
      }
      const x = a.x + dx * inv * t;
      const z = a.z + dz * inv * t;
      const clearance = y - this.heightAt(x, z);
      if (clearance < -tol) return false;
      let step = clearance / k;
      if (step < 12) step = 12;
      else if (step > 3000) step = 3000;
      t += step;
    }
    return true;
  }

  // ------------------------------------------------------------------ sampling

  /** Height including sea floor (negative under water) */
  rawHeightAt(x: number, z: number): number {
    const gx = (x + this.extent) * this.invCell;
    const gz = (z + this.extent) * this.invCell;
    const N = this.gridSize;
    if (gx < 1 || gz < 1 || gx >= N - 2 || gz >= N - 2) return this.sampleEdge(x, z, gx, gz);
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const H = this.heights;
    let o = (iz - 1) * N + ix - 1;
    const r0 = cr(H[o], H[o + 1], H[o + 2], H[o + 3], fx);
    o += N;
    const r1 = cr(H[o], H[o + 1], H[o + 2], H[o + 3], fx);
    o += N;
    const r2 = cr(H[o], H[o + 1], H[o + 2], H[o + 3], fx);
    o += N;
    const r3 = cr(H[o], H[o + 1], H[o + 2], H[o + 3], fx);
    let h = cr(r0, r1, r2, r3, fz);
    // detail amplitude: bilinear on the byte grid
    const D = this.detail;
    const d0 = iz * N + ix;
    const a00 = D[d0];
    const a10 = D[d0 + 1];
    const a01 = D[d0 + N];
    const a11 = D[d0 + N + 1];
    if ((a00 | a10 | a01 | a11) !== 0) {
      const ax = a00 + (a10 - a00) * fx;
      const bx = a01 + (a11 - a01) * fx;
      const amp = (ax + (bx - ax) * fz) * (1 / 255);
      h += amp * this.biome.detailMeters * this.detailValue(x, z);
    }
    return h;
  }

  private sampleEdge(x: number, z: number, gx: number, gz: number): number {
    const N = this.gridSize;
    if (gx < 0 || gz < 0 || gx > N - 1 || gz > N - 1) return this.composeHeight(x, z, this.flattenZones, null);
    // one-cell band at the grid edge: bilinear with clamped indices
    const ix = Math.min(N - 2, Math.floor(gx));
    const iz = Math.min(N - 2, Math.floor(gz));
    const fx = gx - ix;
    const fz = gz - iz;
    const H = this.heights;
    const o = iz * N + ix;
    const a = H[o] + (H[o + 1] - H[o]) * fx;
    const b = H[o + N] + (H[o + N + 1] - H[o + N]) * fx;
    return a + (b - a) * fz;
  }

  /** Conservative [min, max] terrain height inside an axis-aligned square */
  heightRange(x0: number, z0: number, size: number, out: [number, number]): [number, number] {
    const e = this.extent;
    let mn = Infinity;
    let mx = -Infinity;
    const bs = BLOCK * this.cell;
    const bps = this.blocksPerSide;
    const bi0 = Math.floor((x0 + e) / bs);
    const bi1 = Math.floor((x0 + size + e) / bs);
    const bj0 = Math.floor((z0 + e) / bs);
    const bj1 = Math.floor((z0 + size + e) / bs);
    let outside = false;
    for (let bj = bj0; bj <= bj1; bj++) {
      if (bj < 0 || bj >= bps) {
        outside = true;
        continue;
      }
      for (let bi = bi0; bi <= bi1; bi++) {
        if (bi < 0 || bi >= bps) {
          outside = true;
          continue;
        }
        const k = bj * bps + bi;
        if (this.blockMin[k] < mn) mn = this.blockMin[k];
        if (this.blockMax[k] > mx) mx = this.blockMax[k];
      }
    }
    if (outside) {
      if (this.lowRange[0] < mn) mn = this.lowRange[0];
      if (this.lowRange[1] > mx) mx = this.lowRange[1];
    }
    out[0] = mn;
    out[1] = mx;
    return out;
  }

  /** Weight of one flatten zone: 1 inside radius, irregular smooth blend ring outside */
  private zoneWeight(f: FlattenZone, x: number, z: number): number {
    const dx = x - f.x;
    const dz = z - f.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= f.radius) return 1;
    if (d >= f.radius + f.blend) return 0;
    const wobble = 0.55 + 0.45 * (0.5 + 0.5 * this.nSurf.noise(x / 1300 + 3.3, z / 1300 - 8.1));
    return 1 - sstep(f.radius, f.radius + f.blend * wobble, d);
  }

  /** Smooth union weight of all flatten zones at (x, z) */
  flattenWeight(x: number, z: number): number {
    let w = 0;
    for (const f of this.flattenZones) {
      const wi = this.zoneWeight(f, x, z);
      if (wi > w) w = wi;
    }
    return w;
  }

  /** Urban ground mask from decorative cities */
  urbanAt(x: number, z: number): number {
    let u = 0;
    for (const c of this.cities) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const lim = c.radius * 1.15;
      if (d2 > lim * lim) continue;
      const d = Math.sqrt(d2) / c.radius;
      const edge = 0.08 * this.nSurf.noise(x / 700, z / 700);
      const ui = 1 - sstep(0.82, 1.02, d + edge);
      if (ui > u) u = ui;
    }
    return u;
  }

  /** Land cover masks at a point (h = terrain height, slope = 1 - normal.y) */
  surfaceAt(x: number, z: number, h: number, slope: number, out: SurfaceSample): SurfaceSample {
    const b = this.biome;
    const ns = this.nSurf;
    const flat = this.flattenZones.length ? this.flattenWeight(x, z) : 0;
    const urban = this.cities.length ? this.urbanAt(x, z) : 0;
    const moisture = ns.fbm(x / 11000 + 40, z / 11000 - 13, 3) * 0.6 + 0.5;
    let forest = 0;
    if (b.forestCover > 0) {
      const n = ns.fbm(x / 6500 - 71, z / 6500 + 5, 3) * 0.75 + ns.noise(x / 1400 + 9, z / 1400 - 3) * 0.25;
      forest = sstep(this.forestT, this.forestT + 0.16, n + (moisture - 0.5) * 0.25);
      forest *= sstep(2, 9, h) * (1 - sstep(b.treeLine - 150, b.treeLine + 120, h)) * (1 - sstep(0.36, 0.55, slope));
      forest *= (1 - urban) * (1 - sstep(0.55, 0.95, flat));
    }
    let fields = 0;
    if (b.fieldCover > 0) {
      const n = ns.fbm(x / 9000 + 113, z / 9000 + 57, 2);
      fields = sstep(this.fieldT, this.fieldT + 0.14, n) * (1 - forest) * (1 - sstep(0.1, 0.2, slope));
      fields *= sstep(2, 10, h) * (1 - sstep(1100, 1400, h)) * (1 - urban) * (1 - flat * 0.8);
    }
    let scorch = 0;
    if (b.id === 'wasteland') {
      const q = this.craterProximity(x, z);
      const streak = 0.5 + 0.5 * ns.noise(x / 260 + 4.1, z / 260 - 2.2);
      // dark glassed bowl, pale rim, burnt radial ejecta fading out to ~2.4 radii
      const bowl = 1 - sstep(0.55, 0.95, q);
      const ejecta = (1 - sstep(1.15, 2.4, q)) * sstep(0.95, 1.2, q) * (0.35 + 0.65 * streak);
      const blot = sstep(0.3, 0.65, ns.fbm(x / 4200 - 7, z / 4200 + 31, 3)) * (0.4 + 0.4 * streak);
      scorch = Math.max(bowl * 0.95, ejecta * 0.7, blot * 0.55);
    }
    out.forest = forest;
    out.fields = fields;
    out.urban = urban;
    out.scorch = scorch;
    out.moisture = moisture < 0 ? 0 : moisture > 1 ? 1 : moisture;
    out.flat = flat;
    return out;
  }

  // ------------------------------------------------------------------ generation

  private resolveFlatten(opts: EnvironmentOptions): FlattenZone[] {
    const zones: FlattenZone[] = [];
    for (const f of opts.flatten ?? []) {
      const r = Math.max(50, f.radius);
      // earlier zones shape the ground a later zone flattens to
      const target = f.height ?? Math.max(10, this.composeHeight(f.x, f.z, zones, null));
      zones.push({ x: f.x, z: f.z, radius: r, height: target, blend: Math.max(900, r * 0.9) });
    }
    return zones;
  }

  /**
   * Full analytic height: biome → edge fade → coast → flatten zones.
   * low = pre-interpolated low-frequency fields (grid build) or null to evaluate them here.
   */
  private composeHeight(x: number, z: number, zones: readonly FlattenZone[], low: Float64Array | null): number {
    const r = Math.sqrt(x * x + z * z);
    const R = this.mapRadius;
    let h: number;
    if (r < R + 20_000) {
      let L = low;
      if (!L) {
        L = this.lowScratch;
        this.lowFields(x, z, L);
      }
      h = this.biomeHeight(x, z, L);
      if (r > R) {
        const w = sstep(R, R + 20_000, r);
        h = h * (1 - w) + this.lowland(x, z) * w;
      }
    } else {
      h = this.lowland(x, z);
    }
    if (this.coast) h = this.applyCoast(x, z, h);
    for (const f of zones) {
      const w = this.zoneWeight(f, x, z);
      if (w > 0) h += (f.height - h) * w;
    }
    return h;
  }

  private lowland(x: number, z: number): number {
    switch (this.biome.id) {
      case 'ocean':
        return -520 + 60 * this.n2.noise(x / 30000, z / 30000);
      case 'arctic':
        return -90 + 25 * this.n2.noise(x / 20000, z / 20000);
      default:
        return 60 + 35 * this.n2.noise(x / 14000 + 3.7, z / 14000 - 1.3);
    }
  }

  private applyCoast(x: number, z: number, h: number): number {
    const c = this.coast!;
    let across: number;
    let along: number;
    switch (c.side) {
      case 'north':
        across = -z;
        along = x;
        break;
      case 'south':
        across = z;
        along = -x;
        break;
      case 'east':
        across = x;
        along = z;
        break;
      default:
        across = -x;
        along = -z;
    }
    const nc = this.nCoast;
    const s =
      across -
      c.distanceM +
      7000 * nc.fbm(along / 32000, across / 32000, 2) +
      2200 * nc.noise(along / 7000 + 3.1, across / 7000 - 7.7) +
      450 * nc.noise(along / 1700 - 5.3, across / 1700 + 2.9);
    const land = sstep(0, 9000, -s);
    let shore = -s * 0.0045;
    if (shore < -170) shore = -170;
    else if (shore > 40) shore = 40;
    return h * land + shore;
  }

  /**
   * Smooth (>= ~20 km wavelength) inputs of the biome height function:
   * L[0], L[1] = domain-warp offsets (m), L[2..4] = biome specific broad fields.
   */
  private lowFields(x: number, z: number, L: Float64Array): void {
    const n1 = this.n1;
    const n2 = this.n2;
    const n4 = this.n4;
    L[2] = L[3] = L[4] = 0;
    switch (this.biome.id) {
      case 'mountains':
        L[0] = 4500 * n4.fbm(x / 26000, z / 26000, 2);
        L[1] = 4500 * n4.fbm(x / 26000 + 19.1, z / 26000 - 7.3, 2);
        L[2] = n4.fbm(x / 52000 - 3, z / 52000 + 8, 3);
        L[3] = n2.fbm((x + L[0]) / 60000, (z + L[1]) / 60000, 3);
        break;
      case 'desert':
        L[0] = 2500 * n4.fbm(x / 20000, z / 20000, 2);
        L[1] = 2500 * n4.fbm(x / 20000 - 4.4, z / 20000 + 2.2, 2);
        L[2] = n4.fbm(x / 42000 + 11, z / 42000 - 6, 3);
        L[3] = n1.fbm((x + L[0]) / 32000, (z + L[1]) / 32000, 3);
        break;
      case 'savanna':
        L[0] = 3000 * n4.fbm(x / 24000, z / 24000, 2);
        L[1] = 3000 * n4.fbm(x / 24000 + 5.5, z / 24000 + 1.9, 2);
        L[2] = n4.noise(x / 70000 + 2, z / 70000) + x / 300000;
        L[3] = n1.fbm((x + L[0]) / 34000, (z + L[1]) / 34000, 4);
        break;
      case 'jungle':
        L[0] = 3500 * n4.fbm(x / 22000, z / 22000, 2);
        L[1] = 3500 * n4.fbm(x / 22000 - 8.1, z / 22000 + 3.3, 2);
        L[2] = n1.fbm((x + L[0]) / 22000, (z + L[1]) / 22000, 4);
        L[3] = n4.fbm(x / 50000, z / 50000, 2);
        break;
      case 'arctic':
        L[0] = 4000 * n4.fbm(x / 25000, z / 25000, 2);
        L[1] = 4000 * n4.fbm(x / 25000 + 2.7, z / 25000 - 9.4, 2);
        L[2] = n2.fbm((x + L[0]) / 42000, (z + L[1]) / 42000, 3);
        break;
      case 'ocean':
        L[0] = 3000 * n4.fbm(x / 18000, z / 18000, 2);
        L[1] = 3000 * n4.fbm(x / 18000 - 1.1, z / 18000 + 6.6, 2);
        L[2] = n4.fbm(x / 60000, z / 60000, 2);
        L[3] = n2.fbm(x / 55000, z / 55000, 3);
        break;
      case 'wasteland':
        L[0] = 2500 * n4.fbm(x / 21000, z / 21000, 2);
        L[1] = 2500 * n4.fbm(x / 21000 + 4.2, z / 21000 + 8.8, 2);
        L[2] = n1.fbm((x + L[0]) / 26000, (z + L[1]) / 26000, 4);
        break;
      default:
        L[0] = 3000 * n4.fbm(x / 23000, z / 23000, 2);
        L[1] = 3000 * n4.fbm(x / 23000 - 6.2, z / 23000 + 4.1, 2);
        L[2] = n1.fbm((x + L[0]) / 27000, (z + L[1]) / 27000, 4);
        L[3] = n4.fbm(x / 45000 + 1.5, z / 45000 - 2.5, 2);
    }
  }

  private biomeHeight(x: number, z: number, L: Float64Array): number {
    const relief = this.relief;
    const n2 = this.n2;
    const n3 = this.n3;
    const n5 = this.n5;
    const wx = x + L[0];
    const wz = z + L[1];
    switch (this.biome.id) {
      case 'mountains': {
        const mask = sstep(-0.55, 0.35, L[2]);
        const ridge = this.n1.ridged(wx / 17000, wz / 17000, 6);
        const hills = n3.fbm(wx / 4200, wz / 4200, 4);
        let h = 420 + 380 * L[3] + Math.pow(ridge, 1.65) * 3700 * (0.3 + 0.7 * mask) + hills * 130;
        const v = Math.abs(n5.fbm(wx / 21000, wz / 21000, 3));
        if (v < 0.09) h -= (1 - sstep(0, 0.09, v)) * Math.max(0, h - 260) * 0.55;
        return 420 + (h - 420) * relief;
      }
      case 'desert': {
        const rocky = sstep(0.05, 0.45, L[2]);
        const m = n2.fbm(wx / 9000, wz / 9000, 4);
        const mesa = (sstep(0.16, 0.22, m) * 170 + sstep(0.36, 0.41, m) * 140) * (0.4 + 0.6 * rocky);
        const crest = Math.abs(Math.sin(((x * 0.81 + z * 0.58) / 1250 + 1.4 * n5.noise(x / 5200, z / 5200)) * Math.PI));
        const draa = (1 - crest) * (1 - crest) * 55 * (1 - rocky);
        const range = rocky > 0 ? Math.pow(n3.ridged(wx / 13000, wz / 13000, 6), 1.5) * 1500 * rocky : 0;
        const h = 260 + 130 * L[3] + mesa + draa + range;
        return 260 + (h - 260) * relief;
      }
      case 'savanna': {
        const kop = Math.max(0, n3.fbm(x / 3600, z / 3600, 3) - 0.3);
        const rift = sstep(-0.06, 0.06, L[2]) * 280;
        const h = 620 + 220 * L[3] + 75 * n2.fbm(wx / 5200, wz / 5200, 4) + Math.pow(kop, 1.5) * 1900 + rift;
        return 620 + (h - 620) * relief;
      }
      case 'jungle': {
        const broad = L[2];
        const rm = sstep(0.1, 0.55, L[3]);
        const range = rm > 0 ? Math.pow(n3.ridged(wx / 15000, wz / 15000, 5), 2) * 1100 * rm : 0;
        let h = 210 + 300 * broad + 260 * n2.fbm(wx / 4600, wz / 4600, 5) * sstep(-0.5, 0.5, broad) + range;
        h = 210 + (h - 210) * relief;
        return this.carveRivers(wx, wz, h, 0.1, 38);
      }
      case 'arctic': {
        const ridge = this.n1.ridged(wx / 15000, wz / 15000, 6);
        let h = -120 + 520 * L[2] + Math.pow(ridge, 1.35) * 1750 + 90 * n3.fbm(wx / 3500, wz / 3500, 3);
        const f = Math.abs(n5.fbm(wx / 19000, wz / 19000, 3));
        if (f < 0.075) h += (-140 - h) * (1 - sstep(0, 0.075, f)) * 0.95;
        return h > 0 ? h * relief : h;
      }
      case 'ocean': {
        const isl = this.n1.fbm(wx / 17000, wz / 17000, 5) + 0.12 * L[2];
        const floor = -650 + 450 * L[3];
        const shelf = sstep(0.1, 0.27, isl);
        const land = Math.max(0, isl - 0.28);
        const peak = land > 0 ? n3.ridged(wx / 6000, wz / 6000, 5) : 0;
        const h = floor + (-28 - floor) * shelf + land * 3300 + land * peak * 2400;
        return h > 0 ? h * relief : h;
      }
      case 'wasteland': {
        let h = 230 + 230 * L[2] + 150 * n2.fbm(wx / 5200, wz / 5200, 4);
        h = 230 + (h - 230) * relief;
        h += this.craterOffset(x, z);
        return this.carveRivers(wx, wz, h, 0.07, 30);
      }
      default: {
        // temperate
        const broad = L[2];
        const hillMask = sstep(-0.25, 0.5, broad);
        const ridgeMask = sstep(0.05, 0.6, L[3]);
        const ridge = ridgeMask > 0 ? n3.ridged(wx / 19000, wz / 19000, 5) : 0;
        let h = 170 + 170 * broad + n2.fbm(wx / 6000, wz / 6000, 5) * (80 + 260 * hillMask) + ridge * ridge * 850 * ridgeMask;
        h = 170 + (h - 170) * relief;
        return this.carveRivers(wx, wz, h, 0.085, 28);
      }
    }
  }

  /** Broad valleys with a sea-level river channel in the middle */
  private carveRivers(wx: number, wz: number, h: number, width: number, floorH: number): number {
    const v = Math.abs(this.n5.fbm(wx / 26000 + 0.7, wz / 26000 - 3.1, 3));
    if (v >= width) return h;
    const valley = 1 - sstep(0, width, v);
    const floor = floorH + 0.12 * Math.max(0, h - floorH);
    h = h + (Math.min(h, floor) - h) * valley;
    const core = 1 - sstep(0.004, 0.011, v);
    return h + (-9 - h) * core;
  }

  private makeCrater(ci: number, cj: number, out: Crater): boolean {
    if (hash2i(ci, cj, this.seed + 101) >= 0.5) return false;
    const big = hash2i(ci, cj, this.seed + 104) < 0.08;
    out.x = (ci + 0.15 + 0.7 * hash2i(ci, cj, this.seed + 102)) * CRATER_CELL;
    out.z = (cj + 0.15 + 0.7 * hash2i(ci, cj, this.seed + 103)) * CRATER_CELL;
    out.r = big ? 1300 + 500 * hash2i(ci, cj, this.seed + 105) : 160 + 650 * Math.pow(hash2i(ci, cj, this.seed + 105), 1.6);
    return true;
  }

  /**
   * Craters in the 3x3 cells around (x, z).
   * mode 0: summed height offset (bowl + rim); mode 1: min normalised distance (1 = rim)
   */
  private craterQuery(x: number, z: number, mode: 0 | 1): number {
    const ci = Math.floor(x / CRATER_CELL) - this.craterC0;
    const cj = Math.floor(z / CRATER_CELL) - this.craterC0;
    const n = this.craterCells;
    const T = this.craterTable;
    let acc = mode === 0 ? 0 : Infinity;
    for (let j = cj - 1; j <= cj + 1; j++) {
      if (j < 0 || j >= n) continue;
      for (let i = ci - 1; i <= ci + 1; i++) {
        if (i < 0 || i >= n) continue;
        const k = (j * n + i) * 3;
        const r = T[k + 2];
        if (r === 0) continue;
        const dx = x - T[k];
        const dz = z - T[k + 1];
        const q = Math.sqrt(dx * dx + dz * dz) / r;
        if (mode === 1) {
          if (q < acc) acc = q;
        } else if (q <= 2.2) {
          const rimT = (q - 1) / 0.28;
          acc += (q < 1 ? -(1 - q * q) * r * 0.2 : 0) + r * 0.07 * Math.exp(-rimT * rimT);
        }
      }
    }
    return acc;
  }

  private craterOffset(x: number, z: number): number {
    return this.craterQuery(x, z, 0);
  }

  /** Normalised distance to the nearest crater (1 = on the rim), Infinity if none near */
  craterProximity(x: number, z: number): number {
    return this.craterQuery(x, z, 1);
  }

  /** Where the analytic fine detail applies (0..1) before water/flatten suppression */
  private detailMask(L: Float64Array): number {
    switch (this.biome.id) {
      case 'desert':
        return 0.35 + 0.65 * (1 - sstep(0.05, 0.45, L[2]));
      case 'mountains':
        return 0.5 + 0.5 * sstep(-0.55, 0.35, L[2]);
      default:
        return 1;
    }
  }

  /** Analytic fine detail in [-1, 1] (dunes for desert, bumps elsewhere) */
  private detailValue(x: number, z: number): number {
    const n = this.nDetail;
    switch (this.biome.id) {
      case 'desert': {
        const w = (x * 0.83 + z * 0.56) / 330 + 0.9 * n.noise(x / 1500, z / 1500);
        const s = Math.abs(Math.sin(w * Math.PI));
        const dune = (1 - s) * (1 - s) * 2 - 0.7;
        return dune * 0.8 + 0.2 * n.noise(x / 170, z / 170);
      }
      case 'mountains':
      case 'arctic':
        return 0.6 * (0.55 - Math.abs(n.noise(x / 540, z / 540)) * 1.6) + 0.4 * n.noise(x / 190, z / 190);
      default:
        return 0.65 * n.noise(x / 430, z / 430) + 0.35 * n.noise(x / 160, z / 160);
    }
  }

  private computeLowRange(): [number, number] {
    let mn = this.biome.id === 'ocean' ? -600 : this.biome.id === 'arctic' ? -130 : 0;
    let mx = this.biome.id === 'ocean' ? -440 : this.biome.id === 'arctic' ? -50 : 110;
    if (this.coast) {
      mn = Math.min(mn, -170);
      mx = Math.max(mx, 40);
    }
    for (const f of this.flattenZones) {
      mn = Math.min(mn, f.height);
      mx = Math.max(mx, f.height);
    }
    return [mn - 5, mx + 5];
  }

  /** Approximate slope (1 - normal.y) at a point */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z, _n).y;
  }
}
