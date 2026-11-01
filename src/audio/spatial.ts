// 위치 음향 계산 (순수 함수 — WebAudio 없이 테스트 가능).
// 거리 감쇠·공기 흡음(저역통과)·음속 지연·도플러는 PannerNode 대신 여기서 직접 계산한다
// (PannerNode 는 방향 패닝만 담당: rolloffFactor = 0).
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';

/** 해면 음속 (m/s). 게임 연출용 고정값 */
export const SPEED_OF_SOUND = 343;
/** 원거리 소리 도달 지연 상한 (s) — 실제(30km ≈ 87s) 대신 "살짝" 늦게 */
export const MAX_PROPAGATION_DELAY = 1.2;
/** 도플러 연출 배율 (1 = 물리값). 제트기 교차 시 한 옥타브씩 튀지 않게 줄인다 */
export const DOPPLER_FACTOR = 0.6;
/** 도플러 최대 변화 (cent) */
export const MAX_DOPPLER_CENTS = 900;

export interface DistanceSpec {
  /** 이 거리까지는 감쇠 없음 (m) */
  refM: number;
  /** 이 거리에서 0 (m) */
  maxM: number;
  /** 감쇠 지수: gain = (ref/d)^rolloff. 1 = 역거리, 폭발음처럼 멀리 들리는 소리는 < 1 */
  rolloff: number;
}

/** 거리 감쇠 이득 0..1. maxM 의 60% 부터 부드럽게 0 으로 */
export function distanceGain(d: number, spec: DistanceSpec): number {
  if (!(d > spec.refM)) return 1;
  if (d >= spec.maxM) return 0;
  const g = Math.pow(spec.refM / d, spec.rolloff);
  const fadeStart = spec.maxM * 0.6;
  return d <= fadeStart ? g : g * (1 - smoothstep(fadeStart, spec.maxM, d));
}

/** 공기 흡음 근사: 거리(m) → 저역통과 차단 주파수 (Hz). 350m ≈ 10kHz, 3km ≈ 2kHz, 30km ≈ 230Hz */
export function airAbsorptionCutoff(d: number): number {
  return clamp(20000 / (1 + Math.max(0, d) / 350), 180, 20000);
}

/** 음속 지연 (s). 가까우면 실제값, 멀어질수록 MAX_PROPAGATION_DELAY 로 부드럽게 수렴 */
export function propagationDelay(d: number, cap = MAX_PROPAGATION_DELAY): number {
  if (!(d > 0)) return 0;
  return cap * (1 - Math.exp(-d / SPEED_OF_SOUND / cap));
}

/** 거리에 따른 잔향(wet) 비율 0..1 — 멀수록 직접음 대비 잔향이 커진다 */
export function reverbWetness(d: number): number {
  return 0.55 + 0.45 * smoothstep(0, 6000, d);
}

const _u = new THREE.Vector3();

/**
 * 도플러 주파수 비 (1 = 변화 없음). f' = f·(c − v_L·u)/(c − v_S·u), u = 음원→청취자 단위벡터.
 * 연출 배율 DOPPLER_FACTOR 를 cent 단위로 적용하고 ±MAX_DOPPLER_CENTS 로 자른다.
 */
export function dopplerCents(
  sourcePos: THREE.Vector3,
  sourceVel: THREE.Vector3,
  listenerPos: THREE.Vector3,
  listenerVel: THREE.Vector3,
  factor = DOPPLER_FACTOR,
): number {
  _u.subVectors(listenerPos, sourcePos);
  const len = _u.length();
  if (len < 1e-3) return 0;
  _u.divideScalar(len);
  const c = SPEED_OF_SOUND;
  const num = Math.max(c * 0.3, c - listenerVel.dot(_u));
  const den = Math.max(c * 0.3, c - sourceVel.dot(_u));
  const cents = 1200 * Math.log2(num / den) * factor;
  return clamp(cents, -MAX_DOPPLER_CENTS, MAX_DOPPLER_CENTS);
}

/** 재생 배율 → cent */
export function rateToCents(rate: number): number {
  return rate > 0 ? 1200 * Math.log2(rate) : 0;
}

/** 볼륨 슬라이더(0..1) → 이득. 체감 음량이 고르게 변하도록 제곱 */
export function sliderGain(v: number): number {
  const c = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return c * c;
}
