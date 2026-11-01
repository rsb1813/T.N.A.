// data 모듈 공개 API.
//
//   import { DB, computeStats, validateLoadout, presetLoadout } from '../data';
//   const loadout = presetLoadout('f15ex', 'strike');           // 프리셋 (연료 100%)
//   const check = validateLoadout(loadout);                      // { ok, errors[], warnings[] } (전술핵은 { allowNuclear: true } 일 때만)
//   const stats = computeStats(loadout);                         // DerivedStats (모듈/무장/연료 반영, 경고 포함)
//   const perf = performanceSummary(stats, { variableSweep: DB.aircraft.f15ex.variableSweep }); // 격납고 성능 표시
//
// 모듈 선택: loadout.modules[slot] === undefined → 기체 기본값, null → 미장착.
// 미사일 기준 운동 모델(ballistics)은 envelope 보정 기준이며 combat 이 그대로 써도 된다.
export * from './schema';
export { DB } from './db';
export { AIRCRAFT, PLAYER_AIRCRAFT, ENEMY_AIRCRAFT, PLAYER_AIRCRAFT_IDS } from './aircraft';
export { WEAPONS, WEAPON_CATEGORY_NAMES, AAM_CATEGORIES, AG_CATEGORIES } from './weapons';
export { MODULES, modulesInSlot } from './modules';
export { UNITS } from './units';
export {
  computeStats,
  validateLoadout,
  presetLoadout,
  emptyLoadout,
  cloneLoadout,
  playableAircraft,
  weaponsForStation,
  modulesForSlot,
  setStationLoad,
  storesMassKg,
  storesDragArea,
  storesRcs,
  externalFuelKg,
  hasExternalStores,
  storesLimitedG,
  stationLimit,
  stationAllows,
  resolveModules,
  selectedModuleId,
  getAircraft,
  findStation,
  OPTIONAL_SLOTS,
  STEALTH_RCS_M2,
  HEAVY_STORES_START_KG,
  HEAVY_STORES_FULL_KG,
  type ValidateOptions,
  type ValidationResult,
  type ResolvedModules,
} from './loadout';
export {
  performanceSummary,
  maxLevelMach,
  levelExcessThrust,
  sustainedTurn,
  instantaneousTurn,
  turnRateDeg,
  iasLimitMach,
  effectiveAero,
  sweepFraction,
  type PerformanceSummary,
  type PerfOptions,
  type TurnResult,
  type VariableSweep,
} from './performance';
export {
  simulateIntercept,
  estimateEnvelope,
  estimateSurfaceToAirRange,
  maxLaunchRange,
  missileDragCoefficient,
  missileDragFactor,
  missileThrust,
  missileMass,
  missileMaxAccel,
  missileReferenceArea,
  motorTotalImpulse,
  referenceLoft,
  MISSILE_CN_ALPHA,
  type InterceptScenario,
  type InterceptResult,
  type EnvelopeEstimate,
} from './ballistics';
