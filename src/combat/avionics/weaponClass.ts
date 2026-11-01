// 무장 정의 → 락 방식/표적 종류 분류.
import type { Entity } from '../../core/entity';
import type { WeaponCategory, WeaponDef } from '../../data/schema';

export type LockKind = 'none' | 'ir' | 'radar' | 'sarh' | 'eo' | 'laser' | 'gps' | 'arm';
export type TargetFilter = 'air' | 'ground' | 'any';

const AIR_TO_GROUND = new Set<WeaponCategory>(['agm', 'arm', 'ashm', 'bomb_gps', 'bomb_laser', 'bomb_dumb', 'bomb_cluster', 'nuke']);
const AIR_TO_AIR = new Set<WeaponCategory>(['aam_ir', 'aam_radar', 'aam_sarh', 'aam_long']);

export function isAirToGround(def: WeaponDef | null | undefined): boolean {
  return !!def && AIR_TO_GROUND.has(def.category);
}

export function isAirToAir(def: WeaponDef | null | undefined): boolean {
  return !!def && AIR_TO_AIR.has(def.category);
}

/** 락 방식. 공대지 무장에 붙은 'ir' 유도(IIR 매버릭 등)는 영상 유도로 취급한다 */
export function lockKindOf(def: WeaponDef | null | undefined): LockKind {
  if (!def?.guidance) return 'none';
  switch (def.guidance.type) {
    case 'ir':
      return isAirToGround(def) ? 'eo' : 'ir';
    case 'active_radar':
      return 'radar';
    case 'sarh':
      return 'sarh';
    case 'eo':
      return 'eo';
    case 'laser':
      return 'laser';
    case 'gps':
      return 'gps';
    case 'anti_radiation':
      return 'arm';
    default:
      return 'none';
  }
}

/** 표시/락 참고 최대 사거리 (m) */
export function weaponMaxRangeM(def: WeaponDef): number {
  if (def.envelope) return def.envelope.rMaxKm * 1000;
  if (def.guidance) return def.guidance.seekerRangeKm * 3000;
  return 10_000;
}

/** 선택 무장에 맞는 표적 우선 종류 */
export function preferredFilter(def: WeaponDef | null | undefined): TargetFilter {
  if (isAirToGround(def)) return 'ground';
  if (isAirToAir(def)) return 'air';
  return 'any';
}

export function isAirEntity(e: Entity): boolean {
  return e.kind === 'aircraft' || e.targetClass === 'air' || e.targetClass === 'weapon';
}

export function matchesFilter(e: Entity, f: TargetFilter): boolean {
  if (f === 'any') return true;
  return f === 'air' ? isAirEntity(e) : !isAirEntity(e);
}
