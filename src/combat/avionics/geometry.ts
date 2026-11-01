// 기체 기준 각도 계산 (할당 없음). 기수 = 로컬 -Z.
import * as THREE from 'three';
import { RAD, wrapPi } from '../../core/math';

/** 기체 기준 상대 위치 정보 (deg, m) */
export interface LocalAngles {
  /** 방위 (-180..180, 양수 = 오른쪽) */
  az: number;
  /** 고각 (양수 = 위) */
  el: number;
  /** 기수와의 사이각 (0..180) */
  off: number;
  dist: number;
}

export function makeLocalAngles(): LocalAngles {
  return { az: 0, el: 0, off: 0, dist: 0 };
}

const _d = new THREE.Vector3();

/** invQ = 관측자 자세의 역 쿼터니언 (미리 계산해서 여러 표적에 재사용) */
export function bodyAngles(invQ: THREE.Quaternion, from: THREE.Vector3, to: THREE.Vector3, out: LocalAngles): LocalAngles {
  _d.subVectors(to, from);
  const dist = _d.length();
  out.dist = dist;
  if (dist < 1e-6) {
    out.az = 0;
    out.el = 0;
    out.off = 0;
    return out;
  }
  _d.applyQuaternion(invQ);
  const horiz = Math.hypot(_d.x, _d.z);
  out.az = Math.atan2(_d.x, -_d.z) * RAD;
  out.el = Math.atan2(_d.y, horiz) * RAD;
  out.off = Math.acos(Math.max(-1, Math.min(1, -_d.z / dist))) * RAD;
  return out;
}

/** 월드 기준 시선 고각 (deg) */
export function worldElevationDeg(from: THREE.Vector3, to: THREE.Vector3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.atan2(to.y - from.y, Math.hypot(dx, dz)) * RAD;
}

/**
 * 표적 기수 방향과 (표적 → 관측자) 방향의 코사인. 1 = 관측자가 표적 정면에 있음.
 * forward 는 표적의 기수 단위벡터.
 */
export function cosNoseToward(targetPos: THREE.Vector3, targetForward: THREE.Vector3, observerPos: THREE.Vector3): number {
  _d.subVectors(observerPos, targetPos);
  const len = _d.length();
  if (len < 1e-6) return 1;
  return targetForward.dot(_d) / len;
}

/** 각도(deg)를 -180..180 으로 */
export function wrapDeg180(d: number): number {
  return wrapPi(d / RAD) * RAD;
}

/** 'F-15EX Eagle II' → 'F-15EX', 'Su-35S Flanker-E' → 'Su-35S' */
export function shortLabel(name: string): string {
  const t = name.trim();
  const i = t.indexOf(' ');
  return i > 0 ? t.slice(0, i) : t;
}
