// 미션 정의와 미션 스크립트 작성 API(MissionContext) 타입.
// 좌표는 월드 m: x = 동(+)/서(-), z = 남(+)/북(-), alt = 해발 고도. 방위 0 = 북, 90 = 동.
import type * as THREE from 'three';
import type { AircraftLike } from '../core/contracts';
import type { Entity } from '../core/entity';
import type { EnvironmentOptions } from '../core/environment';
import type { Rng } from '../core/rng';
import type { AircraftSpawn, ObjectiveState, RadioMessage } from '../core/services';
import type { Sim } from '../core/sim';
import type { AISkill, Faction } from '../core/types';
import type { Loadout } from '../data/schema';
import type { CastId, CastMember } from './cast';

export const MISSION_IDS = [
  'm00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10',
  'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20',
] as const;
export type MissionId = (typeof MISSION_IDS)[number];

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

/** 공중 위치 */
export interface AirPos {
  x: number;
  z: number;
  alt: number;
}
/** 지상 위치 (고도는 지형에 맞춘다) */
export interface GroundPos {
  x: number;
  z: number;
}

// ---------------------------------------------------------------- 브리핑

export type MarkerKind = 'friendly' | 'enemy' | 'target' | 'objective';

export interface MapMarker {
  x: number;
  z: number;
  label: string;
  kind: MarkerKind;
  /** 구역 표시 반경 (m) — SAM 위협권, 보급 구역 등 */
  radius?: number;
  /** 고도 (m) — 런타임 웨이포인트 등 3D 마커 */
  alt?: number;
}

export interface MissionBriefing {
  /** 브리핑 본문 (문단별) */
  paragraphs: string[];
  /** 목표 목록 (브리핑 화면용 문구) */
  objectivesText: string[];
  mapMarkers: MapMarker[];
  /** 예상 위협 */
  threats?: string[];
  /** 추천 기체/무장 한 줄 */
  recommendation?: string;
}

// ---------------------------------------------------------------- 정의

export type MissionKind =
  | 'tutorial'
  | 'air_superiority'
  | 'strike'
  | 'sead'
  | 'anti_ship'
  | 'intercept'
  | 'escort'
  | 'defense'
  | 'precision'
  | 'ace'
  | 'superweapon'
  | 'skirmish';

export interface PlayerStartDef {
  position: AirPos;
  heading: number;
  /** 초기 속도 m/s */
  speed: number;
  /** 허용 기체 (생략 = 전 기체) */
  allowedAircraft?: string[];
  /** 추천 프리셋 (LoadoutPreset.id 또는 PresetIntent) */
  recommendedPreset?: string;
  /** 전술핵 장착 허용 */
  allowNuclear?: boolean;
}

export interface WingmanDef {
  callsign: string;
  aircraftId: string;
  /** LoadoutPreset.id 또는 PresetIntent (resolvePresetId 로 해석) */
  presetId?: string;
  skill?: AISkill;
}

export interface RankThresholds {
  S: number;
  A: number;
  B: number;
  C: number;
}

export interface MissionUnlocks {
  aircraft?: string[];
  weapons?: string[];
  modules?: string[];
}

export interface MissionDef {
  id: string;
  /** 막 (1..4) */
  act: number;
  /** 막 안에서의 순서 (m00 = 0) */
  index: number;
  title: string;
  subtitle: string;
  /** 작전 일자 (YYYY-MM-DD) */
  date: string;
  location: string;
  /** false = 개발 중 (선택 불가) */
  available: boolean;
  kinds: MissionKind[];
  briefing: MissionBriefing;
  environment: EnvironmentOptions;
  player: PlayerStartDef;
  wingmen: WingmanDef[];
  /** 제한 시간 (s) */
  timeLimit?: number;
  /** 시간 보너스 기준 시간 (s). 생략 시 timeLimit 또는 900 */
  parTime?: number;
  rankThresholds: RankThresholds;
  /** 성공 기본 보상 크레딧 */
  reward: number;
  /** 첫 성공 시 해금 */
  unlocks?: MissionUnlocks;
  /** 전투 무전(chatter) 사용. 기본 true */
  chatter?: boolean;
  /** 스크립트가 스폰할 수 있는 기체/유닛 id (모델 사전 로드용). 플레이어·윙맨 기체는 제외 */
  roster?: { aircraft: string[]; units: string[] };
  /** 미션 스크립트. MissionRunner.start() 에서 한 번 호출된다 */
  script(ctx: MissionContext): void;
}

