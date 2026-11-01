// 미션 작성용 조합 헬퍼: 방공 기지, 비행장, 수송대, 함대 등 자주 쓰는 배치를 한 줄로.
import type { Entity } from '../core/entity';
import type { Faction } from '../core/types';
import type { GroundPos, MissionContext } from './missionTypes';

export type SamSystem = 'sa10' | 'sa11' | 'sa15' | 'sa2' | 'rapier';

export interface SamSiteOptions {
  at: GroundPos;
  faction: Faction;
  system: SamSystem;
  /** 발사대 수 (기본: sa10 4, sa11 3, sa15 2, sa2 6, rapier 4) */
  launchers?: number;
  /** 근접 방공포 수 (기본 2) */
  aaa?: number;
  /** 대공포 종류 (기본: sa2 → zu23, 그 외 → zsu234) */
  aaaUnit?: string;
  /** 발사대 배치 반경 (m, 기본 240) */
  radius?: number;
  tags?: string[];
  /** 레이더·발사대에만 붙는 태그 (진지 무력화 목표용) */
  coreTags?: string[];
  /** 레이더/발사대를 주요 표적으로 */
  target?: boolean;
  callsign?: string;
}

export interface SamSite {
  radar: Entity | null;
  launchers: Entity[];
  aaa: Entity[];
  all: Entity[];
}

const SAM_LAYOUT: Record<SamSystem, { radar: string | null; launcher: string; count: number; aaa: string }> = {
  sa10: { radar: 'sa10_radar', launcher: 'sa10_tel', count: 4, aaa: 'zsu234' },
  sa11: { radar: null, launcher: 'sa11', count: 3, aaa: 'zsu234' },
  sa15: { radar: null, launcher: 'sa15', count: 2, aaa: 'zsu234' },
  sa2: { radar: 'sa2_radar', launcher: 'sa2_launcher', count: 6, aaa: 'zu23' },
  rapier: { radar: null, launcher: 'rapier', count: 4, aaa: 'zu23' },
};

/** 레이더 중앙, 발사대 원형, 대공포 외곽 배치의 SAM 진지 */
export function samSite(ctx: MissionContext, o: SamSiteOptions): SamSite {
  const L = SAM_LAYOUT[o.system];
  const tags = o.tags ?? [];
  const core = o.coreTags ?? [];
  const radius = o.radius ?? 240;
  const radar = L.radar
    ? ctx.spawnGround({ unitId: L.radar, faction: o.faction, at: o.at, tags: [...tags, ...core, 'sam_radar'], target: o.target, callsign: o.callsign })
    : null;
  const launchers = ctx.spawnGroup({
    unitId: L.launcher,
    faction: o.faction,
    at: o.at,
    count: o.launchers ?? L.count,
    pattern: 'ring',
    radius,
    tags: [...tags, ...core, 'sam_launcher'],
    target: o.target,
  });
  const aaaCount = o.aaa ?? 2;
  const aaa =
    aaaCount > 0
      ? ctx.spawnGroup({
          unitId: o.aaaUnit ?? L.aaa,
          faction: o.faction,
          at: { x: o.at.x + radius * 0.3, z: o.at.z - radius * 0.2 },
          count: aaaCount,
          pattern: 'ring',
          radius: radius * 2,
          tags: [...tags, 'aaa'],
        })
      : [];
  return { radar, launchers, aaa, all: [...(radar ? [radar] : []), ...launchers, ...aaa] };
}

export interface AirfieldOptions {
  at: GroundPos;
  /** 활주로 방향 (deg) */
  heading: number;
  faction: Faction;
  hangars?: number;
  fuelTanks?: number;
  /** 대형 격납고 수 */
  bigHangars?: number;
  tower?: boolean;
  tags?: string[];
  /** 격납고를 주요 표적으로 */
  targetHangars?: boolean;
  targetFuel?: boolean;
}

export interface Airfield {
  hangars: Entity[];
  fuel: Entity[];
  other: Entity[];
  all: Entity[];
}

