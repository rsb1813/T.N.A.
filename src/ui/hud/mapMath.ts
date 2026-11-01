// 레이더 미니맵 좌표/거리 범위 (순수 함수). 기수 방향이 위(heading-up).
import { DEG, NM, type UnitSystem } from '../../core/math';

export interface MapPoint {
  x: number;
  y: number;
}

/**
 * 월드 상대 좌표(dx 동쪽, dz 남쪽 = +Z) → 미니맵 px (x 오른쪽, y 아래), 기수 heading 이 화면 위.
 * scale = px / m.
 */
export function worldToMap(dx: number, dz: number, headingDeg: number, scale: number, out: MapPoint): MapPoint {
  const h = headingDeg * DEG;
  const c = Math.cos(h);
  const s = Math.sin(h);
  out.x = (dx * c + dz * s) * scale;
  out.y = (-dx * s + dz * c) * scale;
  return out;
}

/** 표시 단위계별 미니맵 범위 단계 (m) */
export const MAP_RANGES: Record<UnitSystem, readonly number[]> = {
  nato: [10 * NM, 20 * NM, 40 * NM, 80 * NM],
  metric: [20_000, 40_000, 80_000, 160_000],
};

/**
 * 자동 범위: 관심 거리 d 가 범위의 85% 안에 들어오는 가장 작은 단계.
 * 깜빡임 방지 — 한 단계 줄이는 것은 d 가 작은 단계의 70% 아래일 때만. d 가 null 이면 현재 유지.
 */
export function autoMapRange(d: number | null, ranges: readonly number[], currentIdx: number): number {
  const n = ranges.length;
  let idx = Math.min(n - 1, Math.max(0, currentIdx));
  if (d === null || !Number.isFinite(d)) return idx;
  while (idx < n - 1 && d > ranges[idx] * 0.85) idx++;
  while (idx > 0 && d < ranges[idx - 1] * 0.7) idx--;
  return idx;
}
