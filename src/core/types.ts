// 여러 모듈이 공유하는 기본 타입.

export type Faction = 'NATO' | 'WARSAW' | 'PAX' | 'WON' | 'NEUTRAL';

export const FACTION_NAMES: Record<Faction, string> = {
  NATO: 'NATO',
  WARSAW: '바르샤바 조약기구',
  PAX: '팍스 임페리알리스',
  WON: 'WON',
  NEUTRAL: '중립',
};

export type EntityKind =
  | 'aircraft'
  | 'missile' // 유도/무유도 로켓 추진 무기 (AAM, AGM, SAM, 순항미사일)
  | 'bomb' // 낙하 무기 (JDAM, LGB, 일반 폭탄, 활공폭탄)
  | 'decoy' // 플레어, 채프, 견인 디코이
  | 'ground' // 차량, 전차, SAM 발사대, 레이더, 대공포
  | 'ship'
  | 'structure'; // 건물, 격납고, 교량 등 고정 표적

/** HUD/AI 가 표적 종류를 구분하는 분류 */
export type TargetClass = 'air' | 'ground' | 'sea' | 'structure' | 'weapon';

export type DamageKind = 'blast' | 'kinetic' | 'fire' | 'crash' | 'nuclear' | 'mouk';

export interface DamageInfo {
  amount: number;
  kind: DamageKind;
  /** 공격한 엔티티(발사 주체). 미사일이면 미사일이 아니라 쏜 기체 */
  source: import('./entity').Entity | null;
  /** 사용된 무기 id (예: 'AIM-120D', 'M61A2') */
  weaponId: string | null;
  /** 피격 지점(월드) — 시각 효과용 */
  point?: import('three').Vector3;
}

/** RWR 이 읽는 레이더 방사 상태. 방사하지 않으면 Entity.emission = null */
export interface RadarEmission {
  mode: 'search' | 'track' | 'guidance' | 'seeker';
  /** 방사원의 탐지 거리(m). RWR 은 대략 이 거리의 1.5배 밖에서도 감지 */
  rangeM: number;
  /** 스캔 반각(deg) — 기수 기준 원뿔 */
  azimuthDeg: number;
  /** 저피탐(LPI) 0..1. 높을수록 RWR 에 덜 잡힘 */
  lpi: number;
  /** 추적/락/유도 중인 엔티티 id */
  trackedIds: number[];
  /** RWR 표시용 식별 문자열 (예: 'F-15', 'SA-10', 'MSL') */
  label: string;
}

export type AISkill = 'rookie' | 'regular' | 'veteran' | 'ace';

export type Difficulty = 'normal' | 'hard' | 'ace';
