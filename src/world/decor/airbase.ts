// Decorative airbase: runway with markings, taxiway, apron, hardened shelters, hangars, tower, fuel farm,
// radar dome and night runway lights. Merged into a few meshes per base.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Faction } from '../../core/types';
import type { TerrainService } from '../../core/services';

export interface AirbaseSpec {
  x: number;
  z: number;
  /** Runway heading (deg, 0 = north) */
  heading: number;
  faction: Faction;
  name?: string;
}

export const RUNWAY_LENGTH = 3000;
export const RUNWAY_WIDTH = 45;
/** Flatten radius needed so the whole base sits on level ground */
export const AIRBASE_FLAT_RADIUS = 2300;

const FACTION_TINT: Record<Faction, { concrete: number; shelter: number; roof: number }> = {
  NATO: { concrete: 0xa7a59d, shelter: 0x7d8574, roof: 0x8e979d },
  WARSAW: { concrete: 0x9a9a90, shelter: 0x6e7a62, roof: 0x7f8a7c },
  PAX: { concrete: 0x8f8e8a, shelter: 0x5f6266, roof: 0x6d7177 },
  WON: { concrete: 0xb5a88c, shelter: 0x9a8a68, roof: 0xa59a80 },
  NEUTRAL: { concrete: 0xa5a39b, shelter: 0x868a80, roof: 0x8f959a },
};

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[world] 2D canvas 를 만들 수 없다');
  return [c, ctx];
}

