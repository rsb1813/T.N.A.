// HUD 샌드박스: 상자 표적 + 가짜(mock) 플레이어 AircraftLike 로 HUD 상태별 화면을 만든다.
//   sandbox/hud.html?state=normal|lock|locking|ground|missile|radio|gun|ccip|warn|nopilot
//   추가: &units=metric  &mouse=1 (마우스 에임 조준원)  &frames=N (성능 측정 프레임 수)
// window.__report = { state, avgMs, maxMs, frames } (HUD update 1회 평균/최대 시간)
import * as THREE from 'three';
import type {
  AircraftController,
  AircraftDamageState,
  AircraftLike,
  Avionics,
  ControlInput,
  FlightTelemetry,
  LaunchZone,
  LockState,
  RadarMode,
  StoreGroup,
  Stores,
  Threat,
  Track,
} from '../src/core/contracts';
import { Entity } from '../src/core/entity';
import { Game } from '../src/core/game';
import { atmosphere, DEG, headingToDir, quatFromHeadingPitch, tasToIas } from '../src/core/math';
import type { MissionState, TerrainService } from '../src/core/services';
import { createSim, type Sim } from '../src/core/sim';
import type { EntityKind, Faction, TargetClass } from '../src/core/types';
import { getModel, preloadModels } from '../src/core/assets';
import type { AircraftDef, DerivedStats, GameDatabase, Loadout, WeaponDef } from '../src/data/schema';
import { Hud } from '../src/ui/hud';

declare global {
  interface Window {
    __ready?: boolean;
    __report?: unknown;
  }
}

const q = new URLSearchParams(location.search);
const STATE = q.get('state') ?? 'normal';
const emptyDb: GameDatabase = { aircraft: {}, weapons: {}, modules: {}, units: {} };

// ---------------------------------------------------------------- 무장 정의 (샌드박스 전용 최소 값)

function weapon(id: string, over: Partial<WeaponDef> & Pick<WeaponDef, 'category'>): WeaponDef {
  return { id, name: id, description: '', users: ['NATO'], massKg: 150, dragArea: 0.02, rcsAdd: 0.05, unlock: { cost: 0 }, ...over };
}

const W = {
  gun: weapon('M61A2', {
    category: 'gun',
    gun: { caliberMm: 20, rpm: 6000, muzzleVelocity: 1030, damage: 8, dispersionMil: 5, rangeM: 1800 },
  }),
  aim120d: weapon('AIM-120D', { category: 'aam_radar', massKg: 161, envelope: { rMinKm: 1.2, rMaxKm: 62, rNezKm: 22 } }),
  aim9x: weapon('AIM-9X', { category: 'aam_ir', massKg: 85, envelope: { rMinKm: 0.4, rMaxKm: 16, rNezKm: 6 } }),
  gbu31: weapon('GBU-31', { category: 'bomb_gps', massKg: 934, envelope: { rMinKm: 1.5, rMaxKm: 24, rNezKm: 24 } }),
  agm88: weapon('AGM-88E', { category: 'arm', massKg: 360, envelope: { rMinKm: 3, rMaxKm: 110, rNezKm: 40 } }),
  mk82: weapon('Mk 82', { category: 'bomb_dumb', massKg: 241, body: { diameterM: 0.273, lengthM: 2.2, cd0: 0.25, maxG: 0 } }),
};

// ---------------------------------------------------------------- 가짜 엔티티

class Dummy extends Entity {
  readonly kind: EntityKind;
  constructor(kind: EntityKind, faction: Faction, name: string, tc: TargetClass, obj: THREE.Object3D) {
    super(faction, name);
    this.kind = kind;
    this.targetClass = tc;
    this.object3d = obj;
  }
  update(): void {}
}

class MockAvionics implements Avionics {
  radarMode: RadarMode = 'tws';
  tracks: Track[] = [];
  target: Track | null = null;
  threats: Threat[] = [];
  missileWarning = false;
  jammerActive = false;
  lock: LockState = { status: 'none', progress: 0, target: null };
  update(): void {}
  setRadarMode(mode: RadarMode): void {
    this.radarMode = mode;
  }
  cycleTarget(): void {}
  targetNearestToBoresight(): void {}
  designate(e: Entity | null): void {
    this.target = this.tracks.find((t) => t.entity === e) ?? null;
  }
  lockState(): LockState {
    return this.lock;
  }
  isTracked(e: Entity): boolean {
    return this.tracks.some((t) => t.entity === e);
  }
}