export interface CampaignAct {
  id: number;
  title: string;
  subtitle: string;
  missions: MissionDef[];
}

export interface Campaign {
  acts: CampaignAct[];
}

// ---------------------------------------------------------------- 결과

export interface KillEntry {
  /** 표시 이름 (Entity.name) */
  name: string;
  count: number;
  score: number;
}

export interface ScoreLine {
  label: string;
  value: number;
}

export interface MissionResult {
  missionId: string;
  title: string;
  success: boolean;
  reason?: string;
  rank: Rank;
  score: number;
  timeSec: number;
  kills: KillEntry[];
  totalKills: number;
  /** 미사일/폭탄 발사 수 */
  shotsFired: number;
  /** 적에게 피해를 준 미사일/폭탄 수 */
  hits: number;
  /** hits / shotsFired (발사 없으면 0) */
  accuracy: number;
  /** 기관포 명중 횟수 */
  gunHits: number;
  /** 받은 피해 (최대 HP 대비 %) */
  damageTaken: number;
  creditsEarned: number;
  /** 점수 내역 (결과 화면) */
  breakdown: ScoreLine[];
  objectives: ObjectiveState[];
  wingmanKills: number;
  friendlyLosses: number;
}

// ---------------------------------------------------------------- AI 지시 (스폰 요청 확장)

/** AI 역할. AircraftSpawn 에 role 필드가 없어서 CampaignAircraftSpawn.role 과 태그 'role:<id>' 로 함께 전달한다 */
export type AIRole =
  | 'cap' // 구역 초계, 접근하는 적 요격
  | 'sweep' // 공격적 제공 소탕
  | 'escort' // orders.escortTag 엔티티 호위
  | 'strike' // orders.targetTag / waypoints 의 지상·해상 표적 공격
  | 'bomber' // 경로 비행 후 표적 폭격, 회피 기동 최소
  | 'interceptor' // 고속 요격
  | 'awacs' // 후방 선회, 교전 회피
  | 'patrol' // orders.patrol 구역 선회
  | 'drone'; // 표적기: 직선/선회 비행만, 교전 안 함

export interface AIOrders {
  waypoints?: THREE.Vector3[];
  loop?: boolean;
  targetTag?: string;
  escortTag?: string;
  patrol?: { center: THREE.Vector3; radius: number };
  /** 무장 사용 금지 */
  holdFire?: boolean;
}

export interface CampaignAircraftSpawn extends AircraftSpawn {
  role?: AIRole;
  orders?: AIOrders;
}

// ---------------------------------------------------------------- 스폰 명세 (스크립트 작성용)

export interface AirSpawnSpec {
  aircraftId: string;
  faction: Faction;
  at: AirPos;
  heading: number;
  /** m/s, 기본 230 */
  speed?: number;
  skill?: AISkill;
  role?: AIRole;
  callsign?: string;
  /** 표시 이름 덮어쓰기 (예: '미상기') */
  name?: string;
  tags?: string[];
  /** 주요 표적 ('target' 태그 → HUD TGT) */
  target?: boolean;
  presetId?: string;
  loadout?: Loadout | 'default';
  /** 무장 없음 (표적기) */
  unarmed?: boolean;
  /** 격추 점수 덮어쓰기 */
  score?: number;
  controller?: 'ai' | 'none';
  invulnerable?: boolean;
  waypoints?: AirPos[];
  loop?: boolean;
  targetTag?: string;
  escortTag?: string;
  patrol?: { at: AirPos; radius: number };
  holdFire?: boolean;
}

export type Formation = 'wedge' | 'line' | 'echelon' | 'trail' | 'box' | 'spread';

/** 숙련도: 단일 / 기체 순서대로 배열 / 비율 ({ ace: 1, veteran: 2 } → 선두부터 ace, veteran, veteran, 나머지는 마지막 값) */
export type SkillMix = AISkill | AISkill[] | Partial<Record<AISkill, number>>;