/** 활주로 옆 강화 격납고 열, 연료 탱크, 관제탑 (활주로 자체는 environment.airbases 로 그린다) */
export function airfield(ctx: MissionContext, o: AirfieldOptions): Airfield {
  const tags = o.tags ?? [];
  const rad = (o.heading * Math.PI) / 180;
  // 활주로 방향 단위벡터와 오른쪽 수직
  const fx = Math.sin(rad);
  const fz = -Math.cos(rad);
  const rx = -fz;
  const rz = fx;
  const side = 450;
  const pos = (along: number, across: number): GroundPos => ({ x: o.at.x + fx * along + rx * across, z: o.at.z + fz * along + rz * across });
  const hangars: Entity[] = [];
  const n = o.hangars ?? 4;
  for (let i = 0; i < n; i++) {
    hangars.push(
      ctx.spawnGround({
        unitId: 'hangar_has',
        faction: o.faction,
        at: pos((i - (n - 1) / 2) * 140, side),
        heading: o.heading - 90,
        tags: [...tags, 'hangar'],
        target: o.targetHangars,
      }),
    );
  }
  for (let i = 0; i < (o.bigHangars ?? 0); i++) {
    hangars.push(
      ctx.spawnGround({ unitId: 'hangar_big', faction: o.faction, at: pos(-900 - i * 220, side + 120), heading: o.heading - 90, tags: [...tags, 'hangar'], target: o.targetHangars }),
    );
  }
  const fuel: Entity[] = [];
  for (let i = 0; i < (o.fuelTanks ?? 2); i++) {
    fuel.push(ctx.spawnGround({ unitId: 'fuel_tank', faction: o.faction, at: pos(900 + i * 70, side + 200), tags: [...tags, 'fuel'], target: o.targetFuel }));
  }
  const other: Entity[] = [];
  if (o.tower ?? true) other.push(ctx.spawnGround({ unitId: 'comm_tower', faction: o.faction, at: pos(0, side + 260), tags: [...tags, 'tower'] }));
  return { hangars, fuel, other, all: [...hangars, ...fuel, ...other] };
}

export interface ConvoyOptions {
  /** 선두부터 차량 종류 */
  units: string[];
  faction: Faction;
  at: GroundPos;
  heading: number;
  route: GroundPos[];
  spacing?: number;
  tags?: string[];
  target?: boolean;
}

/** 경로를 따라 이동하는 종대 */
export function convoy(ctx: MissionContext, o: ConvoyOptions): Entity[] {
  const spacing = o.spacing ?? 45;
  const rad = (o.heading * Math.PI) / 180;
  const bx = -Math.sin(rad);
  const bz = Math.cos(rad);
  return o.units.map((unitId, i) =>
    ctx.spawnGround({
      unitId,
      faction: o.faction,
      at: { x: o.at.x + bx * spacing * i, z: o.at.z + bz * spacing * i },
      heading: o.heading,
      waypoints: o.route,
      tags: o.tags,
      target: o.target,
    }),
  );
}

export interface FleetOptions {
  /** 기함부터 함정 종류 */
  ships: string[];
  faction: Faction;
  at: GroundPos;
  heading: number;
  route?: GroundPos[];
  /** 함정 간격 (m, 기본 900) */
  spacing?: number;
  tags?: string[];
  target?: boolean;
}

/** 쐐기형 함대 (기함 선두) */
export function fleet(ctx: MissionContext, o: FleetOptions): Entity[] {
  const spacing = o.spacing ?? 900;
  const rad = (o.heading * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fz = -Math.cos(rad);
  return o.ships.map((unitId, i) => {
    const k = Math.ceil(i / 2);
    const across = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * k * spacing;
    const back = k * spacing * 0.7;
    const x = o.at.x - fx * back - fz * across;
    const z = o.at.z - fz * back + fx * across;
    return ctx.spawnGround({
      unitId,
      faction: o.faction,
      at: { x, z },
      heading: o.heading,
      waypoints: o.route?.map((w) => ({ x: w.x - fx * back - fz * across, z: w.z - fz * back + fx * across })),
      tags: o.tags,
      target: o.target,
    });
  });
}

/** 살아있는 엔티티 중 기준점에 가장 가까운 것 */
export function nearestAlive(list: readonly Entity[], from: { x: number; z: number }): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of list) {
    if (!e.alive || e.removed) continue;
    const d = (e.position.x - from.x) ** 2 + (e.position.z - from.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
