// 로드아웃 → 성능 계산, 검증, 프리셋/목록 헬퍼.
//
// 모듈 선택 규칙 (flight/aircraft.ts 와 동일): loadout.modules[slot] 이 undefined 면 기체 기본 모듈, null 이면 미장착.
// 질량: AircraftDef.mass.empty 는 기본 모듈 포함 값이며, 다른 모듈을 고르면 (선택 − 기본) 질량 차이만큼 변한다.
import { DEG, clamp } from '../core/math';
import { DB } from './db';
import type {
  AircraftDef,
  CmsStats,
  DerivedStats,
  EwStats,
  GameDatabase,
  Loadout,
  ModuleDef,
  ModuleSlot,
  StationDef,
  StationLoad,
  StatMods,
  WeaponDef,
} from './schema';
import { MODULE_SLOTS, MODULE_SLOT_NAMES } from './schema';

/** 비워 둘 수 있는 슬롯 (기본값이 null 이 아니어도 미장착 허용) */
export const OPTIONAL_SLOTS: readonly ModuleSlot[] = ['irst', 'maw', 'ew', 'helmet'];

/** 무장 중량에 따른 G 한계 감소가 시작/포화되는 질량 (kg, 외부탱크 연료 포함) */
export const HEAVY_STORES_START_KG = 1000;
export const HEAVY_STORES_FULL_KG = 3000;

/** 이 RCS(m²) 미만 기체는 스텔스기로 보고 외부 무장 경고를 낸다 */
export const STEALTH_RCS_M2 = 0.05;

export type ResolvedModules = Record<ModuleSlot, ModuleDef | null>;

// ---------------------------------------------------------------- 조회

export function getAircraft(aircraftId: string, db: GameDatabase = DB): AircraftDef {
  const def = db.aircraft[aircraftId];
  if (!def) throw new Error(`[data] 알 수 없는 기체 '${aircraftId}'`);
  return def;
}

export function findStation(def: AircraftDef, stationId: string): StationDef | undefined {
  return def.stations.find((s) => s.id === stationId);
}

/** 슬롯별 선택 모듈 id (undefined → 기본값) */
export function selectedModuleId(def: AircraftDef, loadout: Loadout, slot: ModuleSlot): string | null {
  const chosen = loadout.modules?.[slot];
  return chosen === undefined ? (def.modules[slot]?.default ?? null) : chosen;
}

/** 슬롯별 선택 모듈 정의. 없는 id 는 null (validateLoadout 이 오류로 보고) */
export function resolveModules(def: AircraftDef, loadout: Loadout, db: GameDatabase = DB): ResolvedModules {
  const out = {} as ResolvedModules;
  for (const slot of MODULE_SLOTS) {
    const id = selectedModuleId(def, loadout, slot);
    out[slot] = id ? (db.modules[id] ?? null) : null;
  }
  return out;
}

/** 스테이션 개수 상한: limits[무장 id] → limits[분류] → maxCount → 1 */
export function stationLimit(station: StationDef, weapon: WeaponDef): number {
  return station.limits?.[weapon.id] ?? station.limits?.[weapon.category] ?? station.maxCount ?? 1;
}

/** 무장이 이 스테이션 허용 목록에 있는지 (id 또는 분류). 전술핵은 'nuke' 분류로만 허용 */
export function stationAllows(station: StationDef, weapon: WeaponDef): boolean {
  if (weapon.category === 'nuke') return station.allowed.includes('nuke');
  return station.allowed.includes(weapon.id) || station.allowed.includes(weapon.category);
}

// ---------------------------------------------------------------- 무장 합계 (순수 헬퍼)

type Stations = Record<string, StationLoad | null>;

function eachLoad(def: AircraftDef, stations: Stations, db: GameDatabase, fn: (st: StationDef, w: WeaponDef, count: number) => void): void {
  for (const st of def.stations) {
    const load = stations[st.id];
    if (!load || load.count <= 0) continue;
    const w = db.weapons[load.weaponId];
    if (w) fn(st, w, load.count);
  }
}

/** 무장/포드/빈 탱크 질량 합계 (kg, 외부탱크 연료 제외) */
export function storesMassKg(def: AircraftDef, stations: Stations, db: GameDatabase = DB): number {
  let m = 0;
  eachLoad(def, stations, db, (_s, w, n) => (m += w.massKg * n));
  return m;
}

/** 외부 장착 항력 면적 CdA 합계 (m²). 내부 무장창은 0 */
export function storesDragArea(def: AircraftDef, stations: Stations, db: GameDatabase = DB): number {
  let a = 0;
  eachLoad(def, stations, db, (s, w, n) => {
    if (!s.internal) a += w.dragArea * n;
  });
  return a;
}

