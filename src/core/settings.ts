// 사용자 설정. localStorage 에 저장.
import type { UnitSystem } from './math';
import type { Difficulty } from './types';

export interface GameSettings {
  difficulty: Difficulty;
  /** standard = 에이스컴뱃식 직접 조종, mouseAim = 마우스가 가리키는 방향으로 자동 비행 */
  controlMode: 'standard' | 'mouseAim';
  units: UnitSystem;
  invertPitch: boolean;
  mouseSensitivity: number;
  /** 보조 기능 */
  assists: {
    /** 실속/과G 방지 (FBW 리미터) */
    flightLimiter: boolean;
    /** 기관포 리드 조준점 */
    gunLead: boolean;
    /** 위협 방향 화살표 */
    threatArrows: boolean;
  };
  volume: { master: number; sfx: number; radio: number };
  graphics: 'low' | 'medium' | 'high';
  /** 무전 자막 언어 (현재 한국어만) */
  language: 'ko';
}

export const DEFAULT_SETTINGS: GameSettings = {
  difficulty: 'normal',
  controlMode: 'standard',
  units: 'nato',
  invertPitch: false,
  mouseSensitivity: 1,
  assists: { flightLimiter: true, gunLead: true, threatArrows: true },
  volume: { master: 0.8, sfx: 1, radio: 1 },
  graphics: 'medium',
  language: 'ko',
};

/** 난이도별 배율 */
export const DIFFICULTY_TABLE: Record<Difficulty, { playerDamageTaken: number; enemyAccuracy: number; enemyAggression: number; scoreMult: number }> = {
  normal: { playerDamageTaken: 0.6, enemyAccuracy: 0.8, enemyAggression: 0.8, scoreMult: 1 },
  hard: { playerDamageTaken: 1, enemyAccuracy: 1, enemyAggression: 1, scoreMult: 1.5 },
  ace: { playerDamageTaken: 1.4, enemyAccuracy: 1.15, enemyAggression: 1.2, scoreMult: 2 },
};

const KEY = 'tna.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      assists: { ...DEFAULT_SETTINGS.assists, ...parsed.assists },
      volume: { ...DEFAULT_SETTINGS.volume, ...parsed.volume },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경 무시 */
  }
}
