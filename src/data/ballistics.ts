// 미사일 기준 운동 모델. 무장 데이터(모터·공력)의 사거리 보정(envelope)에 쓰이며,
// combat 모듈이 같은 식을 쓰면 HUD 의 발사가능영역과 실제 비행이 일치한다.
//
// 규약
//   - body.cd0: 영양력 항력계수, 기준면적 = π·d²/4, 마하 2 기준값. 마하에 따른 변화는 missileDragFactor().
//   - 유도항력: (m·aₙ)² / (q·A·CNα)  (CNα = MISSILE_CN_ALPHA, 1/rad, 기준면적 동일)
//   - 최대 기동 가속도: body.maxG·g·min(1, q / q(해면, 마하 2))
//   - 램제트 지속 추력: sustainThrustN 은 고도 10 km 기준. 밀도비^0.5 배 (연료 유량 한계), 마하 1.2 미만에서는 거의 0
//   - 질량: 추진제(motor.propellantKg)가 공칭 총역적에 비례해 소모된다
//   - 2D(사거리-고도) 평면, 비례항법(N = guidance.navConstant) + 중력 보상, loft 면 상승 조준점 사용
import { atmosphere, clamp, G0, RHO0, smoothstep, type Atmosphere } from '../core/math';
import type { WeaponDef } from './schema';

/** 법선력 기울기 (1/rad, 기준면적 π·d²/4) */
export const MISSILE_CN_ALPHA = 20;
const RHO_10KM = 0.41351;
const Q_REF = 0.5 * RHO0 * (2 * 340.294) ** 2;

/** 기준면적 π·d²/4 (m²) */
export function missileReferenceArea(def: WeaponDef): number {
  const d = def.body?.diameterM ?? 0.2;
  return (Math.PI * d * d) / 4;
}

/** cd0 에 곱하는 마하 배율: 아음속 0.55, 천음속 피크(M1.1) 1.45, 마하 2 = 1, 고마하로 갈수록 감소 */
export function missileDragFactor(mach: number): number {
  if (mach <= 0.8) return 0.55;
  if (mach <= 1.1) return 0.55 + 0.9 * smoothstep(0.8, 1.1, mach);
  return 1.45 * Math.pow(1.1 / mach, 0.62);
}

export function missileDragCoefficient(def: WeaponDef, mach: number): number {
  return (def.body?.cd0 ?? 0.5) * missileDragFactor(mach);
}

/** 공칭 총역적 (N·s) */
export function motorTotalImpulse(def: WeaponDef): number {
  const m = def.motor;
  if (!m) return 0;
  return m.boostSec * m.boostThrustN + m.sustainSec * m.sustainThrustN;
}

/** 발사 후 t 초의 추력 (N) */
export function missileThrust(def: WeaponDef, t: number, rho: number, mach: number): number {
  const m = def.motor;
  if (!m || t < 0) return 0;
  if (t < m.boostSec) return m.boostThrustN;
  if (t < m.boostSec + m.sustainSec) {
    if (!m.ramjet) return m.sustainThrustN;
    const density = Math.sqrt(clamp(rho / RHO_10KM, 0.2, 3));
    return m.sustainThrustN * density * (0.1 + 0.9 * smoothstep(1.2, 2.2, mach));
  }
  return 0;
}

/** 발사 후 t 초의 질량 (kg) */
export function missileMass(def: WeaponDef, t: number): number {
  const m = def.motor;
  const prop = m?.propellantKg ?? 0;
  if (!m || prop <= 0) return def.massKg;
  const total = motorTotalImpulse(def);
  if (total <= 0) return def.massKg;
  const tb = clamp(t, 0, m.boostSec);
  const ts = clamp(t - m.boostSec, 0, m.sustainSec);
  const burned = (tb * m.boostThrustN + ts * m.sustainThrustN) / total;
  return def.massKg - prop * clamp(burned, 0, 1);
}

/** 가용 법선 가속도 (m/s²) */
export function missileMaxAccel(def: WeaponDef, rho: number, speed: number): number {
  const q = 0.5 * rho * speed * speed;
  return (def.body?.maxG ?? 20) * G0 * clamp(q / Q_REF, 0, 1);
}

// ---------------------------------------------------------------- 2D 요격 시뮬레이션

