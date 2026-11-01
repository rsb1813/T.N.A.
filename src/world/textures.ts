// Procedural canvas textures (generated once on first use, shared). Purely visual — seeded for stable looks.
import * as THREE from 'three';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[world] 2D canvas 를 만들 수 없다');
  return [c, ctx];
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, color = '255,255,255'): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(0.55, `rgba(${color},${alpha * 0.55})`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw a cloudy puff made of many soft blobs into a cell */
function puff(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number, rnd: () => number, blobs: number, spread: number, flatBottom: boolean): void {
  const cx = ox + s / 2;
  const cy = oy + s / 2;
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.7) * s * spread;
    let x = cx + Math.cos(a) * d;
    let y = cy + Math.sin(a) * d * 0.8;
    if (flatBottom && y > cy + s * 0.12) y = cy + s * 0.12 - rnd() * s * 0.05;
    x = Math.min(ox + s * 0.8, Math.max(ox + s * 0.2, x));
    const r = s * (0.08 + rnd() * 0.16) * (1 - (d / (s * spread)) * 0.45);
    blob(ctx, x, y, r, 0.16 + rnd() * 0.18);
  }
  // soft overall falloff so edges never show the quad
  const img = ctx.getImageData(ox, oy, s, s);
  const px = img.data;
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const dx = (i + 0.5) / s - 0.5;
      const dy = (j + 0.5) / s - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const f = r >= 1 ? 0 : Math.pow(1 - r, 0.6);
      const k = (j * s + i) * 4 + 3;
      px[k] = Math.round(Math.min(255, px[k] * 1.25) * f);
    }
  }
  ctx.putImageData(img, ox, oy);
}

let puffTex: THREE.CanvasTexture | null = null;
let particleTex: THREE.CanvasTexture | null = null;
let users = 0;

/** Each Environment / Fx instance holds one reference; GPU textures are freed when the last one releases */
export function acquireSharedTextures(): void {
  users++;
}

export function releaseSharedTextures(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  puffTex?.dispose();
  particleTex?.dispose();
  puffTex = null;
  particleTex = null;
}

/** 2x2 atlas of soft cumulus puffs (alpha in A, white RGB) */
export function getCloudTexture(): THREE.CanvasTexture {
  if (puffTex) return puffTex;
  const S = 256;
  const [c, ctx] = canvas(S * 2);
  const rnd = rng(1234);
  for (let f = 0; f < 4; f++) puff(ctx, (f % 2) * S, Math.floor(f / 2) * S, S, rnd, 46, 0.3, f < 2);
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.NoColorSpace;
  puffTex.generateMipmaps = true;
  puffTex.minFilter = THREE.LinearMipmapLinearFilter;
  return puffTex;
}

/**
 * 2x2 particle atlas: 0 = round glow (fire, flash, sparks), 1 = smoke puff, 2 = ragged smoke, 3 = flame tongue.
 * RGB = brightness detail, A = coverage.
 */
export function getParticleTexture(): THREE.CanvasTexture {
  if (particleTex) return particleTex;
  const S = 128;
  const [c, ctx] = canvas(S * 2);
  const rnd = rng(777);
  // 0: glow
  {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // 1, 2: smoke
  puff(ctx, S, 0, S, rnd, 40, 0.28, false);
  puff(ctx, 0, S, S, rnd, 26, 0.34, false);
  // 3: flame (bright core, ragged edge)
  {
    const ox = S;
    const oy = S;
    for (let i = 0; i < 28; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.pow(rnd(), 1.4) * S * 0.24;
      blob(ctx, ox + S / 2 + Math.cos(a) * d, oy + S / 2 + Math.sin(a) * d, S * (0.1 + rnd() * 0.16), 0.35);
    }
    const g = ctx.createRadialGradient(ox + S / 2, oy + S / 2, 0, ox + S / 2, oy + S / 2, S * 0.3);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, S, S);
  }
  particleTex = new THREE.CanvasTexture(c);
  particleTex.colorSpace = THREE.NoColorSpace;
  particleTex.minFilter = THREE.LinearMipmapLinearFilter;
  return particleTex;
}
