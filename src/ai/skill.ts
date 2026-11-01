// AI 숙련도 프로필 + 세력 교리 + 난이도 배율.
import type { Sim } from '../core/sim';
import { DIFFICULTY_TABLE } from '../core/settings';
import type { AISkill, Faction } from '../core/types';
import type { Rng } from '../core/rng';

export interface SkillProfile {
  /** 새 자극(미사일 경보, 새 위협)에 반응하기까지 지연 (s) */
  reaction: readonly [number, number];
  /** 상태 재평가 주기 (s) */
  decisionInterval: number;
  /** 기관포/조준 각오차 1σ (deg) */
  aimNoiseDeg: number;
  /** 사용하는 G 한계 비율 (기체 gMax 대비) */
  gFraction: number;
  /** 올바른 방어 기동을 고를 확률 (나머지는 늦거나 틀린 기동) */
  defendCorrect: number;
  /** 노칭(빔 + 저고도 + 채프)을 제대로 하는가 */
  notch: boolean;
  /** 레이더 미사일 발사 후 크랭크 */
  crank: boolean;
  /** 저연료/중파손 시 이탈 */
  disengage: boolean;
  /** 에너지 관리 (하이 요요, 코너 속도 유지, 무리한 선회 회피) */
  energyAware: boolean;
  /** 발사 거리: rNez + f·(rMax − rNez). 1 = 최대 사거리 */
  launchFraction: number;
  /** 연속 미사일 발사 최소 간격 (s) */
  launchInterval: number;
  /** 한 표적에 동시에 날려 둘 미사일 수 */
  missilesPerTarget: number;
  /** 육안으로 미사일/항공기를 알아채는 거리 (m) */
  visualRangeM: number;
  /** 대응체계 투하 간격 (s) */
  cmsInterval: number;
  /** 지상 크루: 대방사 미사일 접근 시 레이더 차단 */
  emcon: boolean;
  /** 지상 크루: 표적 획득(추적 전환)에 걸리는 시간 (s) */
  acquireSec: number;
}

export const SKILL_PROFILES: Record<AISkill, SkillProfile> = {
  rookie: {
    reaction: [1.4, 2.6],
    decisionInterval: 0.8,
    aimNoiseDeg: 2.6,
    gFraction: 0.68,
    defendCorrect: 0.55,
    notch: false,
    crank: false,
    disengage: false,
    energyAware: false,
    launchFraction: 0.95,
    launchInterval: 7,
    missilesPerTarget: 1,
    visualRangeM: 2200,
    cmsInterval: 1.6,
    emcon: false,
    acquireSec: 6,
  },
  regular: {
    reaction: [0.8, 1.5],
    decisionInterval: 0.55,
    aimNoiseDeg: 1.5,
    gFraction: 0.82,
    defendCorrect: 0.8,
    notch: false,
    crank: true,
    disengage: false,
    energyAware: false,
    launchFraction: 0.78,
    launchInterval: 5,
    missilesPerTarget: 1,
    visualRangeM: 2800,
    cmsInterval: 1.1,
    emcon: false,
    acquireSec: 4.5,
  },
  veteran: {
    reaction: [0.45, 0.9],
    decisionInterval: 0.4,
    aimNoiseDeg: 0.85,
    gFraction: 0.93,
    defendCorrect: 0.93,
    notch: true,
    crank: true,
    disengage: true,
    energyAware: true,
    launchFraction: 0.62,
    launchInterval: 3.5,
    missilesPerTarget: 2,
    visualRangeM: 3200,
    cmsInterval: 0.8,
    emcon: true,
    acquireSec: 3,
  },
  ace: {
    reaction: [0.2, 0.5],
    decisionInterval: 0.3,
    aimNoiseDeg: 0.45,
    gFraction: 1,
    defendCorrect: 1,
    notch: true,
    crank: true,
    disengage: true,
    energyAware: true,
    launchFraction: 0.5,
    launchInterval: 2.5,
    missilesPerTarget: 2,
    visualRangeM: 3600,
    cmsInterval: 0.6,
    emcon: true,
    acquireSec: 2,
  },
};

export type DoctrineId = 'nato' | 'warsaw' | 'pax' | 'won';

