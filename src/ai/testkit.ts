// AI 모듈 테스트/샌드박스용 경량 목(mock): 시뮬레이션, 지형, 항전/무장 스텁, 단순 미사일·기관포탄.
// 게임 런타임에서는 쓰지 않는다 (실제 무장/항전은 src/combat 이 sim.services.weapons 로 제공).
import * as THREE from 'three';
import type { AircraftLike, Avionics, LaunchZone, LockState, MissileLike, StoreGroup, Stores, Threat, Track } from '../core/contracts';
import { Entity } from '../core/entity';
import { clamp, DEG, G0, interceptPoint } from '../core/math';
import type { FxHandle, FxService, LaunchRequest, TerrainService, WeaponService } from '../core/services';
import { createSim, type Sim } from '../core/sim';
import type { DamageInfo, Faction } from '../core/types';
import type { GameDatabase, GuidanceType, Loadout, WeaponDef } from '../data/schema';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);

// ---------------------------------------------------------------- 지형

/** 평지 (높이 h) */
export function flatTerrain(height = 0, mapRadius = 100_000): TerrainService {
  return {
    heightAt: () => height,
    isWater: () => height <= 0,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    lineOfSight: () => true,
    mapRadius,
  };
}

/**
 * 벽 지형: x 가 wallX 보다 크면 (방향 dir=+1) 높이 wallHeight. 경사 폭 rampM.
 * 북쪽 벽(z 축)도 axis: 'z' 로 가능.
 */
export function wallTerrain(opts: { at: number; height: number; rampM?: number; axis?: 'x' | 'z'; dir?: 1 | -1; base?: number; mapRadius?: number }): TerrainService {
  const ramp = opts.rampM ?? 400;
  const base = opts.base ?? 0;
  const dir = opts.dir ?? 1;
  const h = (x: number, z: number) => {
    const c = (opts.axis === 'z' ? z : x) * dir - opts.at * dir;
    return base + opts.height * clamp(c / ramp + 0.5, 0, 1);
  };
  return {
    heightAt: h,
    isWater: () => false,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    lineOfSight: (a, b) => {
      for (let i = 1; i < 16; i++) {
        _v.lerpVectors(a, b, i / 16);
        if (_v.y < h(_v.x, _v.z)) return false;
      }
      return true;
    },
    mapRadius: opts.mapRadius ?? 100_000,
  };
}

// ---------------------------------------------------------------- 시뮬레이션

export interface TestSimOptions {
  db?: GameDatabase;
  seed?: number;
  terrain?: TerrainService;
}

/** 목 서비스가 연결된 시뮬레이션. weapons 는 createMockWeaponService 결과 */
export function createAITestSim(opts: TestSimOptions = {}): { sim: Sim; weapons: MockWeaponService } {
  const db = opts.db ?? { aircraft: {}, weapons: {}, modules: {}, units: {} };
  const sim = createSim({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), db, seed: opts.seed ?? 3 });
  sim.services.terrain = opts.terrain ?? flatTerrain(0);
  sim.services.fx = recordingFx();
  const weapons = createMockWeaponService(sim);
  sim.services.weapons = weapons;
  return { sim, weapons };
}

/** n 초 동안 고정 스텝 진행 (Game.stepFixed 와 같은 순서) */
export function stepSim(sim: Sim, seconds: number, each?: (t: number) => void, dt = 1 / 60): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    sim.time += dt;
    sim.frame++;
    sim.world.step(dt, sim);
    each?.(sim.time);
  }
}

export interface FxRecord {
  explosions: number;
  smokeTrails: number;
  handles: number;
}

export function recordingFx(): FxService & { record: FxRecord } {
  const record: FxRecord = { explosions: 0, smokeTrails: 0, handles: 0 };
  const handle = (): FxHandle => {
    record.handles++;
    return { stop() {} };
  };
  return {
    record,
    explosion: () => {
      record.explosions++;
    },
    missileTrail: handle,
    damageTrail: (_e, kind) => {
      if (kind === 'smoke') record.smokeTrails++;
      return handle();
    },
    tracer() {},
    decoy: handle,
    hit() {},
    afterburner: handle,
    vapor: handle,
    shake() {},
    shakeAmount: 0,
  };
}

// ---------------------------------------------------------------- 항전 스텁

export interface StubAvionics extends Avionics {
  /** 테스트가 직접 켜는 미사일 경보 */
  missileWarning: boolean;
  threats: Threat[];
  tracks: Track[];
  autoDesignate: boolean;
  designated: Entity | null;
  /** 락 규칙: always = 지정 표적이면 즉시 락, range = 무장 사거리 ×1.1 안 + 기수 60° 안, never */
  lockMode: 'always' | 'range' | 'never';
}

