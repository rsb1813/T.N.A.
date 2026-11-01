// 시뮬레이션 컨텍스트. 모든 update(dt, sim) 이 받는 객체.
import type * as THREE from 'three';
import { EventBus } from './events';
import { Relations } from './factions';
import { Rng } from './rng';
import { createNullServices, type RadioMessage, type Services } from './services';
import { DEFAULT_SETTINGS, type GameSettings } from './settings';
import { World } from './world';
import type { Entity } from './entity';
import type { DamageInfo, DamageKind } from './types';
import type { GameDatabase } from '../data/schema';

export interface GameEvents {
  damaged: { entity: Entity; info: DamageInfo };
  destroyed: { entity: Entity; by: Entity | null; weaponId: string | null; cause: DamageKind };
  /** 미사일/폭탄 발사 */
  weaponLaunched: { weapon: Entity; shooter: Entity | null; target: Entity | null; weaponId: string };
  /** 미사일이 표적을 놓치고 소멸 */
  weaponMissed: { weapon: Entity; target: Entity | null };
  gunFired: { shooter: Entity; weaponId: string };
  radio: RadioMessage;
  /** 플레이어 입력 등에서 나온 UI 동작 (pause, map, ...) */
  uiAction: { action: string };
  /** 플레이어 → 윙맨 명령 */
  wingmanCommand: { command: 'attack' | 'cover' | 'formation' | 'engage_free' };
  objectiveChanged: { id: string };
  missionEnded: { result: 'success' | 'failure'; reason?: string };
  /** 플레이어가 표적을 바꿈 */
  targetChanged: { entity: Entity | null };
}

export interface Sim {
  /** 미션 시작 후 경과한 시뮬레이션 시간 (s) */
  time: number;
  frame: number;
  readonly world: World;
  readonly events: EventBus<GameEvents>;
  readonly rng: Rng;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly relations: Relations;
  settings: GameSettings;
  services: Services;
  readonly db: GameDatabase;
}

export function createSim(opts: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  db: GameDatabase;
  seed?: number;
  settings?: GameSettings;
}): Sim {
  const relations = new Relations();
  const events = new EventBus<GameEvents>();
  const services = createNullServices();
  services.radio = { say: (msg) => events.emit('radio', msg) };
  return {
    time: 0,
    frame: 0,
    world: new World(opts.scene, relations),
    events,
    rng: new Rng(opts.seed ?? 1),
    scene: opts.scene,
    camera: opts.camera,
    relations,
    settings: opts.settings ?? structuredClone(DEFAULT_SETTINGS),
    services,
    db: opts.db,
  };
}
