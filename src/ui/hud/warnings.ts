// HUD 경고 판정 (순수 함수).
import type { FlightTelemetry } from '../../core/contracts';

export interface WarningFlags {
  stall: boolean;
  overG: boolean;
  pullUp: boolean;
  bingo: boolean;
  /** 작전 구역 밖 */
  outOfArea: boolean;
  /** 작전 구역 경계 접근 (반경의 92% 이상) */
  nearBoundary: boolean;
}

export function makeWarningFlags(): WarningFlags {
  return { stall: false, overG: false, pullUp: false, bingo: false, outOfArea: false, nearBoundary: false };
}

/** 연료 잔량 비율이 이 아래면 BINGO */
export const BINGO_FRACTION = 0.15;
export const BOUNDARY_WARN_FRACTION = 0.92;

/**
 * 지면 충돌 경고: 지면까지 남은 시간이 짧거나(하강 중) 아주 낮게 하강 중일 때.
 * 고속일수록 회복에 시간이 더 걸리므로 경고 시간을 늘린다.
 */
export function pullUpRequired(agl: number, verticalSpeed: number, speed: number): boolean {
  if (!Number.isFinite(agl)) return false;
  if (agl <= 0) return true;
  if (verticalSpeed >= -1) return false;
  if (agl > 3000) return false;
  const timeToImpact = agl / -verticalSpeed;
  const threshold = 4 + Math.min(4, Math.max(0, speed - 150) / 75);
  return timeToImpact < threshold || (agl < 60 && verticalSpeed < -5);
}

export function evaluateWarnings(
  tel: FlightTelemetry,
  posX: number,
  posZ: number,
  mapRadius: number,
  out: WarningFlags = makeWarningFlags(),
): WarningFlags {
  out.stall = tel.stalled;
  out.overG = tel.overG;
  out.pullUp = pullUpRequired(tel.agl, tel.verticalSpeed, tel.speed);
  out.bingo = tel.fuelFraction < BINGO_FRACTION;
  const r = Math.hypot(posX, posZ);
  out.outOfArea = mapRadius > 0 && r > mapRadius;
  out.nearBoundary = mapRadius > 0 && !out.outOfArea && r > mapRadius * BOUNDARY_WARN_FRACTION;
  return out;
}