export function createStubAvionics(owner: AircraftLike, lockMode: StubAvionics['lockMode'] = 'range'): StubAvionics {
  const lock: LockState = { status: 'none', progress: 0, target: null };
  const av: StubAvionics = {
    radarMode: 'tws',
    tracks: [],
    get target(): Track | null {
      return null;
    },
    threats: [],
    missileWarning: false,
    jammerActive: false,
    autoDesignate: true,
    designated: null,
    lockMode,
    update() {
      if (av.designated && (!av.designated.alive || av.designated.removed)) av.designated = null;
    },
    setRadarMode(m) {
      av.radarMode = m;
    },
    cycleTarget() {},
    targetNearestToBoresight() {},
    designate(e) {
      av.designated = e;
    },
    lockState(weapon: WeaponDef | null): LockState {
      const t = av.designated;
      lock.target = null;
      lock.progress = 0;
      lock.status = 'none';
      if (!weapon || !t || !t.alive) return lock;
      let ok = av.lockMode === 'always';
      if (av.lockMode === 'range') {
        const range = owner.position.distanceTo(t.position);
        const max = (weapon.envelope?.rMaxKm ?? weapon.guidance?.seekerRangeKm ?? 5) * 1000 * 1.1;
        owner.getForward(_v);
        _w.subVectors(t.position, owner.position).normalize();
        const off = Math.acos(clamp(_v.dot(_w), -1, 1)) / DEG;
        ok = range <= max && off <= Math.max(60, weapon.guidance?.offBoresightDeg ?? 0);
      }
      lock.status = ok ? 'locked' : 'searching';
      lock.progress = ok ? 1 : 0;
      lock.target = ok ? t : null;
      return lock;
    },
    isTracked: (e) => av.designated === e,
  };
  Object.defineProperty(av, 'target', {
    get(): Track | null {
      const e = av.designated;
      if (!e) return null;
      return { entity: e, id: e.id, position: e.position, velocity: e.velocity, source: 'radar', lastUpdate: 0, quality: 1, identified: true, hostile: true, rangeM: owner.position.distanceTo(e.position) };
    },
  });
  return av;
}

// ---------------------------------------------------------------- 무장 스텁

export interface StubStores extends Stores {
  flaresDropped: number;
  chaffDropped: number;
  fired: Array<{ weaponId: string; target: Entity | null; time: number }>;
  gunTrigger: boolean;
}

/** 로드아웃(또는 무장 목록)에서 스토어 묶음 생성. pod/tank 는 제외 */
export function groupsFromLoadout(loadout: Loadout, db: GameDatabase): StoreGroup[] {
  const map = new Map<string, StoreGroup>();
  for (const [station, load] of Object.entries(loadout.stations)) {
    if (!load || load.count <= 0) continue;
    const def = db.weapons[load.weaponId];
    if (!def || def.category === 'pod' || def.category === 'tank') continue;
    let g = map.get(def.id);
    if (!g) map.set(def.id, (g = { weaponId: def.id, def, count: 0, stations: [] }));
    g.count += load.count;
    g.stations.push(station);
  }
  return [...map.values()];
}

/**
 * Stores 스텁. fire() 는 sim.services.weapons.launch 로 발사 요청을 보낸다 (목 무장 서비스가 기록/비행).
 * 기관포는 setGunTrigger 가 켜져 있으면 update 에서 weapons.fireGun 을 부른다.
 */
