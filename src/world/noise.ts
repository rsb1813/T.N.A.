// Seeded 2D gradient noise and fractal helpers for deterministic terrain generation.
// Pure functions of (seed, x, y): no Math.random, safe to use from simulation code.

const ROT_C = Math.cos(0.61);
const ROT_S = Math.sin(0.61);

/** mulberry32 step used only to shuffle permutation/gradient tables */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D Perlin-style gradient noise, output roughly in [-1, 1], period 256 */
export class Noise2 {
  private readonly perm = new Uint8Array(512);
  private readonly grad = new Float64Array(512);

  constructor(seed: number) {
    const rnd = seededRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rnd() * Math.PI * 2;
      this.grad[i * 2] = Math.cos(a);
      this.grad[i * 2 + 1] = Math.sin(a);
    }
  }

  noise(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const fx = x - xf;
    const fy = y - yf;
    const xi = xf & 255;
    const yi = yf & 255;
    const p = this.perm;
    const g = this.grad;
    const a = p[xi] + yi;
    const b = p[xi + 1] + yi;
    const aa = p[a] << 1;
    const ab = p[a + 1] << 1;
    const ba = p[b] << 1;
    const bb = p[b + 1] << 1;
    const n00 = g[aa] * fx + g[aa + 1] * fy;
    const n10 = g[ba] * (fx - 1) + g[ba + 1] * fy;
    const n01 = g[ab] * fx + g[ab + 1] * (fy - 1);
    const n11 = g[bb] * (fx - 1) + g[bb + 1] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  /** Fractal sum, each octave rotated to hide the lattice. Output roughly [-1, 1] */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(px + i * 17.13, py - i * 9.71);
      norm += amp;
      amp *= gain;
      const rx = (px * ROT_C - py * ROT_S) * lacunarity;
      py = (px * ROT_S + py * ROT_C) * lacunarity;
      px = rx;
    }
    return sum / norm;
  }

  /** Ridged multifractal (sharp crests). Output roughly [0, 1] */
  ridged(x: number, y: number, octaves: number, lacunarity = 2.05, gain = 0.5): number {
    let sum = 0;
    let amp = 0.5;
    let weight = 1;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(px + i * 31.7, py + i * 11.3));
      n *= n;
      n *= weight;
      weight = n * 2 > 1 ? 1 : n * 2;
      sum += n * amp;
      norm += amp;
      amp *= gain;
      const rx = (px * ROT_C - py * ROT_S) * lacunarity;
      py = (px * ROT_S + py * ROT_C) * lacunarity;
      px = rx;
    }
    return sum / norm;
  }
}

/** Integer lattice hash -> [0, 1) (deterministic placement of craters, trees, buildings) */
export function hash2i(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const smooth01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const sstep = (e0: number, e1: number, x: number): number => smooth01((x - e0) / (e1 - e0));