export interface AirGroupSpec extends Omit<AirSpawnSpec, 'skill' | 'callsign'> {
  count: number;
  formation?: Formation;
  /** 기체 간격 m (기본 400) */
  spacing?: number;
  skill?: SkillMix;
  /** 'Raven' → 'Raven 1', 'Raven 2' ... */
  callsign?: string;
}

export interface GroundSpawnSpec {
  unitId: string;
  faction: Faction;
  at: GroundPos;
  heading?: number;
  callsign?: string;
  name?: string;
  tags?: string[];
  target?: boolean;
  score?: number;
  waypoints?: GroundPos[];
  invulnerable?: boolean;
}

export type GroundPattern = 'ring' | 'line' | 'column' | 'grid' | 'scatter';

export interface GroundGroupSpec extends Omit<GroundSpawnSpec, 'callsign'> {
  count: number;
  pattern?: GroundPattern;
  /** 간격 m (line/column/grid, 기본 60) */
  spacing?: number;
  /** ring/scatter 반경 m (기본 200) */
  radius?: number;
  callsign?: string;
}

// ---------------------------------------------------------------- 스크립트 API

export interface TimerHandle {
  cancel(): void;
  readonly active: boolean;
}

export interface ObjectiveOptions {
  /** 주목표 (기본 true). 주목표 실패 = 미션 실패 */
  primary?: boolean;
  /** 숨김 상태로 생성 (show() 로 공개) */
  hidden?: boolean;
  /** 이 태그 엔티티 파괴로 진행도 자동 갱신, 전부(또는 required) 파괴 시 완료 */
  destroy?: string;
  required?: number;
  /** 이 태그 엔티티 보호. 손실이 maxLosses(기본 0) 를 넘으면 실패. 미션 성공 시 완료 처리 */
  protect?: string;
  maxLosses?: number;
  /** 수동 진행도 총량 */
  total?: number;
  /** 달성 보너스 (기본 주목표 500, 보조 250) */
  score?: number;
  onComplete?: () => void;
  onFail?: () => void;
}

export interface ObjectiveHandle {
  readonly id: string;
  readonly status: ObjectiveState['status'];
  readonly primary: boolean;
  progress(current: number, total?: number): ObjectiveHandle;
  increment(n?: number): ObjectiveHandle;
  complete(): void;
  fail(reason?: string): void;
  show(): void;
  setText(text: string): void;
  onComplete(fn: () => void): ObjectiveHandle;
  onFail(fn: () => void): ObjectiveHandle;
}

export interface RadioLineOpts {
  priority?: number;
  duration?: number;
  side?: RadioMessage['side'];
}

/** 화자: 등장인물 id / 등장인물 / 임의 이름(콜사인) */
export type Speaker = CastId | CastMember | (string & {});
export type DialogueLine = readonly [Speaker, string] | readonly [Speaker, string, RadioLineOpts];

export type TriggerWho = 'player' | 'friendly' | 'hostile' | 'any' | { tag: string };

export interface AreaTriggerOptions {
  who?: TriggerWho;
  /** 기본 true: 한 번 발동 후 해제 */
  once?: boolean;
  minAlt?: number;
  maxAlt?: number;
  /** 'enter'(기본) 또는 'exit' */
  on?: 'enter' | 'exit';
  /** 런타임 지도/HUD 마커로 표시 */
  marker?: { label: string; kind?: MarkerKind };
}

export interface RearmZoneOptions {
  /** 기체별 재보급 간격 (s, 기본 45) */
  cooldown?: number;
  /** 구역 안에 머물러야 하는 시간 (s, 기본 2) */
  dwell?: number;
  maxAlt?: number;
  /** 윙맨도 재보급 (기본 true) */
  wingmen?: boolean;
  label?: string;
}

export interface WithdrawOptions {
  /** 플레이어와 이 거리 이상 멀어지면 제거 (기본 9000 m) */
  removeDistance?: number;
  /** 이 시간이 지나면 거리와 무관하게 제거 (기본 35 s) */
  maxTime?: number;
}