export interface InterceptScenario {
  /** 발사 시 수평 거리 (m) */
  rangeM: number;
  launchAltM: number;
  /** 발사 속도 (m/s) — 항공기 속도. 지상 발사는 ~30 */
  launchSpeed: number;
  targetAltM: number;
  /** 표적 수평 속도 (m/s). 음수 = 사수 쪽으로 접근(정면), 양수 = 이탈(꼬리 추격) */
  targetVx: number;
  /** loft 궤도 사용 (생략 시 guidance.loft) */
  loft?: boolean;
  /** 최소 발사 고각 (deg) — 지상 발사대는 경사/수직 발사 */
  minLaunchElevationDeg?: number;
  /** 명중 시 필요한 최소 속도 (m/s). 생략 시 정면 max(1.2|Vt|, 1.2a), 이탈 |Vt| + 150·clamp(35/maxG, 0.8, 1.6) */
  minSpeed?: number;
  maxTime?: number;
  dt?: number;
}

export interface InterceptResult {
  hit: boolean;
  reason: 'hit' | 'slow' | 'ground' | 'timeout' | 'miss';
  time: number;
  speed: number;
  missDistance: number;
  maxAltitude: number;
}

const _atm: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 };

export function simulateIntercept(def: WeaponDef, sc: InterceptScenario): InterceptResult {
  const dt = sc.dt ?? 0.05;
  const maxTime = sc.maxTime ?? def.guidance?.maxTimeSec ?? 240;
  const nav = def.guidance?.navConstant ?? 4;
  const loft = sc.loft ?? !!def.guidance?.loft;
  const area = missileReferenceArea(def);
  const proximity = Math.max(def.warhead?.proximityM ?? 8, 8);
  const vt = sc.targetVx;
  const aT = atmosphere(sc.targetAltM).speedOfSound;
  // 이탈 추격: 기동성이 낮은 미사일일수록 표적의 회피 선회를 따라잡을 속도 여유가 더 필요하다
  const tailMargin = 150 * clamp(35 / Math.max(1, def.body?.maxG ?? 30), 0.8, 1.6);
  const minSpeed = sc.minSpeed ?? (vt < 0 ? Math.max(1.2 * -vt, 1.2 * aT) : vt + tailMargin);
  const burnout = (def.motor?.boostSec ?? 0) + (def.motor?.sustainSec ?? 0);

  let x = 0;
  let y = sc.launchAltM;
  let xt = sc.rangeM;
  const yt = sc.targetAltM;
  const los0 = Math.max(Math.atan2(yt - y, xt - x), (sc.minLaunchElevationDeg ?? -90) * (Math.PI / 180));
  let vx = sc.launchSpeed * Math.cos(los0);
  let vy = sc.launchSpeed * Math.sin(los0);
  let t = 0;
  let maxAlt = y;
  let minDist = Infinity;

  while (t < maxTime) {
    atmosphere(y, _atm);
    const V = Math.hypot(vx, vy);
    const mach = V / _atm.speedOfSound;
    const q = 0.5 * _atm.rho * V * V;
    const mass = missileMass(def, t);
    const thrust = missileThrust(def, t, _atm.rho, mach);

    // 조준점 (loft 면 표적 위쪽으로 올린 가상점)
    const dx = xt - x;
    const dyT = yt - y;
    const R = Math.hypot(dx, dyT);
    // 가상점의 하강 속도는 PN 에 넣지 않는다 (넣으면 조기 강하). 남은 거리가 줄며 시선이 내려가 자연히 강하한다
    const dy = yt + loftOffset(loft, R) - y;
    const Ra = Math.max(1, Math.hypot(dx, dy));
    const rvx = vt - vx;
    const rvy = -vy;
    const losRate = (dx * rvy - dy * rvx) / (Ra * Ra);
    const closing = -(dx * rvx + dy * rvy) / Ra;
    const gamma = Math.atan2(vy, vx);
    const aMax = missileMaxAccel(def, _atm.rho, V);
    const aCmd = nav * Math.max(closing, 50) * losRate + G0 * Math.cos(gamma);
    const aN = clamp(aCmd, -aMax, aMax);

    const cd = missileDragCoefficient(def, mach);
    const qa = Math.max(q * area, 1e-3);
    const drag = q * area * cd + (mass * aN) ** 2 / (qa * MISSILE_CN_ALPHA);
    const aTan = (thrust - drag) / mass;
    const ux = V > 1e-3 ? vx / V : 1;
    const uy = V > 1e-3 ? vy / V : 0;
    const ax = aTan * ux - aN * uy;
    const ay = aTan * uy + aN * ux - G0;

    // 이번 스텝 안의 최근접 거리 (상대 등속 근사)
    const wx = vt - vx;
    const wy = -vy;
    const w2 = wx * wx + wy * wy;
    const ts = w2 > 0 ? clamp(-(dx * wx + dyT * wy) / w2, 0, dt) : 0;
    const dmin = Math.hypot(dx + wx * ts, dyT + wy * ts);
    minDist = Math.min(minDist, dmin);
    if (dmin <= proximity) {
      const ok = V >= minSpeed;
      return { hit: ok, reason: ok ? 'hit' : 'slow', time: t + ts, speed: V, missDistance: dmin, maxAltitude: maxAlt };
    }
    if (t > 1 && dx * wx + dyT * wy > 0 && R < 2000) {
      return { hit: false, reason: 'miss', time: t, speed: V, missDistance: minDist, maxAltitude: maxAlt };
    }

    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    xt += vt * dt;
    t += dt;
    if (y > maxAlt) maxAlt = y;
    if (y < 0) return { hit: false, reason: 'ground', time: t, speed: V, missDistance: minDist, maxAltitude: maxAlt };
    if (t > burnout + 0.5 && Math.hypot(vx, vy) < minSpeed) {
      return { hit: false, reason: 'slow', time: t, speed: Math.hypot(vx, vy), missDistance: minDist, maxAltitude: maxAlt };
    }
  }
  return { hit: false, reason: 'timeout', time: t, speed: Math.hypot(vx, vy), missDistance: minDist, maxAltitude: maxAlt };
}

