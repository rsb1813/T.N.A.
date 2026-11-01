// 게임 데이터(기체/무장/모듈/지상유닛) 스키마. 실제 수치는 src/data/*.ts 에 있다.
// 모든 수치는 SI 단위. 설명 문자열은 한국어, 제식명/고유명사는 영문 그대로.
import type { Faction } from '../core/types';

// ---------------------------------------------------------------- 공통

export interface UnlockReq {
  /** 크레딧 가격 (0 = 기본 제공) */
  cost: number;
  /** 이 미션을 완료해야 구매 가능 (미션 id) */
  afterMission?: string;
}

// ---------------------------------------------------------------- 모듈 (커스터마이징 슬롯)

export type ModuleSlot =
  | 'wing' // 날개/기체 개수 키트 (CFT 포함)
  | 'engine'
  | 'radar'
  | 'irst'
  | 'rwr' // 레이더 경보 수신기
  | 'maw' // 미사일 접근 경보기
  | 'ew' // 자체 방어 재머 / 견인 디코이
  | 'cms' // 채프·플레어 디스펜서
  | 'datalink'
  | 'helmet'; // 헬멧 장착 조준기 (HMD)

export const MODULE_SLOTS: readonly ModuleSlot[] = ['wing', 'engine', 'radar', 'irst', 'rwr', 'maw', 'ew', 'cms', 'datalink', 'helmet'];

export const MODULE_SLOT_NAMES: Record<ModuleSlot, string> = {
  wing: '날개/기체',
  engine: '엔진',
  radar: '레이더',
  irst: 'IRST',
  rwr: 'RWR',
  maw: 'MAW',
  ew: '전자전',
  cms: '대응체계',
  datalink: '데이터링크',
  helmet: 'HMD',
};

/** 모듈이 기체 성능에 주는 보정. 곱(Mult)은 기본 1, 합(Add)은 기본 0 */
export interface StatMods {
  thrustMult?: number;
  tsfcMult?: number;
  /** 무차원 영양력 항력계수 가산 (예: CFT +0.0015) */
  cd0Add?: number;
  clMaxMult?: number;
  kMult?: number;
  aoaMaxAdd?: number;
  gMaxAdd?: number;
  /** 롤/피치/요 최대 각속도 배율 */
  rateMult?: number;
  /** 날개 면적 가산 (m²) */
  wingAreaAdd?: number;
  /** 내부 연료 가산 (kg) — CFT 등 */
  fuelAddKg?: number;
  rcsMult?: number;
  irMult?: number;
  maxMachAdd?: number;
  /** 애프터버너 없이 초음속 순항 가능 */
  supercruise?: boolean;
}

export interface RadarStats {
  type: 'AESA' | 'PESA' | 'PD';
  /** 5 m² 표적 탐지 거리 (km). 실제 탐지거리 ∝ RCS^(1/4) */
  rangeKm: number;
  /** 스캔 방위 반각 (deg) */
  azimuthDeg: number;
  /** 동시 추적 수 (TWS) */
  maxTracks: number;
  /** 동시 유도 가능한 능동/반능동 미사일 표적 수 */
  maxGuided: number;
  /** 저피탐 0..1 (적 RWR 탐지 확률 감소) */
  lpi: number;
  /** 대재밍 0..1 (적 재밍 효과 감소) */
  eccm: number;
  /** 공대지 모드(SAR/GMTI) 지원 — 지상 표적 원거리 탐지 */
  groundModes: boolean;
}

export interface IrstStats {
  /** 전투기 후방(군용추력) 기준 탐지 거리 km. 애프터버너 표적은 ~1.5배, 정면은 ~0.6배 */
  rangeKm: number;
  fovDeg: number;
}

export interface RwrStats {
  /** 방위 오차 (deg) */
  bearingErrorDeg: number;
  /** 방사원 기종 식별 가능 */
  identify: boolean;
  /** 미사일 발사(유도 신호) 경보 */
  launchWarning: boolean;
  /** LPI 레이더 탐지 능력 0..1 */
  lpiDetect: number;
}

export interface MawStats {
  /** 미사일 모터 화염 탐지 거리 km */
  rangeKm: number;
  /** 'full' = 전방위, 'rear' = 후반구만 */
  coverage: 'full' | 'rear';
  /** 충돌 예상 시간 표시 */
  timeToImpact: boolean;
}

