// 표적 정보 계산 (순수 함수): 접근률, aspect, 표적 분류/색.
import type * as THREE from 'three';
import { RAD } from '../../core/math';
import type { TargetClass } from '../../core/types';

/** 접근률 Vc (m/s, 양수 = 가까워짐) */
export function closureRate(ownPos: THREE.Vector3, ownVel: THREE.Vector3, tgtPos: THREE.Vector3, tgtVel: THREE.Vector3): number {
  const dx = tgtPos.x - ownPos.x;
  const dy = tgtPos.y - ownPos.y;
  const dz = tgtPos.z - ownPos.z;
  const r = Math.hypot(dx, dy, dz);
  if (r < 1e-6) return 0;
  const rvx = tgtVel.x - ownVel.x;
  const rvy = tgtVel.y - ownVel.y;
  const rvz = tgtVel.z - ownVel.z;
  return -(rvx * dx + rvy * dy + rvz * dz) / r;
}

export interface AspectInfo {
  /** 0 = 표적 꼬리 방향에서 봄, 180 = 정면 */
  deg: number;
  /** 우리가 표적의 어느 쪽에 있나 (표적 기준) */
  side: 'L' | 'R';
}

/** 수평면 기준 aspect. 표적이 거의 정지해 있으면 90 */
export function aspectInfo(ownPos: THREE.Vector3, tgtPos: THREE.Vector3, tgtVel: THREE.Vector3, out: AspectInfo): AspectInfo {
  const tvx = tgtVel.x;
  const tvz = tgtVel.z;
  const sx = ownPos.x - tgtPos.x;
  const sz = ownPos.z - tgtPos.z;
  const tl = Math.hypot(tvx, tvz);
  const sl = Math.hypot(sx, sz);
  if (tl < 1 || sl < 1e-6) {
    out.deg = 90;
    out.side = 'R';
    return out;
  }
  const cos = (tvx * sx + tvz * sz) / (tl * sl);
  // 표적 → 사수 방향이 표적 진행 방향과 같으면 정면(180)
  out.deg = Math.acos(Math.max(-1, Math.min(1, cos))) * RAD;
  out.deg = 180 - out.deg;
  // 표적 오른쪽 벡터 = (-tvz, tvx) (수평, heading 기준 시계방향 90°)
  const right = -tvz * sx + tvx * sz;
  out.side = right >= 0 ? 'R' : 'L';
  return out;
}

export type MarkerShape = 'box' | 'diamond' | 'ship';

export function markerShape(tc: TargetClass): MarkerShape {
  switch (tc) {
    case 'air':
    case 'weapon':
      return 'box';
    case 'sea':
      return 'ship';
    default:
      return 'diamond';
  }
}

export type MarkerSide = 'target' | 'hostile' | 'friendly' | 'neutral';