export function createStubStores(owner: AircraftLike, groups: StoreGroup[], opts: { gun?: WeaponDef | null; rounds?: number; flares?: number; chaff?: number } = {}): StubStores {
  let gunTimer = 0;
  const s: StubStores = {
    gun: opts.gun ? { def: opts.gun, rounds: opts.rounds ?? 500, firing: false } : null,
    groups,
    selected: groups.length ? 0 : -1,
    chaff: opts.chaff ?? 40,
    flares: opts.flares ?? 40,
    massKg: 0,
    dragArea: 0,
    rcsAdd: 0,
    externalFuelKg: 0,
    flaresDropped: 0,
    chaffDropped: 0,
    fired: [],
    gunTrigger: false,
    update(dt, sim) {
      const g = s.gun;
      if (!g) return;
      g.firing = s.gunTrigger && g.rounds > 0;
      if (!g.firing) return;
      gunTimer -= dt;
      if (gunTimer > 0) return;
      gunTimer = 0.1;
      const n = Math.min(g.rounds, Math.max(1, Math.round(((g.def.gun?.rpm ?? 6000) / 60) * 0.1)));
      g.rounds -= n;
      owner.getForward(_v);
      owner.getGunWorldPosition(_w);
      sim.services.weapons.fireGun(owner, g.def.id, _w, _v, sim);
    },
    selectNext(dir = 1) {
      if (!s.groups.length) return;
      s.selected = (s.selected + dir + s.groups.length) % s.groups.length;
    },
    selectedDef: () => (s.selected >= 0 ? (s.groups[s.selected]?.def ?? null) : null),
    setGunTrigger(on) {
      s.gunTrigger = on;
    },
    fire(sim) {
      const g = s.groups[s.selected];
      if (!g || g.count <= 0) return null;
      const target = (owner.avionics as StubAvionics).designated ?? null;
      const pos = owner.getStationWorldPosition(g.stations[0] ?? 'C', new THREE.Vector3());
      const e = sim.services.weapons.launch(
        { weaponId: g.weaponId, shooter: owner, target, position: pos, velocity: owner.velocity.clone(), quaternion: owner.quaternion.clone() },
        sim,
      );
      if (e) {
        g.count--;
        s.fired.push({ weaponId: g.weaponId, target, time: sim.time });
      }
      return e;
    },
    dropFlare() {
      if (s.flares <= 0) return;
      s.flares--;
      s.flaresDropped++;
    },
    dropChaff() {
      if (s.chaff <= 0) return;
      s.chaff--;
      s.chaffDropped++;
    },
    jettison() {},
    launchZone(target, sim): LaunchZone | null {
      const def = s.selectedDef();
      if (!def || !target) return null;
      return envelopeZone(def, owner, target, sim);
    },
  };
  return s;
}

/** 무장 envelope(고도 10 km 기준)에서 고도·aspect 를 대충 반영한 발사가능영역 */
export function envelopeZone(def: WeaponDef, shooter: Entity, target: Entity, _sim?: Sim): LaunchZone {
  const env = def.envelope ?? { rMinKm: 0.5, rMaxKm: (def.guidance?.seekerRangeKm ?? 5) * 2, rNezKm: def.guidance?.seekerRangeKm ?? 3 };
  const alt = Math.max(0, (shooter.position.y + target.position.y) / 2);
  const altF = 0.35 + 0.65 * clamp(alt / 10_000, 0, 1.2);
  _v.subVectors(shooter.position, target.position);
  const range = _v.length();
  // 표적이 멀어지는 중이면 사거리 감소
  const closing = range > 1 ? -_w.subVectors(target.velocity, shooter.velocity).dot(_v.normalize().negate()) : 0;
  const aspectF = clamp(0.55 + 0.45 * (closing / 500 + 0.5), 0.35, 1.1);
  const rMax = env.rMaxKm * 1000 * altF * aspectF;
  const rNez = env.rNezKm * 1000 * altF * aspectF;
  const rMin = env.rMinKm * 1000;
  return { rMin, rMax, rNez, range, inRange: range >= rMin && range <= rMax, inNez: range >= rMin && range <= rNez };
}

// ---------------------------------------------------------------- 목 무장 서비스 (단순 미사일·탄)

export interface MockWeaponService extends WeaponService {
  launches: LaunchRequest[];
  gunBursts: Array<{ shooter: Entity; weaponId: string; origin: THREE.Vector3; direction: THREE.Vector3 }>;
  decoys: number;
  /** 미사일/탄 엔티티를 실제로 날린다 (기본 true). false 면 요청만 기록 */
  simulate: boolean;
  /** 명중 시 피해 (HP). 기본 무장 탄두 또는 80 */
  kills: Array<{ victim: Entity; by: Entity | null; weaponId: string }>;
}

/** 단순 미사일: 일정 속도 비례항법, 근접신관 25 m, 대응체계로 확률 기만 */
export class SimpleMissile extends Entity implements MissileLike {
  readonly kind = 'missile' as const;
  readonly guidanceType: GuidanceType;
  motorBurning = true;
  seekerActive = false;
  timeOfFlight = 0;
  private readonly speedMax: number;
  private readonly maxTime: number;
  private decoyCheck = 0;

  constructor(
    readonly def: WeaponDef,
    readonly shooter: Entity | null,
    public target: Entity | null,
    faction: Faction,
    private readonly service: MockWeaponService,
  ) {
    super(faction, def.name);
    this.guidanceType = def.guidance?.type ?? 'none';
    this.targetClass = 'weapon';
    this.radius = 1;
    this.rcs = 0.05;
    this.hp = this.maxHp = 8;
    const cat = def.category;
    this.speedMax = cat === 'aam_ir' ? 800 : cat === 'sam' ? 1000 : cat.startsWith('aam') ? 1100 : 300;
    this.maxTime = cat === 'aam_ir' ? 20 : cat === 'sam' ? 60 : cat.startsWith('aam') ? 45 : 200;
  }

