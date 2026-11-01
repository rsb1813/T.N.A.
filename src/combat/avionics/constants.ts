// 센서/항전 튜닝 상수. 단위: m, s, deg (이름에 표시), m/s.
import type { RadarStats } from '../../data/schema';

/** 레이더 탐지거리 공식의 기준 RCS (m²) — RadarStats.rangeKm 이 이 표적 기준 */
export const REFERENCE_RCS = 5;

// ---------------------------------------------------------------- 갱신 주기

/** 센서 판정 주기 (s). 플레이어는 10 Hz, AI 는 5 Hz. 엔티티 id 로 위상을 흩는다 */
export const SENSOR_TICK_PLAYER = 0.1;
export const SENSOR_TICK_AI = 0.2;

/** 레이더 스캔 1회(방위 한 바 전체)에 걸리는 시간 (s) */
export const SCAN_PERIOD = { rws: 1.0, tws: 1.0, ag: 1.5 } as const;
/** 레이더 스캔 고각 한계 (deg, 기체 기준 ±) */
export const SCAN_ELEVATION_DEG = 60;

// ---------------------------------------------------------------- 모드별 거리 배율

/** 모드별 탐지거리 배율 (RWS 기준). STT 는 에너지 집중, TWS 는 체류시간 감소 */
export const MODE_RANGE_FACTOR = { rws: 1.0, tws: 0.9, stt: 1.15 } as const;
/** AESA 가 지상 모드에서 공중 탐색을 끼워 넣을 때의 거리 배율 */
export const AESA_AG_AIR_FACTOR = 0.5;

// ---------------------------------------------------------------- 탐지 확률

/** 탐지확률 로지스틱 기울기: Pd = 1 / (1 + exp(k·(r/R − 1))). R = 50% 탐지 거리 */
export const PD_STEEPNESS = 12;
/** 이 비율(r/R) 밖은 굴리지도 않는다 (Pd < 1%) */
export const PD_CUTOFF_RATIO = 1.4;

// ---------------------------------------------------------------- RCS 자세각

/** 측면(빔) RCS 배율: 일반기 / 스텔스기 */
export const RCS_BEAM_GAIN = { conventional: 2.0, stealth: 1.2 } as const;
/** 후방 RCS 배율 */
export const RCS_TAIL_GAIN = { conventional: 1.5, stealth: 1.15 } as const;
/** 이 RCS 이상은 일반기, 이하는 스텔스기로 보고 사이를 로그 보간 (m²) */
export const RCS_CONVENTIONAL = 0.5;
export const RCS_STEALTH = 0.01;

// ---------------------------------------------------------------- 재밍

/** 최대 재밍 거리 감소율: R × (1 − 0.6 · jamPower · (1 − eccm)) */
export const JAM_MAX_REDUCTION = 0.6;
/** 재머 방사가 RWR 에 보이는 거리 (m) */
export const JAMMER_RWR_RANGE_M = 160_000;

// ---------------------------------------------------------------- 하방 클러터 / 도플러 노치

/** 시선 하향각이 이 범위에서 0→1 로 클러터 배경이 된다 (deg, 음수 = 아래) */
export const LOOKDOWN_EL_START_DEG = -1;
export const LOOKDOWN_EL_FULL_DEG = -6;
/** 표적 AGL 이 이 범위에서 클러터 영향이 1→0 (m) */
export const LOOKDOWN_AGL_FULL = 1500;
export const LOOKDOWN_AGL_NONE = 6000;
/** 하방 탐지 거리 감소 (심각도 1 일 때) — PD 는 크게, AESA 는 작게 */
export const CLUTTER_PENALTY: Record<RadarStats['type'], number> = { PD: 0.45, PESA: 0.2, AESA: 0.1 };
/** 노치 폭: 표적의 시선 방향 대지속도 성분이 이보다 작으면 클러터와 함께 걸러진다 (m/s) */
export const NOTCH_WIDTH: Record<RadarStats['type'], number> = { PD: 30, PESA: 25, AESA: 20 };
/** 노치가 작동하는 하방 심각도 하한, 또는 표적 AGL 상한 (m) */
export const NOTCH_SEVERITY_MIN = 0.25;
export const NOTCH_LOW_AGL = 300;

// ---------------------------------------------------------------- 트랙 품질 / 유지

export const QUALITY = {
  stt: 1.0,
  tws: 0.8,
  rws: 0.5,
  ag: 0.6,
  irst: 0.5,
  visual: 0.7,
  /** 아군 트랙 공유: 원 트랙 품질 × 이 값 */
  datalinkPeer: 0.75,
  awacs: 0.45,
  /** 사령부 정보 (미션 표적) */
  intel: 0.2,
  /** 코스팅 끝의 품질 */
  coastFloor: 0.12,
} as const;

