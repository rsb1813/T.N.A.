// 공용 수학/단위/대기 모델. 모든 시뮬레이션 값은 SI 단위(m, s, kg, N, rad).
//
// 좌표계 (three.js 와 동일, Y-up 오른손 좌표계)
//   월드: +X = 동쪽, +Y = 위, -Z = 북쪽 (+Z = 남쪽). 해수면 y = 0.
//   기체/미사일 로컬 축: 기수 = -Z, 위 = +Y, 오른쪽 날개 = +X  (three.js 카메라 규칙과 동일)
//   방위각(heading): 0° = 북(-Z), 90° = 동(+X), 시계방향.
import * as THREE from 'three';

export const G0 = 9.80665;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const KT = 0.514444; // 1 knot (m/s)
export const FT = 0.3048; // 1 ft (m)
export const NM = 1852; // 1 해리 (m)
export const KMH = 1 / 3.6; // 1 km/h (m/s)

export const FORWARD: Readonly<THREE.Vector3> = new THREE.Vector3(0, 0, -1);
export const UP: Readonly<THREE.Vector3> = new THREE.Vector3(0, 1, 0);
export const RIGHT: Readonly<THREE.Vector3> = new THREE.Vector3(1, 0, 0);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  lerp(b0, b1, clamp(invLerp(a0, a1, v), 0, 1));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const moveTowards = (cur: number, target: number, maxDelta: number): number =>
  Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta;
/** 지수 감쇠 보간: rate(1/s) 로 target 에 수렴. 프레임레이트 독립. */
export const damp = (cur: number, target: number, rate: number, dt: number): number =>
  lerp(target, cur, Math.exp(-rate * dt));

/** 각도를 -PI..PI 로 */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}
/** 각도를 0..360 (deg) 로 */
export function wrap360(d: number): number {
  d %= 360;
  return d < 0 ? d + 360 : d;
}

// ---------------------------------------------------------------- 대기 (ISA)

export interface Atmosphere {
  /** 밀도 kg/m³ */
  rho: number;
  /** 온도 K */
  temperature: number;
  /** 기압 Pa */
  pressure: number;
  /** 음속 m/s */
  speedOfSound: number;
}

const R_AIR = 287.05287;
const GAMMA = 1.4;
export const RHO0 = 1.225;

/** 국제표준대기(ISA). 0~32km 지원, 범위 밖은 끝값으로 고정. */
export function atmosphere(altitudeM: number, out: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 }): Atmosphere {
  const h = clamp(altitudeM, 0, 32000);
  let T: number;
  let p: number;
  if (h <= 11000) {
    T = 288.15 - 0.0065 * h;
    p = 101325 * Math.pow(T / 288.15, 5.255877);
  } else if (h <= 20000) {
    T = 216.65;
    p = 22632.06 * Math.exp((-G0 * (h - 11000)) / (R_AIR * T));
  } else {
    T = 216.65 + 0.001 * (h - 20000);
    p = 5474.889 * Math.pow(216.65 / T, 34.1632);
  }
  out.temperature = T;
  out.pressure = p;
  out.rho = p / (R_AIR * T);
  out.speedOfSound = Math.sqrt(GAMMA * R_AIR * T);
  return out;
}

/** 진대기속도(TAS) → 지시대기속도(IAS, EAS 근사) */
export function tasToIas(tas: number, rho: number): number {
  return tas * Math.sqrt(rho / RHO0);
}

// ---------------------------------------------------------------- 방향/자세

const _v = new THREE.Vector3();
const _e = new THREE.Euler();

export function forwardOf(q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 0, -1).applyQuaternion(q);
}
export function upOf(q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 1, 0).applyQuaternion(q);
}
export function rightOf(q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(1, 0, 0).applyQuaternion(q);
}

