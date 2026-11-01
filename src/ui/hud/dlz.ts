// 발사가능영역(DLZ) 막대 기하 (순수 함수). Stores.launchZone() 결과를 0..1 비율로 바꾼다.
import type { LaunchZone } from '../../core/contracts';

export type DlzState = 'far' | 'inRange' | 'nez' | 'tooClose';

export interface DlzGeometry {
  /** 막대 꼭대기 거리 (m) — 표시 단위로 깔끔한 값 */
  scaleMax: number;
  /** 0 = 막대 바닥(거리 0), 1 = 꼭대기 */
  fMin: number;
  fNez: number;
  fMax: number;
  fRange: number;
  /** 현재 거리가 눈금 밖이라 꼭대기에 붙여 표시 */
  clamped: boolean;
  state: DlzState;
}

export function makeDlzGeometry(): DlzGeometry {
  return { scaleMax: 1, fMin: 0, fNez: 0, fMax: 0, fRange: 0, clamped: false, state: 'far' };
}

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** v 이상인 가장 작은 '깔끔한' 수 (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ) */
export function niceCeil(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  for (const n of NICE) if (f <= n + 1e-9) return n * base;
  return 10 * base;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * metersPerUnit = 표시 단위 1 의 미터 (NM 1852, km 1000). 눈금 꼭대기 = Rmax 의 1.25배를 표시 단위로 올림.
 * 상태는 무장 모듈이 계산한 inRange/inNez 플래그를 우선한다.
 */
export function computeDlz(zone: LaunchZone, metersPerUnit: number, out: DlzGeometry = makeDlzGeometry()): DlzGeometry {
  const rMax = Math.max(1, zone.rMax);
  const scaleMax = niceCeil((rMax * 1.25) / metersPerUnit) * metersPerUnit;
  out.scaleMax = scaleMax;
  out.fMin = clamp01(zone.rMin / scaleMax);
  out.fNez = clamp01(Math.max(zone.rMin, zone.rNez) / scaleMax);
  out.fMax = clamp01(rMax / scaleMax);
  out.clamped = zone.range > scaleMax;
  out.fRange = clamp01(zone.range / scaleMax);
  if (zone.inNez) out.state = 'nez';
  else if (zone.inRange) out.state = 'inRange';
  else if (zone.range < zone.rMin) out.state = 'tooClose';
  else out.state = 'far';
  return out;
}
