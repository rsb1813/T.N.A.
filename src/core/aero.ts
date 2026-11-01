// 표준 공력/추진 공식. 비행모델(src/flight)과 데이터 보정(src/data 테스트)이 같은 식을 쓰도록 여기 고정한다.
// 단위: SI. 각도 rad.
import { clamp, smoothstep, RHO0 } from './math';

/** 천음속 조파항력 배율 0..1 (waveDragRise 에 곱한다) */
export function waveDragFactor(mach: number): number {
  if (mach <= 0.85) return 0;
  if (mach <= 1.2) return smoothstep(0.85, 1.2, mach);
  return Math.max(0.6, 1 - 0.25 * (mach - 1.2));
}

/** 엔진 전체 추력 (N). throttle 0..1 (군용추력까지), afterburner 이면 AB 추력 */
export function engineThrust(
  dryThrustN: number,
  abThrustN: number,
  rho: number,
  mach: number,
  throttle: number,
  afterburner: boolean,
): number {
  const sigma = rho / RHO0;
  if (afterburner) return abThrustN * Math.pow(sigma, 0.75) * (1 + 0.35 * Math.min(mach, 2.0));
  return dryThrustN * Math.pow(sigma, 0.8) * (1 + 0.1 * Math.min(mach, 1.5)) * clamp(throttle, 0, 1);
}

/** 연료 유량 (kg/s). tsfc = kg/(kN·h) */
export function fuelFlow(thrustN: number, tsfc: number): number {
  return (tsfc * (thrustN / 1000)) / 3600;
}

/** 양력계수. 실속각(clMax/clAlpha) 이후 감소. alpha 는 음수도 대칭 처리 */
export function liftCoefficient(alpha: number, clAlpha: number, clMax: number): number {
  const a = Math.abs(alpha);
  const stall = clMax / clAlpha;
  const cl = a <= stall ? clAlpha * a : Math.max(0.3 * clMax, clMax - (a - stall) * clAlpha * 0.5);
  return Math.sign(alpha) * cl;
}

/** 항력계수 (외부무장 CdA 제외) */
export function dragCoefficient(cl: number, mach: number, cd0: number, k: number, waveDragRise: number): number {
  return cd0 + k * cl * cl + waveDragRise * waveDragFactor(mach);
}

/** 전체 항력 (N) */
export function dragForce(q: number, wingArea: number, cd: number, storesDragArea: number): number {
  return q * (wingArea * cd + storesDragArea);
}
