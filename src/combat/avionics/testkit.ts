// 항전 모듈 테스트/샌드박스용 경량 목(mock): 시뮬레이션, 항공기, 지상 유닛, 미사일, 산악 지형, 표본 장비/무장.
// 게임 런타임에서는 쓰지 않는다.
import * as THREE from 'three';
import { Entity } from '../../core/entity';
import { createSim, type Sim } from '../../core/sim';
import { headingToDir, quatFromHeadingPitch } from '../../core/math';
import type {
  AircraftDamageState,
  AircraftLike,
  ControlInput,
  FlightTelemetry,
  LaunchZone,
  MissileLike,
  StoreGroup,
  Stores,
} from '../../core/contracts';
import type { AudioService, SoundId, TerrainService, ToneId } from '../../core/services';
import type { EntityKind, Faction } from '../../core/types';
import type {
  AircraftDef,
  DatalinkStats,
  DerivedStats,
  EwStats,
  GameDatabase,
  GuidanceType,
  HelmetStats,
  IrstStats,
  Loadout,
  MawStats,
  RadarStats,
  RwrStats,
  StationLoad,
  WeaponDef,
} from '../../data/schema';
import { AircraftAvionics } from './avionics';

// ---------------------------------------------------------------- 표본 장비

export const SAMPLE_RADAR: Record<'aesa' | 'pd' | 'pesa', RadarStats> = {
  /** AN/APG-82(V)1 급 AESA */
  aesa: { type: 'AESA', rangeKm: 150, azimuthDeg: 60, maxTracks: 20, maxGuided: 8, lpi: 0.7, eccm: 0.6, groundModes: true },
  /** AN/APG-63(V)1 급 PD */
  pd: { type: 'PD', rangeKm: 110, azimuthDeg: 60, maxTracks: 6, maxGuided: 2, lpi: 0, eccm: 0.3, groundModes: false },
  /** N035 Irbis 급 PESA */
  pesa: { type: 'PESA', rangeKm: 170, azimuthDeg: 60, maxTracks: 30, maxGuided: 8, lpi: 0.2, eccm: 0.5, groundModes: true },
};

export const SAMPLE_IRST: IrstStats = { rangeKm: 60, fovDeg: 70 };
export const SAMPLE_RWR: Record<'modern' | 'legacy', RwrStats> = {
  modern: { bearingErrorDeg: 8, identify: true, launchWarning: true, lpiDetect: 0.5 },
  legacy: { bearingErrorDeg: 20, identify: false, launchWarning: true, lpiDetect: 0.1 },
};
export const SAMPLE_MAW: Record<'full' | 'rear', MawStats> = {
  full: { rangeKm: 10, coverage: 'full', timeToImpact: true },
  rear: { rangeKm: 8, coverage: 'rear', timeToImpact: false },
};
export const SAMPLE_EW: Record<'strong' | 'forward' | 'towed', EwStats> = {
  strong: { jamPower: 0.9, coverageDeg: 180, towedDecoys: 0 },
  forward: { jamPower: 0.8, coverageDeg: 60, towedDecoys: 0 },
  towed: { jamPower: 0.6, coverageDeg: 120, towedDecoys: 2 },
};
export const SAMPLE_DATALINK: DatalinkStats = { kind: 'Link16', rangeKm: 300, shareTracks: true, cooperativeEngagement: true };
export const SAMPLE_HELMET: HelmetStats = { offBoresightDeg: 80 };

// ---------------------------------------------------------------- 표본 무장

export function testWeapon(p: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'category'>): WeaponDef {
  return {
    name: p.id,
    description: '',
    users: ['NATO'],
    massKg: 100,
    dragArea: 0.01,
    rcsAdd: 0.05,
    unlock: { cost: 0 },
    ...p,
  };
}

function guidance(type: GuidanceType, seekerRangeKm: number, gimbalDeg: number, offBoresightDeg: number, extra: Partial<NonNullable<WeaponDef['guidance']>> = {}) {
  return { type, seekerRangeKm, gimbalDeg, offBoresightDeg, navConstant: 4, ccm: 0.5, ...extra };
}