class MockStores implements Stores {
  gun: { def: WeaponDef; rounds: number; firing: boolean } | null = { def: W.gun, rounds: 940, firing: false };
  groups: StoreGroup[] = [];
  selected = 0;
  chaff = 30;
  flares = 30;
  massKg = 0;
  dragArea = 0;
  rcsAdd = 0;
  externalFuelKg = 0;
  constructor(private readonly owner: () => AircraftLike) {}
  update(): void {}
  selectNext(): void {}
  selectedDef(): WeaponDef | null {
    return this.groups[this.selected]?.def ?? null;
  }
  setGunTrigger(on: boolean): void {
    if (this.gun) this.gun.firing = on;
  }
  fire(): Entity | null {
    return null;
  }
  dropFlare(): void {}
  dropChaff(): void {}
  jettison(): void {}
  launchZone(target: Entity | null): LaunchZone | null {
    const env = this.selectedDef()?.envelope;
    if (!target || !env) return null;
    const range = this.owner().position.distanceTo(target.position);
    const rMin = env.rMinKm * 1000;
    const rMax = env.rMaxKm * 1000;
    const rNez = env.rNezKm * 1000;
    return { rMin, rMax, rNez, range, inRange: range >= rMin && range <= rMax, inNez: range >= rMin && range <= rNez };
  }
}

function makeStats(): DerivedStats {
  return {
    massEmptyKg: 15000,
    fuelCapacityKg: 10000,
    fuelKg: 10000,
    storesMassKg: 1500,
    totalMassKg: 26500,
    wingArea: 56.5,
    cd0: 0.021,
    storesDragArea: 0.2,
    k: 0.16,
    clAlpha: 3.6,
    clMax: 1.6,
    aoaMaxDeg: 25,
    waveDragRise: 0.028,
    thrustDryN: 152_000,
    thrustAbN: 262_000,
    tsfcDry: 78,
    tsfcAB: 205,
    spoolTime: 4,
    supercruise: false,
    gMax: 9,
    gMin: -3,
    maxMach: 2.5,
    rollRate: 200 * DEG,
    pitchRate: 28 * DEG,
    yawRate: 14 * DEG,
    cornerSpeed: 180,
    rcs: 10,
    ir: 1.3,
    radar: { type: 'AESA', rangeKm: 180, azimuthDeg: 60, maxTracks: 20, maxGuided: 8, lpi: 0.6, eccm: 0.7, groundModes: true },
    irst: null,
    rwr: { bearingErrorDeg: 3, identify: true, launchWarning: true, lpiDetect: 0.5 },
    maw: { rangeKm: 10, coverage: 'full', timeToImpact: true },
    ew: { jamPower: 0.6, coverageDeg: 60, towedDecoys: 0 },
    cms: { chaff: 30, flares: 30 },
    datalink: { kind: 'Link16', rangeKm: 300, shareTracks: true, cooperativeEngagement: true },
    helmet: { offBoresightDeg: 80 },
    gun: { weaponId: 'M61A2', rounds: 940 },
    warnings: [],
  };
}

