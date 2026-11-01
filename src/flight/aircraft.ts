// 항공기 엔티티: 비행모델 + 모델/조종면 애니메이션 + 피해/격추 연출 + 조종석 경고음.
//
//   const ac = new Aircraft({ def, loadout, faction: 'NATO', sim, callsign: 'Lancer 1' });
//   ac.placeAt(new THREE.Vector3(0, 6000, 0), 90, 250);   // 위치/방위/속도 (트림 상태)
//   ac.controller = new PlayerController(input, sim);   // 또는 AI 컨트롤러
//   ac.isPlayer = true; sim.world.player = ac;
//   sim.world.add(ac, sim);
//
// 스텝 순서: controller.update → avionics.update → 비행모델 → stores.update.
import * as THREE from 'three';
import { cloneMaterials, getModel, tintMaterial } from '../core/assets';
import type { AircraftController, AircraftDamageState, AircraftLike, Avionics, ControlInput, FlightTelemetry, Stores } from '../core/contracts';
import { Entity } from '../core/entity';
import { clamp, damp, DEG, G0, smoothstep } from '../core/math';
import type { FxHandle, ToneId } from '../core/services';
import { DIFFICULTY_TABLE } from '../core/settings';
import type { Sim } from '../core/sim';
import type { AISkill, DamageInfo, Faction } from '../core/types';
import { computeStats } from '../data/index';
import type { AircraftDef, DerivedStats, Loadout, ModuleDef, ModuleSlot } from '../data/schema';
import { FlightModel, flightParamsFromStats } from './flightModel';

export interface AircraftOptions {
  def: AircraftDef;
  loadout: Loadout;
  faction: Faction;
  sim: Sim;
  callsign?: string;
  /** 미리 계산된 성능 (기본: computeStats(loadout, sim.db)). 테스트/격납고 미리보기용 */
  stats?: DerivedStats;
  controller?: AircraftController | null;
  skill?: AISkill | null;
  /** 미리 만든 모델 (격납고 미리보기/테스트). 기본: getModel(def.model) */
  model?: THREE.Object3D;
}

/** 세력별 도장 (paint / paint_dark) */
export const FACTION_PAINT: Record<Faction, { paint: string; dark: string }> = {
  NATO: { paint: '#8e98a3', dark: '#6c7783' },
  WARSAW: { paint: '#7f93a8', dark: '#4d6378' },
  PAX: { paint: '#2b2e34', dark: '#6a1c22' },
  WON: { paint: '#a99a74', dark: '#6d7450' },
  NEUTRAL: { paint: '#9a9c9e', dark: '#6b6d70' },
};

const MODULE_SLOTS: readonly ModuleSlot[] = ['wing', 'engine', 'radar', 'irst', 'rwr', 'maw', 'ew', 'cms', 'datalink', 'helmet'];
const WARNING_TONES: readonly ToneId[] = ['stall', 'overg', 'pull_up', 'low_fuel'];

/** 지면 충돌 예상 경고 시간 (s) */
const PULL_UP_TIME = 5;
/** 과G 응력 1 당 날개 피해 / HP 피해 */
const STRESS_WING_DAMAGE = 0.4;
const STRESS_HP_DAMAGE = 25;

type SurfaceKind = 'aileron' | 'elevator' | 'rudder' | 'flap' | 'flap_le' | 'canard' | 'airbrake' | 'wing';

interface AnimatedNode {
  node: THREE.Object3D;
  rest: THREE.Quaternion;
  kind: SurfaceKind;
  /** -1 = 왼쪽, 1 = 오른쪽, 0 = 중앙 */
  side: -1 | 0 | 1;
  /**
   * 힌지에서 면이 뻗은 방향 (로컬 Z 부호): +1 = 뒤(+Z, 뒷전 조종면), -1 = 앞(-Z, 앞전 플랩/뒤집힌 에어브레이크).
   * 로컬 X 회전 +θ 는 +Z 쪽 끝을 내리고 -Z 쪽 끝을 올린다 → 이 부호를 곱해 "자유단 아래/위" 로 통일한다.
   */
  extent: 1 | -1;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

function sideOf(name: string): -1 | 0 | 1 {
  if (/_L(?:$|[_\d])/.test(name)) return -1;
  if (/_R(?:$|[_\d])/.test(name)) return 1;
  return 0;
}

/** 노드 로컬 공간에서 메시가 힌지(원점) 앞/뒤 어느 쪽으로 뻗었나 */
function extentOf(node: THREE.Object3D): 1 | -1 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const inv = new THREE.Matrix4();
  node.updateMatrixWorld(true);
  inv.copy(node.matrixWorld).invert();
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox!).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    box.union(tmp);
  });
  if (box.isEmpty()) return 1;
  return (box.min.z + box.max.z) * 0.5 < 0 ? -1 : 1;
}

