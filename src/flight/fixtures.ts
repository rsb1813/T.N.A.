// 비행모듈 단독 테스트/샌드박스용 고정 데이터 (실제 DB 와 무관). F-15/F-16/F-14 계열의 대략적인 공개 수치.
// 게임 본편은 src/data 의 computeStats 결과를 쓴다.
import type { AircraftDef, DerivedStats, Loadout, ModuleSlot } from '../data/schema';
import { DEG } from '../core/math';

function baseStats(over: Partial<DerivedStats>): DerivedStats {
  const s: DerivedStats = {
    massEmptyKg: 10000,
    fuelCapacityKg: 4000,
    fuelKg: 4000,
    storesMassKg: 0,
    totalMassKg: 0,
    wingArea: 30,
    cd0: 0.02,
    storesDragArea: 0,
    k: 0.14,
    clAlpha: 3.5,
    clMax: 1.5,
    aoaMaxDeg: 25,
    waveDragRise: 0.026,
    thrustDryN: 76_000,
    thrustAbN: 129_000,
    tsfcDry: 77,
    tsfcAB: 200,
    spoolTime: 3.5,
    supercruise: false,
    gMax: 9,
    gMin: -3,
    maxMach: 2,
    rollRate: 240 * DEG,
    pitchRate: 26 * DEG,
    yawRate: 14 * DEG,
    cornerSpeed: 170,
    rcs: 1.2,
    ir: 1,
    radar: null,
    irst: null,
    rwr: null,
    maw: null,
    ew: null,
    cms: { chaff: 60, flares: 60 },
    datalink: null,
    helmet: null,
    gun: { weaponId: 'M61A2', rounds: 510 },
    warnings: [],
    ...over,
  };
  s.totalMassKg = s.massEmptyKg + s.fuelKg + s.storesMassKg;
  return s;
}

/** F-15 계열 (쌍발 대형 제공기, AIM-120 4발) */
export const FIXTURE_F15_STATS: DerivedStats = baseStats({
  massEmptyKg: 13_200,
  fuelCapacityKg: 6_100,
  fuelKg: 6_100,
  storesMassKg: 640,
  storesDragArea: 0.1,
  wingArea: 56.5,
  cd0: 0.021,
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
  gMax: 9,
  gMin: -3,
  maxMach: 2.5,
  rollRate: 200 * DEG,
  pitchRate: 28 * DEG,
  yawRate: 14 * DEG,
  cornerSpeed: 185,
  rcs: 10,
  ir: 1.3,
  gun: { weaponId: 'M61A2', rounds: 940 },
});

/** F-16 계열 (단발 경량 다목적, AAM 4발) */
export const FIXTURE_F16_STATS: DerivedStats = baseStats({
  massEmptyKg: 8_900,
  fuelCapacityKg: 3_200,
  fuelKg: 3_200,
  storesMassKg: 500,
  storesDragArea: 0.12,
  wingArea: 27.87,
  cd0: 0.019,
  k: 0.135,
  clAlpha: 3.5,
  clMax: 1.55,
  aoaMaxDeg: 25,
  waveDragRise: 0.026,
  thrustDryN: 76_000,
  thrustAbN: 129_000,
  tsfcDry: 77,
  tsfcAB: 200,
  spoolTime: 3.5,
  gMax: 9,
  gMin: -3,
  maxMach: 2.0,
  rollRate: 240 * DEG,
  pitchRate: 26 * DEG,
  yawRate: 14 * DEG,
  cornerSpeed: 170,
  rcs: 1.2,
  ir: 1,
  gun: { weaponId: 'M61A2', rounds: 510 },
});

/** F-14 계열 (가변익 20°~68°) */
export const FIXTURE_F14_STATS: DerivedStats = baseStats({
  massEmptyKg: 19_800,
  fuelCapacityKg: 7_350,
  fuelKg: 7_350,
  storesMassKg: 900,
  storesDragArea: 0.3,
  wingArea: 52.5,
  cd0: 0.022,
  k: 0.14,
  clAlpha: 3.8,
  clMax: 1.75,
  aoaMaxDeg: 28,
  waveDragRise: 0.03,
  thrustDryN: 122_000,
  thrustAbN: 249_000,
  tsfcDry: 80,
  tsfcAB: 210,
  spoolTime: 4.5,
  gMax: 7.5,
  gMin: -3,
  maxMach: 2.34,
  rollRate: 180 * DEG,
  pitchRate: 24 * DEG,
  yawRate: 12 * DEG,
  cornerSpeed: 165,
  rcs: 12,
  ir: 1.4,
  gun: { weaponId: 'M61A2', rounds: 675 },
});

export const FIXTURE_F14_SWEEP = { minDeg: 20, maxDeg: 68 } as const;

const SLOTS: readonly ModuleSlot[] = ['wing', 'engine', 'radar', 'irst', 'rwr', 'maw', 'ew', 'cms', 'datalink', 'helmet'];

function emptyModules(): AircraftDef['modules'] {
  const m = {} as AircraftDef['modules'];
  for (const s of SLOTS) m[s] = { default: null, allowed: [] };
  return m;
}

/** 샌드박스용 F-16 계열 기체 정의 (모델 id 'f16p' — 없으면 대체 형상) */
export const FIXTURE_F16_DEF: AircraftDef = {
  id: 'fixture_f16',
  name: 'F-16 (fixture)',
  faction: 'NATO',
  playable: false,
  role: 'multirole',
  description: '비행모듈 시험용 고정 데이터',
  model: 'f16p',
  crew: 1,
  dimensions: { length: 15.1, span: 10.0, height: 5.1 },
  mass: { empty: 8_900, internalFuel: 3_200, maxTakeoff: 21_700 },
  aero: { wingArea: 27.87, cd0: 0.019, k: 0.135, clAlpha: 3.5, clMax: 1.55, aoaMaxDeg: 25, waveDragRise: 0.026 },
  engine: { name: 'F110-GE-129', count: 1, dryThrustKN: 76, abThrustKN: 129, tsfcDry: 77, tsfcAB: 200, spoolTime: 3.5 },
  limits: { gMax: 9, gMin: -3, maxMach: 2, rollRateDeg: 240, pitchRateDeg: 26, yawRateDeg: 14, cornerSpeed: 170 },
  signature: { rcs: 1.2, ir: 1 },
  gun: { weaponId: 'M61A2', rounds: 510 },
  stations: [
    { id: 'L1', label: '좌 날개끝', internal: false, maxMassKg: 200, allowed: ['aam_ir', 'aam_radar'], mirror: 'R1', position: [-4.9, 0, 1.6] },
    { id: 'R1', label: '우 날개끝', internal: false, maxMassKg: 200, allowed: ['aam_ir', 'aam_radar'], mirror: 'L1', position: [4.9, 0, 1.6] },
    { id: 'C', label: '중앙', internal: false, maxMassKg: 1_000, allowed: ['tank', 'pod'], position: [0, -1.1, 0.4] },
  ],
  modules: emptyModules(),
  presets: [],
  unlock: { cost: 0 },
};

export const FIXTURE_F16_LOADOUT: Loadout = {
  aircraftId: 'fixture_f16',
  modules: {},
  stations: { L1: { weaponId: 'AIM-9X', count: 1 }, R1: { weaponId: 'AIM-9X', count: 1 }, C: null },
  fuel: 1,
};
