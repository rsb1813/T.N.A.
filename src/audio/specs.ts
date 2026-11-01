// 효과음/루프별 믹싱 규격: 버스, 우선순위, 동시 재생 수, 거리 감쇠, 잔향.
import type { LoopSoundId, SoundId } from '../core/services';
import type { DistanceSpec } from './spatial';

/** world = 전장 소리(경고음이 덮음), ui = 메뉴/징글, radio = 무전, tones = 조종석 경고음 */
export type BusId = 'world' | 'ui' | 'radio' | 'tones';

export interface SoundSpec {
  bus: BusId;
  /** 보이스 강탈 우선순위 (높을수록 살아남음) */
  priority: number;
  /** 이 소리의 동시 재생 상한 (넘으면 가장 오래된 것을 끊는다) */
  maxVoices: number;
  /** 같은 위치(또는 둘 다 자기 기체)에서 이 시간 안에 다시 요청되면 하나로 합친다 (s) */
  coalesceSec: number;
  /** null = 위치 무시 (항상 정위치 재생) */
  distance: DistanceSpec | null;
  /** 잔향 송출량 0..1 */
  reverb: number;
  /** 음속 지연 적용 */
  delayed: boolean;
  /** 기본 음량 */
  gain: number;
}

const ui = (priority: number, gain: number, maxVoices = 3): SoundSpec => ({
  bus: 'ui',
  priority,
  maxVoices,
  coalesceSec: 0.03,
  distance: null,
  reverb: 0,
  delayed: false,
  gain,
});

export const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  gun: { bus: 'world', priority: 6, maxVoices: 4, coalesceSec: 0, distance: { refM: 40, maxM: 4000, rolloff: 0.9 }, reverb: 0.3, delayed: true, gain: 0.9 },
  missile_launch: { bus: 'world', priority: 6, maxVoices: 5, coalesceSec: 0.06, distance: { refM: 60, maxM: 9000, rolloff: 0.85 }, reverb: 0.3, delayed: true, gain: 0.85 },
  bomb_release: { bus: 'world', priority: 4, maxVoices: 3, coalesceSec: 0.06, distance: { refM: 15, maxM: 600, rolloff: 1 }, reverb: 0.05, delayed: false, gain: 0.8 },
  explosion_near: { bus: 'world', priority: 7, maxVoices: 6, coalesceSec: 0.05, distance: { refM: 150, maxM: 15000, rolloff: 0.8 }, reverb: 0.4, delayed: true, gain: 1 },
  explosion_far: { bus: 'world', priority: 4, maxVoices: 8, coalesceSec: 0.05, distance: { refM: 700, maxM: 45000, rolloff: 0.65 }, reverb: 0.55, delayed: true, gain: 0.9 },
  hit: { bus: 'world', priority: 5, maxVoices: 4, coalesceSec: 0.05, distance: { refM: 30, maxM: 2000, rolloff: 1 }, reverb: 0.08, delayed: false, gain: 0.75 },
  flare: { bus: 'world', priority: 3, maxVoices: 4, coalesceSec: 0.04, distance: { refM: 30, maxM: 2500, rolloff: 1 }, reverb: 0.15, delayed: true, gain: 0.6 },
  chaff: { bus: 'world', priority: 3, maxVoices: 3, coalesceSec: 0.04, distance: { refM: 30, maxM: 1500, rolloff: 1 }, reverb: 0.1, delayed: true, gain: 0.5 },
  sonic_boom: { bus: 'world', priority: 6, maxVoices: 2, coalesceSec: 0.25, distance: { refM: 600, maxM: 25000, rolloff: 0.6 }, reverb: 0.45, delayed: true, gain: 1 },
  weapon_select: ui(6, 0.5),
  target_switch: ui(6, 0.45),
  ui_click: ui(8, 0.4),
  ui_confirm: ui(8, 0.5),
  ui_back: ui(8, 0.45),
  mission_complete: { ...ui(9, 0.75, 1), coalesceSec: 1 },
  mission_failed: { ...ui(9, 0.75, 1), coalesceSec: 1 },
  radio_in: { bus: 'radio', priority: 8, maxVoices: 2, coalesceSec: 0.15, distance: null, reverb: 0, delayed: false, gain: 0.45 },
  radio_out: { bus: 'radio', priority: 8, maxVoices: 2, coalesceSec: 0.15, distance: null, reverb: 0, delayed: false, gain: 0.45 },
};

export interface LoopSpec {
  /** 위치가 주어졌을 때의 거리 감쇠 */
  distance: DistanceSpec;
  reverb: number;
  /** 정지 시 페이드아웃 (s) */
  releaseSec: number;
  /** 가상화 우선순위 가중치 (가청도에 곱한다) */
  weight: number;
}

export const LOOP_SPECS: Record<LoopSoundId, LoopSpec> = {
  engine: { distance: { refM: 40, maxM: 7000, rolloff: 0.9 }, reverb: 0.12, releaseSec: 0.6, weight: 1 },
  afterburner: { distance: { refM: 50, maxM: 10000, rolloff: 0.85 }, reverb: 0.15, releaseSec: 0.35, weight: 1.1 },
  wind: { distance: { refM: 30, maxM: 600, rolloff: 1.2 }, reverb: 0, releaseSec: 0.6, weight: 0.8 },
  gun_loop: { distance: { refM: 40, maxM: 4000, rolloff: 0.9 }, reverb: 0.3, releaseSec: 0.2, weight: 1.5 },
};

/** 동시에 실제로 소리를 내는(실체화된) 루프 최대 수. 나머지는 가상 루프로 상태만 유지 */
export const MAX_REALIZED_LOOPS = 20;
/** 동시 원샷 보이스 최대 수 */
export const MAX_ONESHOT_VOICES = 40;
/** 기관포 연사 슬롯 최대 수 (사수별 하나) */
export const MAX_GUN_SLOTS = 4;
/** 이 거리 안의 소리는 자기 기체 소리로 보고 정위치(패닝 없음)로 재생 (m) */
export const OWNSHIP_RADIUS = 45;
/** 'gun' 단발 요청 최소 연사 길이 (s) — 다시 요청하면 GUN_EXTEND_SEC 만큼 연장 */
export const GUN_MIN_BURST = 0.3;
export const GUN_EXTEND_SEC = 0.12;