class MockAircraft extends Entity implements AircraftLike {
  readonly kind = 'aircraft' as const;
  readonly def: AircraftDef;
  readonly loadout: Loadout = { aircraftId: 'f15ex', modules: {}, stations: {}, fuel: 1 };
  stats = makeStats();
  readonly controls: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, afterburner: false, airbrake: false };
  readonly telemetry: FlightTelemetry = {
    speed: 0,
    ias: 0,
    mach: 0,
    altitude: 0,
    agl: 0,
    verticalSpeed: 0,
    aoaDeg: 0,
    sideslipDeg: 0,
    gLoad: 1,
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    throttle: 0.8,
    afterburner: false,
    fuelKg: 6000,
    fuelFraction: 0.6,
    thrustN: 0,
    dragN: 0,
    specificExcessPower: 0,
    stalled: false,
    overG: false,
    sweepDeg: null,
  };
  readonly avionics = new MockAvionics();
  readonly stores: MockStores;
  readonly damageState: AircraftDamageState = { engine: 0, wings: 0, control: 0, fuelLeak: false, onFire: false };
  controller: AircraftController | null = null;
  skill = null;

  constructor() {
    super('NATO', 'F-15EX Eagle II');
    this.callsign = 'Halberd 1';
    this.isPlayer = true;
    this.def = { id: 'f15ex', name: 'F-15EX Eagle II' } as AircraftDef;
    this.stores = new MockStores(() => this);
  }
  update(): void {}
  getStationWorldPosition(_id: string, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position);
  }
  getGunWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0.9, 0.4, -6).applyQuaternion(this.quaternion).add(this.position);
  }

  /** 자세/속도/텔레메트리 일괄 설정 */
  fly(o: { x: number; z: number; alt: number; heading: number; pitch: number; roll: number; tas: number; aoa?: number; g?: number; agl?: number }): void {
    const aoa = o.aoa ?? 4;
    quatFromHeadingPitch(o.heading, o.pitch, o.roll, this.quaternion);
    this.position.set(o.x, o.alt, o.z);
    this.velocity.set(0, -Math.sin(aoa * DEG), -Math.cos(aoa * DEG)).applyQuaternion(this.quaternion).multiplyScalar(o.tas);
    const atm = atmosphere(o.alt);
    const t = this.telemetry;
    t.speed = o.tas;
    t.ias = tasToIas(o.tas, atm.rho);
    t.mach = o.tas / atm.speedOfSound;
    t.altitude = o.alt;
    t.agl = o.agl ?? o.alt;
    t.verticalSpeed = this.velocity.y;
    t.aoaDeg = aoa;
    t.gLoad = o.g ?? 1;
    t.headingDeg = o.heading;
    t.pitchDeg = o.pitch;
    t.rollDeg = o.roll;
  }
}

class MouseAimMock implements AircraftController {
  readonly aimDirection = new THREE.Vector3();
  update(): void {}
}

// ---------------------------------------------------------------- 장면

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.geometry.translate(0, h / 2, 0);
  return m;
}

function airBox(color = 0x55606a): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(14, 3, 20), new THREE.MeshLambertMaterial({ color }));
}

function track(e: Entity, player: Entity, opts: Partial<Track> = {}): Track {
  return {
    entity: e,
    id: e.id,
    position: e.position.clone(),
    velocity: e.velocity.clone(),
    source: 'radar',
    lastUpdate: 0,
    quality: 1,
    identified: true,
    hostile: e.faction !== player.faction,
    rangeM: e.position.distanceTo(player.position),
    ...opts,
  };
}

function threat(kind: Threat['kind'], source: Entity, bearingDeg: number, label: string, over: Partial<Threat> = {}): Threat {
  return { kind, source, bearingDeg, elevationDeg: 0, rangeM: null, timeToImpact: null, detectedBy: 'rwr', label, ...over };
}

/** 플레이어 기준 오프셋 위치 (방위 deg, 거리 m, 고도차 m) */
function placeRel(e: Entity, p: Entity, heading: number, bearing: number, dist: number, dAlt: number): void {
  const d = headingToDir(heading + bearing);
  e.position.set(p.position.x + d.x * dist, p.position.y + dAlt, p.position.z + d.z * dist);
}

function placeGround(e: Entity, p: Entity, heading: number, bearing: number, dist: number): void {
  const d = headingToDir(heading + bearing);
  e.position.set(p.position.x + d.x * dist, 0, p.position.z + d.z * dist);
}

function setVel(e: Entity, heading: number, speed: number): void {
  headingToDir(heading, e.velocity).multiplyScalar(speed);
}