/** 외부 장착 RCS 증가분 합계 (m²). 내부 무장창은 0 */
export function storesRcs(def: AircraftDef, stations: Stations, db: GameDatabase = DB): number {
  let r = 0;
  eachLoad(def, stations, db, (s, w, n) => {
    if (!s.internal) r += w.rcsAdd * n;
  });
  return r;
}

/** 외부 연료탱크 연료 합계 (kg, 가득 찬 상태) */
export function externalFuelKg(def: AircraftDef, stations: Stations, db: GameDatabase = DB): number {
  let f = 0;
  eachLoad(def, stations, db, (_s, w, n) => (f += (w.tank?.fuelKg ?? 0) * n));
  return f;
}

/** 외부(비내부) 스테이션에 무엇이든 실려 있는지 */
export function hasExternalStores(def: AircraftDef, stations: Stations): boolean {
  return def.stations.some((s) => !s.internal && (stations[s.id]?.count ?? 0) > 0);
}

// ---------------------------------------------------------------- 성능 계산

interface ModTotals {
  thrustMult: number;
  tsfcMult: number;
  cd0Add: number;
  clMaxMult: number;
  kMult: number;
  aoaMaxAdd: number;
  gMaxAdd: number;
  rateMult: number;
  wingAreaAdd: number;
  fuelAddKg: number;
  rcsMult: number;
  irMult: number;
  maxMachAdd: number;
  supercruise: boolean;
  ewPowerAdd: number;
  cmsMult: number;
}

function sumMods(mods: ResolvedModules): ModTotals {
  const t: ModTotals = {
    thrustMult: 1,
    tsfcMult: 1,
    cd0Add: 0,
    clMaxMult: 1,
    kMult: 1,
    aoaMaxAdd: 0,
    gMaxAdd: 0,
    rateMult: 1,
    wingAreaAdd: 0,
    fuelAddKg: 0,
    rcsMult: 1,
    irMult: 1,
    maxMachAdd: 0,
    supercruise: false,
    ewPowerAdd: 0,
    cmsMult: 1,
  };
  for (const slot of MODULE_SLOTS) {
    const m: StatMods | undefined = mods[slot]?.mods;
    if (!m) continue;
    t.thrustMult *= m.thrustMult ?? 1;
    t.tsfcMult *= m.tsfcMult ?? 1;
    t.cd0Add += m.cd0Add ?? 0;
    t.clMaxMult *= m.clMaxMult ?? 1;
    t.kMult *= m.kMult ?? 1;
    t.aoaMaxAdd += m.aoaMaxAdd ?? 0;
    t.gMaxAdd += m.gMaxAdd ?? 0;
    t.rateMult *= m.rateMult ?? 1;
    t.wingAreaAdd += m.wingAreaAdd ?? 0;
    t.fuelAddKg += m.fuelAddKg ?? 0;
    t.rcsMult *= m.rcsMult ?? 1;
    t.irMult *= m.irMult ?? 1;
    t.maxMachAdd += m.maxMachAdd ?? 0;
    t.supercruise ||= !!m.supercruise;
    t.ewPowerAdd += m.ewPowerAdd ?? 0;
    t.cmsMult *= m.cmsMult ?? 1;
  }
  return t;
}

/** 무장 중량(외부탱크 연료 포함)에 따른 G 한계. 1 t 부터 선형 감소해 3 t 에서 무장 G 한계(6.5~7.5)에 도달 */
export function storesLimitedG(cleanGMax: number, heavyKg: number): number {
  const heavyG = Math.min(cleanGMax, clamp(cleanGMax - 2, 6.5, 7.5));
  const t = clamp((heavyKg - HEAVY_STORES_START_KG) / (HEAVY_STORES_FULL_KG - HEAVY_STORES_START_KG), 0, 1);
  return cleanGMax + (heavyG - cleanGMax) * t;
}

const fmt = (v: number, digits = 1) => v.toFixed(digits);
const fmtKg = (v: number) => Math.round(v).toLocaleString('en-US');
const fmtRcs = (v: number) => (v < 0.01 ? v.toExponential(1) : v.toFixed(v < 1 ? 3 : 1));

