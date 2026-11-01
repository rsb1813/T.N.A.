// 점수/랭크/크레딧 계산 (순수 함수).
import { isAircraft } from '../core/contracts';
import type { Entity } from '../core/entity';
import type { TargetClass } from '../core/types';
import type { AircraftRole, GameDatabase, UnitKind } from '../data/schema';
import type { Rank, RankThresholds } from './missionTypes';

export const AIRCRAFT_ROLE_SCORE: Record<AircraftRole, number> = {
  air_superiority: 120,
  multirole: 110,
  strike: 100,
  attacker: 90,
  interceptor: 130,
  bomber: 250,
  awacs: 400,
  transport: 150,
  experimental: 400,
};

export const UNIT_KIND_SCORE: Record<UnitKind, number> = {
  sam_launcher: 120,
  sam_radar: 160,
  aaa: 70,
  radar: 130,
  vehicle: 30,
  tank: 60,
  artillery: 50,
  ship: 300,
  structure: 80,
};

export const TARGET_CLASS_SCORE: Record<TargetClass, number> = {
  air: 100,
  ground: 50,
  sea: 300,
  structure: 80,
  weapon: 30,
};

/** 'target' 태그 표적 배율 */
export const TARGET_TAG_MULT = 1.5;
/** 기본 목표 달성 보너스 */
export const OBJECTIVE_SCORE = { primary: 500, secondary: 250 } as const;
/** 중립(비적대) 세력 격추 감점 */
export const NEUTRAL_KILL_PENALTY = 300;
/** 성공 시 점수 → 크레딧 환산 비율 */
export const CREDITS_PER_POINT = 0.5;
/** 실패 시 격추 점수의 일부만 크레딧으로 */
export const FAILURE_CREDIT_RATE = 0.25;
export const RANK_CREDIT_MULT: Record<Rank, number> = { S: 1.5, A: 1.25, B: 1, C: 0.9, D: 0.8 };

/** 격추 1회 기본 점수. unitId 는 지상 유닛 스폰 시 기록한 UnitDef.id */
export function killScore(e: Entity, db: GameDatabase | null, unitId?: string | null, override?: number): number {
  let base: number;
  if (override != null) base = override;
  else if (isAircraft(e) && e.def && AIRCRAFT_ROLE_SCORE[e.def.role] != null) base = AIRCRAFT_ROLE_SCORE[e.def.role];
  else if (unitId && db?.units?.[unitId]) base = UNIT_KIND_SCORE[db.units[unitId].kind] ?? TARGET_CLASS_SCORE[e.targetClass];
  else base = TARGET_CLASS_SCORE[e.targetClass] ?? 50;
  return Math.round(e.tags.has('target') && override == null ? base * TARGET_TAG_MULT : base);
}

/** 기준 시간보다 빨리 끝낸 초당 2점, 최대 1500 */
export function timeBonus(elapsedSec: number, parTimeSec: number): number {
  return Math.round(Math.min(1500, Math.max(0, parTimeSec - elapsedSec) * 2));
}

/** 미사일/폭탄 4발 이상 쐈을 때 명중률 × 600 */
export function accuracyBonus(hits: number, shots: number): number {
  if (shots < 4) return 0;
  return Math.round(Math.min(1, hits / shots) * 600);
}

/** 받은 피해 % × 8 (100% = -800) */
export function damagePenalty(damagePct: number): number {
  return Math.round(Math.max(0, Math.min(100, damagePct)) * 8);
}

export function computeRank(score: number, t: RankThresholds, success: boolean): Rank {
  if (!success) return 'D';
  if (score >= t.S) return 'S';
  if (score >= t.A) return 'A';
  if (score >= t.B) return 'B';
  if (score >= t.C) return 'C';
  return 'D';
}

export function computeCredits(opts: { success: boolean; reward: number; score: number; killScore: number; rank: Rank }): number {
  if (!opts.success) return Math.round(Math.max(0, opts.killScore) * FAILURE_CREDIT_RATE);
  return Math.round((opts.reward + opts.score * CREDITS_PER_POINT) * RANK_CREDIT_MULT[opts.rank]);
}
