// 정상 비행 성능 추정 (core/aero.ts 공식). 데이터 보정 테스트와 격납고 성능 표시에 쓴다.
//
// 가변익: 비행모델(src/flight)과 같은 자동 스케줄을 쓴다 — 후퇴율 s = clamp((M − 0.4) / 0.8, 0, 1),
//   CLmax × (1 − 0.25 s), k × (1 + 0.3 s), 조파항력 × (1 + 0.6 (1 − s)).
//   (AircraftDef 의 clMax·k 는 최소 후퇴각 값, waveDragRise 는 최대 후퇴각 값)
import { dragCoefficient, engineThrust, waveDragFactor } from '../core/aero';
import { atmosphere, clamp, G0, RAD, RHO0, type Atmosphere } from '../core/math';
import type { DerivedStats } from './schema';

export type VariableSweep = { minDeg: number; maxDeg: number } | null | undefined;

export interface PerfOptions {
  /** 기체 총질량 (kg). 생략 시 빈 무게 + 무장 + fuelFraction × 연료 용량 */
  massKg?: number;
  /** 연료 비율 (massKg 생략 시) 기본 0.5 */
  fuelFraction?: number;
  variableSweep?: VariableSweep;
}

const _atm: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 };

export function sweepFraction(mach: number, sweep: VariableSweep): number {
  return sweep ? clamp((mach - 0.4) / 0.8, 0, 1) : 0;
}

/** 마하에 따른 유효 공력 계수 (가변익 반영) */
export function effectiveAero(stats: DerivedStats, mach: number, sweep: VariableSweep): { k: number; clMax: number; waveDragRise: number } {
  if (!sweep) return { k: stats.k, clMax: stats.clMax, waveDragRise: stats.waveDragRise };
  const s = sweepFraction(mach, sweep);
  return { k: stats.k * (1 + 0.3 * s), clMax: stats.clMax * (1 - 0.25 * s), waveDragRise: stats.waveDragRise * (1 + 0.6 * (1 - s)) };
}

function massOf(stats: DerivedStats, opts: PerfOptions): number {
  return opts.massKg ?? stats.massEmptyKg + stats.storesMassKg + (opts.fuelFraction ?? 0.5) * stats.fuelCapacityKg;
}

/** 수평 정상비행 잉여 추력 (N). afterburner=false 면 군용추력 */
export function levelExcessThrust(stats: DerivedStats, altitudeM: number, mach: number, afterburner: boolean, opts: PerfOptions = {}): number {
  atmosphere(altitudeM, _atm);
  const V = mach * _atm.speedOfSound;
  const q = 0.5 * _atm.rho * V * V;
  const W = massOf(stats, opts) * G0;
  const aero = effectiveAero(stats, mach, opts.variableSweep);
  const cl = W / (q * stats.wingArea);
  const cd = dragCoefficient(cl, mach, stats.cd0, aero.k, aero.waveDragRise);
  const thrust = engineThrust(stats.thrustDryN, stats.thrustAbN, _atm.rho, mach, 1, afterburner);
  return thrust - q * (stats.wingArea * cd + stats.storesDragArea);
}

/**
 * 수평 가속으로 도달하는 최고 마하 (추력 = 항력). 저속에서 위로 훑어 처음 추력이 모자라는 지점을 찾는다
 * (천음속 항력 벽을 못 넘으면 그 아래가 최고속도). 구조 한계(maxIas/maxMach)는 반영하지 않는다.
 */