export interface EwStats {
  /** 재밍 강도 0..1 — 적 레이더의 락 거리 감소 */
  jamPower: number;
  /** 재밍 각도 반각 (deg) */
  coverageDeg: number;
  /** 견인 디코이 개수 (0 = 없음) */
  towedDecoys: number;
}

export interface CmsStats {
  chaff: number;
  flares: number;
}

export interface DatalinkStats {
  kind: 'Link16' | 'IFDL' | 'MADL';
  rangeKm: number;
  /** 아군이 탐지한 표적을 공유받아 표시 */
  shareTracks: boolean;
  /** 아군 트랙으로 원거리 발사(제3자 유도) 가능 */
  cooperativeEngagement: boolean;
}

export interface HelmetStats {
  /** 고정 HUD 밖으로 조준 가능한 최대 각 (deg) */
  offBoresightDeg: number;
}

export interface ModuleDef {
  id: string;
  slot: ModuleSlot;
  /** 제식명 (예: 'AN/APG-82(V)1') */
  name: string;
  /** 한 줄 설명 (한국어) */
  description: string;
  massKg: number;
  unlock: UnlockReq;
  mods?: StatMods;
  radar?: RadarStats;
  irst?: IrstStats;
  rwr?: RwrStats;
  maw?: MawStats;
  ew?: EwStats;
  cms?: CmsStats;
  datalink?: DatalinkStats;
  helmet?: HelmetStats;
  /** 이 모듈이 하드포인트 하나를 차지 (예: Legion IRST 포드 → 'C') */
  occupiesStation?: string;
  /** 모델의 선택 노드 표시/숨김 (예: show: ['opt_cft']) */
  visual?: { show?: string[]; hide?: string[] };
}

// ---------------------------------------------------------------- 무장

export type WeaponCategory =
  | 'gun'
  | 'aam_ir' // 적외선 단거리 (AIM-9X)
  | 'aam_radar' // 능동 레이더 중거리 (AIM-120D)
  | 'aam_sarh' // 반능동 레이더 (AIM-7)
  | 'aam_long' // 장거리 (AIM-54, R-37)
  | 'agm' // 공대지 정밀 미사일 (AGM-65, JASSM)
  | 'arm' // 대방사 (AGM-88)
  | 'ashm' // 대함 (AGM-84)
  | 'bomb_gps' // JDAM, SDB
  | 'bomb_laser' // Paveway
  | 'bomb_dumb' // Mk 82/84
  | 'bomb_cluster'
  | 'nuke' // 전술핵 (B61 등) — 미션 지정 시에만
  | 'pod' // 표적/센서/재밍 포드
  | 'tank' // 외부 연료탱크
  | 'sam' // 지대공 (지상 유닛용)
  | 'aaa'; // 대공포 (지상 유닛용)

export type GuidanceType =
  | 'none'
  | 'ir'
  | 'active_radar'
  | 'sarh'
  | 'anti_radiation'
  | 'laser'
  | 'gps'
  | 'eo' // TV/IIR 영상
  | 'command'; // 지령 유도 (일부 SAM)

export interface WeaponDef {
  id: string; // 제식명 그대로 (예: 'AIM-120D')
  name: string; // 표시 이름 (예: 'AIM-120D AMRAAM')
  category: WeaponCategory;
  description: string;
  /** 사용 세력 */
  users: Faction[];
  massKg: number;
  /** 외부 장착 시 항력 면적 CdA (m², 1발 기준) */
  dragArea: number;
  /** 외부 장착 시 RCS 증가 (m², 1발 기준) */
  rcsAdd: number;
  /** 3D 모델 id (/models/<id>.glb). 없으면 범용 모델 */
  model?: string;
  unlock: UnlockReq;