export interface LaunchSpec {
  /** 무장 id 또는 후보 목록 (DB 에 있는 첫 번째를 사용) */
  weapon: string | readonly string[];
  from: Entity;
  target: Entity | null;
  targetPoint?: THREE.Vector3;
  /** 발사 위치 오프셋 (월드, m) */
  offset?: THREE.Vector3;
  /** 초기 속도 (기본 발사체 속도 또는 250 m/s) */
  speed?: number;
  /** 수직 발사 (함정/SAM) */
  vertical?: boolean;
}

export interface LiveMarker extends MapMarker {
  id: number;
}

export interface MissionContext {
  readonly sim: Sim;
  readonly def: MissionDef;
  /** = sim.rng (미션 무작위성은 이것만) */
  readonly rng: Rng;
  /** 미션 경과 시간 (s) */
  readonly time: number;
  readonly player: AircraftLike | null;
  readonly wingmen: readonly AircraftLike[];
  /** 스크립트 자유 상태 */
  readonly vars: Record<string, unknown>;

  // 스폰
  spawnAir(spec: AirSpawnSpec): AircraftLike;
  spawnGround(spec: GroundSpawnSpec): Entity;
  spawnGroup(spec: AirGroupSpec): AircraftLike[];
  spawnGroup(spec: GroundGroupSpec): Entity[];
  /** 조용히 제거 (파괴 이벤트 없음) */
  despawn(e: Entity): void;
  /** 교전 이탈: 무적 + 중립화 후, 멀어지거나 시간이 지나면 제거 */
  withdraw(target: Entity | string, opts?: WithdrawOptions): void;
  setInvulnerable(target: Entity | string, on: boolean): void;

  // 무전
  /** 무전 한 줄. 표시 시간(s) 반환 */
  say(speaker: Speaker, text: string, opts?: RadioLineOpts): number;
  /** 대사 연속 재생 (앞 대사 표시 시간 + gap 후 다음 대사) */
  dialogue(lines: readonly DialogueLine[], opts?: { delay?: number; gap?: number; then?: () => void }): TimerHandle;

  // 목표
  objective(id: string, text: string, opts?: ObjectiveOptions): ObjectiveHandle;
  getObjective(id: string): ObjectiveHandle | null;

  // 시간/조건
  after(seconds: number, fn: () => void): TimerHandle;
  every(seconds: number, fn: (h: TimerHandle) => void, opts?: { immediate?: boolean; times?: number }): TimerHandle;
  when(cond: () => boolean, fn: () => void, opts?: { interval?: number; timeout?: number; onTimeout?: () => void }): TimerHandle;

  // 질의/이벤트
  countAlive(tag: string): number;
  alive(tag: string): Entity[];
  /** 태그(또는 엔티티)가 파괴될 때마다 */
  onDestroyed(target: string | Entity, fn: (e: Entity, by: Entity | null) => void): TimerHandle;
  /** 태그 엔티티가 모두 파괴되면 한 번 */
  onAllDestroyed(tag: string, fn: () => void): TimerHandle;
  areaTrigger(center: AirPos | GroundPos, radius: number, fn: (e: Entity) => void, opts?: AreaTriggerOptions): TimerHandle;
  setRelations(a: Faction, b: Faction, hostile: boolean): void;
  rearmZone(center: AirPos | GroundPos, radius: number, opts?: RearmZoneOptions): TimerHandle;
  /** 스크립트 발사 (대함 미사일 일제사격 등) */
  launch(spec: LaunchSpec): Entity | null;
  distanceToPlayer(target: Entity | AirPos | GroundPos): number;

  // 점수/표시
  addScore(points: number, label: string): void;
  addMarker(marker: MapMarker): number;
  removeMarker(id: number): void;
  setChatter(on: boolean): void;

  // 종료
  /** 모든 주목표 달성 시 자동 성공 (기본 true) */
  setAutoComplete(on: boolean): void;
  /** 제한 시간 만료 시 호출 (기본: 실패) */
  onTimeUp(fn: () => void): void;
  /** 결과 확정. delay(s) 뒤 missionEnded 발행 (기본 성공 5, 실패 2.5) */
  end(success: boolean, reason?: string, delay?: number): void;
}