function missionState(over: Partial<MissionState> = {}): MissionState {
  return {
    id: 'm01',
    title: '작전 01 — 북해의 장벽',
    elapsed: 312,
    timeLeft: null,
    score: 4200,
    kills: 3,
    objectives: [
      { id: 'cap', text: '적 요격기 편대 격추', status: 'active', primary: true, progress: { current: 3, total: 6 } },
      { id: 'sam', text: 'SA-10 방공 진지 파괴', status: 'active', primary: true, progress: { current: 0, total: 2 } },
      { id: 'awacs', text: '아군 AWACS Bellwether 보호', status: 'complete', primary: false },
      { id: 'hidden', text: '숨은 목표', status: 'hidden', primary: false },
    ],
    result: null,
    ...over,
  };
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);
  game.renderer.setPixelRatio(1);
  game.resize();
  const scene = game.scene;
  const camera = game.camera;
  const sim: Sim = createSim({ scene, camera, db: emptyDb, seed: 7 });
  if (q.get('units') === 'metric') sim.settings.units = 'metric';
  const terrain: TerrainService = {
    heightAt: () => 0,
    isWater: () => false,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    lineOfSight: () => true,
    mapRadius: 100_000,
  };
  sim.services.terrain = terrain;
  const mission: { state: MissionState | null; markers: Array<{ x: number; z: number; label: string; kind: string; radius?: number }> } = {
    state: missionState(),
    markers: [],
  };
  sim.services.mission = mission;

  scene.background = new THREE.Color(0x86acd6);
  scene.fog = new THREE.Fog(0x9ab8d8, 20_000, 160_000);
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a5a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400_000, 400_000, 1, 1), new THREE.MeshLambertMaterial({ color: 0x5b7343 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // 지면 격자 (원근감)
  const grid = new THREE.GridHelper(120_000, 60, 0x40552e, 0x4b6236);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 2;
  scene.add(grid);

  await preloadModels(['f15ex']);
  const player = new MockAircraft();
  player.object3d = getModel('f15ex', { kind: 'aircraft', length: 19.4 });
  sim.world.add(player, sim);
  sim.world.player = player;
  const av = player.avionics;
  const st = player.stores;
  st.groups = [
    { weaponId: 'AIM-120D', def: W.aim120d, count: 6, stations: ['L2A', 'R2A', 'CFT_LF', 'CFT_RF', 'CFT_LR', 'CFT_RR'] },
    { weaponId: 'AIM-9X', def: W.aim9x, count: 2, stations: ['L1', 'R1'] },
    { weaponId: 'GBU-31', def: W.gbu31, count: 2, stations: ['L2', 'R2'] },
  ];

  const ui = document.getElementById('ui')!;
  const hud = new Hud(ui);

  const add = <T extends Entity>(e: T): T => sim.world.add(e, sim);
  const hostileAir = (name: string): Dummy => add(new Dummy('aircraft', 'WARSAW', name, 'air', airBox()));
  const radioQueue: Array<{ at: number; fn: () => void }> = [];
  const at = (t: number, fn: () => void): void => {
    radioQueue.push({ at: t, fn });
  };

  const heading = 35;
  switch (STATE) {
    case 'normal':
    default: {
      player.fly({ x: 12_000, z: 30_000, alt: 6200, heading, pitch: 4, roll: 14, tas: 245, g: 1.3 });
      for (const [b, dist, dAlt] of [
        [-8, 52_000, 1500],
        [6, 61_000, 800],
        [14, 58_000, 1200],
      ] as const) {
        const e = hostileAir('Su-35S');
        placeRel(e, player, heading, b, dist, dAlt);
        setVel(e, heading + 180, 260);
        av.tracks.push(track(e, player, { identified: false, quality: 0.8 }));
      }
      const wing = add(new Dummy('aircraft', 'NATO', 'F-15EX Eagle II', 'air', airBox(0x7a8896)));
      wing.callsign = 'Halberd 2';
      placeRel(wing, player, heading, 32, 520, 40);
      setVel(wing, heading, 245);
      av.tracks.push(track(wing, player, { source: 'datalink', hostile: false }));
      av.threats.push(threat('search', player, 62, 'SA-10'), threat('search', player, -120, 'A-50'));
      player.telemetry.throttle = 0.86;
      player.telemetry.fuelFraction = 0.64;
      break;
    }
    case 'lock':
    case 'locking': {
      player.fly({ x: 8000, z: 26_000, alt: 8300, heading, pitch: 3, roll: -6, tas: 290, g: 1.1, aoa: 3 });
      const tgt = hostileAir('Su-35S');
      placeRel(tgt, player, heading, 4, STATE === 'lock' ? 31_000 : 44_000, 600);
      setVel(tgt, heading + 160, 270);
      tgt.tags.add('target');
      const t = track(tgt, player, { identified: true });
      av.tracks.push(t);
      av.target = t;
      for (const [b, dist] of [
        [-6, 38_000],
        [12, 41_000],
      ] as const) {
        const e = hostileAir('Su-35S');
        placeRel(e, player, heading, b, dist, 300);
        setVel(e, heading + 170, 260);
        av.tracks.push(track(e, player, { identified: b > 0 }));
      }
      av.lock = STATE === 'lock' ? { status: 'locked', progress: 1, target: tgt } : { status: 'locking', progress: 0.45, target: tgt };
      av.threats.push(threat('track', tgt, 4, 'Su-35'));
      player.telemetry.afterburner = true;
      player.telemetry.throttle = 1;
      if (STATE === 'lock') {
        // 비행 중인 아군 미사일 1발 (MSL 1 · Ns)
        const msl = add(new Dummy('missile', 'NATO', 'AIM-120D', 'weapon', new THREE.Group()));
        placeRel(msl, player, heading, 3, 9000, 300);
        setVel(msl, heading + 3, 1150);
        Object.assign(msl, { target: tgt, shooter: player });
        at(0.1, () => sim.events.emit('weaponLaunched', { weapon: msl, shooter: player, target: tgt, weaponId: 'AIM-120D' }));
      }
      break;
    }
    case 'ground': {
      const h = 80;
      player.fly({ x: -20_000, z: 10_000, alt: 4600, heading: h, pitch: -9, roll: 3, tas: 230, g: 1, aoa: 3 });
      av.radarMode = 'ag';
      st.selected = 2;
      const mk = (name: string, b: number, dist: number, tc: TargetClass, target: boolean, size: [number, number, number], kind: EntityKind = 'ground'): Dummy => {
        const e = add(new Dummy(kind, 'WARSAW', name, tc, box(size[0], size[1], size[2], target ? 0x6b5a3a : 0x4f4f45)));
        placeGround(e, player, h, b, dist);
        if (target) e.tags.add('target');
        return e;
      };
      const tel = mk('SA-10 TEL', -3, 13_500, 'ground', true, [12, 4, 8]);
      const rad = mk('SA-10 레이더', 4, 14_800, 'ground', true, [10, 6, 10]);
      const trucks = [mk('트럭', -8, 11_000, 'ground', false, [8, 3, 3]), mk('트럭', -9, 11_300, 'ground', false, [8, 3, 3])];
      const fac = mk('공장', 13, 17_000, 'structure', true, [60, 18, 40], 'structure');
      const ship = mk('Slava급 순양함', -22, 26_000, 'sea', false, [20, 12, 180], 'ship');
      const tTel = track(tel, player);
      av.tracks.push(tTel, track(rad, player), ...trucks.map((e) => track(e, player)), track(fac, player), track(ship, player, { identified: false }));
      av.target = tTel;
      av.lock = { status: 'locked', progress: 1, target: tel };
      av.threats.push(threat('track', rad, 3, 'SA-10'), threat('search', player, -40, 'EWR'));
      mission.markers.push({ x: player.position.x - 15_000, z: player.position.z + 18_000, label: '보급', kind: 'friendly', radius: 5000 });
      mission.state = missionState({
        title: '작전 03 — 방공망 제압',
        timeLeft: 422,
        objectives: [
          { id: 'sam', text: 'SA-10 방공 진지 파괴', status: 'active', primary: true, progress: { current: 1, total: 3 } },
          { id: 'fac', text: '미사일 조립 공장 폭격', status: 'active', primary: true },
          { id: 'ship', text: '순양함 접근 금지', status: 'failed', primary: false },
        ],
      });
      break;
    }
    case 'missile': {
      player.fly({ x: 30_000, z: 40_000, alt: 5400, heading: 300, pitch: 6, roll: 68, tas: 205, g: 7.4, aoa: 16 });
      player.telemetry.afterburner = true;
      player.telemetry.throttle = 1;
      player.telemetry.fuelFraction = 0.12;
      player.hp = 64;
      Object.assign(player.damageState, { engine: 0.4, wings: 0.15, control: 0, fuelLeak: true });
      st.flares = 4;
      av.jammerActive = true;
      const m1 = add(new Dummy('missile', 'WARSAW', 'R-77', 'weapon', new THREE.Group()));
      const m2 = add(new Dummy('missile', 'WARSAW', 'R-73', 'weapon', new THREE.Group()));
      const shooter = hostileAir('Su-35S');
      placeRel(shooter, player, 300, -35, 22_000, 900);
      setVel(shooter, 120, 250);
      av.tracks.push(track(shooter, player, { identified: true }));
      av.missileWarning = true;
      av.threats.push(
        threat('missile', m1, 142, 'MSL', { detectedBy: 'maw', timeToImpact: 3.4, rangeM: 3600, elevationDeg: -20 }),
        threat('missile', m2, -96, 'MSL', { detectedBy: 'maw', timeToImpact: 7.8, rangeM: 7200 }),
        threat('launch', shooter, -35, 'Su-35'),
        threat('track', player, 80, 'SA-11'),
        threat('search', player, 20, 'EWR'),
      );
      at(9.6, () => sim.events.emit('damaged', { entity: player, info: { amount: 4, kind: 'blast', source: shooter, weaponId: 'R-73' } }));
      break;
    }
    case 'radio': {
      player.fly({ x: 0, z: 20_000, alt: 7000, heading: 10, pitch: 2, roll: -20, tas: 250, g: 1.4 });
      const kill = hostileAir('MiG-29S');
      placeRel(kill, player, 10, -6, 2600, 120);
      setVel(kill, 200, 200);
      const hit = hostileAir('Su-27S');
      placeRel(hit, player, 10, 9, 3400, 60);
      setVel(hit, 150, 230);
      av.tracks.push(track(hit, player));
      at(2.0, () =>
        sim.events.emit('radio', {
          speaker: 'Halberd 2',
          text: '2번기, 좌측 편대 맡겠다.',
          side: 'friendly',
          priority: 0,
        }),
      );
      at(8.4, () =>
        sim.events.emit('radio', {
          speaker: 'AWACS Bellwether',
          text: '할버드 편대, 북동쪽 120 해리에서 미확인 고속 편대 접근 중. 팍스 임페리알리스 실험기로 추정된다. 무장 자유, 교전을 허가한다.',
          side: 'command',
          priority: 2,
        }),
      );
      at(8.6, () => sim.events.emit('radio', { speaker: 'Sceptre 1', text: '나토의 개들이 또 왔군.', side: 'enemy', priority: 1 }));
      at(9.1, () => sim.events.emit('damaged', { entity: hit, info: { amount: 10, kind: 'kinetic', source: player, weaponId: 'M61A2' } }));
      at(9.3, () => {
        kill.alive = false;
        sim.events.emit('destroyed', { entity: kill, by: player, weaponId: 'AIM-9X', cause: 'blast' });
        mission.state!.score += 1200;
        mission.state!.kills += 1;
        mission.state!.objectives[0].progress = { current: 4, total: 6 };
      });
      at(9.35, () => sim.events.emit('objectiveChanged', { id: 'cap' }));
      at(8.0, () => {
        mission.state!.objectives[1].status = 'complete';
        sim.events.emit('objectiveChanged', { id: 'sam' });
      });
      break;
    }
    case 'gun': {
      player.fly({ x: 5000, z: 5000, alt: 4200, heading: 20, pitch: 8, roll: 35, tas: 210, g: 5.2, aoa: 10 });
      const tgt = hostileAir('MiG-29S');
      placeRel(tgt, player, 20, 6, 720, 120);
      setVel(tgt, 95, 200);
      const t = track(tgt, player);
      av.tracks.push(t);
      av.target = t;
      st.selected = 1;
      av.lock = { status: 'locked', progress: 1, target: tgt };
      st.setGunTrigger(true);
      st.gun!.rounds = 512;
      break;
    }
    case 'ccip': {
      const h = 120;
      player.fly({ x: -5000, z: -8000, alt: 1700, heading: h, pitch: -24, roll: 0, tas: 220, g: 1, aoa: 2 });
      st.groups = [
        { weaponId: 'Mk 82', def: W.mk82, count: 6, stations: ['L2', 'R2'] },
        { weaponId: 'AIM-9X', def: W.aim9x, count: 2, stations: ['L1', 'R1'] },
      ];
      st.selected = 0;
      av.radarMode = 'ag';
      for (const [b, dist] of [
        [-2, 4300],
        [3, 4500],
        [8, 5200],
      ] as const) {
        const e = add(new Dummy('ground', 'WON', 'ZU-23', 'ground', box(5, 2.5, 5, 0x4f4a3c)));
        placeGround(e, player, h, b, dist);
        e.tags.add('target');
      }
      break;
    }
    case 'warn': {
      // 저고도 급강하 + 실속 + 작전 구역 이탈 + 마우스 에임
      player.fly({ x: 98_000, z: 30_000, alt: 260, heading: 60, pitch: -18, roll: -25, tas: 120, g: 0.6, aoa: 22, agl: 240 });
      player.telemetry.stalled = true;
      player.telemetry.fuelFraction = 0.08;
      player.telemetry.throttle = 0.35;
      sim.settings.controlMode = 'mouseAim';
      const ctl = new MouseAimMock();
      ctl.aimDirection.set(0, 0, -1).applyQuaternion(quatFromHeadingPitch(75, 4, 0));
      player.controller = ctl;
      mission.state = missionState({ timeLeft: 48 });
      break;
    }
    case 'nopilot': {
      sim.world.player = null;
      player.object3d.visible = false;
      camera.position.set(0, 3000, 0);
      camera.lookAt(0, 2800, -10_000);
      at(8.5, () =>
        sim.events.emit('radio', {
          speaker: 'HQ Citadel',
          text: '전 기, 귀환하라. 작전은 종료되었다.',
          side: 'command',
          priority: 1,
        }),
      );
      at(9.0, () => sim.events.emit('missionEnded', { result: 'success' }));
      break;
    }
  }

  if (q.get('mouse') === '1' && STATE !== 'warn') {
    sim.settings.controlMode = 'mouseAim';
    const ctl = new MouseAimMock();
    ctl.aimDirection.set(0, 0, -1).applyQuaternion(player.quaternion).applyAxisAngle(new THREE.Vector3(0, 1, 0), -6 * DEG);
    player.controller = ctl;
  }

  // 추적 카메라: 기체 뒤 34 m, 위 7 m, 기수 방향
  if (sim.world.player) {
    const back = new THREE.Vector3(0, 7, 34).applyQuaternion(player.quaternion);
    camera.position.copy(player.position).add(back);
    camera.quaternion.copy(player.quaternion);
  }
  camera.updateMatrixWorld();
  sim.world.syncObjects();

  // HUD 시계를 10.05 s 까지 진행 (깜빡임 위상이 '켜짐'인 시점), 예약 이벤트 발생
  const dt = 1 / 30;
  let t = 0;
  radioQueue.sort((a, b) => a.at - b.at);
  let qi = 0;
  const end = 10.05;
  while (t < end - 1e-9) {
    const step = Math.min(dt, end - t);
    t += step;
    while (qi < radioQueue.length && radioQueue[qi].at <= t) radioQueue[qi++].fn();
    hud.update(step, sim);
  }

  // 성능: HUD update 반복 (dt = 0 → 상태 고정)
  const frames = Number(q.get('frames') ?? 60);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < frames; i++) {
    hud.update(0, sim);
    sum += hud.lastFrameMs;
    max = Math.max(max, hud.lastFrameMs);
  }
  game.renderer.render(scene, camera);
  window.__report = { state: STATE, avgMs: +(sum / Math.max(1, frames)).toFixed(3), maxMs: +max.toFixed(3), frames };
  requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
}

main().catch((err) => {
  console.error(err);
  window.__report = { error: String(err) };
  window.__ready = true;
});