  /** 로켓 모터 (미사일) */
  motor?: {
    boostSec: number;
    boostThrustN: number;
    sustainSec: number;
    sustainThrustN: number;
    /** 연기 정도 — 저연기 모터는 육안/MAW 탐지가 어려움 */
    smoke: 'low' | 'medium' | 'high';
    /** 램제트 (Meteor 등): 지속 추력이 길고 고도 영향 큼 */
    ramjet?: boolean;
  };
  /** 미사일/폭탄 비행체 공력 */
  body?: {
    diameterM: number;
    lengthM: number;
    cd0: number;
    /** 최대 기동 G (해면, 마하 2 기준; 속도·밀도 낮으면 감소) */
    maxG: number;
    /** 활공 날개 (SDB, JSOW 등) 양항비 */
    glideRatio?: number;
  };
  guidance?: {
    type: GuidanceType;
    /** 시커 탐지/락 거리 (km) */
    seekerRangeKm: number;
    /** 시커 짐벌 한계 반각 (deg) */
    gimbalDeg: number;
    /** 발사 시 허용 조준 이탈각 (deg). HMD 가 있으면 이 값까지, 없으면 HUD 범위로 제한 */
    offBoresightDeg: number;
    /** 발사 후 락온 (LOAL) */
    loal?: boolean;
    /** 중간 유도 데이터링크 */
    datalink?: boolean;
    /** 능동 시커 작동 거리 (km, 능동 레이더) */
    pitbullKm?: number;
    /** 비례항법 상수 */
    navConstant: number;
    /** 대응책 저항 0..1 (플레어/채프에 속을 확률 감소) */
    ccm: number;
    /** 로프트 궤도 사용 */
    loft?: boolean;
  };
  warhead?: {
    massKg: number;
    /** 피해 반경 (m) */
    blastRadiusM: number;
    /** 직격 시 피해량 (HP) */
    damage: number;
    /** 근접신관 작동 거리 (m) */
    proximityM?: number;
    /** 전술핵 위력 (kt) */
    yieldKt?: number;
  };
  /** HUD 발사가능영역 참고값 (km): 고도 ~10km, 정면 대치 기준 */
  envelope?: { rMinKm: number; rMaxKm: number; rNezKm: number };
  gun?: {
    caliberMm: number;
    rpm: number;
    muzzleVelocity: number;
    /** 1발 피해 */
    damage: number;
    /** 산포 (mil) */
    dispersionMil: number;
    rangeM: number;
  };
  pod?: { kind: 'targeting' | 'irst' | 'ecm' | 'recon'; laserDesignator?: boolean };
  tank?: { fuelKg: number };
  /** 이 기체에만 장착 가능 (생략 시 스테이션 허용 목록만 따름) */
  aircraftOnly?: string[];
}

// ---------------------------------------------------------------- 기체

export type AircraftRole =
  | 'air_superiority'
  | 'multirole'
  | 'strike'
  | 'interceptor'
  | 'attacker'
  | 'bomber'
  | 'awacs'
  | 'transport'
  | 'experimental';

export interface StationDef {
  /** 스테이션 id. 플레이어 기체는 docs/architecture.md 의 표와 일치해야 함 (모델 empty 'station_<id>') */
  id: string;
  label: string;
  /** 내부 무장창 (RCS 증가 없음) */
  internal: boolean;
  /** 최대 하중 (kg) */
  maxMassKg: number;
  /** 허용 카테고리 또는 무장 id */
  allowed: Array<WeaponCategory | string>;
  /** 다중 장착 최대 개수 (기본 1) — 예: CFT 접선 장착, BRU-61 SDB 랙 */
  maxCount?: number;
  /** 카테고리/무장별 개수 상한 (maxCount 보다 우선). 예: { aam_radar: 1, bomb_gps: 3 } */
  limits?: Partial<Record<WeaponCategory | string, number>>;
  /** 대칭 스테이션 id (UI 대칭 장착용) */
  mirror?: string;
  /** 모델에 empty 가 없을 때 쓰는 장착 위치 (모델 공간, m) */
  position?: [number, number, number];
}

export interface LoadoutPreset {
  id: string;
  name: string;
  description: string;
  modules: Partial<Record<ModuleSlot, string | null>>;
  stations: Record<string, StationLoad | null>;
}

