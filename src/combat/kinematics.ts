// 미사일/폭탄 비행체의 순수 공력·추진 계산. Missile/Bomb 엔티티와 발사가능영역 추정이 같은 식을 쓴다.
// 게임용 단순화 모델: 점질량 + 속도축 정렬 자세. 단위 SI.
import { G0, RHO0, atmosphere, clamp, smoothstep, type Atmosphere } from '../core/math';
import { waveDragFactor } from '../core/aero';
import type { WeaponDef } from '../data/schema';

/** 고체 로켓 비추력 (s) */
export const ISP_ROCKET = 250;
/** 램제트 서스테인 비추력 (s) — 공기 흡입식이라 연료 소모가 적다 */
export const ISP_RAMJET = 900;
/** 천음속 항력 상승 배율 (cd0 에 곱해지는 최대 증가분) */
export const TRANSONIC_RISE = 1.1;
/** 단면적 기준 최대 법선력 계수 (동체+날개 양력 한계) — 동압이 낮으면 이것이 기동 G 를 제한 */
export const CN_MAX = 28;
/** 유도항력 계수: D_i = K_IND · (m·a)² / (q·S) */
export const K_IND = 0.012;
/** 연소 종료 후 이 속도 아래로 떨어지면 자폭 (m/s) */
export const MIN_GUIDED_SPEED = 150;
/** 추진제 질량 상한 (발사 질량 대비) */
const MAX_PROP_FRACTION = 0.62;

const REF_RAM_RHO = atmosphere(10000).rho;
const REF_RAM_V = 3 * atmosphere(10000).speedOfSound;

export interface MissileMassProps {
  launchMass: number;
  boostProp: number;
  sustainProp: number;
  /** 기준 단면적 (m²) */
  area: number;
  cd0: number;
  maxG: number;
}

const massCache = new WeakMap<WeaponDef, MissileMassProps>();

/** 무장 정의에서 질량/면적 특성 산출 (캐시) */
export function massProps(def: WeaponDef): MissileMassProps {
  let mp = massCache.get(def);
  if (mp) return mp;
  const d = def.body?.diameterM ?? 0.2;
  const area = (Math.PI * d * d) / 4;
  const m = def.massKg;
  let boostProp = 0;
  let sustainProp = 0;
  const motor = def.motor;
  if (motor) {
    boostProp = (motor.boostThrustN * motor.boostSec) / (ISP_ROCKET * G0);
    sustainProp = (motor.sustainThrustN * motor.sustainSec) / ((motor.ramjet ? ISP_RAMJET : ISP_ROCKET) * G0);
    const total = boostProp + sustainProp;
    const cap = m * MAX_PROP_FRACTION;
    if (total > cap) {
      boostProp *= cap / total;
      sustainProp *= cap / total;
    }
  }
  mp = { launchMass: m, boostProp, sustainProp, area, cd0: def.body?.cd0 ?? 0.3, maxG: def.body?.maxG ?? 2 };
  massCache.set(def, mp);
  return mp;
}

/** 모터 점화 후 경과 시간 burnT 에서의 질량 */
export function massAt(def: WeaponDef, burnT: number): number {
  const mp = massProps(def);
  const motor = def.motor;
  if (!motor) return mp.launchMass;
  const b = clamp(burnT / Math.max(1e-3, motor.boostSec), 0, 1);
  const s = motor.sustainSec > 0 ? clamp((burnT - motor.boostSec) / motor.sustainSec, 0, 1) : 1;
  return mp.launchMass - mp.boostProp * b - mp.sustainProp * s;
}

/** 램제트 추력 배율: 질량유량(ρV)에 비례, 저속에서는 흡입구가 작동하지 않는다 */
export function ramjetFactor(rho: number, speed: number, mach: number): number {
  const flow = (rho * speed) / (REF_RAM_RHO * REF_RAM_V);
  return clamp(flow, 0.15, 1.8) * smoothstep(0.9, 1.8, mach) * (1 - smoothstep(4.2, 5.0, mach));
}

/** 모터 점화 후 burnT 에서의 추력 (N) */
export function thrustAt(def: WeaponDef, burnT: number, rho: number, speed: number, mach: number): number {
  const motor = def.motor;
  if (!motor || burnT < 0) return 0;
  if (burnT < motor.boostSec) return motor.boostThrustN;
  if (burnT < motor.boostSec + motor.sustainSec) {
    return motor.ramjet ? motor.sustainThrustN * ramjetFactor(rho, speed, mach) : motor.sustainThrustN;
  }
  return 0;
}

export function burnTime(def: WeaponDef): number {
  return def.motor ? def.motor.boostSec + def.motor.sustainSec : 0;
}

/** 영양력 항력계수 (천음속 상승 포함) */
export function bodyCd(cd0: number, mach: number): number {
  return cd0 * (1 + TRANSONIC_RISE * waveDragFactor(mach));
}

/** 동압 제한 최대 횡가속도 (m/s²) = min(maxG, CN_MAX·q·S/m) */
export function maxLateralAccel(maxG: number, q: number, area: number, mass: number): number {
  return Math.min(maxG * G0, (CN_MAX * q * area) / Math.max(1, mass));
}

/** 횡가속도 aLat 를 내기 위한 유도항력 (N) */
export function inducedDrag(aLat: number, q: number, area: number, mass: number): number {
  if (q < 1) return 0;
  const f = mass * aLat;
  return (K_IND * f * f) / (q * area);
}

/** 활공체(폭탄)의 양력 유도항력: 양항비 LD 로 |L|/LD */
export function liftDrag(aLat: number, mass: number, ld: number): number {
  return (Math.abs(aLat) * mass) / Math.max(0.5, ld);
}

const _atm: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 };
/** 공유 대기 계산 (반환 객체는 다음 호출에서 덮어쓴다) */
export function airAt(altitude: number): Atmosphere {
  return atmosphere(altitude, _atm);
}

export { RHO0 };
