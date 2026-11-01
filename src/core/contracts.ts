// 모듈 간 런타임 계약. 구현은 각 모듈이 하고, 다른 모듈은 이 인터페이스로만 접근한다.
//   AircraftLike  → src/flight  (Aircraft 클래스)
//   Avionics/Stores/MissileLike/DecoyLike → src/combat
//   AircraftController → src/flight (플레이어), src/ai (적/윙맨)
import type * as THREE from 'three';
import type { Entity } from './entity';
import type { Sim } from './sim';
import type { AISkill } from './types';
import type { AircraftDef, DerivedStats, GuidanceType, Loadout, WeaponDef } from '../data/schema';

// ---------------------------------------------------------------- 비행

/** 조종 입력. 컨트롤러(플레이어/AI)가 매 스텝 써 넣고 비행모델이 읽는다 */
export interface ControlInput {
  /** -1..1  양수 = 기수 올림 (요구 피치 각속도 비율) */
  pitch: number;
  /** -1..1  양수 = 오른쪽 롤 */
  roll: number;
  /** -1..1  양수 = 기수 오른쪽 */
  yaw: number;
  /** 0..1 군용추력까지의 스로틀 */
  throttle: number;
  /** 애프터버너 (throttle 이 1 일 때만 의미) */
  afterburner: boolean;
  airbrake: boolean;
}

export interface FlightTelemetry {
  /** 진대기속도 m/s */
  speed: number;
  /** 지시대기속도 m/s */
  ias: number;
  mach: number;
  /** 해발 고도 m */
  altitude: number;
  /** 지면 위 고도 m */
  agl: number;
  verticalSpeed: number;
  aoaDeg: number;
  sideslipDeg: number;
  /** 수직 하중배수 (G) */
  gLoad: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** 실제 엔진 출력 0..1 (스풀 반영) */
  throttle: number;
  afterburner: boolean;
  fuelKg: number;
  fuelFraction: number;
  thrustN: number;
  dragN: number;
  /** 비잉여출력 Ps (m/s) — 에너지 획득률 */
  specificExcessPower: number;
  stalled: boolean;
  overG: boolean;
  /** 가변익 후퇴각 (deg), 해당 없으면 null */
  sweepDeg: number | null;
}

export interface AircraftDamageState {
  /** 각 0..1 (1 = 완파) */
  engine: number;
  wings: number;
  control: number;
  fuelLeak: boolean;
  onFire: boolean;
}

/** 항공기 엔티티의 공개 API */
export interface AircraftLike extends Entity {
  readonly kind: 'aircraft';
  readonly def: AircraftDef;
  readonly loadout: Loadout;
  readonly stats: DerivedStats;
  readonly controls: ControlInput;
  readonly telemetry: FlightTelemetry;
  readonly avionics: Avionics;
  readonly stores: Stores;
  readonly damageState: AircraftDamageState;
  controller: AircraftController | null;
  /** AI 숙련도 (플레이어면 null) */
  skill: AISkill | null;
  /** 스테이션 장착점 월드 좌표 (모델 empty 'station_<id>' 또는 StationDef.position) */
  getStationWorldPosition(stationId: string, out: THREE.Vector3): THREE.Vector3;
  /** 기관포 총구 월드 좌표 */
  getGunWorldPosition(out: THREE.Vector3): THREE.Vector3;
}

export interface AircraftController {
  /** 매 고정 스텝, 비행모델보다 먼저 호출. ac.controls 를 갱신하고 무장 사용 등을 수행 */
  update(ac: AircraftLike, dt: number, sim: Sim): void;
  dispose?(): void;
}

// ---------------------------------------------------------------- 센서/항전

export interface Track {
  /** 실제 엔티티 참조 (시뮬레이션 내부용 — 표시 정보는 아래 필드 사용) */
  entity: Entity;
  id: number;
  /** 마지막으로 알려진 위치/속도 */
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  source: 'radar' | 'irst' | 'datalink' | 'visual';
  lastUpdate: number;
  /** 0..1 — 1 = 정밀 추적 */
  quality: number;
  /** IFF/NCTR 식별 완료 (기종명 표시 가능) */
  identified: boolean;
  hostile: boolean;
  rangeM: number;
}

export interface Threat {
  /** search = 탐색 레이더 조사, track = 추적(락), launch = 유도 신호(발사 경보), missile = 비행 중 미사일 */
  kind: 'search' | 'track' | 'launch' | 'missile';
  source: Entity;
  /** 기수 기준 상대 방위 (deg, -180..180, 양수 = 오른쪽) */
  bearingDeg: number;
  elevationDeg: number;
  /** 알 수 있으면 거리 (MAW 는 대략, RWR 은 null) */
  rangeM: number | null;
  timeToImpact: number | null;
  detectedBy: 'rwr' | 'maw';
  /** 표시 문자 (예: 'Su-35', 'SA-10', 'MSL') */
  label: string;
}