function surfaceKind(name: string): SurfaceKind | null {
  if (name === 'wing_L' || name === 'wing_R') return 'wing';
  if (name.startsWith('aileron')) return 'aileron';
  if (name.startsWith('elevator')) return 'elevator';
  if (name.startsWith('rudder')) return 'rudder';
  if (name.startsWith('flap_le') || name.startsWith('slat')) return 'flap_le';
  if (name.startsWith('flap')) return 'flap';
  if (name.startsWith('canard')) return 'canard';
  if (name.startsWith('airbrake')) return 'airbrake';
  return null;
}

export class Aircraft extends Entity implements AircraftLike {
  readonly kind = 'aircraft' as const;
  readonly def: AircraftDef;
  readonly loadout: Loadout;
  readonly stats: DerivedStats;
  readonly controls: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, afterburner: false, airbrake: false };
  readonly flight: FlightModel;
  readonly avionics: Avionics;
  readonly stores: Stores;
  readonly damageState: AircraftDamageState = { engine: 0, wings: 0, control: 0, fuelLeak: false, onFire: false };
  controller: AircraftController | null = null;
  skill: AISkill | null = null;

  /** 렌더링 모델 (object3d 의 자식) */
  readonly model: THREE.Object3D;
  /** 모델 로컬 좌표의 장착점들 */
  readonly cockpitLocal = new THREE.Vector3();
  readonly gunLocal = new THREE.Vector3();
  readonly nozzleLocals: THREE.Vector3[] = [];
  /** 가변익이면 매 스텝 갱신된다 (vapor fx 가 같은 인스턴스를 읽음) */
  readonly wingtipLocals: THREE.Vector3[] = [];
  private readonly stationLocals = new Map<string, THREE.Vector3>();
  private readonly animated: AnimatedNode[] = [];
  private readonly wingtipNodes: Array<THREE.Object3D | null> = [];
  private readonly wingtipRest: THREE.Vector3[] = [];

  /** 격추 시각 (sim.time), 살아 있으면 null */
  deathTime: number | null = null;
  private wreckDuration = 5;
  private wreckRoll = 1;
  private wreckPitch = 0.3;
  private baseRcs: number;
  private stressSeen = 0;
  private smokeFx: FxHandle | null = null;
  private fireFx: FxHandle | null = null;
  private engineFx: FxHandle | null = null;
  private vaporFx: FxHandle | null = null;
  private tones = new Map<ToneId, boolean>();
  private pullUpTimer = 0;
  private pullUp = false;
  private surf = { aileron: 0, elevator: 0, rudder: 0, flap: 0, flapLe: 0, canard: 0 };
  private disposed = false;
  private readonly sim: Sim;

  constructor(opts: AircraftOptions) {
    super(opts.faction, opts.def.name);
    const { def, loadout, sim } = opts;
    this.def = def;
    this.loadout = loadout;
    this.callsign = opts.callsign ?? null;
    this.targetClass = 'air';
    this.skill = opts.skill ?? null;
    this.controller = opts.controller ?? null;
    this.stats = opts.stats ?? computeStats(loadout, sim.db);

    this.sim = sim;
    this.radius = Math.max(3, 0.4 * (def.dimensions.length + def.dimensions.span) * 0.5);
    this.maxHp = this.hp = Math.round(100 * clamp(Math.sqrt(def.mass.empty / 13_000), 0.85, 3));

    // ---- 모델
    this.model = opts.model ?? getModel(def.model, { kind: 'aircraft', length: def.dimensions.length });
    cloneMaterials(this.model);
    const paint = FACTION_PAINT[opts.faction] ?? FACTION_PAINT.NEUTRAL;
    tintMaterial(this.model, 'paint', paint.paint);
    tintMaterial(this.model, 'paint_dark', paint.dark);
    this.object3d.name = `aircraft_${def.id}_${this.id}`;
    this.object3d.add(this.model);
    this.applyOptionalParts(sim);
    this.readAttachPoints();

    // ---- 비행모델 (엔티티 벡터 공유)
    this.flight = new FlightModel(flightParamsFromStats(this.stats, def.variableSweep, 0), {
      position: this.position,
      velocity: this.velocity,
      quaternion: this.quaternion,
      throttle: this.controls.throttle,
    });
    this.flight.damage = this.damageState;

    // ---- 항전/무장 (combat)
    this.avionics = sim.services.weapons.createAvionics(this, sim);
    this.stores = sim.services.weapons.createStores(this, sim);
    this.flight.stores = this.stores;
    const ext = Math.max(0, this.stores.externalFuelKg);
    this.flight.params.internalFuelCapacityKg = Math.max(0, this.stats.fuelCapacityKg - ext);
    this.flight.internalFuelKg = this.flight.params.internalFuelCapacityKg * clamp(loadout.fuel ?? 1, 0, 1);
    this.flight.massKg = this.flight.currentMass();
    // stats.rcs 는 외부 무장 포함 값 → 기체 고유분만 남기고 매 스텝 현재 무장 RCS 를 더한다
    this.baseRcs = Math.max(this.stats.rcs * 0.05, this.stats.rcs - Math.max(0, this.stores.rcsAdd));
    this.rcs = this.stats.rcs;
    this.irSignature = this.stats.ir;

    // ---- 지속 효과
    const fx = sim.services.fx;
    this.engineFx = fx.afterburner(this.object3d, this.nozzleLocals, () => this.engineFxLevel());
    this.vaporFx = fx.vapor(this, this.wingtipLocals, () => this.vaporIntensity());
  }

  get telemetry(): FlightTelemetry {
    return this.flight.telemetry;
  }

  /** 노즐 화염 정도: 0..1 군용, 1..2 애프터버너 */
  engineFxLevel(): number {
    const f = this.flight;
    if (!this.alive || !f.engineRunning) return 0;
    return f.abLevel > 0.01 ? 1 + f.abLevel : f.spool;
  }

  /** 날개끝 베이퍼 강도 0..1 */
  vaporIntensity(): number {
    if (!this.alive) return 0;
    const t = this.flight.telemetry;
    const g = smoothstep(4.5, 8, Math.abs(t.gLoad)) + 0.6 * smoothstep(14, 24, Math.abs(t.aoaDeg)) * smoothstep(60, 140, t.speed);
    const humid = t.altitude < 9000 ? 1 : 0.5;
    return clamp(g * humid, 0, 1);
  }

  /** 트림 상태로 배치 (스폰): 위치, 방위(deg), 속도(m/s). 스로틀은 controls.throttle 로 맞춘다 */
  placeAt(position: THREE.Vector3, headingDeg: number, speed: number, opts: { pathDeg?: number; rollDeg?: number; throttle?: number } = {}): void {
    this.position.copy(position);
    const throttle = opts.throttle ?? this.controls.throttle;
    this.controls.throttle = throttle;
    this.flight.placeTrimmed(headingDeg, speed, { pathDeg: opts.pathDeg, rollDeg: opts.rollDeg, throttle });
    this.syncObject();
  }

  /** 내부 연료 보충 (보급 구역) */
  refuel(): void {
    this.flight.refuel();
  }

  update(dt: number, sim: Sim): void {
    if (this.alive) {
      this.controller?.update(this, dt, sim);
      this.avionics.update(dt, sim);
      this.flight.step(dt, this.controls, {
        limiter: this.isPlayer ? sim.settings.assists.flightLimiter : true,
        groundHeight: sim.services.terrain.heightAt(this.position.x, this.position.z),
      });
      this.stores.update(dt, sim);
      this.applyAirframeStress(sim);
      if (this.isPlayer && this.alive) this.updateWarnings(dt, sim);
    } else {
      this.updateWreck(dt, sim);
      if (this.removed) return;
    }
    this.updateSignatures();
    this.animate(dt);
  }

  // ---------------------------------------------------------------- 피해

  applyDamage(info: DamageInfo, sim: Sim): void {
    if (!this.alive || info.amount <= 0) return;
    let amount = info.amount;
    if (this.isPlayer) amount *= DIFFICULTY_TABLE[sim.settings.difficulty]?.playerDamageTaken ?? 1;
    if (info.kind !== 'crash') this.damageComponents(amount, info, sim);
    super.applyDamage(amount === info.amount ? info : { ...info, amount }, sim);
    if (this.alive) this.updateDamageFx(sim);
  }

  /** 피해를 부위(엔진/날개/조종면)로 나눈다 */
  private damageComponents(amount: number, info: DamageInfo, sim: Sim): void {
    const ds = this.damageState;
    const rng = sim.rng;
    const frac = clamp(amount / this.maxHp, 0, 1);
    const hit = (part: 'engine' | 'wings' | 'control', scale: number) => {
      ds[part] = clamp(ds[part] + frac * scale, 0, 1);
      if (part === 'wings') this.flight.rollBiasSign = rng.chance(0.5) ? 1 : -1;
    };
    switch (info.kind) {
      case 'kinetic': {
        const r = rng.next();
        hit(r < 0.35 ? 'engine' : r < 0.7 ? 'wings' : 'control', rng.range(0.9, 1.8));
        break;
      }
      case 'fire':
        hit('engine', rng.range(0.6, 1.2));
        break;
      case 'nuclear':
      case 'mouk':
        hit('engine', 1);
        hit('wings', 1);
        hit('control', 1);
        break;
      default: {
        // 폭발 파편: 각 부위가 확률적으로 맞는다 (최소 한 곳)
        let any = false;
        for (const part of ['engine', 'wings', 'control'] as const) {
          if (rng.chance(0.55)) {
            hit(part, rng.range(0.5, 1.3));
            any = true;
          }
        }
        if (!any) hit(rng.pick(['engine', 'wings', 'control'] as const), rng.range(0.6, 1.2));
      }
    }
    if (!ds.fuelLeak && rng.chance(Math.min(0.6, frac * 1.2))) ds.fuelLeak = true;
  }

  private updateDamageFx(sim: Sim): void {
    const ratio = this.hp / this.maxHp;
    const fx = sim.services.fx;
    if (ratio < 0.25) {
      this.damageState.onFire = true;
      if (!this.fireFx) {
        this.fireFx = fx.damageTrail(this, 'fire');
        this.smokeFx?.stop();
        this.smokeFx = null;
      }
    } else if (ratio < 0.5 && !this.smokeFx && !this.fireFx) {
      this.smokeFx = fx.damageTrail(this, 'smoke');
    }
  }

  /** 과G 응력 → 날개 피해 + HP 피해 (리미터를 끈 플레이어만 해당) */
  private applyAirframeStress(sim: Sim): void {
    const stress = this.flight.airframeStress;
    const d = stress - this.stressSeen;
    if (d <= 1e-6) return;
    this.stressSeen = stress;
    this.damageState.wings = clamp(this.damageState.wings + d * STRESS_WING_DAMAGE, 0, 1);
    if (this.damageState.wings >= 1) {
      this.kill(sim, { amount: this.hp, kind: 'crash', source: null, weaponId: null });
      return;
    }
    super.applyDamage({ amount: d * STRESS_HP_DAMAGE, kind: 'crash', source: null, weaponId: null }, sim);
    if (this.alive) this.updateDamageFx(sim);
  }

  // ---------------------------------------------------------------- 격추/추락

  protected onDestroyed(sim: Sim, info: DamageInfo | null): void {
    this.deathTime = sim.time;
    const rng = sim.rng;
    const overkill = !!info && (info.amount >= this.maxHp * 1.5 || info.kind === 'nuclear' || info.kind === 'mouk');
    this.wreckDuration = overkill ? rng.range(1, 2.5) : rng.range(3.5, 6);
    this.wreckRoll = (rng.chance(0.5) ? 1 : -1) * rng.range(0.55, 1);
    this.wreckPitch = rng.range(-0.15, 0.45);
    this.damageState.onFire = true;
    this.damageState.engine = 1;
    this.stores.setGunTrigger(false);
    const fx = sim.services.fx;
    this.smokeFx?.stop();
    this.smokeFx = null;
    if (!this.fireFx) this.fireFx = fx.damageTrail(this, 'fire');
    if (overkill && info?.kind !== 'crash') fx.explosion(this.position, { size: this.def.dimensions.length * 0.6, kind: 'air' });
    if (this.isPlayer) this.silenceTones(sim);
  }

  private updateWreck(dt: number, sim: Sim): void {
    const c = this.controls;
    c.roll = this.wreckRoll;
    c.pitch = this.wreckPitch;
    c.yaw = 0;
    c.throttle = 0;
    c.afterburner = false;
    c.airbrake = false;
    this.flight.step(dt, c, { limiter: false, uncontrolled: true, groundHeight: sim.services.terrain.heightAt(this.position.x, this.position.z) });
    if (this.deathTime !== null && sim.time - this.deathTime >= this.wreckDuration) {
      sim.services.fx.explosion(this.position, { size: this.def.dimensions.length, kind: 'air' });
      sim.services.fx.shake(this.isPlayer ? 0.8 : 0);
      this.finish();
    }
  }

  onTerrainCollision(sim: Sim, groundY: number): void {
    if (this.removed) return;
    this.position.y = groundY;
    const terrain = sim.services.terrain;
    const water = terrain.isWater(this.position.x, this.position.z);
    const fx = sim.services.fx;
    fx.explosion(this.position, { size: this.def.dimensions.length * 1.2, kind: water ? 'water' : 'ground' });
    if (water) fx.hit(this.position, 'splash');
    if (this.isPlayer) fx.shake(1);
    if (this.alive) this.kill(sim, { amount: this.hp, kind: 'crash', source: null, weaponId: null });
    this.finish();
  }

  private finish(): void {
    this.removed = true;
    this.stopFx();
  }

  // ---------------------------------------------------------------- 경고음

  private setTone(sim: Sim, id: ToneId, on: boolean): void {
    if ((this.tones.get(id) ?? false) === on) return;
    this.tones.set(id, on);
    sim.services.audio.setTone(id, on);
  }

  private silenceTones(sim: Sim): void {
    for (const id of WARNING_TONES) this.setTone(sim, id, false);
  }

  private updateWarnings(dt: number, sim: Sim): void {
    const t = this.flight.telemetry;
    this.setTone(sim, 'stall', t.stalled && t.agl > 20);
    this.setTone(sim, 'overg', t.overG);
    this.setTone(sim, 'low_fuel', t.fuelFraction < 0.15);
    this.pullUpTimer -= dt;
    if (this.pullUpTimer <= 0) {
      this.pullUpTimer = 0.1;
      this.pullUp = this.groundImpactPredicted(sim);
    }
    this.setTone(sim, 'pull_up', this.pullUp);
  }

  /** 현재 속도벡터로 직진할 때 PULL_UP_TIME 안에 지면에 닿는가 */
  private groundImpactPredicted(sim: Sim): boolean {
    const v = this.velocity;
    if (v.lengthSq() < 30 * 30) return false;
    const terrain = sim.services.terrain;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const tt = (PULL_UP_TIME * i) / steps;
      _v.copy(this.position).addScaledVector(v, tt);
      if (_v.y < terrain.heightAt(_v.x, _v.z) + 10) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 신호/시각

  private updateSignatures(): void {
    const f = this.flight;
    this.rcs = this.baseRcs + Math.max(0, this.stores.rcsAdd);
    let ir: number;
    if (!this.alive) ir = 1.2;
    else if (!f.engineRunning) ir = 0.15;
    else ir = (0.25 + 0.75 * f.spool) * (1 + 2.6 * f.abLevel);
    ir += 0.3 * Math.max(0, f.telemetry.mach - 1);
    if (this.damageState.onFire) ir += 0.8;
    this.irSignature = this.stats.ir * ir;
  }

  private animate(dt: number): void {
    const c = this.controls;
    const s = this.surf;
    const t = this.flight.telemetry;
    s.aileron = damp(s.aileron, c.roll, 14, dt);
    s.elevator = damp(s.elevator, c.pitch, 12, dt);
    s.rudder = damp(s.rudder, c.yaw, 10, dt);
    s.canard = damp(s.canard, c.pitch, 12, dt);
    const flapTarget = Math.max(smoothstep(170, 100, t.ias), 0.6 * smoothstep(10, 22, t.aoaDeg) * smoothstep(240, 160, t.ias));
    s.flap = damp(s.flap, flapTarget, 3, dt);
    // 앞전 플랩: 받음각 스케줄 (+ 저속)
    s.flapLe = damp(s.flapLe, Math.max(smoothstep(2, 20, t.aoaDeg), 0.5 * smoothstep(150, 90, t.ias)), 4, dt);
    const brake = this.flight.airbrakeLevel;
    const vs = this.def.variableSweep;
    const sweepDelta = vs && t.sweepDeg !== null ? (t.sweepDeg - vs.minDeg) * DEG : 0;
    for (const a of this.animated) {
      let axis = AXIS_X;
      let angle = 0;
      // angle > 0 (× extent) = 자유단 내림 / 러더는 뒷전 오른쪽
      switch (a.kind) {
        case 'aileron':
          // 오른쪽 롤 → 왼쪽 에일러론 뒷전 내림
          angle = a.extent * -a.side * s.aileron * 20 * DEG;
          break;
        case 'elevator':
          // 기수 올림 → 뒷전 올림, 테일러론 차동
          angle = a.extent * (-s.elevator * 18 * DEG - a.side * s.aileron * 6 * DEG);
          break;
        case 'canard':
          angle = a.extent * s.canard * 14 * DEG;
          break;
        case 'flap':
          angle = a.extent * s.flap * 28 * DEG;
          break;
        case 'flap_le':
          // 앞으로 뻗은 면(extent -1)의 자유단 = 앞전 → 내림
          angle = a.extent * s.flapLe * 22 * DEG;
          break;
        case 'rudder':
          axis = AXIS_Y;
          angle = a.extent * s.rudder * 25 * DEG;
          break;
        case 'airbrake':
          // 자유단 올림
          angle = -a.extent * brake * 45 * DEG;
          break;
        case 'wing':
          axis = AXIS_Y;
          angle = a.side < 0 ? sweepDelta : -sweepDelta;
          break;
      }
      a.node.quaternion.copy(a.rest).multiply(_q.setFromAxisAngle(axis, angle));
    }
    if (vs && this.wingtipNodes.some((n) => n)) this.refreshWingtips();
  }

  // ---------------------------------------------------------------- 모델 노드

  private installedModules(sim: Sim): ModuleDef[] {
    const out: ModuleDef[] = [];
    const db = sim.db?.modules ?? {};
    for (const slot of MODULE_SLOTS) {
      const chosen = this.loadout.modules?.[slot];
      const id = chosen === undefined ? this.def.modules?.[slot]?.default : chosen;
      const m = id ? db[id] : undefined;
      if (m) out.push(m);
    }
    return out;
  }

  /** opt_* 노드: 장착 모듈의 visual.show 에 있는 것만 표시. opt_pylons 는 외부 스테이션에 무장이 있으면 표시 */
  private applyOptionalParts(sim: Sim): void {
    const show = new Set<string>();
    const hide = new Set<string>();
    for (const m of this.installedModules(sim)) {
      for (const n of m.visual?.show ?? []) show.add(n);
      for (const n of m.visual?.hide ?? []) hide.add(n);
    }
    const externalLoaded = this.def.stations.some((st) => !st.internal && (this.loadout.stations?.[st.id]?.count ?? 0) > 0);
    if (externalLoaded) show.add('opt_pylons');
    this.model.traverse((o) => {
      if (o.name.startsWith('opt_')) o.visible = show.has(o.name);
      if (hide.has(o.name)) o.visible = false;
    });
  }

  private readAttachPoints(): void {
    const d = this.def.dimensions;
    const root = this.object3d;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.updateMatrixWorld(true);
    const local = (o: THREE.Object3D, out: THREE.Vector3) => root.worldToLocal(o.getWorldPosition(out));

    const nozzles: THREE.Object3D[] = [];
    const tips: Record<'L' | 'R', THREE.Object3D | null> = { L: null, R: null };
    let gun: THREE.Object3D | null = null;
    let cockpit: THREE.Object3D | null = null;
    this.model.traverse((o) => {
      const n = o.name;
      if (!n) return;
      if (n.startsWith('station_')) this.stationLocals.set(n.slice(8), local(o, new THREE.Vector3()));
      else if (/^nozzle(?:_[A-Za-z0-9]+)?$/.test(n) && !(o as THREE.Mesh).isMesh) nozzles.push(o);
      else if (n === 'gun') gun = o;
      else if (n === 'cockpit') cockpit = o;
      else if (n === 'wingtip_L') tips.L = o;
      else if (n === 'wingtip_R') tips.R = o;
      const kind = surfaceKind(n);
      if (kind && !n.startsWith('opt_')) this.animated.push({ node: o, rest: o.quaternion.clone(), kind, side: sideOf(n), extent: extentOf(o) });
    });

    // 스테이션: 모델 empty 우선, 없으면 StationDef.position
    for (const st of this.def.stations) {
      if (!this.stationLocals.has(st.id)) {
        const p = st.position;
        this.stationLocals.set(st.id, p ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3(0, -0.15 * d.height, 0));
      }
    }

    if (nozzles.length) for (const n of nozzles) this.nozzleLocals.push(local(n, new THREE.Vector3()));
    else {
      const count = Math.max(1, this.def.engine.count);
      const z = d.length * 0.47;
      if (count === 1) this.nozzleLocals.push(new THREE.Vector3(0, 0, z));
      else if (count === 2) {
        const x = Math.max(0.5, d.span * 0.05);
        this.nozzleLocals.push(new THREE.Vector3(-x, 0, z), new THREE.Vector3(x, 0, z * 0.95));
      } else {
        for (let i = 0; i < count; i++) {
          const x = ((i - (count - 1) / 2) / ((count - 1) / 2)) * d.span * 0.3;
          this.nozzleLocals.push(new THREE.Vector3(x, -0.3, d.length * 0.1));
        }
      }
    }

    if (gun) local(gun, this.gunLocal);
    else this.gunLocal.set(0.9, 0.25, -d.length * 0.25);
    if (cockpit) local(cockpit, this.cockpitLocal);
    else this.cockpitLocal.set(0, Math.max(0.6, d.height * 0.22), -d.length * 0.3);

    for (const side of ['L', 'R'] as const) {
      const node = tips[side];
      const p = node ? local(node, new THREE.Vector3()) : new THREE.Vector3((side === 'L' ? -0.5 : 0.5) * d.span, 0, d.length * 0.12);
      this.wingtipNodes.push(node);
      this.wingtipRest.push(p.clone());
      this.wingtipLocals.push(p);
    }
  }

  /** 가변익: 날개끝 empty 가 회전한 위치를 다시 읽는다 */
  private refreshWingtips(): void {
    const root = this.object3d;
    root.updateMatrixWorld(true);
    for (let i = 0; i < this.wingtipNodes.length; i++) {
      const n = this.wingtipNodes[i];
      if (!n) continue;
      root.worldToLocal(n.getWorldPosition(this.wingtipLocals[i]));
    }
  }

  // ---------------------------------------------------------------- AircraftLike

  /** 스테이션 장착점 (모델 로컬). 무장 메시 부착용 */
  getStationLocalPosition(stationId: string, out: THREE.Vector3): THREE.Vector3 {
    const p = this.stationLocals.get(stationId);
    return p ? out.copy(p) : out.set(0, -0.15 * this.def.dimensions.height, 0);
  }

  getStationWorldPosition(stationId: string, out: THREE.Vector3): THREE.Vector3 {
    return this.getStationLocalPosition(stationId, out).applyQuaternion(this.quaternion).add(this.position);
  }

  getGunWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.gunLocal).applyQuaternion(this.quaternion).add(this.position);
  }

  getCockpitWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.cockpitLocal).applyQuaternion(this.quaternion).add(this.position);
  }

  private stopFx(): void {
    this.smokeFx?.stop();
    this.fireFx?.stop();
    this.engineFx?.stop();
    this.vaporFx?.stop();
    this.smokeFx = this.fireFx = this.engineFx = this.vaporFx = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFx();
    if (this.isPlayer) this.silenceTones(this.sim);
    this.controller?.dispose?.();
  }
}

/** 표준 중력 하중 계산 보조 (HUD 등): 수직 하중배수 → 선회율 (deg/s) */
export function turnRateDeg(gLoad: number, speed: number): number {
  if (speed < 1) return 0;
  return (Math.sqrt(Math.max(0, gLoad * gLoad - 1)) * G0) / speed / DEG;
}