/** 로드아웃을 적용한 최종 성능 */
export function computeStats(loadout: Loadout, db: GameDatabase = DB): DerivedStats {
  const def = getAircraft(loadout.aircraftId, db);
  const mods = resolveModules(def, loadout, db);
  const t = sumMods(mods);
  const stations: Stations = loadout.stations ?? {};
  const warnings: string[] = [];

  // 질량: 기본 장비 대비 차이
  let massEmpty = def.mass.empty;
  for (const slot of MODULE_SLOTS) {
    const n = slot === 'engine' ? def.engine.count : 1;
    const dflt = def.modules[slot]?.default;
    massEmpty += ((mods[slot]?.massKg ?? 0) - (dflt ? (db.modules[dflt]?.massKg ?? 0) : 0)) * n;
  }

  // 엔진: 모듈에 성능이 있으면 대체
  const e = mods.engine?.engine ?? def.engine;
  const count = def.engine.count;

  // 연료
  const internalFuel = def.mass.internalFuel + t.fuelAddKg;
  const extFuel = externalFuelKg(def, stations, db);
  const fuelCapacity = internalFuel + extFuel;
  const fuelKg = clamp(loadout.fuel ?? 1, 0, 1) * internalFuel + extFuel;

  // 무장
  const storesMass = storesMassKg(def, stations, db);
  const dragArea = storesDragArea(def, stations, db);
  const rcsStores = storesRcs(def, stations, db);
  const totalMass = massEmpty + fuelKg + storesMass;

  // G 한계
  const cleanG = def.limits.gMax + t.gMaxAdd;
  const gMax = storesLimitedG(cleanG, storesMass + extFuel);
  if (gMax < cleanG - 0.05) warnings.push(`무장 중량으로 G 한계 감소 (${fmt(cleanG)} → ${fmt(gMax)} G)`);

  // 신호
  const baseRcs = def.signature.rcs * t.rcsMult;
  const rcs = baseRcs + rcsStores;
  if (baseRcs < STEALTH_RCS_M2 && rcsStores > 0) {
    warnings.push(`외부 무장으로 스텔스 상실 (RCS ${fmtRcs(baseRcs)} → ${fmtRcs(rcs)} m²)`);
  }

  // 센서/항전
  const ewBase = mods.ew?.ew;
  const ew: EwStats | null = ewBase ? { ...ewBase, jamPower: clamp(ewBase.jamPower + t.ewPowerAdd, 0, 1) } : null;
  const cmsBase = mods.cms?.cms;
  const cms: CmsStats | null = cmsBase ? { chaff: Math.round(cmsBase.chaff * t.cmsMult), flares: Math.round(cmsBase.flares * t.cmsMult) } : null;
  const radar = mods.radar?.radar ? { ...mods.radar.radar } : null;

  // 경고
  if (totalMass > def.mass.maxTakeoff) warnings.push(`최대 이륙 중량 초과 (${fmtKg(totalMass)} / ${fmtKg(def.mass.maxTakeoff)} kg)`);
  let needsRadar = false;
  let laserBombs = false;
  let hasDesignator = false;
  eachLoad(def, stations, db, (_s, w) => {
    if (w.category === 'aam_sarh' || (w.category === 'aam_long' && w.guidance?.type === 'sarh')) needsRadar = true;
    if (w.guidance?.type === 'laser') laserBombs = true;
    if (w.pod?.laserDesignator) hasDesignator = true;
  });
  if (needsRadar && !radar) warnings.push('반능동 레이더 미사일을 실었지만 레이더가 없어 유도할 수 없다');
  if (laserBombs && !hasDesignator) warnings.push('레이저 유도 무장: 표적 포드가 없어 아군 조사에 의존해야 한다');
  for (const st of def.stations) {
    if (!st.mirror || st.id > st.mirror) continue;
    const a = loadMass(stations[st.id], db);
    const b = loadMass(stations[st.mirror], db);
    if (Math.abs(a - b) > 700) {
      warnings.push(`좌우 비대칭 장착 (${st.id} ${fmtKg(a)} kg / ${st.mirror} ${fmtKg(b)} kg) — 롤 쏠림`);
    }
  }

  return {
    massEmptyKg: massEmpty,
    fuelCapacityKg: fuelCapacity,
    fuelKg,
    storesMassKg: storesMass,
    totalMassKg: totalMass,
    wingArea: def.aero.wingArea + t.wingAreaAdd,
    cd0: def.aero.cd0 + t.cd0Add,
    storesDragArea: dragArea,
    k: def.aero.k * t.kMult,
    clAlpha: def.aero.clAlpha,
    clMax: def.aero.clMax * t.clMaxMult,
    aoaMaxDeg: def.aero.aoaMaxDeg + t.aoaMaxAdd,
    waveDragRise: def.aero.waveDragRise,
    thrustDryN: e.dryThrustKN * 1000 * count * t.thrustMult,
    thrustAbN: e.abThrustKN * 1000 * count * t.thrustMult,
    tsfcDry: e.tsfcDry * t.tsfcMult,
    tsfcAB: e.tsfcAB * t.tsfcMult,
    spoolTime: e.spoolTime,
    supercruise: t.supercruise,
    gMax,
    gMin: def.limits.gMin,
    maxMach: def.limits.maxMach + t.maxMachAdd,
    rollRate: def.limits.rollRateDeg * t.rateMult * DEG,
    pitchRate: def.limits.pitchRateDeg * t.rateMult * DEG,
    yawRate: def.limits.yawRateDeg * t.rateMult * DEG,
    cornerSpeed: def.limits.cornerSpeed,
    maxIas: def.limits.maxIas,
    rcs,
    ir: def.signature.ir * t.irMult,
    radar,
    irst: mods.irst?.irst ? { ...mods.irst.irst } : null,
    rwr: mods.rwr?.rwr ? { ...mods.rwr.rwr } : null,
    maw: mods.maw?.maw ? { ...mods.maw.maw } : null,
    ew,
    cms,
    datalink: mods.datalink?.datalink ? { ...mods.datalink.datalink } : null,
    helmet: mods.helmet?.helmet ? { ...mods.helmet.helmet } : null,
    gun: def.gun ? { ...def.gun } : null,
    warnings,
  };
}