/** 세력 교리 (BVR 교전 방식) */
export interface Doctrine {
  id: DoctrineId;
  /** 레이더 미사일 직후 IR 미사일을 쌍으로 발사 (바르샤바) */
  pairs: boolean;
  /** 발사 거리 비율 상한 (skill.launchFraction 과 min) */
  launchFractionCap: number;
  /** 레이더 미사일 최대 발사 거리 상한 (m). WON 은 가까이 붙는다 */
  maxRadarLaunchM: number;
  /** BFM(근접전) 진입 거리 (m) */
  mergeRangeM: number;
  /** 크랭크 각 (deg) */
  crankDeg: number;
  /** 공중전 개시 거리 기본값 (m) */
  commitRangeM: number;
  /** 근접 IR 미사일/기관포 선호 */
  prefersClose: boolean;
}

export const DOCTRINES: Record<DoctrineId, Doctrine> = {
  nato: { id: 'nato', pairs: false, launchFractionCap: 0.8, maxRadarLaunchM: Infinity, mergeRangeM: 10_000, crankDeg: 45, commitRangeM: 90_000, prefersClose: false },
  warsaw: { id: 'warsaw', pairs: true, launchFractionCap: 0.85, maxRadarLaunchM: Infinity, mergeRangeM: 10_000, crankDeg: 40, commitRangeM: 80_000, prefersClose: false },
  // 팍스: Meteor 를 NEZ 근처까지 끌고 와서 쏘고 크게 크랭크
  pax: { id: 'pax', pairs: false, launchFractionCap: 0.18, maxRadarLaunchM: Infinity, mergeRangeM: 9_000, crankDeg: 50, commitRangeM: 90_000, prefersClose: false },
  // WON: 구형 장비 — 근거리로 붙어서 IR/기관포
  won: { id: 'won', pairs: false, launchFractionCap: 0.45, maxRadarLaunchM: 22_000, mergeRangeM: 12_000, crankDeg: 35, commitRangeM: 50_000, prefersClose: true },
};

export function doctrineFor(faction: Faction): Doctrine {
  switch (faction) {
    case 'WARSAW':
      return DOCTRINES.warsaw;
    case 'PAX':
      return DOCTRINES.pax;
    case 'WON':
      return DOCTRINES.won;
    default:
      return DOCTRINES.nato;
  }
}

/** 난이도 배율. 플레이어에게 적대적인 AI 만 적용 (아군/중립은 1) */
export interface DifficultyScale {
  accuracy: number;
  aggression: number;
}

export function difficultyScale(sim: Sim, faction: Faction): DifficultyScale {
  const player = sim.world.player;
  const playerFaction: Faction = player ? player.faction : 'NATO';
  if (!sim.relations.isHostile(faction, playerFaction)) return { accuracy: 1, aggression: 1 };
  const row = DIFFICULTY_TABLE[sim.settings.difficulty] ?? DIFFICULTY_TABLE.normal;
  return { accuracy: row.enemyAccuracy, aggression: row.enemyAggression };
}

/** 숙련도 + 난이도를 합친 실효 프로필 */
export function effectiveProfile(skill: AISkill, scale: DifficultyScale): SkillProfile {
  const base = SKILL_PROFILES[skill] ?? SKILL_PROFILES.regular;
  const acc = Math.max(0.3, scale.accuracy);
  const agg = Math.max(0.3, scale.aggression);
  return {
    ...base,
    aimNoiseDeg: base.aimNoiseDeg / acc,
    launchInterval: base.launchInterval / agg,
    // 공격성이 높을수록 더 멀리서(일찍) 쏘고, 낮으면 망설인다
    launchFraction: Math.min(1, base.launchFraction * (0.85 + 0.15 * agg)),
    reaction: [base.reaction[0] / Math.sqrt(acc), base.reaction[1] / Math.sqrt(acc)],
  };
}

export function reactionDelay(p: SkillProfile, rng: Rng): number {
  return rng.range(p.reaction[0], p.reaction[1]);
}

/** 태그 'skill:<id>' 로 숙련도 지정 (지상 유닛 크루 등) */
export function skillFromTags(tags: Iterable<string>, fallback: AISkill): AISkill {
  for (const t of tags) {
    if (!t.startsWith('skill:')) continue;
    const s = t.slice(6);
    if (s === 'rookie' || s === 'regular' || s === 'veteran' || s === 'ace') return s;
  }
  return fallback;
}

/** 세력 기본 지상 크루 숙련도 */
export function defaultCrewSkill(faction: Faction): AISkill {
  switch (faction) {
    case 'PAX':
      return 'veteran';
    case 'WON':
      return 'rookie';
    default:
      return 'regular';
  }
}