function asphalt(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (w * h) / 6; i++) {
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function texture(c: HTMLCanvasElement, repeat: 'none' | 'v' | 'uv'): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeat === 'uv' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat === 'none' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Runway end: piano keys, designation number, touchdown/aiming marks. 45 m x 400 m, threshold at v = 0 */
function runwayEndTexture(designation: string): THREE.CanvasTexture {
  const W = 128;
  const H = 1136; // 0.352 m / px
  const [c, ctx] = makeCanvas(W, H);
  asphalt(ctx, W, H, '#3b3d40', designation.charCodeAt(0) * 31 + 7);
  const m = W / RUNWAY_WIDTH; // px per metre
  const yOf = (metres: number): number => H - metres * m; // canvas y for distance from threshold
  ctx.fillStyle = '#eceae2';
  // edge lines
  ctx.fillRect(0, 0, 1 * m, H);
  ctx.fillRect(W - 1 * m, 0, 1 * m, H);
  // threshold piano keys (6 m from threshold, 30 m long)
  const keys = 8;
  const keyW = 1.8 * m;
  const gap = (W - 2 * m - keys * keyW) / (keys + 1);
  for (let k = 0; k < keys; k++) {
    const x = 1 * m + gap + k * (keyW + gap);
    ctx.fillRect(x, yOf(36), keyW, 30 * m);
  }
  // designation number (upright for an aircraft landing toward -v... i.e. reading from the threshold)
  ctx.save();
  ctx.translate(W / 2, yOf(62));
  ctx.scale(1, 2.6);
  ctx.font = `bold ${Math.round(9 * m)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(designation, 0, 0);
  ctx.restore();
  // touchdown zone marks
  for (const d of [150, 300]) {
    ctx.fillRect(W / 2 - 13 * m, yOf(d + 22), 3 * m, 22 * m);
    ctx.fillRect(W / 2 + 10 * m, yOf(d + 22), 3 * m, 22 * m);
  }
  // aiming point
  ctx.fillRect(W / 2 - 15 * m, yOf(400 - 4), 6 * m, 45 * m);
  ctx.fillRect(W / 2 + 9 * m, yOf(400 - 4), 6 * m, 45 * m);
  // centreline dashes
  for (let d = 120; d < 400; d += 60) ctx.fillRect(W / 2 - 0.45 * m, yOf(d + 30), 0.9 * m, 30 * m);
  return texture(c, 'none');
}

/** Tileable runway middle: 45 m x 180 m */
function runwayMidTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  asphalt(ctx, W, H, '#3d3f42', 99);
  const m = W / RUNWAY_WIDTH;
  ctx.fillStyle = '#eceae2';
  ctx.fillRect(0, 0, 1 * m, H);
  ctx.fillRect(W - 1 * m, 0, 1 * m, H);
  const mv = H / 180;
  for (let d = 0; d < 180; d += 60) ctx.fillRect(W / 2 - 0.45 * m, d * mv, 0.9 * m, 30 * mv);
  // tyre marks
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(W / 2 - 6 * m, 0, 4 * m, H);
  ctx.fillRect(W / 2 + 2 * m, 0, 4 * m, H);
  return texture(c, 'v');
}

function taxiwayTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 256);
  asphalt(ctx, 64, 256, '#45474a', 5);
  ctx.fillStyle = '#d8b13a';
  ctx.fillRect(30, 0, 4, 256);
  ctx.fillStyle = 'rgba(216,177,58,0.8)';
  ctx.fillRect(1, 0, 2, 256);
  ctx.fillRect(61, 0, 2, 256);
  return texture(c, 'v');
}

function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  asphalt(ctx, 256, 256, '#a9a7a0', 11);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  return texture(c, 'uv');
}

function glowSprite(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Flat quad on the ground: width along X, length along Z (texture v runs along Z), centred at (x, z) */
function groundQuad(width: number, length: number, x: number, y: number, z: number, repeatU = 1, repeatV = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
  if (repeatU !== 1 || repeatV !== 1) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeatU, uv.getY(i) * repeatV);
  }
  return g.translate(x, y, z);
}

/** Same as groundQuad but with its length running along X */
function groundQuadX(length: number, width: number, x: number, y: number, z: number, repeatV = 1): THREE.BufferGeometry {
  return groundQuad(width, length, 0, 0, 0, 1, repeatV).rotateY(Math.PI / 2).translate(x, y, z);
}

function designationFor(headingDeg: number): string {
  let n = Math.round((((headingDeg % 360) + 360) % 360) / 10);
  if (n === 0) n = 36;
  return String(n).padStart(2, '0');
}

export class AirbaseBuilder {
  private readonly owned: Array<{ dispose(): void }> = [];
  private readonly lightMaterials: THREE.PointsMaterial[] = [];
  private readonly windowMaterials: THREE.MeshStandardMaterial[] = [];
  private midTex: THREE.CanvasTexture | null = null;
  private taxiTex: THREE.CanvasTexture | null = null;
  private concreteTex: THREE.CanvasTexture | null = null;
  private glowTex: THREE.CanvasTexture | null = null;

  constructor(private readonly terrain: TerrainService) {}

  build(spec: AirbaseSpec): THREE.Group {
    const root = new THREE.Group();
    root.name = `airbase_${spec.name ?? spec.faction}`;
    const h0 = this.terrain.heightAt(spec.x, spec.z);
    root.position.set(spec.x, h0, spec.z);
    root.rotation.y = (-spec.heading * Math.PI) / 180;
    const tint = FACTION_TINT[spec.faction] ?? FACTION_TINT.NEUTRAL;
    this.midTex ??= this.own(runwayMidTexture());
    this.taxiTex ??= this.own(taxiwayTexture());
    this.concreteTex ??= this.own(concreteTexture());
    this.glowTex ??= this.own(glowSprite());

    const L = RUNWAY_LENGTH;
    const W = RUNWAY_WIDTH;
    const endLen = 400;
    const asphaltMat = (map: THREE.Texture): THREE.MeshStandardMaterial =>
      this.own(new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, envMapIntensity: 0.3 }));
    const temp: THREE.BufferGeometry[] = [];
    const tmp = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      temp.push(g);
      return g;
    };
    const merged = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => this.own(mergeGeometries(geos)!);

    // Runway: local -Z = heading. Aircraft landing on runway <heading> touch down at the +Z end, so the
    // end texture for that designation sits there with its threshold (v = 0) at the +Z edge.
    const yR = 0.45;
    const endA = this.own(runwayEndTexture(designationFor(spec.heading)));
    const endB = this.own(runwayEndTexture(designationFor(spec.heading + 180)));
    // PlaneGeometry v = 0 lies at +Z after rotateX(-PI/2), and text "up" points along -Z (direction of travel)
    const geoA = this.own(groundQuad(W, endLen, 0, yR, L / 2 - endLen / 2));
    const geoB = this.own(groundQuad(W, endLen, 0, 0, 0).rotateY(Math.PI).translate(0, yR, -L / 2 + endLen / 2));
    root.add(new THREE.Mesh(geoA, asphaltMat(endA)), new THREE.Mesh(geoB, asphaltMat(endB)));
    const midLen = L - 2 * endLen;
    root.add(new THREE.Mesh(this.own(groundQuad(W, midLen, 0, yR, 0, 1, midLen / 180)), asphaltMat(this.midTex)));
    const padMat = this.own(new THREE.MeshStandardMaterial({ color: 0x4a4a46, roughness: 0.95 }));
    root.add(new THREE.Mesh(merged([tmp(groundQuad(W, 120, 0, 0.4, L / 2 + 60)), tmp(groundQuad(W, 120, 0, 0.4, -L / 2 - 60))]), padMat));

    // Taxiway parallel on the right, connectors, apron, shelter pads
    const taxiX = 190;
    const taxiW = 23;
    const conLen = taxiX - W / 2 - taxiW / 2 + 4;
    const taxi: THREE.BufferGeometry[] = [tmp(groundQuad(taxiW, L, taxiX, 0.38, 0, 1, L / 90))];
    for (const z of [-L / 2 + 40, -L / 4, 0, L / 4, L / 2 - 40]) taxi.push(tmp(groundQuadX(conLen, taxiW, W / 2 + conLen / 2 - 2, 0.36, z, conLen / 90)));
    root.add(new THREE.Mesh(merged(taxi), asphaltMat(this.taxiTex)));

    const concreteMat = this.own(new THREE.MeshStandardMaterial({ map: this.concreteTex, color: tint.concrete, roughness: 0.9, envMapIntensity: 0.3 }));
    const apronW = 280;
    const apronL = 900;
    const apronX = taxiX + taxiW / 2 + apronW / 2;
    const concrete: THREE.BufferGeometry[] = [tmp(groundQuad(apronW, apronL, apronX, 0.32, 0, apronW / 40, apronL / 40))];
    const shelters: Array<{ x: number; z: number }> = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const z = side * (650 + k * 150);
        shelters.push({ x: taxiX + 150, z });
        concrete.push(tmp(groundQuad(60, 50, taxiX + 140, 0.3, z, 1.5, 1.2)));
        concrete.push(tmp(groundQuadX(120, 16, taxiX + 60, 0.34, z, 3)));
      }
    }
    root.add(new THREE.Mesh(merged(concrete), concreteMat));

    // Structures
    const shelterMat = this.own(new THREE.MeshStandardMaterial({ color: tint.shelter, roughness: 0.85, envMapIntensity: 0.4 }));
    const roofMat = this.own(new THREE.MeshStandardMaterial({ color: tint.roof, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.6 }));
    const wallMat = this.own(new THREE.MeshStandardMaterial({ color: 0xc9c5b9, roughness: 0.8, envMapIntensity: 0.4 }));
    const glassMat = this.own(new THREE.MeshStandardMaterial({ color: 0x1f2a33, roughness: 0.15, metalness: 0.7, emissive: 0xffc070, emissiveIntensity: 0 }));
    const tankMat = this.own(new THREE.MeshStandardMaterial({ color: 0xdcdcd4, roughness: 0.45, metalness: 0.4, envMapIntensity: 0.7 }));
    this.windowMaterials.push(glassMat);

    // hardened shelters: half-cylinder vaults (axis along X) opening toward the taxiway (-X)
    const vaults = shelters.map((s) =>
      tmp(new THREE.CylinderGeometry(13, 13, 38, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.72, 1).translate(s.x + 19, 0, s.z)),
    );
    root.add(new THREE.Mesh(merged(vaults), shelterMat));
    const walls: THREE.BufferGeometry[] = shelters.map((s) => tmp(new THREE.BoxGeometry(0.6, 8.6, 24).translate(s.x - 0.2, 4.3, s.z)));
    // maintenance hangars with arched roofs
    const hangarX = apronX + apronW / 2 + 40;
    const roofs: THREE.BufferGeometry[] = [];
    for (const z of [-260, 0, 260]) {
      roofs.push(tmp(new THREE.CylinderGeometry(32, 32, 75, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.32, 1).translate(hangarX, 14, z)));
      walls.push(tmp(new THREE.BoxGeometry(75, 14, 64).translate(hangarX, 7, z)));
    }
    root.add(new THREE.Mesh(merged(roofs), roofMat));
    // control tower, ops buildings, radar mast
    const towerX = apronX + 40;
    const towerZ = apronL / 2 + 80;
    walls.push(tmp(new THREE.BoxGeometry(7, 24, 7).translate(towerX, 12, towerZ)));
    walls.push(tmp(new THREE.BoxGeometry(12.5, 1, 12.5).translate(towerX, 29.5, towerZ)));
    walls.push(tmp(new THREE.BoxGeometry(40, 9, 22).translate(towerX + 30, 4.5, towerZ + 10)));
    walls.push(tmp(new THREE.BoxGeometry(60, 7, 18).translate(apronX + 60, 3.5, -apronL / 2 - 70)));
    walls.push(tmp(new THREE.CylinderGeometry(2.5, 3, 12, 8).translate(apronX + 170, 6, towerZ + 60)));
    root.add(new THREE.Mesh(merged(walls), wallMat));
    root.add(new THREE.Mesh(this.own(new THREE.BoxGeometry(11, 5, 11).translate(towerX, 26.5, towerZ)), glassMat));
    // fuel farm + radome
    const tanks: THREE.BufferGeometry[] = [tmp(new THREE.SphereGeometry(7, 14, 10).translate(apronX + 170, 18, towerZ + 60))];
    for (let k = 0; k < 4; k++) tanks.push(tmp(new THREE.CylinderGeometry(9, 9, 11, 16).translate(apronX + 120 + (k % 2) * 26, 5.5, -apronL / 2 - 150 - Math.floor(k / 2) * 26)));
    root.add(new THREE.Mesh(merged(tanks), tankMat));
    for (const g of temp) g.dispose();

    // runway lights (visible at night)
    root.add(this.runwayLights(L, W));
    root.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    root.updateMatrixWorld(true);
    return root;
  }

  private runwayLights(L: number, W: number): THREE.Points {
    const pos: number[] = [];
    const col: number[] = [];
    const push = (x: number, z: number, c: [number, number, number]): void => {
      pos.push(x, 1.2, z);
      col.push(...c);
    };
    for (let z = -L / 2; z <= L / 2; z += 60) {
      push(-W / 2 - 1.5, z, [1, 0.95, 0.85]);
      push(W / 2 + 1.5, z, [1, 0.95, 0.85]);
    }
    for (let x = -W / 2; x <= W / 2; x += 4) {
      push(x, L / 2 + 2, [0.3, 1, 0.45]);
      push(x, -L / 2 - 2, [1, 0.25, 0.2]);
    }
    for (let d = 60; d <= 900; d += 30) push(0, L / 2 + d, [1, 0.97, 0.9]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: 5,
      sizeAttenuation: false,
      map: this.glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.own(g);
    this.own(m);
    this.lightMaterials.push(m);
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.visible = false;
    return pts;
  }

  /** 0 = day, 1 = night: runway lights and lit tower cab */
  setNight(night: number, root: THREE.Object3D): void {
    for (const m of this.lightMaterials) m.opacity = night;
    for (const m of this.windowMaterials) m.emissiveIntensity = night * 1.4;
    root.traverse((o) => {
      if ((o as THREE.Points).isPoints) o.visible = night > 0.05;
    });
  }

  private own<T extends { dispose(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.lightMaterials.length = 0;
    this.windowMaterials.length = 0;
  }
}
