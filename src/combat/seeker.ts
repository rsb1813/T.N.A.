// 시커/기만 판정 규칙 (게임 밸런스 상수 포함). 순수 함수라 테스트/AI 가 직접 쓸 수 있다.
import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Entity } from '../core/entity';

/** 플레어 1발이 시커를 속일 기본 확률 (CCM 0, 강도 1, 군용추력 표적, 측면) */
export const FLARE_BASE = 0.8;
/** 채프 1다발의 기본 기만 확률 */
export const CHAFF_BASE = 0.22;
/** 노칭 중 채프 효과 배율 — 도플러를 잃은 시커는 정지한 채프 구름과 표적을 구분하지 못한다 */
export const CHAFF_NOTCH_MULT = 3.5;
/** 노칭 판정: 표적 시선방향 속도 성분 (m/s) */
export const NOTCH_SPEED = 25;
/** 노칭 중 초당 추적 상실률 (CCM 0) */
export const NOTCH_LOSS_RATE = 0.9;
/** 디코이가 시커 시야 안에 있다고 보는 표적-디코이 시선 각도 (rad) */
export const DECOY_FOV = (8 * Math.PI) / 180;
/** 레이더 시커 거리 기준 RCS (m²) */
export const REF_RCS = 5;

/**
 * 플레어 기만 확률.
 * aspectDeg: 0 = 미사일이 표적 꼬리 쪽(배기구가 잘 보임 → 플레어가 덜 먹힘), 180 = 정면.
 * targetIr: 표적 적외선 신호 (1 = 군용추력, 애프터버너 3~4 → 플레어가 상대적으로 약함).
 */
export function flareSeductionChance(ccm: number, strength: number, aspectDeg: number, targetIr: number): number {
  const aspect = 0.7 + 0.5 * clamp(aspectDeg / 180, 0, 1);
  const hot = 1 / Math.sqrt(clamp(targetIr, 1, 4));
  return clamp(FLARE_BASE * clamp(strength, 0, 1) * (1 - clamp(ccm, 0, 1)) * aspect * hot, 0, 0.95);
}

/** 채프 기만 확률. notching = 표적이 노치 상태, hoj = 재밍원 추적(각도만 쓰므로 채프에 강함) */
export function chaffSeductionChance(ccm: number, strength: number, notching: boolean, hoj: boolean): number {
  let p = CHAFF_BASE * clamp(strength, 0, 1) * (1 - clamp(ccm, 0, 1));
  if (notching) p *= CHAFF_NOTCH_MULT;
  if (hoj) p *= 0.3;
  return clamp(p, 0, 0.95);
}

/** 노칭 중 이번 스텝에 추적을 잃을 확률 */
export function notchLossChance(ccm: number, dt: number): number {
  const rate = NOTCH_LOSS_RATE * (1 - 0.6 * clamp(ccm, 0, 1));
  return 1 - Math.exp(-rate * dt);
}

/**
 * 노치 조건: 표적 속도의 시선방향 성분이 작고(빔 기동), 시커가 지면 클러터를 내려다보는 상황.
 * losDir = 미사일→표적 단위벡터, targetAgl = 표적 지면 위 고도.
 */
export function isNotching(losDir: THREE.Vector3, targetVel: THREE.Vector3, targetAgl: number): boolean {
  const radial = Math.abs(targetVel.dot(losDir));
  if (radial >= NOTCH_SPEED) return false;
  const lookingDown = losDir.y < -0.03;
  return lookingDown || targetAgl < 300;
}

/** IR 시커 탐지 거리 배율 (표적 적외선 신호와 aspect). aspectDeg 는 flareSeductionChance 와 동일 기준 */
export function irRangeFactor(targetIr: number, aspectDeg: number): number {
  const aspect = 1 - 0.45 * clamp(aspectDeg / 180, 0, 1);
  return clamp(Math.sqrt(Math.max(0.05, targetIr)), 0.35, 2) * aspect;
}

/** 레이더 시커 탐지 거리 배율 (RCS^(1/4)) */
export function radarRangeFactor(rcs: number): number {
  return clamp(Math.pow(Math.max(1e-4, rcs) / REF_RCS, 0.25), 0.15, 2.5);
}

const _a = new THREE.Vector3();
/** 미사일 위치에서 본 표적의 aspect(deg): 0 = 꼬리 쪽, 180 = 정면 */
export function aspectFrom(missilePos: THREE.Vector3, target: Entity): number {
  const v = target.velocity;
  const vl = v.length();
  if (vl < 1) return 90;
  _a.subVectors(missilePos, target.position);
  const dl = _a.length();
  if (dl < 1e-3) return 90;
  const c = clamp(_a.dot(v) / (dl * vl), -1, 1);
  return 180 - (Math.acos(c) * 180) / Math.PI;
}