export const SAMPLE_WEAPONS = {
  aim9x: testWeapon({ id: 'AIM-9X', category: 'aam_ir', guidance: guidance('ir', 18, 90, 90), envelope: { rMinKm: 0.3, rMaxKm: 35, rNezKm: 10 } }),
  aim9m: testWeapon({ id: 'AIM-9M', category: 'aam_ir', guidance: guidance('ir', 12, 27, 27), envelope: { rMinKm: 0.3, rMaxKm: 18, rNezKm: 6 } }),
  aim120d: testWeapon({
    id: 'AIM-120D',
    category: 'aam_radar',
    guidance: guidance('active_radar', 20, 60, 60, { datalink: true, pitbullKm: 18 }),
    envelope: { rMinKm: 1, rMaxKm: 160, rNezKm: 40 },
  }),
  aim7m: testWeapon({ id: 'AIM-7M', category: 'aam_sarh', guidance: guidance('sarh', 70, 60, 60), envelope: { rMinKm: 1, rMaxKm: 70, rNezKm: 20 } }),
  gbu31: testWeapon({ id: 'GBU-31', category: 'bomb_gps', guidance: guidance('gps', 0, 180, 180), envelope: { rMinKm: 1, rMaxKm: 25, rNezKm: 0 } }),
  gbu12: testWeapon({ id: 'GBU-12', category: 'bomb_laser', guidance: guidance('laser', 8, 30, 30), envelope: { rMinKm: 1, rMaxKm: 12, rNezKm: 0 } }),
  agm65: testWeapon({ id: 'AGM-65D', category: 'agm', guidance: guidance('eo', 20, 40, 40), envelope: { rMinKm: 1, rMaxKm: 25, rNezKm: 0 } }),
  agm88: testWeapon({ id: 'AGM-88E', category: 'arm', guidance: guidance('anti_radiation', 150, 60, 60), envelope: { rMinKm: 2, rMaxKm: 150, rNezKm: 0 } }),
  mk82: testWeapon({ id: 'Mk 82', category: 'bomb_dumb' }),
  sniper: testWeapon({ id: 'AN/AAQ-33', category: 'pod', pod: { kind: 'targeting', laserDesignator: true } }),
} satisfies Record<string, WeaponDef>;

export const TEST_DB: GameDatabase = {
  aircraft: {},
  weapons: Object.fromEntries(Object.values(SAMPLE_WEAPONS).map((w) => [w.id, w])),
  modules: {},
  units: {},
};

// ---------------------------------------------------------------- 지형

export interface Peak {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** 원뿔 산들로 된 지형. lineOfSight 는 구간을 표본 추출해 지면과 비교한다 */
export function mountainTerrain(peaks: Peak[], sampleM = 150): TerrainService {
  const heightAt = (x: number, z: number): number => {
    let h = 0;
    for (const p of peaks) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.radius) h = Math.max(h, p.height * (1 - d / p.radius));
    }
    return h;
  };
  return {
    heightAt,
    isWater: () => false,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    lineOfSight(a, b) {
      const len = a.distanceTo(b);
      const n = Math.max(2, Math.ceil(len / sampleM));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        if (y < heightAt(x, z)) return false;
      }
      return true;
    },
    mapRadius: 300_000,
  };
}

// ---------------------------------------------------------------- 시뮬레이션

export function createTestSim(opts: { seed?: number; terrain?: TerrainService } = {}): Sim {
  const sim = createSim({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), db: TEST_DB, seed: opts.seed ?? 7 });
  if (opts.terrain) sim.services.terrain = opts.terrain;
  return sim;
}

/** 고정 스텝으로 시간을 진행 (엔티티 update → 항전 update) */
export function stepSim(sim: Sim, seconds: number, dt = 1 / 60): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    sim.time += dt;
    sim.frame++;
    sim.world.step(dt, sim);
  }
}

// ---------------------------------------------------------------- 항공기

type Vec3Like = THREE.Vector3 | [number, number, number];
const toVec = (v: Vec3Like, out: THREE.Vector3): THREE.Vector3 => (Array.isArray(v) ? out.set(v[0], v[1], v[2]) : out.copy(v));

export type SensorSuite = Partial<Pick<DerivedStats, 'radar' | 'irst' | 'rwr' | 'maw' | 'ew' | 'cms' | 'datalink' | 'helmet'>>;

export interface TestAircraftOptions {
  faction: Faction;
  /** 기체 이름 (AircraftDef.name) */
  name?: string;
  position?: Vec3Like;
  heading?: number;
  pitch?: number;
  roll?: number;
  speed?: number;
  /** 속도 벡터를 직접 지정 (기수 방향과 별개, 빔 기동 시험 등) */
  velocity?: Vec3Like;
  sensors?: SensorSuite;
  rcs?: number;
  ir?: number;
  radius?: number;
  isPlayer?: boolean;
  tags?: string[];
  afterburner?: boolean;
  /** 선택 무장 */
  weapon?: WeaponDef | null;
  stations?: Record<string, StationLoad | null>;
  /** 항전 생성 여부 (기본 true) */
  avionics?: boolean;
}

