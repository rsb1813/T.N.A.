// 기체 정의 작성 헬퍼 (스테이션 대칭 쌍, 모듈 슬롯 표, 프리셋 장착).
import { MODULES } from './modules';
import type { AircraftDef, ModuleSlot, StationDef, StationLoad, UnlockReq, WeaponCategory } from './schema';
import { MODULE_SLOTS } from './schema';

export const FREE: UnlockReq = { cost: 0 };

export interface StationSpec {
  internal?: boolean;
  maxMassKg: number;
  allowed: Array<WeaponCategory | string>;
  maxCount?: number;
  limits?: Partial<Record<WeaponCategory | string, number>>;
}

type Vec3 = [number, number, number];

export function station(id: string, label: string, position: Vec3, spec: StationSpec): StationDef {
  return { id, label, internal: spec.internal ?? false, maxMassKg: spec.maxMassKg, allowed: [...spec.allowed], ...opt(spec), position };
}

/** 좌우 대칭 스테이션 쌍. position 은 좌측(-X) 좌표, 우측은 x 부호 반전 */
export function pair(left: string, right: string, label: string, position: Vec3, spec: StationSpec): [StationDef, StationDef] {
  const [x, y, z] = position;
  return [
    { ...station(left, `좌 ${label}`, [x, y, z], spec), mirror: right },
    { ...station(right, `우 ${label}`, [-x, y, z], spec), mirror: left },
  ];
}

function opt(spec: StationSpec): Partial<StationDef> {
  const o: Partial<StationDef> = {};
  if (spec.maxCount !== undefined) o.maxCount = spec.maxCount;
  if (spec.limits) o.limits = { ...spec.limits };
  return o;
}

/**
 * 모듈 슬롯 표. 값 = [기본값, ...추가 허용 목록]. 기본값은 자동으로 허용 목록에 들어간다.
 * 지정하지 않은 슬롯은 { default: null, allowed: [] }.
 */
export function moduleTable(spec: Partial<Record<ModuleSlot, [string | null, ...string[]]>>): AircraftDef['modules'] {
  const out = {} as AircraftDef['modules'];
  for (const slot of MODULE_SLOTS) {
    const s = spec[slot];
    if (!s) {
      out[slot] = { default: null, allowed: [] };
      continue;
    }
    const [dflt, ...rest] = s;
    const allowed = [...new Set([...(dflt ? [dflt] : []), ...rest])];
    out[slot] = { default: dflt, allowed };
  }
  return out;
}

/** 엔진 모듈 성능으로 AircraftDef.engine 작성 */
export function engineFrom(moduleId: string, count: number): AircraftDef['engine'] {
  const e = MODULES[moduleId]?.engine;
  if (!e) throw new Error(`[data] 엔진 모듈 '${moduleId}' 없음`);
  return { name: moduleId, count, ...e };
}

export const ld = (weaponId: string, count = 1): StationLoad => ({ weaponId, count });

/** 대칭 스테이션에 같은 무장 */
export function both(left: string, right: string, load: StationLoad): Record<string, StationLoad> {
  return { [left]: { ...load }, [right]: { ...load } };
}
