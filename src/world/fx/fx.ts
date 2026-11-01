// FxService implementation: explosions, trails, decoys, hits, tracers, afterburners, vapour, shake, flash.
// All particle work goes through two GPU pools (additive fire/sparks, alpha smoke/dust); per-frame CPU work is
// limited to emitters (trails, decoys) and a small sprite bank. No allocations in the per-frame path.
import * as THREE from 'three';
import { isDecoy, isMissile } from '../../core/contracts';
import type { Entity } from '../../core/entity';
import type { System } from '../../core/game';
import type { ExplosionKind, FxHandle, FxService } from '../../core/services';
import type { Sim } from '../../core/sim';
import { acquireSharedTextures, releaseSharedTextures } from '../textures';
import { AfterburnerFx, disposeAfterburnerGeometry } from './afterburner';
import { MoukFx, NuclearFx, disposeBigFxGeometry, type BigFx, type BigFxContext } from './bigfx';
import { ParticlePool, type ParticleSpec } from './particles';
import { Ribbon, RibbonPool, type RibbonStyle } from './ribbons';
import { SpriteBank } from './sprites';

const rnd = Math.random;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _col = new THREE.Color();

function randDir(out: THREE.Vector3): THREE.Vector3 {
  const u = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

function setColor(p: ParticleSpec, r0: number, g0: number, b0: number, a0: number, r1: number, g1: number, b1: number, a1: number): void {
  p.r0 = r0;
  p.g0 = g0;
  p.b0 = b0;
  p.a0 = a0;
  p.r1 = r1;
  p.g1 = g1;
  p.b1 = b1;
  p.a1 = a1;
}

const SMOKE_STYLES: Record<'low' | 'medium' | 'high', RibbonStyle> = {
  low: { life: 6, width0: 0.7, width1: 4, alpha: 0.13, color: new THREE.Color(0.9, 0.9, 0.9), headFade: 0.15, lit: true },
  medium: { life: 9, width0: 1.0, width1: 7, alpha: 0.55, color: new THREE.Color(0.92, 0.92, 0.92), headFade: 0.12, lit: true },
  high: { life: 11, width0: 1.3, width1: 9.5, alpha: 0.8, color: new THREE.Color(0.95, 0.95, 0.94), headFade: 0.1, lit: true },
};
const VAPOR_STYLE: RibbonStyle = { life: 0.9, width0: 0.25, width1: 1.6, alpha: 0.55, color: new THREE.Color(0.95, 0.97, 1), headFade: 0.02, lit: true };

interface Emitter extends FxHandle {
  done: boolean;
  update(fx: FxSystem, dt: number): void;
}

// ---------------------------------------------------------------- emitters

class MissileTrail implements Emitter {
  done = false;
  private ribbon: Ribbon | null = null;
  private readonly halfLen: number;
  private readonly diameter: number;
  private age = 0;

  constructor(
    private readonly entity: Entity,
    private readonly style: RibbonStyle,
    private readonly smoke: 'low' | 'medium' | 'high',
  ) {
    const body = isMissile(entity) ? entity.def.body : undefined;
    this.halfLen = (body?.lengthM ?? 3.6) * 0.5;
    this.diameter = body?.diameterM ?? 0.18;
  }

  stop(): void {
    this.done = true;
    this.ribbon?.finish();
    this.ribbon = null;
  }

  update(fx: FxSystem, dt: number): void {
    const e = this.entity;
    this.age += dt;
    const alive = !e.removed && e.alive;
    const burning = alive && (isMissile(e) ? e.motorBurning : true);
    if (!burning) {
      this.ribbon?.finish();
      this.ribbon = null;
      if (!alive) this.done = true;
      return;
    }
    const fwd = e.getForward(_a);
    const tail = _b.copy(e.position).addScaledVector(fwd, -this.halfLen);
    if (!this.ribbon) {
      this.ribbon = fx.missileRibbons.acquire();
      this.ribbon?.start(this.style, tail, fx.time, 1);
    } else if (!this.ribbon.feed(tail, fx.time, 1, 0.045, 40)) {
      this.ribbon = null;
    }
    // motor flame: bright core + tongue streaming backwards, flickering
    const back = _c.copy(fwd).negate();
    const fl = 0.8 + 0.2 * rnd();
    const d = Math.max(0.12, this.diameter);
    fx.sprites.add(tail, d * 9 * fl, 5, 3.6, 2.2, 1, back, d * 22 * fl);
    fx.sprites.add(tail, d * 30, 1.6, 0.85, 0.35, 0.45 * fl);
    // launch puff around the rail in the first moments
    if (this.age < 0.35 && this.smoke !== 'low') {
      const p = fx.alphaPool.spec;
      p.x = tail.x;
      p.y = tail.y;
      p.z = tail.z;
      randDir(_c).multiplyScalar(3);
      p.vx = e.velocity.x * 0.2 + _c.x;
      p.vy = e.velocity.y * 0.2 + _c.y;
      p.vz = e.velocity.z * 0.2 + _c.z;
      p.life = 1.6 + rnd();
      p.delay = 0;
      p.size0 = 1.5;
      p.size1 = 7;
      p.rot = rnd() * 6.28;
      p.spin = 0.3;
      p.drag = 1.6;
      p.gravity = 0.5;
      p.stretch = 0;
      p.frame = 1;
      p.flicker = false;
      setColor(p, 0.9, 0.9, 0.9, 0.5, 0.85, 0.85, 0.85, 0);
      fx.alphaPool.emit();
    }
  }
}

class DamageTrail implements Emitter {
  done = false;
  private readonly last = new THREE.Vector3();
  private dist = 0;
  private timer = 0;

  constructor(
    private readonly entity: Entity,
    private readonly kind: 'smoke' | 'fire',
  ) {
    this.last.copy(entity.position);
  }

  stop(): void {
    this.done = true;
  }

  update(fx: FxSystem, dt: number): void {
    const e = this.entity;
    if (e.removed) {
      this.done = true;
      return;
    }
    const fire = this.kind === 'fire';
    const spacing = fire ? 4.5 : 7;
    this.dist += this.last.distanceTo(e.position);
    this.timer += dt;
    const minInterval = fire ? 1 / 30 : 1 / 18;
    // puffs spaced along the path travelled this frame (fast aircraft), at least a minimum rate when slow
    let n = Math.floor(this.dist / spacing);
    if (n === 0 && this.timer >= minInterval) n = 1;
    n = Math.min(n, 10);
    for (let i = 0; i < n; i++) {
      _a.copy(this.last).lerp(e.position, (i + 1) / n);
      this.emitSmoke(fx, _a, fire);
      if (fire) this.emitFlame(fx, _a);
    }
    if (n > 0) {
      this.dist %= spacing;
      this.timer = 0;
    }
    if (fire) fx.sprites.add(e.position, 7 + 3 * rnd(), 2.4, 1.1, 0.3, 0.55);
    this.last.copy(e.position);
  }

  private emitSmoke(fx: FxSystem, at: THREE.Vector3, fire: boolean): void {
    const p = fx.alphaPool.spec;
    const v = this.entity.velocity;
    randDir(_c);
    p.x = at.x + _c.x;
    p.y = at.y + _c.y;
    p.z = at.z + _c.z;
    p.vx = v.x * 0.12 + _c.x * 3;
    p.vy = v.y * 0.12 + _c.y * 3;
    p.vz = v.z * 0.12 + _c.z * 3;
    p.life = 3.5 + rnd() * 2.5;
    p.delay = 0;
    p.size0 = fire ? 3.5 : 2.5;
    p.size1 = (fire ? 22 : 15) * (0.8 + 0.4 * rnd());
    p.rot = rnd() * 6.28;
    p.spin = (rnd() - 0.5) * 0.6;
    p.drag = 1.3;
    p.gravity = 1.6;
    p.stretch = 0;
    p.frame = 1 + (rnd() < 0.5 ? 1 : 0);
    p.flicker = false;
    if (fire) setColor(p, 0.07, 0.065, 0.06, 0.85, 0.2, 0.19, 0.18, 0);
    else setColor(p, 0.2, 0.2, 0.2, 0.65, 0.36, 0.36, 0.36, 0);
    fx.alphaPool.emit();
  }

  private emitFlame(fx: FxSystem, at: THREE.Vector3): void {
    const p = fx.addPool.spec;
    const v = this.entity.velocity;
    randDir(_c);
    p.x = at.x;
    p.y = at.y;
    p.z = at.z;
    p.vx = v.x * 0.75 + _c.x * 4;
    p.vy = v.y * 0.75 + _c.y * 4;
    p.vz = v.z * 0.75 + _c.z * 4;
    p.life = 0.3 + rnd() * 0.3;
    p.delay = 0;
    p.size0 = 3.2 + rnd() * 1.5;
    p.size1 = 1.2;
    p.rot = rnd() * 6.28;
    p.spin = (rnd() - 0.5) * 4;
    p.drag = 3;
    p.gravity = 4;
    p.stretch = 0;
    p.frame = 3;
    p.flicker = false;
    setColor(p, 3.4, 1.7, 0.5, 1, 1.6, 0.35, 0.06, 0);
    fx.addPool.emit();
  }
}

class DecoyFx implements Emitter {
  done = false;
  private timer = 0;
  private age = 0;

  constructor(
    private readonly entity: Entity,
    private readonly type: 'flare' | 'chaff',
    fx: FxSystem,
  ) {
    if (type === 'chaff') this.burst(fx, 70);
  }

  stop(): void {
    this.done = true;
  }

  private strength(): number {
    return isDecoy(this.entity) ? this.entity.strength : 1;
  }

  private burst(fx: FxSystem, n: number): void {
    const e = this.entity;
    const p = fx.addPool.spec;
    for (let i = 0; i < n; i++) {
      randDir(_c);
      p.x = e.position.x + _c.x * 2;
      p.y = e.position.y + _c.y * 2;
      p.z = e.position.z + _c.z * 2;
      p.vx = e.velocity.x * 0.55 + _c.x * 9;
      p.vy = e.velocity.y * 0.55 + _c.y * 9 - 2;
      p.vz = e.velocity.z * 0.55 + _c.z * 9;
      p.life = 2.2 + rnd() * 2;
      p.delay = rnd() * 0.15;
      p.size0 = 0.7;
      p.size1 = 0.5;
      p.rot = 0;
      p.spin = 0;
      p.drag = 1.8;
      p.gravity = -1.5;
      p.stretch = 0;
      p.frame = 0;
      p.flicker = true;
      setColor(p, 2.4, 2.4, 2.7, 0.9, 1.4, 1.5, 1.7, 0);
      fx.addPool.emit();
    }
    const s = fx.alphaPool.spec;
    for (let i = 0; i < 3; i++) {
      randDir(_c);
      s.x = e.position.x + _c.x * 3;
      s.y = e.position.y + _c.y * 3;
      s.z = e.position.z + _c.z * 3;
      s.vx = e.velocity.x * 0.5;
      s.vy = e.velocity.y * 0.5;
      s.vz = e.velocity.z * 0.5;
      s.life = 3.5 + rnd() * 1.5;
      s.delay = 0;
      s.size0 = 4;
      s.size1 = 20;
      s.rot = rnd() * 6.28;
      s.spin = 0.2;
      s.drag = 1.8;
      s.gravity = -0.5;
      s.stretch = 0;
      s.frame = 2;
      s.flicker = false;
      setColor(s, 0.75, 0.76, 0.8, 0.22, 0.7, 0.7, 0.72, 0);
      fx.alphaPool.emit();
    }
  }

  update(fx: FxSystem, dt: number): void {
    const e = this.entity;
    if (e.removed || !e.alive) {
      this.done = true;
      return;
    }
    this.age += dt;
    const str = this.strength();
    if (str <= 0.02) {
      this.done = true;
      return;
    }
    if (this.type === 'chaff') {
      if (this.age < 0.6) this.burst(fx, 2);
      else this.done = true;
      return;
    }
    // flare: blinding magnesium core + glow + smoke trail + sparks
    const fl = 0.75 + 0.25 * rnd();
    const k = Math.min(1, str * 1.4);
    fx.sprites.add(e.position, (3.5 + 3 * k) * fl, 9, 8, 6, 1);
    fx.sprites.add(e.position, 16 * k, 2.2, 1.4, 0.6, 0.55 * fl);
    this.timer += dt;
    while (this.timer > 0.035) {
      this.timer -= 0.035;
      const p = fx.alphaPool.spec;
      randDir(_c);
      p.x = e.position.x;
      p.y = e.position.y;
      p.z = e.position.z;
      p.vx = e.velocity.x * 0.25 + _c.x;
      p.vy = e.velocity.y * 0.25 + _c.y;
      p.vz = e.velocity.z * 0.25 + _c.z;
      p.life = 2 + rnd();
      p.delay = 0;
      p.size0 = 1;
      p.size1 = 6;
      p.rot = rnd() * 6.28;
      p.spin = 0.4;
      p.drag = 1.5;
      p.gravity = 0.7;
      p.stretch = 0;
      p.frame = 1;
      p.flicker = false;
      setColor(p, 0.92, 0.92, 0.9, 0.55 * k, 0.82, 0.82, 0.82, 0);
      fx.alphaPool.emit();
      const s = fx.addPool.spec;
      randDir(_c);
      s.x = e.position.x;
      s.y = e.position.y;
      s.z = e.position.z;
      s.vx = e.velocity.x * 0.9 + _c.x * 14;
      s.vy = e.velocity.y * 0.9 + _c.y * 14;
      s.vz = e.velocity.z * 0.9 + _c.z * 14;
      s.life = 0.25 + rnd() * 0.25;
      s.delay = 0;
      s.size0 = 0.9;
      s.size1 = 0.3;
      s.rot = 0;
      s.spin = 0;
      s.drag = 2;
      s.gravity = -9.8;
      s.stretch = 0.04;
      s.frame = 0;
      s.flicker = false;
      setColor(s, 5, 4, 2.4, 1, 3, 1.4, 0.4, 0);
      fx.addPool.emit();
    }
  }
}

class VaporFx implements Emitter {
  done = false;
  private readonly ribbons: Array<Ribbon | null>;
  private readonly tmpTips: THREE.Vector3[];
  private condensation = 0;

  constructor(
    private readonly entity: Entity,
    private readonly wingtips: THREE.Vector3[],
    private readonly intensity: () => number,
  ) {
    this.ribbons = wingtips.map(() => null);
    this.tmpTips = wingtips.map(() => new THREE.Vector3());
  }

  stop(): void {
    this.done = true;
    for (let i = 0; i < this.ribbons.length; i++) {
      this.ribbons[i]?.finish();
      this.ribbons[i] = null;
    }
  }

  update(fx: FxSystem, dt: number): void {
    const e = this.entity;
    if (e.removed) {
      this.stop();
      return;
    }
    const k = e.alive ? THREE.MathUtils.clamp(this.intensity(), 0, 1) : 0;
    const obj = e.object3d;
    obj.updateMatrixWorld();
    // wingtips are read by reference every frame (variable-sweep aircraft update them in place)
    for (let i = 0; i < this.wingtips.length; i++) this.tmpTips[i].copy(this.wingtips[i]).applyMatrix4(obj.matrixWorld);
    if (k > 0.12) {
      for (let i = 0; i < this.ribbons.length; i++) {
        let r = this.ribbons[i];
        if (!r) {
          r = fx.vaporRibbons.acquire();
          r?.start(VAPOR_STYLE, this.tmpTips[i], fx.time, k);
          this.ribbons[i] = r;
        } else if (!r.feed(this.tmpTips[i], fx.time, k, 0.025, 12)) {
          this.ribbons[i] = null;
        }
      }
    } else {
      for (let i = 0; i < this.ribbons.length; i++) {
        this.ribbons[i]?.finish();
        this.ribbons[i] = null;
      }
    }
    // wing-surface condensation cloud at very high G
    if (k > 0.45 && this.wingtips.length >= 2) {
      this.condensation += dt * 110 * ((k - 0.45) / 0.55);
      const up = _c.set(0, 1, 0).applyQuaternion(obj.getWorldQuaternion(_q));
      while (this.condensation >= 1) {
        this.condensation -= 1;
        const side = rnd() < 0.5 ? 0 : 1;
        const span = 0.15 + rnd() * 0.75;
        _a.copy(obj.position).lerp(this.tmpTips[side], span).addScaledVector(up, 0.4 + rnd() * 0.6);
        const p = fx.alphaPool.spec;
        p.x = _a.x;
        p.y = _a.y;
        p.z = _a.z;
        p.vx = e.velocity.x * 0.97;
        p.vy = e.velocity.y * 0.97;
        p.vz = e.velocity.z * 0.97;
        p.life = 0.16 + rnd() * 0.16;
        p.delay = 0;
        p.size0 = 1.2 + rnd();
        p.size1 = 3.5 + rnd() * 2;
        p.rot = rnd() * 6.28;
        p.spin = 0;
        p.drag = 0;
        p.gravity = 0;
        p.stretch = 0;
        p.frame = 2;
        p.flicker = false;
        setColor(p, 1, 1, 1, 0.4 * k, 1, 1, 1, 0);
        fx.alphaPool.emit();
      }
    } else {
      this.condensation = 0;
    }
  }
}

class AfterburnerHandle implements Emitter {
  done = false;
  constructor(readonly fxObj: AfterburnerFx) {}
  stop(): void {
    if (this.done) return;
    this.done = true;
    this.fxObj.dispose();
  }
  update(fx: FxSystem): void {
    this.fxObj.update(fx.time);
  }
}

// ---------------------------------------------------------------- system

export interface FxStats {
  particlesAdditive: number;
  particlesAlpha: number;
  emitters: number;
  ribbons: number;
  sprites: number;
  bigEffects: number;
}

export class FxSystem implements FxService, System {
  readonly name = 'fx';
  /** Screen flash 0..1 (nuclear / MOUK) — draw a full-screen overlay with flashColor at this opacity */
  flash = 0;
  readonly flashColor = new THREE.Color(1, 1, 1);
  time = 0;
  readonly alphaPool = new ParticlePool(3072, false);
  readonly addPool = new ParticlePool(2048, true);
  readonly sprites = new SpriteBank(384);
  readonly missileRibbons = new RibbonPool(72, 320);
  readonly vaporRibbons = new RibbonPool(96, 48);
  /** Scene light level applied to smoke (auto from the environment's lights; override with setLighting) */
  readonly light = new THREE.Color(1, 1, 1);
  private lightOverride = false;
  private readonly group = new THREE.Group();
  private readonly emitters: Emitter[] = [];
  private readonly big: BigFx[] = [];
  private readonly pointLight = new THREE.PointLight(0xffd0a0, 0, 0, 2);
  private lightPeak = 0;
  private lightTime = 0;
  private lightDuration = 0.3;
  private shake_ = 0;
  private flashHold = 0;
  private flashDecay = 1;
  private readonly delayedShakes: Array<{ t: number; amount: number }> = [];
  private sim: Sim | null = null;
  private lightProbeTimer = 0;
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private readonly bigCtx: BigFxContext;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    acquireSharedTextures();
    this.group.name = 'tna_fx';
    this.group.add(this.alphaPool.mesh, this.addPool.mesh, this.sprites.mesh, this.missileRibbons.group, this.vaporRibbons.group);
    this.pointLight.name = 'tna_fx_light';
    scene.add(this.group, this.pointLight);
    this.bigCtx = {
      scene,
      alpha: this.alphaPool,
      add: this.addPool,
      camera,
      flash: (amount, color) => this.startFlash(amount, color, 0.45),
      shakeLater: (delay, amount) => {
        if (amount > 0) this.delayedShakes.push({ t: this.time + delay, amount });
      },
      light: (pos, intensity, color, duration) => this.pulseLight(pos, intensity, color, duration),
    };
  }

  get shakeAmount(): number {
    return this.shake_;
  }

  shake(amount: number): void {
    this.shake_ = Math.min(1, Math.max(this.shake_, amount));
  }

  /** Override the smoke lighting colour (otherwise derived from the 'tna_sun'/'tna_hemi' lights) */
  setLighting(color: THREE.Color | null): void {
    this.lightOverride = !!color;
    if (color) this.light.copy(color);
  }

  get stats(): FxStats {
    return {
      particlesAdditive: this.addPool.liveCount,
      particlesAlpha: this.alphaPool.liveCount,
      emitters: this.emitters.length,
      ribbons: this.missileRibbons.activeCount + this.vaporRibbons.activeCount,
      sprites: this.sprites.mesh.visible ? 1 : 0,
      bigEffects: this.big.length,
    };
  }

  private startFlash(amount: number, color: THREE.Color, decayPerSec: number): void {
    if (amount <= 0) return;
    if (amount >= this.flash) this.flashColor.copy(color);
    this.flash = Math.max(this.flash, Math.min(1, amount));
    this.flashHold = 0.12;
    this.flashDecay = decayPerSec;
  }

  private pulseLight(pos: THREE.Vector3, intensity: number, color: THREE.Color, duration: number): void {
    const cur = this.lightPeak * Math.max(0, 1 - this.lightTime / this.lightDuration);
    if (intensity < cur) return;
    this.pointLight.position.copy(pos);
    this.pointLight.color.copy(color);
    this.lightPeak = intensity;
    this.lightTime = 0;
    this.lightDuration = duration;
  }

  private camDist(pos: THREE.Vector3): number {
    return this.camera.position.distanceTo(pos);
  }

  private groundKind(pos: THREE.Vector3, size: number): ExplosionKind {
    const t = this.sim?.services.terrain;
    if (!t) return 'air';
    const h = t.heightAt(pos.x, pos.z);
    if (pos.y - h > 12 * Math.max(1, size)) return 'air';
    return t.isWater(pos.x, pos.z) ? 'water' : 'ground';
  }

  // ---------------------------------------------------------------- FxService

  explosion(pos: THREE.Vector3, opts?: { size?: number; kind?: ExplosionKind }): void {
    if (this.disposed) return;
    const size = Math.max(0.1, opts?.size ?? 1);
    const kind = opts?.kind ?? this.groundKind(pos, size);
    if (kind === 'nuclear') {
      const gy = this.sim?.services.terrain.heightAt(pos.x, pos.z) ?? Math.min(0, pos.y);
      this.big.push(new NuclearFx(this.bigCtx, pos, size, gy));
      return;
    }
    if (kind === 'mouk') {
      this.big.push(new MoukFx(this.bigCtx, pos, size));
      return;
    }
    const d = this.camDist(pos);
    const s = kind === 'small' ? size * 0.45 : size;
    this.flashBurst(pos, s);
    if (kind === 'water') {
      this.splash(pos, s, 1);
    } else {
      this.fireball(pos, s, kind === 'small' ? 4 : 11);
      this.smoke(pos, s, kind === 'small' ? 4 : 9, kind === 'ground' ? 0.12 : 0.17);
      this.sparks(pos, s, kind === 'small' ? 8 : 26);
      if (kind !== 'small') this.debris(pos, s, kind === 'ground' ? 10 : 8);
      if (kind === 'ground') this.dust(pos, s);
    }
    this.pulseLight(pos, 6000 * s * s, _col.setRGB(1, 0.72, 0.42), 0.35);
    this.shake(THREE.MathUtils.clamp(s * 0.55 * (1 - d / (650 * s + 250)), 0, 0.85));
  }

  missileTrail(missile: Entity, smoke: 'low' | 'medium' | 'high'): FxHandle {
    const e = new MissileTrail(missile, SMOKE_STYLES[smoke] ?? SMOKE_STYLES.medium, smoke);
    this.emitters.push(e);
    return e;
  }

  damageTrail(entity: Entity, kind: 'smoke' | 'fire'): FxHandle {
    const e = new DamageTrail(entity, kind);
    this.emitters.push(e);
    return e;
  }

  tracer(origin: THREE.Vector3, velocity: THREE.Vector3, lifetime: number): void {
    if (this.disposed || this.camDist(origin) > 9000) return;
    const p = this.addPool.spec;
    p.x = origin.x;
    p.y = origin.y;
    p.z = origin.z;
    p.vx = velocity.x;
    p.vy = velocity.y;
    p.vz = velocity.z;
    p.life = Math.max(0.05, lifetime);
    p.delay = 0;
    p.size0 = 0.55;
    p.size1 = 0.45;
    p.rot = 0;
    p.spin = 0;
    p.drag = 0;
    p.gravity = -9.81;
    p.stretch = 0.028;
    p.frame = 0;
    p.flicker = false;
    setColor(p, 4.2, 3.0, 1.3, 1, 3.2, 1.6, 0.5, 0.7);
    this.addPool.emit();
  }

  decoy(decoy: Entity, type: 'flare' | 'chaff'): FxHandle {
    const e = new DecoyFx(decoy, type, this);
    this.emitters.push(e);
    return e;
  }

  hit(pos: THREE.Vector3, kind: 'spark' | 'debris' | 'dust' | 'splash' = 'spark'): void {
    if (this.disposed || this.camDist(pos) > 7000) return;
    switch (kind) {
      case 'spark':
        this.sparks(pos, 0.35, 10);
        this.flashBurst(pos, 0.12);
        break;
      case 'debris':
        this.debris(pos, 0.3, 5);
        this.smoke(pos, 0.25, 2, 0.25);
        this.sparks(pos, 0.3, 5);
        break;
      case 'dust':
        this.dust(pos, 0.18);
        break;
      case 'splash':
        this.splash(pos, 0.16, 0.6);
        break;
    }
  }

  afterburner(target: THREE.Object3D, nozzles: THREE.Vector3[], level: () => number): FxHandle {
    const h = new AfterburnerHandle(new AfterburnerFx(target, nozzles, level));
    this.emitters.push(h);
    return h;
  }

  vapor(aircraft: Entity, wingtips: THREE.Vector3[], intensity: () => number): FxHandle {
    const e = new VaporFx(aircraft, wingtips, intensity);
    this.emitters.push(e);
    return e;
  }

  // ---------------------------------------------------------------- recipes

  private flashBurst(pos: THREE.Vector3, s: number): void {
    const p = this.addPool.spec;
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    p.vx = p.vy = p.vz = 0;
    p.life = 0.16;
    p.delay = 0;
    p.size0 = 16 * s;
    p.size1 = 26 * s;
    p.rot = rnd() * 6.28;
    p.spin = 0;
    p.drag = 0;
    p.gravity = 0;
    p.stretch = 0;
    p.frame = 0;
    p.flicker = false;
    setColor(p, 6, 5.2, 4, 1, 3, 1.6, 0.6, 0);
    this.addPool.emit();
  }

  private fireball(pos: THREE.Vector3, s: number, n: number): void {
    const p = this.addPool.spec;
    for (let i = 0; i < n; i++) {
      randDir(_a);
      const r = rnd() * 2.5 * s;
      const v = (7 + rnd() * 16) * s;
      p.x = pos.x + _a.x * r;
      p.y = pos.y + _a.y * r;
      p.z = pos.z + _a.z * r;
      p.vx = _a.x * v;
      p.vy = _a.y * v + 2 * s;
      p.vz = _a.z * v;
      p.life = 0.55 + rnd() * 0.6;
      p.delay = rnd() * 0.06;
      p.size0 = (5 + rnd() * 3) * s;
      p.size1 = (11 + rnd() * 6) * s;
      p.rot = rnd() * 6.28;
      p.spin = (rnd() - 0.5) * 2;
      p.drag = 3.2;
      p.gravity = 3;
      p.stretch = 0;
      p.frame = 3;
      p.flicker = false;
      setColor(p, 3.6, 2.2, 0.8, 1, 1.4, 0.25, 0.05, 0);
      this.addPool.emit();
    }
  }

  private smoke(pos: THREE.Vector3, s: number, n: number, grey: number): void {
    const p = this.alphaPool.spec;
    for (let i = 0; i < n; i++) {
      randDir(_a);
      const v = (3 + rnd() * 6) * s;
      p.x = pos.x + _a.x * 2 * s;
      p.y = pos.y + _a.y * 2 * s;
      p.z = pos.z + _a.z * 2 * s;
      p.vx = _a.x * v;
      p.vy = _a.y * v + 1.5 * s;
      p.vz = _a.z * v;
      p.life = 4 + rnd() * 3.5;
      p.delay = 0.08 + rnd() * 0.15;
      p.size0 = 6 * s;
      p.size1 = (20 + rnd() * 12) * s;
      p.rot = rnd() * 6.28;
      p.spin = (rnd() - 0.5) * 0.5;
      p.drag = 1.1;
      p.gravity = 1.4;
      p.stretch = 0;
      p.frame = 1 + (i & 1);
      p.flicker = false;
      setColor(p, grey, grey * 0.97, grey * 0.94, 0.8, grey + 0.22, grey + 0.21, grey + 0.2, 0);
      this.alphaPool.emit();
    }
  }

  private sparks(pos: THREE.Vector3, s: number, n: number): void {
    const p = this.addPool.spec;
    const vs = Math.sqrt(s);
    for (let i = 0; i < n; i++) {
      randDir(_a);
      const v = (50 + rnd() * 120) * vs;
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
      p.vx = _a.x * v;
      p.vy = _a.y * v;
      p.vz = _a.z * v;
      p.life = 0.5 + rnd() * 0.9;
      p.delay = 0;
      p.size0 = 0.7 * Math.max(0.6, vs);
      p.size1 = 0.35;
      p.rot = 0;
      p.spin = 0;
      p.drag = 1.7;
      p.gravity = -9.81;
      p.stretch = 0.05;
      p.frame = 0;
      p.flicker = false;
      setColor(p, 4.5, 3.0, 1.4, 1, 2.4, 0.7, 0.15, 0);
      this.addPool.emit();
    }
  }

  /** Dark chunks on ballistic arcs, each carrying a co-moving flame (same motion parameters) */
  private debris(pos: THREE.Vector3, s: number, n: number): void {
    const pa = this.alphaPool.spec;
    const pf = this.addPool.spec;
    for (let i = 0; i < n; i++) {
      randDir(_a);
      _a.y = Math.abs(_a.y) * 0.8 + 0.2;
      const v = (25 + rnd() * 45) * Math.sqrt(s);
      const life = 1.8 + rnd() * 1.6;
      for (const p of [pa, pf]) {
        p.x = pos.x;
        p.y = pos.y;
        p.z = pos.z;
        p.vx = _a.x * v;
        p.vy = _a.y * v;
        p.vz = _a.z * v;
        p.delay = 0;
        p.rot = 0;
        p.spin = 0;
        p.drag = 0.5;
        p.gravity = -9.81;
        p.flicker = false;
      }
      pa.life = life;
      pa.size0 = 1.1 * Math.max(0.5, s);
      pa.size1 = 0.9 * Math.max(0.5, s);
      pa.stretch = 0.04;
      pa.frame = 0;
      setColor(pa, 0.05, 0.045, 0.04, 1, 0.08, 0.07, 0.06, 0.6);
      this.alphaPool.emit();
      pf.life = life * 0.6;
      pf.size0 = 2.2 * Math.max(0.5, s);
      pf.size1 = 0.6;
      pf.stretch = 0.03;
      pf.frame = 3;
      setColor(pf, 3, 1.5, 0.4, 0.9, 1.2, 0.3, 0.05, 0);
      this.addPool.emit();
    }
  }

  private dust(pos: THREE.Vector3, s: number): void {
    const p = this.alphaPool.spec;
    const n = Math.max(5, Math.round(14 * Math.min(1.5, s)));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const up = 10 + rnd() * 35;
      const out = 8 + rnd() * 22;
      p.x = pos.x;
      p.y = pos.y + 1;
      p.z = pos.z;
      p.vx = Math.cos(a) * out * s;
      p.vy = up * s;
      p.vz = Math.sin(a) * out * s;
      p.life = 3 + rnd() * 2.5;
      p.delay = rnd() * 0.1;
      p.size0 = 5 * s;
      p.size1 = (18 + rnd() * 10) * s;
      p.rot = rnd() * 6.28;
      p.spin = (rnd() - 0.5) * 0.4;
      p.drag = 1.4;
      p.gravity = -4;
      p.stretch = 0;
      p.frame = 2;
      p.flicker = false;
      setColor(p, 0.42, 0.34, 0.25, 0.85, 0.52, 0.47, 0.4, 0);
      this.alphaPool.emit();
    }
    // dirt clods
    for (let i = 0; i < n; i++) {
      randDir(_a);
      _a.y = Math.abs(_a.y) * 0.7 + 0.5;
      const v = (25 + rnd() * 35) * Math.sqrt(s);
      p.x = pos.x;
      p.y = pos.y + 0.5;
      p.z = pos.z;
      p.vx = _a.x * v;
      p.vy = _a.y * v;
      p.vz = _a.z * v;
      p.life = 1.5 + rnd() * 1.5;
      p.delay = 0;
      p.size0 = 0.9 * Math.max(0.5, s);
      p.size1 = 0.7 * Math.max(0.5, s);
      p.rot = 0;
      p.spin = 0;
      p.drag = 0.4;
      p.gravity = -9.81;
      p.stretch = 0.03;
      p.frame = 0;
      setColor(p, 0.12, 0.09, 0.06, 1, 0.14, 0.11, 0.08, 0.5);
      this.alphaPool.emit();
    }
    // base ring of dust
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rnd() * 0.3;
      p.x = pos.x;
      p.y = pos.y + 2 * s;
      p.z = pos.z;
      p.vx = Math.cos(a) * 45 * s;
      p.vy = 2 * s;
      p.vz = Math.sin(a) * 45 * s;
      p.life = 3.5 + rnd() * 1.5;
      p.delay = 0.05;
      p.size0 = 6 * s;
      p.size1 = 16 * s;
      p.rot = rnd() * 6.28;
      p.spin = 0.2;
      p.drag = 2.4;
      p.gravity = 0.3;
      p.stretch = 0;
      p.frame = 1;
      setColor(p, 0.5, 0.43, 0.34, 0.6, 0.55, 0.5, 0.44, 0);
      this.alphaPool.emit();
    }
  }

  private splash(pos: THREE.Vector3, s: number, flashScale: number): void {
    const p = this.alphaPool.spec;
    const y0 = this.sim ? 0.5 : pos.y;
    const n = Math.max(6, Math.round(22 * Math.min(1.5, s)));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 3 * s;
      p.x = pos.x + Math.cos(a) * r;
      p.y = y0;
      p.z = pos.z + Math.sin(a) * r;
      const up = (35 + rnd() * 45) * Math.sqrt(s);
      p.vx = Math.cos(a) * (2 + rnd() * 6) * s;
      p.vy = up;
      p.vz = Math.sin(a) * (2 + rnd() * 6) * s;
      p.life = 2.2 + rnd() * 1.6;
      p.delay = rnd() * 0.12;
      p.size0 = 3 * s;
      p.size1 = (11 + rnd() * 6) * s;
      p.rot = rnd() * 6.28;
      p.spin = (rnd() - 0.5) * 0.5;
      p.drag = 0.45;
      p.gravity = -9.81;
      p.stretch = 0;
      p.frame = 2;
      p.flicker = false;
      setColor(p, 0.95, 0.97, 1, 0.9, 0.9, 0.93, 0.96, 0);
      this.alphaPool.emit();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.x = pos.x;
      p.y = y0 + 2;
      p.z = pos.z;
      p.vx = Math.cos(a) * 30 * s;
      p.vy = 3 * s;
      p.vz = Math.sin(a) * 30 * s;
      p.life = 3 + rnd() * 1.5;
      p.delay = 0.1;
      p.size0 = 6 * s;
      p.size1 = 22 * s;
      p.rot = rnd() * 6.28;
      p.spin = 0.2;
      p.drag = 1.8;
      p.gravity = 0.4;
      p.stretch = 0;
      p.frame = 1;
      setColor(p, 0.92, 0.94, 0.97, 0.45, 0.9, 0.92, 0.95, 0);
      this.alphaPool.emit();
    }
    if (flashScale > 0.8) this.fireball(pos, s * 0.6, 3);
  }

  // ---------------------------------------------------------------- System

  private probeLights(): void {
    if (this.lightOverride) return;
    if (!this.sun || !this.sun.parent) this.sun = (this.scene.getObjectByName('tna_sun') as THREE.DirectionalLight) ?? null;
    if (!this.hemi || !this.hemi.parent) this.hemi = (this.scene.getObjectByName('tna_hemi') as THREE.HemisphereLight) ?? null;
    if (!this.sun && !this.hemi) {
      this.light.setRGB(1, 1, 1);
      return;
    }
    this.light.setRGB(0, 0, 0);
    if (this.hemi) this.light.add(_col.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * 0.6));
    if (this.sun) {
      const up = Math.max(0.3, _b.copy(this.sun.position).normalize().y);
      this.light.add(_col.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.36 * up));
    }
    const m = Math.max(this.light.r, this.light.g, this.light.b);
    if (m > 1.35) this.light.multiplyScalar(1.35 / m);
  }

  update(dt: number, sim: Sim): void {
    if (this.disposed) return;
    this.sim = sim ?? this.sim;
    this.time += dt;
    this.lightProbeTimer -= dt;
    if (this.lightProbeTimer <= 0) {
      this.probeLights();
      this.lightProbeTimer = 0.5;
    }
    this.alphaPool.setLight(this.light);

    this.sprites.begin();
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (!e.done) e.update(this, dt);
      if (e.done) {
        this.emitters[i] = this.emitters[this.emitters.length - 1];
        this.emitters.pop();
      }
    }
    for (let i = this.big.length - 1; i >= 0; i--) {
      if (!this.big[i].update(dt)) {
        this.big[i].dispose();
        this.big.splice(i, 1);
      }
    }
    this.sprites.end();
    this.alphaPool.update(dt);
    this.addPool.update(dt);
    this.missileRibbons.update(this.time, this.light);
    this.vaporRibbons.update(this.time, this.light);

    // point light pulse
    if (this.lightPeak > 0) {
      this.lightTime += dt;
      const k = Math.max(0, 1 - this.lightTime / this.lightDuration);
      this.pointLight.intensity = this.lightPeak * k * k;
      if (k <= 0) this.lightPeak = 0;
    } else {
      this.pointLight.intensity = 0;
    }
    // shake / flash decay, delayed shock-wave shakes
    this.shake_ *= Math.exp(-3.2 * dt);
    if (this.shake_ < 0.002) this.shake_ = 0;
    for (let i = this.delayedShakes.length - 1; i >= 0; i--) {
      if (this.delayedShakes[i].t <= this.time) {
        this.shake(this.delayedShakes[i].amount);
        this.delayedShakes.splice(i, 1);
      }
    }
    if (this.flashHold > 0) this.flashHold -= dt;
    else this.flash = Math.max(0, this.flash - dt * this.flashDecay * (0.35 + this.flash));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const e of this.emitters) e.stop();
    this.emitters.length = 0;
    for (const b of this.big) b.dispose();
    this.big.length = 0;
    this.alphaPool.dispose();
    this.addPool.dispose();
    this.sprites.dispose();
    this.missileRibbons.dispose();
    this.vaporRibbons.dispose();
    this.group.removeFromParent();
    this.pointLight.removeFromParent();
    this.pointLight.dispose();
    disposeAfterburnerGeometry();
    disposeBigFxGeometry();
    releaseSharedTextures();
  }
}

export function createFx(scene: THREE.Scene, camera: THREE.Camera): FxSystem {
  return new FxSystem(scene, camera);
}