export function baseStats(sensors: SensorSuite = {}, rcs = 5, ir = 1): DerivedStats {
  return {
    massEmptyKg: 15000,
    fuelCapacityKg: 6000,
    fuelKg: 6000,
    storesMassKg: 0,
    totalMassKg: 21000,
    wingArea: 56,
    cd0: 0.02,
    storesDragArea: 0,
    k: 0.1,
    clAlpha: 4,
    clMax: 1.6,
    aoaMaxDeg: 28,
    waveDragRise: 0.03,
    thrustDryN: 150_000,
    thrustAbN: 230_000,
    tsfcDry: 75,
    tsfcAB: 190,
    spoolTime: 4,
    supercruise: false,
    gMax: 9,
    gMin: -3,
    maxMach: 2.2,
    rollRate: 4,
    pitchRate: 0.5,
    yawRate: 0.2,
    cornerSpeed: 180,
    rcs,
    ir,
    radar: null,
    irst: null,
    rwr: null,
    maw: null,
    ew: null,
    cms: null,
    datalink: null,
    helmet: null,
    gun: null,
    warnings: [],
    ...sensors,
  };
}

class TestStores implements Stores {
  readonly gun = null;
  readonly groups: StoreGroup[] = [];
  selected = 0;
  chaff = 30;
  flares = 30;
  readonly massKg = 0;
  readonly dragArea = 0;
  readonly rcsAdd = 0;
  externalFuelKg = 0;
  constructor(public weapon: WeaponDef | null) {}
  update(): void {}
  selectNext(): void {}
  selectedDef(): WeaponDef | null {
    return this.weapon;
  }
  setGunTrigger(): void {}
  fire(): Entity | null {
    return null;
  }
  dropFlare(): void {}
  dropChaff(): void {}
  jettison(): void {}
  launchZone(): LaunchZone | null {
    return null;
  }
}

export class TestAircraft extends Entity implements AircraftLike {
  readonly kind = 'aircraft' as const;
  readonly def: AircraftDef;
  readonly loadout: Loadout;
  readonly stats: DerivedStats;
  readonly controls: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, afterburner: false, airbrake: false };
  readonly telemetry: FlightTelemetry;
  readonly avionics!: AircraftAvionics;
  readonly stores: TestStores;
  readonly damageState: AircraftDamageState = { engine: 0, wings: 0, control: 0, fuelLeak: false, onFire: false };
  controller = null;
  skill = null;
  /** false 면 제자리 (속도는 유지 — 도플러/접근 계산용) */
  moving = true;

  constructor(sim: Sim, o: TestAircraftOptions) {
    const name = o.name ?? (o.faction === 'NATO' ? 'F-15EX Eagle II' : 'Su-35S Flanker-E');
    super(o.faction, name);
    this.def = { id: name.toLowerCase(), name, faction: o.faction } as unknown as AircraftDef;
    this.loadout = { aircraftId: this.def.id, modules: {}, stations: o.stations ?? {}, fuel: 1 };
    this.rcs = o.rcs ?? 5;
    this.irSignature = o.ir ?? 1;
    this.radius = o.radius ?? 8;
    this.stats = baseStats(o.sensors, this.rcs, this.irSignature);
    this.isPlayer = !!o.isPlayer;
    for (const t of o.tags ?? []) this.tags.add(t);
    if (o.position) toVec(o.position, this.position);
    quatFromHeadingPitch(o.heading ?? 0, o.pitch ?? 0, o.roll ?? 0, this.quaternion);
    if (o.velocity) toVec(o.velocity, this.velocity);
    else this.velocity.set(0, 0, -1).applyQuaternion(this.quaternion).multiplyScalar(o.speed ?? 250);
    this.telemetry = {
      speed: this.velocity.length(),
      ias: this.velocity.length(),
      mach: this.velocity.length() / 300,
      altitude: this.position.y,
      agl: this.position.y,
      verticalSpeed: 0,
      aoaDeg: 3,
      sideslipDeg: 0,
      gLoad: 1,
      headingDeg: o.heading ?? 0,
      pitchDeg: o.pitch ?? 0,
      rollDeg: o.roll ?? 0,
      throttle: 0.8,
      afterburner: !!o.afterburner,
      fuelKg: 6000,
      fuelFraction: 1,
      thrustN: 0,
      dragN: 0,
      specificExcessPower: 0,
      stalled: false,
      overG: false,
      sweepDeg: null,
    };
    this.stores = new TestStores(o.weapon ?? null);
    sim.world.add(this, sim);
    if (o.avionics !== false) (this as { avionics: AircraftAvionics }).avionics = new AircraftAvionics(this, sim);
  }

  update(dt: number, sim: Sim): void {
    if (!this.alive) return;
    if (this.moving) this.position.addScaledVector(this.velocity, dt);
    this.telemetry.altitude = this.position.y;
    this.telemetry.agl = this.position.y - sim.services.terrain.heightAt(this.position.x, this.position.z);
    this.avionics?.update(dt, sim);
  }

  /** 기수를 점 쪽으로 (롤 0). 속도는 기수 방향으로 크기 유지 */
  pointAt(p: Vec3Like): this {
    const t = toVec(p, new THREE.Vector3()).sub(this.position);
    const heading = (Math.atan2(t.x, -t.z) * 180) / Math.PI;
    const pitch = (Math.atan2(t.y, Math.hypot(t.x, t.z)) * 180) / Math.PI;
    quatFromHeadingPitch(heading, pitch, 0, this.quaternion);
    const s = this.velocity.length();
    this.velocity.set(0, 0, -1).applyQuaternion(this.quaternion).multiplyScalar(s);
    return this;
  }

  setHeading(deg: number, speed = this.velocity.length()): this {
    quatFromHeadingPitch(deg, 0, 0, this.quaternion);
    headingToDir(deg, this.velocity).multiplyScalar(speed);
    return this;
  }

  getStationWorldPosition(_id: string, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position);
  }

  getGunWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position);
  }
}