export interface AircraftDef {
  id: string; // 'f15ex'
  name: string; // 'F-15EX Eagle II'
  faction: Faction;
  playable: boolean;
  role: AircraftRole;
  description: string;
  /** 모델 id → /models/<model>.glb */
  model: string;
  crew: 1 | 2;
  dimensions: { length: number; span: number; height: number };
  mass: { empty: number; internalFuel: number; maxTakeoff: number };
  aero: {
    wingArea: number;
    /** 깨끗한 기체 영양력 항력계수 */
    cd0: number;
    /** 유도항력 계수 k (CD = cd0 + k·CL²) */
    k: number;
    /** 양력 기울기 (1/rad) */
    clAlpha: number;
    clMax: number;
    /** FBW 받음각 제한 (deg) */
    aoaMaxDeg: number;
    /** 천음속 조파항력 증가량 (마하 1.2 에서의 ΔCD) */
    waveDragRise: number;
  };
  engine: {
    name: string;
    count: number;
    /** 1기당 추력 (kN, 해면 정지) */
    dryThrustKN: number;
    abThrustKN: number;
    /** 연료소모율 kg/(kN·h) */
    tsfcDry: number;
    tsfcAB: number;
    /** 아이들→최대 스풀업 시간 (s) */
    spoolTime: number;
  };
  limits: {
    gMax: number;
    gMin: number;
    maxMach: number;
    /** 최대 각속도 (deg/s) — 고속(코너 속도 부근) 기준 */
    rollRateDeg: number;
    pitchRateDeg: number;
    yawRateDeg: number;
    /** 코너 속도 (m/s, 참고값) */
    cornerSpeed: number;
  };
  signature: { rcs: number; ir: number };
  gun: { weaponId: string; rounds: number } | null;
  stations: StationDef[];
  modules: Record<ModuleSlot, { default: string | null; allowed: string[] }>;
  presets: LoadoutPreset[];
  /** 가변익 (F-14, Tornado, Su-24, MiG-23, Tu-22M3) */
  variableSweep?: { minDeg: number; maxDeg: number };
  unlock: UnlockReq;
}

// ---------------------------------------------------------------- 지상/해상 유닛

export type UnitKind =
  | 'sam_launcher'
  | 'sam_radar'
  | 'aaa'
  | 'radar' // 조기경보 레이더
  | 'vehicle'
  | 'tank'
  | 'artillery'
  | 'ship'
  | 'structure';

export interface UnitDef {
  id: string;
  name: string;
  kind: UnitKind;
  faction?: Faction;
  description: string;
  model: string;
  hp: number;
  radius: number;
  rcs: number;
  /** 무장 (SAM, 함대공, CIWS, 대공포) */
  weapons?: Array<{ weaponId: string; count: number; reloadSec: number; salvo?: number }>;
  /** 자체 레이더 (탐지/추적 km) */
  radar?: { searchKm: number; trackKm: number; label: string };
  /** 이동 속도 m/s (차량/함정) */
  speed?: number;
  /** 장갑 — 폭발 피해 감소 배율 (0..1, 1 = 감소 없음) */
  armor?: number;
}

// ---------------------------------------------------------------- 로드아웃

export interface StationLoad {
  weaponId: string;
  count: number;
}

export interface Loadout {
  aircraftId: string;
  modules: Partial<Record<ModuleSlot, string | null>>;
  stations: Record<string, StationLoad | null>;
  /** 내부 연료 비율 0..1 */
  fuel: number;
  livery?: string;
}

/** 로드아웃을 적용한 최종 성능 (data/loadout.ts 의 computeStats 가 계산) */
export interface DerivedStats {
  massEmptyKg: number; // 기체 + 모듈
  fuelCapacityKg: number; // 내부 + CFT + 외부탱크
  fuelKg: number; // 시작 연료
  storesMassKg: number; // 무장/포드/탱크(연료 제외)
  totalMassKg: number;
  wingArea: number;
  /** 깨끗한 기체 + 모듈 영양력 항력계수 (외부 무장 항력은 storesDragArea 로 따로) */
  cd0: number;
  storesDragArea: number;
  k: number;
  clAlpha: number;
  clMax: number;
  aoaMaxDeg: number;
  waveDragRise: number;
  thrustDryN: number; // 전체 엔진 합계
  thrustAbN: number;
  tsfcDry: number;
  tsfcAB: number;
  spoolTime: number;
  supercruise: boolean;
  /** 무장 중량에 따라 감소한 G 한계 */
  gMax: number;
  gMin: number;
  maxMach: number;
  rollRate: number; // rad/s
  pitchRate: number; // rad/s
  yawRate: number; // rad/s
  cornerSpeed: number;
  /** 외부 무장 포함 RCS (m²) */
  rcs: number;
  ir: number;
  radar: RadarStats | null;
  irst: IrstStats | null;
  rwr: RwrStats | null;
  maw: MawStats | null;
  ew: EwStats | null;
  cms: CmsStats | null;
  datalink: DatalinkStats | null;
  helmet: HelmetStats | null;
  gun: { weaponId: string; rounds: number } | null;
  /** 경고 (예: '외부 무장으로 스텔스 상실') */
  warnings: string[];
}

export interface GameDatabase {
  aircraft: Record<string, AircraftDef>;
  weapons: Record<string, WeaponDef>;
  modules: Record<string, ModuleDef>;
  units: Record<string, UnitDef>;
}
