// 무장 모듈 게임 밸런스 상수. 단위: m, s, m/s, deg(이름에 표시).
// 모든 값은 재미를 위해 단순화·조정한 게임 수치다 (실제 무기 체계 모델이 아님).

// ---------------------------------------------------------------- 미사일 비행

/** 시커 판정 주기 (s). 유도 계산(비례항법)은 매 스텝, 시야/기만 판정은 이 주기로 */
export const SEEKER_TICK = 0.1;
/** 비례항법 최소 접근속도 (m/s) — 접근속도가 0 근처여도 선회는 계속하게 */
export const PN_MIN_CLOSING = 60;
/** 사출 발사(무장창·동체 반매립·대형 미사일) 후 모터 점화까지 (s) */
export const EJECT_DELAY = 0.35;
/** 사출 속도 (m/s, 발사 기체 아래쪽) */
export const EJECT_SPEED = 7;
/** 추력편향(TVC) 미사일: 모터 연소 중 최소 기동 가속 = 이 비율 × 추력/질량 */
export const TVC_ACCEL_FRACTION = 0.55;
/** TVC 로 취급하는 시커 짐벌 (deg 이상) — 고 off-boresight 단거리 미사일 */
export const TVC_GIMBAL_DEG = 75;

/**
 * 에너지 고갈(fizzle) 속도: 모터 연소 후 이 속도 아래면 유도 상실·자폭.
 * 공대공은 data/ballistics.ts 의 정면 명중 판정(마하 1.2)과 같아서 HUD 사거리와 실제 비행이 맞는다.
 */
export const FIZZLE_MACH = { air: 1.2, sam: 0.9 } as const;
/** 공대지/대함/순항 미사일은 활공 끝까지 (m/s) */
export const FIZZLE_SPEED_SURFACE = 60;
/** 추격 중 접근속도가 이 값 아래로 이만큼 지속되면 포기 (m/s, s) */
export const MIN_CLOSING_SPEED = 25;
export const MIN_CLOSING_SEC = 1.5;
/** 표적을 잃고 재획득하지 못한 채 이 시간이 지나면 자폭 (s) */
export const LOST_TIMEOUT = 3;
/** 시커가 표적을 놓친 뒤 마지막 위치·속도로 외삽 비행하는 시간 (s) */
export const SEEKER_MEMORY = 2;
/** 유도 시간 기본값 (guidance.maxTimeSec 이 없을 때, s) */
export const DEFAULT_MAX_TIME = { air: 90, sam: 120, surface: 300, cruise: 2400, bomb: 400 } as const;

/** 레이더 미사일 무락 발사(maddog): 이 시간 뒤 능동 시커 작동 (s) */
export const MADDOG_ACTIVE_SEC = 1.5;
/** 반능동 미사일: 조사가 끊긴 뒤 유도를 유지하는 시간 (s) */
export const SARH_MEMORY = 1.0;
/** 대레이더 미사일: 방사가 멈춰도 밀리미터파 시커로 재획득하는 거리 (m) — ccm 이 이 값 이상인 신형만 */
export const ARM_MMW_RANGE = 4000;
export const ARM_MMW_CCM = 0.6;
/** 견인 디코이의 레이더 시커 기만률 (1/s, 강도 1·CCM 0) */
export const TOWED_SEDUCTION_RATE = 0.9;

/** 로프트: 남은 수평거리 12 km 이상에서 거리의 30% 만큼 조준점 상승 (data/ballistics 와 같음), 시커 짐벌의 이 비율 이하 각도로 제한 */
export const LOFT_START_M = 12_000;
export const LOFT_GAIN = 0.3;
export const LOFT_MAX_M = 15_000;
export const LOFT_GIMBAL_FRACTION = 0.6;

/** 순항 미사일 비행 고도 (AGL m) 와 종말 진입 수평거리 (m) */
export const CRUISE_AGL = { ashm: 15, agm: 70 } as const;
export const CRUISE_TERMINAL_M = { ashm: 5000, agm: 3500 } as const;
/** 순항 판정: 지속 연소가 이 시간 이상인 공대지/대함 미사일 (s) */
export const CRUISE_SUSTAIN_SEC = 60;

/** 미사일 엔티티 HP (기관포/CIWS 로 격추 가능) */
export const MISSILE_HP = 8;
/** 근접신관이 없는 무장의 접촉신관 여유 (m) */
export const CONTACT_FUZE_M = 1.5;

// ---------------------------------------------------------------- 폭탄

/** 무유도 폭탄 정의상 maxG 가 없을 때 유도 폭탄의 최대 기동 (G) */
export const BOMB_DEFAULT_G = 3;
/** 확산탄 자탄 산개 고도 (AGL m) */
export const CLUSTER_BURST_AGL = 300;
/** 확산탄 자탄 연출 개수 */
export const CLUSTER_FX_COUNT = 14;
/** 전술핵 공중 폭발 고도 (AGL m) */
export const NUKE_BURST_AGL = 450;
/** 활공 폭탄 최적 활공: 양항비의 이 비율로 활공각을 잡는다 */
export const GLIDE_EFFICIENCY = 0.8;

// ---------------------------------------------------------------- 디코이

export const FLARE = {
  /** 연소 시간 (s) */
  burnSec: 4,
  /** 최대 적외선 신호 (전투기 군용추력 = 1) */
  ir: 5,
  /** 사출 속도 (m/s) */
  ejectSpeed: 30,
  /** 공기저항 감속률 (1/s) — 상대풍 속도에 곱해짐 */
  dragRate: 0.9,
} as const;

export const CHAFF = {
  /** 구름 유지 시간 (s) */
  lifeSec: 6,
  /** 최대 RCS (m²) — 0.4 s 안에 펼쳐진다 */
  rcs: 40,
  bloomSec: 0.4,
  ejectSpeed: 15,
  /** 감속률 (1/s) — 금방 공중에 멈춘다 */
  dragRate: 3.5,
  /** 낙하 종단속도 (m/s) */
  fallSpeed: 2,
} as const;

/** 디스펜서 1회 사용 시 투하 수 / 재사용 대기 (s) */
export const CM_BURST = { flare: 2, chaff: 2 } as const;
export const CM_COOLDOWN = { flare: 0.45, chaff: 0.45 } as const;

// ---------------------------------------------------------------- 무장 발사 (Stores)

/** 같은 무장 연속 발사 간격 (s) */
export const FIRE_COOLDOWN = 0.4;
/** 폭탄 연속 투하 간격 (s) */
export const BOMB_COOLDOWN = 0.2;

// ---------------------------------------------------------------- 기관포

/** 탄 최대 수명 = rangeM / 초속 × 이 값 */
export const BULLET_LIFE_FACTOR = 1.6;
/** 예광탄 간격 (n 발마다 1 발) */
export const TRACER_EVERY = 4;
/** 지상 대공포 fireGun 1 회 = 이만큼의 점사 (s). 점사 중 재호출하면 연장 */
export const AAA_BURST_SEC = 0.25;
/** 지면 충돌 판정 주기 (스텝) */
export const BULLET_GROUND_CHECK_STEPS = 2;
/** 공간 해시 셀 크기 (m) */
export const BULLET_CELL_M = 400;
/** 같은 엔티티에 불꽃 효과를 다시 내기까지 (s) */
export const HIT_FX_INTERVAL = 0.06;
/** 탄 풀 최대 크기 */
export const MAX_BULLETS = 4096;
