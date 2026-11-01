// 게임 DB 조립 (index.ts 와 loadout.ts 가 공유 — 순환 import 방지용으로 분리)
import { AIRCRAFT } from './aircraft';
import { MODULES } from './modules';
import type { GameDatabase } from './schema';
import { UNITS } from './units';
import { WEAPONS } from './weapons';

export const DB: GameDatabase = { aircraft: AIRCRAFT, weapons: WEAPONS, modules: MODULES, units: UNITS };