/** loft 조준점 상승량 (m): 남은 거리 12 km 이상에서 거리의 30%, 최대 15 km */
function loftOffset(loft: boolean, rangeM: number): number {
  return loft ? clamp(0.3 * (rangeM - 12000), 0, 15000) : 0;
}

/** 성공하는 최대 발사 거리 (m) — 이분 탐색 */
export function maxLaunchRange(def: WeaponDef, base: Omit<InterceptScenario, 'rangeM'>, upperM = 400_000): number {
  const ok = (r: number) => simulateIntercept(def, { ...base, rangeM: r }).hit;
  // 아주 가까우면 가속 전이라 실패할 수 있으므로 첫 성공 거리를 찾는다
  let lo = 0;
  for (const r of [1000, 2000, 3500, 6000]) {
    if (ok(r)) {
      lo = r;
      break;
    }
  }
  if (lo === 0) return 0;
  let hi = lo * 1.6;
  while (hi < upperM && ok(hi)) {
    lo = hi;
    hi *= 1.6;
  }
  if (hi >= upperM && ok(upperM)) return upperM;
  for (let i = 0; i < 22 && hi - lo > 50; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface EnvelopeEstimate {
  /** 정면 대치 최대 사거리 (km) */
  rMaxKm: number;
  /** 회피불가 거리 (km): 발사 순간 표적이 반전해 이탈해도 명중 */
  rNezKm: number;
}

/**
 * 공대공 사거리 추정. 기본: 고도 10 km, 사수·표적 모두 마하 0.9.
 * 궤도: 장거리(aam_long, loft 사용)는 로프트 궤도, 나머지는 수평 궤도 — 중거리 이하에서는 보수적 값이며
 * 실제 loft 비행은 원거리 사거리가 조금 더 길다 (opts.loft 로 강제 지정 가능).
 */
export function estimateEnvelope(
  def: WeaponDef,
  opts: { altitudeM?: number; launchMach?: number; targetMach?: number; loft?: boolean } = {},
): EnvelopeEstimate {
  const alt = opts.altitudeM ?? 10_000;
  const a = atmosphere(alt).speedOfSound;
  const vs = (opts.launchMach ?? 0.9) * a;
  const vt = (opts.targetMach ?? 0.9) * a;
  const common = { launchAltM: alt, launchSpeed: vs, targetAltM: alt, loft: opts.loft ?? referenceLoft(def) };
  const rMax = maxLaunchRange(def, { ...common, targetVx: -vt });
  const rNez = maxLaunchRange(def, { ...common, targetVx: vt });
  return { rMaxKm: rMax / 1000, rNezKm: rNez / 1000 };
}

/** envelope 기준 궤도에 loft 를 쓰는지 (장거리 공대공만) */
export function referenceLoft(def: WeaponDef): boolean {
  return def.category === 'aam_long' && !!def.guidance?.loft;
}

/** 지대공 사거리 추정: 지상(해면) 발사, 표적은 targetAltM 에서 targetSpeed 로 정면 접근 */
export function estimateSurfaceToAirRange(def: WeaponDef, targetAltM: number, targetSpeed = 250): number {
  return (
    maxLaunchRange(def, { launchAltM: 5, launchSpeed: 30, targetAltM, targetVx: -targetSpeed, minSpeed: targetSpeed * 1.1, minLaunchElevationDeg: 35 }) / 1000
  );
}
