// 미션이 쓰는 프리셋 의도(PresetIntent)를 data 의 실제 LoadoutPreset.id 로 해석한다.
// data 쪽 프리셋 id 가 확정되기 전에도 미션 정의가 깨지지 않게 키워드로 찾는다.
import type { GameDatabase, Loadout, WeaponDef } from '../data/schema';

export type PresetIntent = 'air' | 'strike' | 'sead' | 'antiship' | 'intercept';

export const PRESET_INTENTS: readonly PresetIntent[] = ['air', 'strike', 'sead', 'antiship', 'intercept'];

const INTENT_KEYWORDS: Record<PresetIntent, string[]> = {
  air: ['air_superiority', 'superiority', 'air', 'cap', 'a2a', 'fighter', '제공'],
  strike: ['strike', 'attack', 'a2g', 'ground', 'bomb', '공격', '타격', '폭격'],
  sead: ['sead', 'dead', 'wild', 'arm', '방공', '제압'],
  antiship: ['antiship', 'anti_ship', 'anti-ship', 'ship', 'naval', 'maritime', '대함'],
  intercept: ['intercept', 'interceptor', 'long', 'phoenix', '요격'],
};

/**
 * preset(실제 id 또는 의도) → 해당 기체의 LoadoutPreset.id.
 * - DB 에 기체가 없으면 입력값 그대로 (스폰 서비스가 판단)
 * - 찾지 못하면 undefined (스폰 서비스가 기본 프리셋 사용)
 */
export function resolvePresetId(db: GameDatabase | null | undefined, aircraftId: string, preset: string | undefined): string | undefined {
  if (!preset) return undefined;
  const def = db?.aircraft?.[aircraftId];
  if (!def) return preset;
  if (def.presets.some((p) => p.id === preset)) return preset;
  const keys = INTENT_KEYWORDS[preset as PresetIntent] ?? [preset.toLowerCase()];
  for (const key of keys) {
    const hit = def.presets.find((p) => p.id.toLowerCase().includes(key) || p.name.toLowerCase().includes(key));
    if (hit) return hit.id;
  }
  return undefined;
}

/** 무장 없는 로드아웃 (표적기/훈련기) */
export function emptyLoadout(aircraftId: string): Loadout {
  return { aircraftId, modules: {}, stations: {}, fuel: 1 };
}

/** 후보 무장 id 중 DB 에 있는 첫 번째. DB 가 비었으면(테스트) 첫 후보 */
export function pickWeapon(db: GameDatabase | null | undefined, candidates: string | readonly string[]): string | null {
  const list = typeof candidates === 'string' ? [candidates] : candidates;
  const weapons = db?.weapons;
  if (!weapons || Object.keys(weapons).length === 0) return list[0] ?? null;
  for (const id of list) if (weapons[id]) return id;
  return null;
}

export function weaponDef(db: GameDatabase | null | undefined, id: string | null | undefined): WeaponDef | null {
  if (!id) return null;
  return db?.weapons?.[id] ?? null;
}