export type RadarMode = 'off' | 'rws' | 'tws' | 'stt' | 'ag';

export interface LockState {
  status: 'none' | 'searching' | 'locking' | 'locked';
  /** 0..1 락 진행 */
  progress: number;
  target: Entity | null;
}

export interface Avionics {
  radarMode: RadarMode;
  /** 현재 센서 그림 (레이더+IRST+데이터링크+육안 융합) */
  readonly tracks: ReadonlyArray<Track>;
  /** 지정 표적 (HUD 의 락 박스) */
  readonly target: Track | null;
  readonly threats: ReadonlyArray<Threat>;
  /** 접근 중 미사일 감지 (RWR 발사경보 또는 MAW) */
  readonly missileWarning: boolean;
  jammerActive: boolean;
  update(dt: number, sim: Sim): void;
  setRadarMode(mode: RadarMode): void;
  /** 표적 순환 (에이스컴뱃식 표적 전환). filter 로 공중/지상 우선 */
  cycleTarget(sim: Sim, direction?: 1 | -1, filter?: 'air' | 'ground' | 'any'): void;
  /** 기수 정면에 가장 가까운 표적 지정 */
  targetNearestToBoresight(sim: Sim, filter?: 'air' | 'ground' | 'any'): void;
  designate(entity: Entity | null): void;
  /** 선택 무장의 락 상태 (HUD 락 박스/톤에 사용) */
  lockState(weapon: WeaponDef | null, sim: Sim): LockState;
  isTracked(entity: Entity): boolean;
}

export interface StoreGroup {
  weaponId: string;
  def: WeaponDef;
  count: number;
  stations: string[];
}

export interface LaunchZone {
  rMin: number;
  rMax: number;
  /** 회피불가 거리 */
  rNez: number;
  range: number;
  inRange: boolean;
  inNez: boolean;
}

export interface Stores {
  readonly gun: { def: WeaponDef; rounds: number; firing: boolean } | null;
  /** 발사 가능한 무장 묶음 (포드/탱크 제외) */
  readonly groups: ReadonlyArray<StoreGroup>;
  /** groups 인덱스. 무장이 없으면 -1 */
  selected: number;
  readonly chaff: number;
  readonly flares: number;
  /** 현재 외부/내부 무장 질량 (발사하면 감소) */
  readonly massKg: number;
  /** 현재 외부 무장 항력 면적 CdA (m²) */
  readonly dragArea: number;
  /** 현재 외부 무장 RCS 증가분 (m²) */
  readonly rcsAdd: number;
  /** 외부 연료탱크 연료 (kg) — 비행모델이 먼저 소모 */
  externalFuelKg: number;
  update(dt: number, sim: Sim): void;
  selectNext(direction?: 1 | -1): void;
  selectedDef(): WeaponDef | null;
  setGunTrigger(on: boolean): void;
  /** 선택 무장을 현재 지정 표적으로 발사. 발사체 반환 (못 쏘면 null) */
  fire(sim: Sim): Entity | null;
  dropFlare(sim: Sim): void;
  dropChaff(sim: Sim): void;
  /** 외부 탱크·공대지 무장 투하 */
  jettison(sim: Sim): void;
  launchZone(target: Entity | null, sim: Sim): LaunchZone | null;
}

export interface MissileLike extends Entity {
  readonly kind: 'missile';
  readonly def: WeaponDef;
  readonly shooter: Entity | null;
  target: Entity | null;
  readonly guidanceType: GuidanceType;
  readonly motorBurning: boolean;
  /** 능동 레이더 시커 작동 중 (RWR 이 감지) */
  readonly seekerActive: boolean;
  readonly timeOfFlight: number;
}

export interface DecoyLike extends Entity {
  readonly kind: 'decoy';
  readonly decoyType: 'flare' | 'chaff' | 'towed';
  /** 기만 강도 (시간에 따라 감소) */
  strength: number;
  readonly owner: Entity | null;
}

// 타입 가드
export const isAircraft = (e: Entity): e is AircraftLike => e.kind === 'aircraft';
export const isMissile = (e: Entity): e is MissileLike => e.kind === 'missile';
export const isDecoy = (e: Entity): e is DecoyLike => e.kind === 'decoy';
