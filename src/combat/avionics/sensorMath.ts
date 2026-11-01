// 센서 공식 (순수 함수). 레이더/IRST/육안 탐지거리와 재밍·클러터·노치 판정.
// 무장(시커) 쪽에서도 같은 식을 쓸 수 있도록 상태를 갖지 않는다.
import { clamp, invLerp, lerp, smoothstep } from '../../core/math';
import type { RadarStats } from '../../data/schema';
import {
  AG_RANGE_M,
  AG_REFERENCE_RCS,
  AWACS_RANGE_M,
  CLUTTER_PENALTY,
  JAM_MAX_REDUCTION,
  LOOKDOWN_AGL_FULL,
  LOOKDOWN_AGL_NONE,
  LOOKDOWN_EL_FULL_DEG,
  LOOKDOWN_EL_START_DEG,
  NOTCH_WIDTH,
  PD_STEEPNESS,
  RCS_BEAM_GAIN,
  RCS_CONVENTIONAL,
  RCS_STEALTH,
  RCS_TAIL_GAIN,
  REFERENCE_RCS,
  VISUAL_AIR_FRONT_M,
  VISUAL_AIR_REAR_M,
  VISUAL_GROUND_M,
} from './constants';

const LOG_CONV = Math.log10(RCS_CONVENTIONAL);
const LOG_STEALTH = Math.log10(RCS_STEALTH);

/** 0 = 일반기, 1 = 스텔스기 (정면 RCS 로 판단) */
export function stealthiness(rcs: number): number {
  if (!(rcs > 0)) return 1;
  return clamp(invLerp(LOG_CONV, LOG_STEALTH, Math.log10(rcs)), 0, 1);
}

/**
 * 자세각에 따른 RCS 배율.
 * @param cosNose 표적 기수 방향과 (표적 → 레이더) 방향의 코사인. 1 = 레이더가 표적 정면을 봄, -1 = 꼬리를 봄
 */
export function rcsAspectFactor(rcs: number, cosNose: number): number {
  const s = stealthiness(rcs);
  const beam = lerp(RCS_BEAM_GAIN.conventional, RCS_BEAM_GAIN.stealth, s);
  const tail = lerp(RCS_TAIL_GAIN.conventional, RCS_TAIL_GAIN.stealth, s);
  const c = clamp(cosNose, -1, 1);
  const sin2 = 1 - c * c;
  const back = c < 0 ? c * c : 0;
  return 1 + (beam - 1) * sin2 + (tail - 1) * back;
}

/** 레이더 방정식: 탐지거리 (m) = rangeKm × (rcs / 5)^(1/4) */
export function radarRangeForRcs(rangeKm: number, rcsEff: number): number {
  return rangeKm * 1000 * Math.pow(Math.max(rcsEff, 1e-9) / REFERENCE_RCS, 0.25);
}

/**
 * 표적 재밍이 탐지거리에 주는 배율 (= 번스루 거리 / 원래 탐지거리).
 * 이 거리 안으로 들어오면 반사 신호가 재밍을 이긴다(번스루).
 * @param coverage 0..1 — 레이더가 재머 안테나 범위 가장자리에 있으면 1 보다 작다
 */
export function jamRangeFactor(jamPower: number, eccm: number, coverage = 1): number {
  return 1 - JAM_MAX_REDUCTION * clamp(jamPower, 0, 1) * (1 - clamp(eccm, 0, 1)) * clamp(coverage, 0, 1);
}

/** 재머 안테나 범위 가중치: 재머 기수와 (재머 → 레이더) 사이 각(deg) 기준 */
export function jamCoverageWeight(angleDeg: number, coverageDeg: number): number {
  if (coverageDeg >= 180) return 1;
  return 1 - smoothstep(coverageDeg * 0.85, coverageDeg, angleDeg);
}