function loadMass(load: StationLoad | null | undefined, db: GameDatabase): number {
  if (!load || load.count <= 0) return 0;
  const w = db.weapons[load.weaponId];
  return w ? (w.massKg + (w.tank?.fuelKg ?? 0)) * load.count : 0;
}

// ---------------------------------------------------------------- 검증

export interface ValidateOptions {
  /** 전술핵 허용 (미션이 지정할 때만) */
  allowNuclear?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateLoadout(loadout: Loadout, db: GameDatabase = DB, opts: ValidateOptions = { allowNuclear: false }): ValidationResult {
  const errors: string[] = [];
  const def = db.aircraft[loadout.aircraftId];
  if (!def) return { ok: false, errors: [`알 수 없는 기체 '${loadout.aircraftId}'`], warnings: [] };

  if (!(Number.isFinite(loadout.fuel) && loadout.fuel >= 0 && loadout.fuel <= 1)) errors.push(`연료 비율은 0~1 이어야 한다 (${loadout.fuel})`);

  // 모듈
  const occupied = new Map<string, ModuleDef>();
  for (const slot of MODULE_SLOTS) {
    const slotName = MODULE_SLOT_NAMES[slot];
    const spec = def.modules[slot];
    const chosen = loadout.modules?.[slot];
    if (chosen === null) {
      if (spec.default !== null && !OPTIONAL_SLOTS.includes(slot)) errors.push(`${slotName} 모듈은 비울 수 없다`);
      continue;
    }
    const id = chosen === undefined ? spec.default : chosen;
    if (id === null) continue;
    const m = db.modules[id];
    if (!m) {
      errors.push(`${slotName}: 알 수 없는 모듈 '${id}'`);
      continue;
    }
    if (m.slot !== slot) errors.push(`${m.name} 은(는) ${slotName} 슬롯 모듈이 아니다`);
    else if (!spec.allowed.includes(id)) errors.push(`${def.name} 에 ${m.name} 을(를) 장착할 수 없다`);
    if (m.occupiesStation) {
      if (!findStation(def, m.occupiesStation)) errors.push(`${m.name}: ${def.name} 에 ${m.occupiesStation} 스테이션이 없다`);
      else occupied.set(m.occupiesStation, m);
    }
  }

  // 스테이션
  const stations: Stations = loadout.stations ?? {};
  for (const key of Object.keys(stations)) {
    if (!findStation(def, key)) errors.push(`알 수 없는 스테이션 '${key}'`);
  }
  for (const st of def.stations) {
    const load = stations[st.id];
    if (!load || load.count === 0) continue;
    const label = `${st.id}`;
    const w = db.weapons[load.weaponId];
    if (!w) {
      errors.push(`${label}: 알 수 없는 무장 '${load.weaponId}'`);
      continue;
    }
    if (!Number.isInteger(load.count) || load.count < 0) {
      errors.push(`${label}: 잘못된 수량 ${load.count}`);
      continue;
    }
    const occ = occupied.get(st.id);
    if (occ) errors.push(`${label}: ${occ.name} 이(가) 스테이션을 차지하고 있어 ${w.name} 장착 불가`);
    if (w.category === 'gun' || w.category === 'sam' || w.category === 'aaa') {
      errors.push(`${label}: ${w.name} 은(는) 항공기 스테이션 무장이 아니다`);
      continue;
    }
    if (w.category === 'nuke' && !opts.allowNuclear) errors.push(`${label}: 전술핵(${w.name})은 미션이 지정할 때만 장착할 수 있다`);
    if (!stationAllows(st, w)) errors.push(`${label}: ${w.name} 은(는) 이 스테이션에 장착할 수 없다`);
    if (w.aircraftOnly && !w.aircraftOnly.includes(def.id)) errors.push(`${label}: ${w.name} 은(는) ${def.name} 전용 무장이 아니다`);
    if (!w.users.includes(def.faction)) errors.push(`${label}: ${w.name} 은(는) ${def.faction} 이 운용하지 않는다`);
    const limit = stationLimit(st, w);
    if (load.count > limit) errors.push(`${label}: ${w.name} 최대 ${limit} 발 (요청 ${load.count})`);
    const mass = w.massKg * load.count + (w.tank?.fuelKg ?? 0) * load.count;
    if (mass > st.maxMassKg + 1e-6) errors.push(`${label}: 하중 초과 (${fmtKg(mass)} / ${fmtKg(st.maxMassKg)} kg)`);
  }

  let warnings: string[] = [];
  if (errors.length === 0) warnings = computeStats(loadout, db).warnings;
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- 프리셋/목록

export function cloneLoadout(l: Loadout): Loadout {
  const stations: Record<string, StationLoad | null> = {};
  for (const [k, v] of Object.entries(l.stations ?? {})) stations[k] = v ? { weaponId: v.weaponId, count: v.count } : null;
  const out: Loadout = { aircraftId: l.aircraftId, modules: { ...l.modules }, stations, fuel: l.fuel };
  if (l.livery !== undefined) out.livery = l.livery;
  return out;
}

/** 프리셋 로드아웃 (연료 100%). presetId 생략/불일치 시 첫 프리셋 */
export function presetLoadout(aircraftId: string, presetId?: string, db: GameDatabase = DB): Loadout {
  const def = getAircraft(aircraftId, db);
  const preset = (presetId && def.presets.find((p) => p.id === presetId)) || def.presets[0];
  if (!preset) return emptyLoadout(aircraftId, db);
  return cloneLoadout({ aircraftId, modules: preset.modules, stations: preset.stations, fuel: 1 });
}

/** 무장 없음 + 기본 모듈 (연료 100%) */
export function emptyLoadout(aircraftId: string, db: GameDatabase = DB): Loadout {
  getAircraft(aircraftId, db);
  return { aircraftId, modules: {}, stations: {}, fuel: 1 };
}

export function playableAircraft(db: GameDatabase = DB): AircraftDef[] {
  return Object.values(db.aircraft).filter((a) => a.playable);
}

/** 이 스테이션에 장착 가능한 무장 (세력·전용 기체·허용 목록 반영, 전술핵은 allowNuclear 일 때만) */
export function weaponsForStation(aircraftId: string, stationId: string, db: GameDatabase = DB, opts: ValidateOptions = {}): WeaponDef[] {
  const def = getAircraft(aircraftId, db);
  const st = findStation(def, stationId);
  if (!st) return [];
  return Object.values(db.weapons).filter(
    (w) =>
      w.category !== 'gun' &&
      w.category !== 'sam' &&
      w.category !== 'aaa' &&
      (w.category !== 'nuke' || !!opts.allowNuclear) &&
      stationAllows(st, w) &&
      w.users.includes(def.faction) &&
      (!w.aircraftOnly || w.aircraftOnly.includes(def.id)) &&
      w.massKg + (w.tank?.fuelKg ?? 0) <= st.maxMassKg,
  );
}

/** 이 슬롯에 장착 가능한 모듈 */
export function modulesForSlot(aircraftId: string, slot: ModuleSlot, db: GameDatabase = DB): ModuleDef[] {
  const def = getAircraft(aircraftId, db);
  return (def.modules[slot]?.allowed ?? []).map((id) => db.modules[id]).filter((m): m is ModuleDef => !!m);
}

/** 스테이션 장착 (symmetric 이면 대칭 스테이션도 같이). 새 Loadout 반환 */
export function setStationLoad(loadout: Loadout, stationId: string, load: StationLoad | null, symmetric = true, db: GameDatabase = DB): Loadout {
  const def = getAircraft(loadout.aircraftId, db);
  const out = cloneLoadout(loadout);
  const value = load && load.count > 0 ? { weaponId: load.weaponId, count: load.count } : null;
  out.stations[stationId] = value;
  const mirror = findStation(def, stationId)?.mirror;
  if (symmetric && mirror) out.stations[mirror] = value ? { ...value } : null;
  return out;
}