export function maxLevelMach(stats: DerivedStats, altitudeM: number, afterburner = true, opts: PerfOptions = {}): number {
  atmosphere(altitudeM, _atm);
  const W = massOf(stats, opts) * G0;
  let m = 0.2;
  // 1G 를 낼 수 있는 속도부터 시작
  for (; m < 1; m += 0.01) {
    const q = 0.5 * _atm.rho * (m * _atm.speedOfSound) ** 2;
    if (W / (q * stats.wingArea) < 0.9 * effectiveAero(stats, m, opts.variableSweep).clMax) break;
  }
  const step = 0.01;
  // 최소 속도 부근(항력 곡선 뒷면)은 추력이 모자랄 수 있다 → 처음으로 잉여 추력이 생기는 속도부터
  while (m < 1.0 && levelExcessThrust(stats, altitudeM, m, afterburner, opts) < 0) m += step;
  if (levelExcessThrust(stats, altitudeM, m, afterburner, opts) < 0) return 0;
  while (m < 4 && levelExcessThrust(stats, altitudeM, m + step, afterburner, opts) >= 0) m += step;
  let lo = m;
  let hi = m + step;
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if (levelExcessThrust(stats, altitudeM, mid, afterburner, opts) >= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 구조 한계 지시대기속도를 마하로 (해당 고도) */
export function iasLimitMach(stats: DerivedStats, altitudeM: number): number {
  if (!stats.maxIas) return Infinity;
  atmosphere(altitudeM, _atm);
  return stats.maxIas / Math.sqrt(_atm.rho / RHO0) / _atm.speedOfSound;
}

export interface TurnResult {
  /** 하중배수 (G) */
  loadFactor: number;
  /** 선회율 deg/s */
  rateDeg: number;
  limitedBy: 'thrust' | 'g' | 'lift';
}

/** 지속 선회 (애프터버너 추력 = 항력인 하중배수, gMax·CLmax 로 제한) */
export function sustainedTurn(stats: DerivedStats, altitudeM: number, mach: number, opts: PerfOptions = {}): TurnResult {
  atmosphere(altitudeM, _atm);
  const V = mach * _atm.speedOfSound;
  const q = 0.5 * _atm.rho * V * V;
  const qs = q * stats.wingArea;
  const W = massOf(stats, opts) * G0;
  const aero = effectiveAero(stats, mach, opts.variableSweep);
  const thrust = engineThrust(stats.thrustDryN, stats.thrustAbN, _atm.rho, mach, 1, true);
  const cdAvail = (thrust - q * stats.storesDragArea) / qs - stats.cd0 - aero.waveDragRise * waveDragFactor(mach);
  const cl = Math.sqrt(Math.max(0, cdAvail / aero.k));
  let n = (cl * qs) / W;
  let limitedBy: TurnResult['limitedBy'] = 'thrust';
  if (n > stats.gMax) {
    n = stats.gMax;
    limitedBy = 'g';
  }
  const nLift = (aero.clMax * qs) / W;
  if (n > nLift) {
    n = nLift;
    limitedBy = 'lift';
  }
  return { loadFactor: n, rateDeg: turnRateDeg(n, V), limitedBy };
}

/** 순간 선회 (CLmax 또는 gMax) */
export function instantaneousTurn(stats: DerivedStats, altitudeM: number, mach: number, opts: PerfOptions = {}): TurnResult {
  atmosphere(altitudeM, _atm);
  const V = mach * _atm.speedOfSound;
  const qs = 0.5 * _atm.rho * V * V * stats.wingArea;
  const W = massOf(stats, opts) * G0;
  const nLift = (effectiveAero(stats, mach, opts.variableSweep).clMax * qs) / W;
  const n = Math.min(nLift, stats.gMax);
  return { loadFactor: n, rateDeg: turnRateDeg(n, V), limitedBy: n === stats.gMax ? 'g' : 'lift' };
}

export function turnRateDeg(loadFactor: number, speed: number): number {
  return speed > 0 ? ((G0 * Math.sqrt(Math.max(0, loadFactor * loadFactor - 1))) / speed) * RAD : 0;
}

export interface PerformanceSummary {
  /** 고도 11 km 최고 마하 (애프터버너, 추력 = 항력) */
  maxMachHigh: number;
  /** 해면 최고 마하 (추력 기준) */
  maxMachSeaThrust: number;
  /** 해면 최고 마하 (구조 한계 maxIas·maxMach 반영) */
  maxMachSea: number;
  /** 고도 11 km 군용추력 최고 마하. 1 이상이면 초음속 순항 */
  supercruiseMach: number;
  /** 5,000 m · 마하 0.8 지속 선회 */
  sustainedTurnDeg: number;
  sustainedTurnG: number;
  /** 5,000 m · 마하 0.6 순간 선회 */
  instantTurnDeg: number;
  /** 해면 정지 추력/중량 (애프터버너) */
  thrustToWeight: number;
  /** 날개 하중 kg/m² */
  wingLoading: number;
  massKg: number;
}

/** 격납고/보정용 성능 요약 (기본: 연료 50%, 현재 무장 포함) */
export function performanceSummary(stats: DerivedStats, opts: PerfOptions = {}): PerformanceSummary {
  const mass = massOf(stats, opts);
  const o = { ...opts, massKg: mass };
  const seaThrust = maxLevelMach(stats, 0, true, o);
  const st = sustainedTurn(stats, 5000, 0.8, o);
  return {
    maxMachHigh: Math.min(maxLevelMach(stats, 11000, true, o), Math.max(stats.maxMach, 0)),
    maxMachSeaThrust: seaThrust,
    maxMachSea: Math.min(seaThrust, iasLimitMach(stats, 0), stats.maxMach),
    supercruiseMach: maxLevelMach(stats, 11000, false, o),
    sustainedTurnDeg: st.rateDeg,
    sustainedTurnG: st.loadFactor,
    instantTurnDeg: instantaneousTurn(stats, 5000, 0.6, o).rateDeg,
    thrustToWeight: stats.thrustAbN / (mass * G0),
    wingLoading: mass / stats.wingArea,
    massKg: mass,
  };
}