/**
 * 하방 클러터 심각도 0..1: 표적이 지평선 아래(시선 하향)이고 저고도일수록 배경이 지면이 된다.
 * @param losElevationDeg 레이더 → 표적 시선의 월드 고각 (음수 = 내려다봄)
 */
export function lookDownSeverity(losElevationDeg: number, targetAgl: number): number {
  const below = smoothstep(LOOKDOWN_EL_START_DEG, LOOKDOWN_EL_FULL_DEG, losElevationDeg);
  const low = 1 - smoothstep(LOOKDOWN_AGL_FULL, LOOKDOWN_AGL_NONE, targetAgl);
  return below * low;
}

/** 하방 탐지거리 배율 (PD 레이더가 가장 크게 손해) */
export function clutterRangeFactor(type: RadarStats['type'], severity: number): number {
  return 1 - CLUTTER_PENALTY[type] * clamp(severity, 0, 1);
}

/** 도플러 노치: 표적의 시선 방향 대지속도 성분이 노치 폭보다 작으면 지면 클러터와 함께 걸러진다 */
export function inDopplerNotch(type: RadarStats['type'], targetRadialSpeed: number): boolean {
  return Math.abs(targetRadialSpeed) < NOTCH_WIDTH[type];
}

/** 탐지확률. ratio = 거리 / 50% 탐지거리 */
export function detectionProbability(ratio: number): number {
  return 1 / (1 + Math.exp(PD_STEEPNESS * (ratio - 1)));
}

/**
 * IR 자세각 배율. 후방(배기구) 1.0, 측면 0.8, 정면 0.6.
 * @param cosNose 표적 기수와 (표적 → 관측자) 의 코사인 (1 = 정면에서 봄)
 */
export function irAspectFactor(cosNose: number): number {
  return lerp(1.0, 0.6, (clamp(cosNose, -1, 1) + 1) / 2);
}

/** IR 신호 → 거리 배율. 군용추력 1 → 1, 애프터버너(≈3.4) → ≈1.5 */
export function irSignatureFactor(irSignature: number): number {
  return Math.pow(Math.max(irSignature, 0.01), 0.35);
}

/** IR 탐지거리 (m). rangeKm = 전투기 후방 군용추력 기준. 하방(지면 배경)은 20% 감소 */
export function irDetectionRange(rangeKm: number, irSignature: number, cosNose: number, lookDown = 0): number {
  return rangeKm * 1000 * irSignatureFactor(irSignature) * irAspectFactor(cosNose) * (1 - 0.2 * clamp(lookDown, 0, 1));
}

/**
 * 육안 공중 표적 발견 거리 (m). 전반구 7 km, 후반구 3 km, 대형기는 더 멀리.
 * @param cosOff 관측자 기수와 표적 방향 사이 각의 코사인
 */
export function visualAirRange(cosOff: number, targetRadius: number): number {
  const base = lerp(VISUAL_AIR_REAR_M, VISUAL_AIR_FRONT_M, smoothstep(-0.15, 0.15, cosOff));
  return base * clamp(Math.sqrt(Math.max(targetRadius, 0) / 8), 1, 1.8);
}

/** 육안 지상 표적 발견 거리 (m). 함정·대형 건물은 더 멀리 */
export function visualGroundRange(targetRadius: number): number {
  return VISUAL_GROUND_M * clamp(Math.pow(Math.max(targetRadius, 0) / 5, 0.3), 1, 1.5);
}

/** 지상 모드 탐지거리 (m) */
export function groundRadarRange(groundModes: boolean, rcs: number): number {
  const base = groundModes ? AG_RANGE_M.sar : AG_RANGE_M.realBeam;
  return base * clamp(Math.pow(Math.max(rcs, 1e-6) / AG_REFERENCE_RCS, 0.25), 0.6, 2);
}

/** AWACS 가 이 RCS 표적을 보는 거리 (m) */
export function awacsRange(rcsEff: number): number {
  return AWACS_RANGE_M * Math.min(1, Math.pow(Math.max(rcsEff, 1e-9), 0.25));
}