// ---------------------------------------------------------------- 지상 유닛 / 미사일

export interface TestUnitOptions {
  faction: Faction;
  name?: string;
  kind?: Extract<EntityKind, 'ground' | 'ship' | 'structure'>;
  position: Vec3Like;
  heading?: number;
  rcs?: number;
  radius?: number;
  tags?: string[];
}

export class TestUnit extends Entity {
  readonly kind: 'ground' | 'ship' | 'structure';
  constructor(sim: Sim, o: TestUnitOptions) {
    super(o.faction, o.name ?? 'SA-10 레이더');
    this.kind = o.kind ?? 'ground';
    this.targetClass = this.kind === 'ship' ? 'sea' : this.kind === 'structure' ? 'structure' : 'ground';
    toVec(o.position, this.position);
    quatFromHeadingPitch(o.heading ?? 0, 0, 0, this.quaternion);
    this.rcs = o.rcs ?? 15;
    this.radius = o.radius ?? 5;
    for (const t of o.tags ?? []) this.tags.add(t);
    sim.world.add(this, sim);
  }
  update(): void {}
}

export interface TestMissileOptions {
  def: WeaponDef;
  shooter: Entity | null;
  target: Entity | null;
  position: Vec3Like;
  velocity: Vec3Like;
  /** 모터 연소 시간 (s). timeOfFlight 가 이보다 작으면 motorBurning */
  burnSec?: number;
  timeOfFlight?: number;
  seekerActive?: boolean;
  faction?: Faction;
}

export class TestMissile extends Entity implements MissileLike {
  readonly kind = 'missile' as const;
  readonly def: WeaponDef;
  readonly shooter: Entity | null;
  target: Entity | null;
  readonly guidanceType: GuidanceType;
  seekerActive: boolean;
  timeOfFlight: number;
  burnSec: number;
  moving = true;

  constructor(sim: Sim, o: TestMissileOptions) {
    super(o.faction ?? o.shooter?.faction ?? 'WARSAW', o.def.id);
    this.def = o.def;
    this.shooter = o.shooter;
    this.target = o.target;
    this.guidanceType = o.def.guidance?.type ?? 'none';
    this.seekerActive = !!o.seekerActive;
    this.timeOfFlight = o.timeOfFlight ?? 0;
    this.burnSec = o.burnSec ?? 6;
    this.targetClass = 'weapon';
    this.radius = 1;
    this.rcs = 0.05;
    toVec(o.position, this.position);
    toVec(o.velocity, this.velocity);
    sim.world.add(this, sim);
  }

  get motorBurning(): boolean {
    return this.timeOfFlight < this.burnSec;
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.timeOfFlight += dt;
    if (this.moving) this.position.addScaledVector(this.velocity, dt);
  }
}

/** 방위(deg)/수평거리(m)/고도(m) → 월드 좌표 (원점 기준) */
export function polar(bearingDeg: number, rangeM: number, altitude: number, origin = new THREE.Vector3()): THREE.Vector3 {
  return headingToDir(bearingDeg).multiplyScalar(rangeM).add(origin).setY(altitude);
}

// ---------------------------------------------------------------- 오디오

export interface RecordingAudio extends AudioService {
  /** 현재 켜진 경고음 */
  readonly tones: Map<ToneId, boolean>;
  /** 켜진 적이 있는 경고음 */
  readonly everOn: Set<ToneId>;
  readonly played: SoundId[];
}

export function recordingAudio(): RecordingAudio {
  const tones = new Map<ToneId, boolean>();
  const everOn = new Set<ToneId>();
  const played: SoundId[] = [];
  const handle = { set() {}, stop() {} };
  return {
    tones,
    everOn,
    played,
    play: (id) => void played.push(id),
    loop: () => handle,
    setTone(id, on) {
      tones.set(id, on);
      if (on) everOn.add(id);
    },
    setListener() {},
  };
}