  update(dt: number, sim: Sim): void {
    if (!this.alive) {
      this.removed = true;
      return;
    }
    this.timeOfFlight += dt;
    this.motorBurning = this.timeOfFlight < (this.def.motor ? this.def.motor.boostSec + this.def.motor.sustainSec : 4);
    const t = this.target;
    const V = Math.min(this.speedMax, this.velocity.length() + 250 * dt);
    if (t && t.alive && !t.removed) {
      const range = this.position.distanceTo(t.position);
      const pit = (this.def.guidance?.pitbullKm ?? (this.def.guidance?.seekerRangeKm ?? 10) * 0.6) * 1000;
      this.seekerActive = this.guidanceType === 'active_radar' && range < pit;
      const aim = interceptPoint(this.position, V, t.position, t.velocity, _v) ?? _v.copy(t.position);
      _w.subVectors(aim, this.position).normalize();
      const cur = this.velocity.lengthSq() > 1 ? this.velocity.clone().normalize() : _w.clone();
      const maxTurn = (30 * G0 * dt) / Math.max(V, 100);
      const ang = Math.acos(clamp(cur.dot(_w), -1, 1));
      const f = ang > 1e-6 ? Math.min(1, maxTurn / ang) : 1;
      cur.lerp(_w, f).normalize();
      this.velocity.copy(cur).multiplyScalar(V);
      this.quaternion.setFromUnitVectors(FWD, cur);
      this.decoyCheck -= dt;
      if (this.decoyCheck <= 0) {
        this.decoyCheck = 0.5;
        if (this.seducedBy(t, sim)) this.target = null;
      }
      if (range < 25) {
        this.service.kills.push({ victim: t, by: this.shooter, weaponId: this.def.id });
        t.applyDamage({ amount: this.def.warhead?.damage ?? 80, kind: 'blast', source: this.shooter, weaponId: this.def.id }, sim);
        this.kill(sim);
        this.removed = true;
        return;
      }
    }
    this.position.addScaledVector(this.velocity, dt);
    if (this.timeOfFlight > this.maxTime || this.position.y < sim.services.terrain.heightAt(this.position.x, this.position.z)) {
      this.kill(sim);
      this.removed = true;
    }
  }

  /** 최근 투하한 디코이에 확률적으로 기만 (IR = 플레어, 레이더 = 채프) */
  private seducedBy(t: Entity, sim: Sim): boolean {
    const st = this.service.recentDecoys.get(t.id);
    if (!st || sim.time - st.time > 1.2) return false;
    const want = this.guidanceType === 'ir' ? 'flare' : 'chaff';
    if (st.type !== want) return false;
    const ccm = this.def.guidance?.ccm ?? 0.3;
    return sim.rng.chance((want === 'flare' ? 0.35 : 0.2) * (1 - ccm));
  }

  protected onDestroyed(): void {
    this.removed = true;
  }
}

/** 단순 기관포탄 (경량 시스템 대신 엔티티 없이 서비스가 직접 갱신) */
interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  shooter: Entity;
  weaponId: string;
  damage: number;
}

