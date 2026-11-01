// 모듈 간 서비스 인터페이스. Sim.services 로 접근한다.
// 구현 모듈이 아직 연결되지 않아도 돌아가도록 Null 구현을 제공한다.
import * as THREE from 'three';
import type { Entity } from './entity';
import type { Sim } from './sim';
import type { AISkill, Faction } from './types';
import type { AircraftLike, Avionics, Stores } from './contracts';
import type { Loadout } from '../data/schema';

// ---------------------------------------------------------------- 지형 (src/world)

export interface TerrainService {
  /** 지면 고도 (m). 바다는 0 */
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** 두 점 사이 지형 가림 없음 */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** 플레이 가능 영역 반경 (m, 원점 중심) */
  readonly mapRadius: number;
}

// ---------------------------------------------------------------- 시각효과 (src/world/fx)

export interface FxHandle {
  stop(): void;
}

export type ExplosionKind = 'air' | 'ground' | 'water' | 'small' | 'nuclear' | 'mouk';

export interface FxService {
  explosion(pos: THREE.Vector3, opts?: { size?: number; kind?: ExplosionKind }): void;
  /** 미사일 연기/화염 궤적. 엔티티가 죽으면 자동 정지(연기는 서서히 사라짐) */
  missileTrail(missile: Entity, smoke: 'low' | 'medium' | 'high'): FxHandle;
  /** 피격/파괴된 기체의 연기·화염 궤적 */
  damageTrail(entity: Entity, kind: 'smoke' | 'fire'): FxHandle;
  /** 예광탄 (순수 시각) */
  tracer(origin: THREE.Vector3, velocity: THREE.Vector3, lifetime: number): void;
  /** 플레어/채프 시각 효과 — 디코이 엔티티를 따라감 */
  decoy(decoy: Entity, type: 'flare' | 'chaff'): FxHandle;
  hit(pos: THREE.Vector3, kind?: 'spark' | 'debris' | 'dust' | 'splash'): void;
  /** 노즐 화염. nozzles = 모델 로컬 좌표. level(): 0..1 군용, 1..2 애프터버너 */
  afterburner(target: THREE.Object3D, nozzles: THREE.Vector3[], level: () => number): FxHandle;
  /** 고G 날개끝 베이퍼 / 비행운. intensity(): 0..1 */
  vapor(aircraft: Entity, wingtips: THREE.Vector3[], intensity: () => number): FxHandle;
  /** 카메라 흔들림 요청 (0..1) */
  shake(amount: number): void;
  readonly shakeAmount: number;
}

// ---------------------------------------------------------------- 오디오 (src/audio)

export type SoundId =
  | 'gun'
  | 'missile_launch'
  | 'bomb_release'
  | 'explosion_near'
  | 'explosion_far'
  | 'hit'
  | 'flare'
  | 'chaff'
  | 'weapon_select'
  | 'target_switch'
  | 'radio_in'
  | 'radio_out'
  | 'ui_click'
  | 'ui_confirm'
  | 'ui_back'
  | 'mission_complete'
  | 'mission_failed'
  | 'sonic_boom';

export type LoopSoundId = 'engine' | 'afterburner' | 'wind' | 'gun_loop';

/** 조종석 경고음 (켜고 끄는 지속음) */
export type ToneId =
  | 'ir_search' // AIM-9 시커 그르렁
  | 'ir_lock'
  | 'radar_lock'
  | 'rwr_search'
  | 'rwr_lock'
  | 'missile_launch' // 발사 경보
  | 'missile_incoming' // 근접 미사일
  | 'stall'
  | 'overg'
  | 'pull_up'
  | 'low_fuel';

export interface LoopHandle {
  set(params: { volume?: number; rate?: number; position?: THREE.Vector3 }): void;
  stop(): void;
}

export interface AudioService {
  play(id: SoundId, opts?: { position?: THREE.Vector3; volume?: number; rate?: number }): void;
  loop(id: LoopSoundId, opts?: { position?: THREE.Vector3; volume?: number; rate?: number }): LoopHandle;
  setTone(id: ToneId, on: boolean): void;
  setListener(position: THREE.Vector3, quaternion: THREE.Quaternion, velocity: THREE.Vector3): void;
}

// ---------------------------------------------------------------- 무장 (src/combat)

