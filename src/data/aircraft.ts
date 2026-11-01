// 기체 DB: 플레이어(NATO 개량형) + 적 (바르샤바 / 팍스 / WON).
import { ENEMY_AIRCRAFT } from './aircraft-enemy';
import { PLAYER_AIRCRAFT } from './aircraft-player';
import type { AircraftDef } from './schema';

export { PLAYER_AIRCRAFT } from './aircraft-player';
export { ENEMY_AIRCRAFT } from './aircraft-enemy';

export const AIRCRAFT: Record<string, AircraftDef> = Object.fromEntries([...PLAYER_AIRCRAFT, ...ENEMY_AIRCRAFT].map((a) => [a.id, a]));

/** 플레이어 기체 id (격납고 순서) */
export const PLAYER_AIRCRAFT_IDS: readonly string[] = PLAYER_AIRCRAFT.map((a) => a.id);