export function createMockWeaponService(sim: Sim): MockWeaponService & { recentDecoys: Map<number, { type: 'flare' | 'chaff'; time: number }>; stepBullets(dt: number, sim: Sim): void } {
  const bullets: Bullet[] = [];
  const recentDecoys = new Map<number, { type: 'flare' | 'chaff'; time: number }>();
  const svc = {
    launches: [] as LaunchRequest[],
    gunBursts: [] as MockWeaponService['gunBursts'],
    decoys: 0,
    simulate: true,
    kills: [] as MockWeaponService['kills'],
    recentDecoys,
    launch(req: LaunchRequest, s: Sim): Entity | null {
      svc.launches.push({ ...req, position: req.position.clone(), velocity: req.velocity.clone(), quaternion: req.quaternion.clone() });
      const def = s.db.weapons[req.weaponId];
      if (!def || !svc.simulate) return null;
      const m = new SimpleMissile(def, req.shooter, req.target, req.shooter?.faction ?? 'NEUTRAL', svc as unknown as MockWeaponService);
      m.position.copy(req.position);
      m.velocity.copy(req.velocity);
      if (m.velocity.lengthSq() < 100) m.velocity.copy(FWD).applyQuaternion(req.quaternion).multiplyScalar(60);
      m.quaternion.copy(req.quaternion);
      s.world.add(m, s);
      s.events.emit('weaponLaunched', { weapon: m, shooter: req.shooter, target: req.target, weaponId: req.weaponId });
      return m;
    },
    fireGun(shooter: Entity, weaponId: string, origin: THREE.Vector3, direction: THREE.Vector3, s: Sim): void {
      svc.gunBursts.push({ shooter, weaponId, origin: origin.clone(), direction: direction.clone() });
      if (!svc.simulate) return;
      const def = s.db.weapons[weaponId];
      const mv = def?.gun?.muzzleVelocity ?? 1000;
      const disp = (def?.gun?.dispersionMil ?? 5) / 1000;
      for (let i = 0; i < 4; i++) {
        const d = direction.clone().normalize();
        d.x += s.rng.gaussian() * disp;
        d.y += s.rng.gaussian() * disp;
        d.z += s.rng.gaussian() * disp;
        d.normalize();
        bullets.push({
          pos: origin.clone(),
          vel: d.multiplyScalar(mv).add(shooter.velocity),
          life: ((def?.gun?.rangeM ?? 2000) / mv) * 1.6,
          shooter,
          weaponId,
          damage: (def?.gun?.damage ?? 6) * 2,
        });
      }
    },
    dropDecoy(owner: Entity, type: 'flare' | 'chaff'): Entity | null {
      svc.decoys++;
      recentDecoys.set(owner.id, { type, time: sim.time });
      return null;
    },
    createAvionics: (owner: AircraftLike) => createStubAvionics(owner),
    createStores: (owner: AircraftLike) => createStubStores(owner, []),
    applyBlast(center: THREE.Vector3, radiusM: number, damage: number, source: Entity | null, weaponId: string | null, s: Sim): void {
      for (const e of s.world.query({ within: { center, radius: radiusM } })) {
        e.applyDamage({ amount: damage, kind: 'blast', source, weaponId } as DamageInfo, s);
      }
    },
    stepBullets(dt: number, s: Sim): void {
      let w = 0;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        b.life -= dt;
        b.vel.y -= G0 * dt;
        b.pos.addScaledVector(b.vel, dt);
        let hit = false;
        for (const e of s.world.entities) {
          if (!e.alive || e === b.shooter || (e.kind !== 'aircraft' && e.kind !== 'missile')) continue;
          if (!s.relations.isHostile(b.shooter.faction, e.faction)) continue;
          if (e.position.distanceToSquared(b.pos) < (e.radius + 3) ** 2) {
            e.applyDamage({ amount: b.damage, kind: 'kinetic', source: b.shooter, weaponId: b.weaponId }, s);
            if (!e.alive) svc.kills.push({ victim: e, by: b.shooter, weaponId: b.weaponId });
            hit = true;
            break;
          }
        }
        if (!hit && b.life > 0) bullets[w++] = b;
      }
      bullets.length = w;
    },
  };
  // 스텁 Stores/Avionics 가 디코이를 서비스로 기록하도록
  return svc;
}

/** 스텁 Stores 의 dropFlare/dropChaff 를 무장 서비스 기록과 연결 */
export function linkDecoys(stores: StubStores, owner: Entity, sim: Sim): void {
  const flare = stores.dropFlare.bind(stores);
  const chaff = stores.dropChaff.bind(stores);
  stores.dropFlare = (s: Sim) => {
    if (stores.flares > 0) sim.services.weapons.dropDecoy(owner, 'flare', s);
    flare(s);
  };
  stores.dropChaff = (s: Sim) => {
    if (stores.chaff > 0) sim.services.weapons.dropDecoy(owner, 'chaff', s);
    chaff(s);
  };
}

/** 일정 방향으로 날아오는 가짜 미사일 (방어 기동 테스트용) */
export class FakeMissile extends Entity implements MissileLike {
  readonly kind = 'missile' as const;
  motorBurning = true;
  seekerActive = true;
  timeOfFlight = 0;
  constructor(
    readonly def: WeaponDef,
    readonly shooter: Entity | null,
    public target: Entity | null,
    readonly guidanceType: GuidanceType,
    faction: Faction,
  ) {
    super(faction, def.name);
    this.targetClass = 'weapon';
  }
  update(dt: number): void {
    this.timeOfFlight += dt;
    const t = this.target;
    if (t) {
      _v.subVectors(t.position, this.position).normalize().multiplyScalar(Math.max(this.velocity.length(), 600));
      this.velocity.copy(_v);
    }
    this.position.addScaledVector(this.velocity, dt);
  }
}