export interface LaunchRequest {
  weaponId: string;
  shooter: Entity | null;
  target: Entity | null;
  /** 지점 표적 (GPS 폭탄, 순항미사일) */
  targetPoint?: THREE.Vector3;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface WeaponService {
  /** 무장 발사체(미사일/폭탄) 생성. SAM/함정/AI 도 이걸 쓴다 */
  launch(req: LaunchRequest, sim: Sim): Entity | null;
  /** 기관포 1 점사 (지상 대공포/CIWS 용; 항공기는 Stores 사용) */
  fireGun(shooter: Entity, gunWeaponId: string, origin: THREE.Vector3, direction: THREE.Vector3, sim: Sim): void;
  /** 디코이 생성 */
  dropDecoy(owner: Entity, type: 'flare' | 'chaff', sim: Sim): Entity | null;
  /** 항공기의 항전/무장 시스템 생성 (Aircraft 생성자가 호출) */
  createAvionics(owner: AircraftLike, sim: Sim): Avionics;
  createStores(owner: AircraftLike, sim: Sim): Stores;
  /** 범위 폭발 피해 적용 (반경 내 엔티티에 거리 감쇠 피해) */
  applyBlast(center: THREE.Vector3, radiusM: number, damage: number, source: Entity | null, weaponId: string | null, sim: Sim): void;
}

// ---------------------------------------------------------------- 스폰 (src/game, 통합)

export interface AircraftSpawn {
  defId: string;
  faction: Faction;
  position: THREE.Vector3;
  /** 방위 (deg) */
  heading: number;
  /** 초기 속도 m/s */
  speed: number;
  /** 'default' = 기체 첫 프리셋 */
  loadout?: Loadout | 'default';
  presetId?: string;
  controller: 'player' | 'ai' | 'wingman' | 'none';
  skill?: AISkill;
  callsign?: string;
  tags?: string[];
  /** 윙맨이면 편대장 */
  leader?: AircraftLike;
  /** 편대 내 위치 (1 = 2번기 ...) */
  formationSlot?: number;
}

export interface GroundSpawn {
  unitId: string;
  faction: Faction;
  /** x, z (y 는 지형에 맞춤). 함정은 해수면 */
  position: THREE.Vector3;
  heading: number;
  tags?: string[];
  callsign?: string;
  /** 이동 경로 (차량/함정) */
  waypoints?: THREE.Vector3[];
}

export interface SpawnService {
  aircraft(req: AircraftSpawn): AircraftLike;
  ground(req: GroundSpawn): Entity;
}

// ---------------------------------------------------------------- 무전 (UI 자막)

export interface RadioMessage {
  /** 화자 (예: 'Lancer 2', 'AWACS Bellwether') */
  speaker: string;
  text: string;
  /** 표시 색 구분 */
  side?: 'friendly' | 'enemy' | 'neutral' | 'command';
  /** 표시 시간 (s), 기본은 글자 수 기반 */
  duration?: number;
  /** 높을수록 다른 메시지를 끊고 먼저 표시 */
  priority?: number;
}

export interface RadioService {
  say(msg: RadioMessage): void;
}

// ---------------------------------------------------------------- 미션 (src/campaign)

export interface ObjectiveState {
  id: string;
  text: string;
  status: 'active' | 'complete' | 'failed' | 'hidden';
  primary: boolean;
  progress?: { current: number; total: number };
}

export interface MissionState {
  id: string;
  title: string;
  elapsed: number;
  /** 남은 시간 (s), 제한 없으면 null */
  timeLeft: number | null;
  score: number;
  kills: number;
  objectives: ObjectiveState[];
  result: null | 'success' | 'failure';
  failReason?: string;
}

export interface MissionService {
  readonly state: MissionState | null;
}

// ---------------------------------------------------------------- 묶음

export interface Services {
  terrain: TerrainService;
  fx: FxService;
  audio: AudioService;
  weapons: WeaponService;
  spawn: SpawnService;
  radio: RadioService;
  mission: MissionService;
}

// ---------------------------------------------------------------- Null 구현

const NOOP_HANDLE: FxHandle & LoopHandle = { stop() {}, set() {} };

export const nullTerrain: TerrainService = {
  heightAt: () => 0,
  isWater: () => true,
  normalAt: (_x, _z, out) => out.set(0, 1, 0),
  lineOfSight: () => true,
  mapRadius: 100_000,
};

export const nullFx: FxService = {
  explosion() {},
  missileTrail: () => NOOP_HANDLE,
  damageTrail: () => NOOP_HANDLE,
  tracer() {},
  decoy: () => NOOP_HANDLE,
  hit() {},
  afterburner: () => NOOP_HANDLE,
  vapor: () => NOOP_HANDLE,
  shake() {},
  shakeAmount: 0,
};

export const nullAudio: AudioService = {
  play() {},
  loop: () => NOOP_HANDLE,
  setTone() {},
  setListener() {},
};

function missing(name: string): never {
  throw new Error(`[services] ${name} 가 아직 연결되지 않았다`);
}

export const nullWeapons: WeaponService = {
  launch: () => null,
  fireGun() {},
  dropDecoy: () => null,
  createAvionics: () => missing('weapons.createAvionics'),
  createStores: () => missing('weapons.createStores'),
  applyBlast() {},
};

export const nullSpawn: SpawnService = {
  aircraft: () => missing('spawn.aircraft'),
  ground: () => missing('spawn.ground'),
};

export function createNullServices(): Services {
  return {
    terrain: nullTerrain,
    fx: nullFx,
    audio: nullAudio,
    weapons: nullWeapons,
    spawn: nullSpawn,
    radio: { say() {} },
    mission: { state: null },
  };
}