/** 벡터의 방위각(deg, 0=북, 90=동) */
export function headingOf(v: THREE.Vector3): number {
  return wrap360(Math.atan2(v.x, -v.z) * RAD);
}
/** 방위각 → 수평 단위벡터 */
export function headingToDir(deg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const r = deg * DEG;
  return out.set(Math.sin(r), 0, -Math.cos(r));
}
/** 방위각/피치(deg)로 자세 쿼터니언 생성 (롤 0) */
export function quatFromHeadingPitch(headingDeg: number, pitchDeg = 0, rollDeg = 0, out = new THREE.Quaternion()): THREE.Quaternion {
  // YXZ 순서: yaw(Y) → pitch(X) → roll(Z). 기수 -Z 기준이라 yaw 는 -heading.
  _e.set(pitchDeg * DEG, -headingDeg * DEG, -rollDeg * DEG, 'YXZ');
  return out.setFromEuler(_e);
}
/** 쿼터니언 → {heading, pitch, roll} (deg). roll 양수 = 오른쪽 날개 내려감 */
export function attitudeOf(q: THREE.Quaternion): { heading: number; pitch: number; roll: number } {
  _e.setFromQuaternion(q, 'YXZ');
  return { heading: wrap360(-_e.y * RAD), pitch: _e.x * RAD, roll: -_e.z * RAD };
}

/** from 에서 to 를 봤을 때, 기준 자세 q 의 기수 대비 상대 방위(deg, -180..180, 양수=오른쪽)와 고각(deg) */
export function relativeBearing(q: THREE.Quaternion, from: THREE.Vector3, to: THREE.Vector3): { bearing: number; elevation: number } {
  _v.subVectors(to, from);
  const inv = q.clone().invert();
  _v.applyQuaternion(inv); // 기체 로컬
  const horiz = Math.hypot(_v.x, _v.z);
  return { bearing: Math.atan2(_v.x, -_v.z) * RAD, elevation: Math.atan2(_v.y, horiz) * RAD };
}

/** 두 방향 사이 각도 (rad) */
export function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  const d = a.length() * b.length();
  return d === 0 ? 0 : Math.acos(clamp(a.dot(b) / d, -1, 1));
}

/** 표적의 aspect angle(deg): 0 = 표적 꼬리를 보는 중(뒤에서 접근), 180 = 정면 대치 */
export function aspectAngle(shooterPos: THREE.Vector3, targetPos: THREE.Vector3, targetVel: THREE.Vector3): number {
  _v.subVectors(shooterPos, targetPos); // 표적 → 사수
  if (targetVel.lengthSq() < 1e-6) return 90;
  return 180 - angleBetween(targetVel, _v) * RAD;
}

/** 등속 표적에 대한 요격 지점(리드) 계산. 해가 없으면 null */
export function interceptPoint(
  shooterPos: THREE.Vector3,
  projectileSpeed: number,
  targetPos: THREE.Vector3,
  targetVel: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  const d = _v.subVectors(targetPos, shooterPos);
  const a = targetVel.lengthSq() - projectileSpeed * projectileSpeed;
  const b = 2 * d.dot(targetVel);
  const c = d.lengthSq();
  let t: number;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) return null;
  return out.copy(targetPos).addScaledVector(targetVel, t);
}

// ---------------------------------------------------------------- 표시 단위

export type UnitSystem = 'nato' | 'metric';

export function formatSpeed(ms: number, units: UnitSystem): string {
  return units === 'nato' ? `${Math.round(ms / KT)}` : `${Math.round(ms * 3.6)}`;
}
export function formatAltitude(m: number, units: UnitSystem): string {
  return units === 'nato' ? `${Math.round(m / FT)}` : `${Math.round(m)}`;
}
export function formatDistance(m: number, units: UnitSystem): string {
  if (units === 'nato') return m < 1852 ? `${(m / NM).toFixed(1)}` : `${Math.round(m / NM)}`;
  return m < 10000 ? `${(m / 1000).toFixed(1)}` : `${Math.round(m / 1000)}`;
}
export const speedUnit = (u: UnitSystem): string => (u === 'nato' ? 'KT' : 'KM/H');
export const altitudeUnit = (u: UnitSystem): string => (u === 'nato' ? 'FT' : 'M');
export const distanceUnit = (u: UnitSystem): string => (u === 'nato' ? 'NM' : 'KM');