/** 마지막 탐지 후 트랙을 유지하는 시간 (s) */
export const COAST = { rws: 5, tws: 8, stt: 4, ag: 6, irst: 4, visual: 3, datalink: 3 } as const;
/** "현재 보고 있음" 으로 치는 시간 (이후 품질 감쇠) */
export const HOLD = { stt: 0.5, irst: 0.6, visual: 0.6, datalink: 1.2 } as const;
/** STT 가 표적을 놓친 뒤 탐색 모드로 돌아가기까지 (s) */
export const STT_BREAK_SEC = 1.5;

// ---------------------------------------------------------------- 식별

/** NCTR: 탐지거리의 이 비율 안에서 기종 식별 */
export const NCTR_RATIO = 0.6;
/** SAR 영상 식별 (지상 모드, groundModes) */
export const SAR_ID_RATIO = 0.4;
export const IRST_ID_RATIO = 0.3;
export const VISUAL_ID_AIR_M = 4000;
export const VISUAL_ID_GROUND_M = 5000;

// ---------------------------------------------------------------- 육안 / 지상 / AWACS

export const VISUAL_AIR_FRONT_M = 7000;
export const VISUAL_AIR_REAR_M = 3000;
export const VISUAL_GROUND_M = 8000;
/** 육안 미사일 발견 (연기) */
export const VISUAL_MISSILE_M = 1500;
/** 지상 모드 탐지거리 (m): SAR/GMTI 있음 / 없음 (실빔 지도) — 10 m² 표적 기준 */
export const AG_RANGE_M = { sar: 50_000, realBeam: 20_000 } as const;
export const AG_REFERENCE_RCS = 10;
/** AWACS 탐지 반경 (m) — RCS 1 m² 이상 기준, 그 이하는 RCS^(1/4) 로 감소 */
export const AWACS_RANGE_M = 300_000;

// ---------------------------------------------------------------- 표적 지정

/** 에이스컴뱃식 우선 원뿔 (deg) */
export const DESIGNATION_CONE_DEG = 30;
/** 표적 순환 세션이 이어지는 시간 (s) */
export const CYCLE_SESSION_SEC = 3;

// ---------------------------------------------------------------- 락

/** HMD 없을 때 IR 시커 조준 한계 (HUD 시야) */
export const HUD_OFFBORESIGHT_DEG = 25;
export const LOCK_TIME = {
  irMin: 0.6,
  irMax: 1.0,
  radar: 0.8,
  eo: 1.0,
  laser: 0.5,
  gps: 0.3,
  arm: 0.5,
} as const;
/** 레이더 AAM 락 가능 거리 = rMax × 이 값 */
export const RADAR_LOCK_RANGE_FACTOR = 1.2;
export const GPS_LOCK_RANGE_FACTOR = 1.3;
/** GPS 무장 락 허용 각 (기수 기준) */
export const GPS_LOCK_CONE_DEG = 75;
/** 레이더 트랙이 락에 쓸 만큼 신선해야 하는 시간: 스캔 주기 × 이 값 */
export const RADAR_FRESH_SCANS = 1.6;
/** 조건을 잃으면 락 진행이 줄어드는 속도 (1/s) */
export const LOCK_DECAY_RATE = 4;

// ---------------------------------------------------------------- RWR / MAW

/** RWR 경보 유지 시간 (s): 한 번 감지된 방사원은 이 시간 동안 남는다 */
export const RWR_HOLD_SEC = 1.0;
export const MAW_HOLD_SEC = 0.5;
/** MAW: 모터 연소 종료 후에도 탐지되는 시간 (s) */
export const MAW_AFTERBURN_SEC = 2;
/** 접근 판정: 거리 감소율 (m/s) */
export const CLOSING_MIN_MS = 30;
/** 접근 판정: 미사일 속도와 시선의 각 (deg) */
export const CLOSING_CONE_DEG = 45;
/** 방위 오차 바이어스 재추첨 주기 (s) */
export const BEARING_BIAS_PERIOD = 3;
/** MAW 거리 오차 (1σ, 비율) */
export const MAW_RANGE_ERROR = 0.06;

// ---------------------------------------------------------------- 조종석 경고음

export const INCOMING_TTI_SEC = 6;
export const INCOMING_RANGE_M = 4000;
export const RWR_NEW_PING_SEC = 0.35;

// ---------------------------------------------------------------- 견인 디코이

export const TOWED_DECOY = {
  cableM: 110,
  dropM: 6,
  strength: 0.85,
  /** 반사 증폭 (리피터) */
  rcsGain: 3,
  rcsMin: 10,
} as const;
