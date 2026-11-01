// 엔티티 레지스트리와 공간 질의.
import * as THREE from 'three';
import type { Entity } from './entity';
import type { Relations } from './factions';
import type { Sim } from './sim';
import type { EntityKind, Faction, TargetClass } from './types';
import type { AircraftLike } from './contracts';

export interface QueryFilter {
  kinds?: readonly EntityKind[];
  targetClasses?: readonly TargetClass[];
  faction?: Faction;
  /** 이 세력에 적대적인 엔티티만 */
  hostileTo?: Faction;
  within?: { center: THREE.Vector3; radius: number };
  tag?: string;
  /** 기본 true: 살아있는 것만 */
  alive?: boolean;
  exclude?: Entity;
  predicate?: (e: Entity) => boolean;
}

const TERRAIN_COLLIDERS = new Set<EntityKind>(['aircraft', 'missile', 'bomb', 'decoy']);

export class World {
  readonly entities: Entity[] = [];
  private byId = new Map<number, Entity>();
  /** 플레이어 기체 (없으면 null) */
  player: AircraftLike | null = null;

  constructor(
    readonly scene: THREE.Scene,
    readonly relations: Relations,
  ) {}

  add<T extends Entity>(e: T, sim?: Sim): T {
    if (this.byId.has(e.id)) return e;
    this.entities.push(e);
    this.byId.set(e.id, e);
    if (sim) e.spawnTime = sim.time;
    e.syncObject();
    this.scene.add(e.object3d);
    return e;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  /** 고정 스텝 1회: 엔티티 갱신 → 지형 충돌 → 제거 정리 */
  step(dt: number, sim: Sim): void {
    const list = this.entities.slice();
    for (const e of list) {
      if (!e.removed) e.update(dt, sim);
    }
    const terrain = sim.services.terrain;
    for (const e of list) {
      if (e.removed || !TERRAIN_COLLIDERS.has(e.kind) || !e.onTerrainCollision) continue;
      const gy = terrain.heightAt(e.position.x, e.position.z);
      if (e.position.y <= gy) e.onTerrainCollision(sim, gy);
    }
    this.cleanup();
  }

  /** 렌더 직전: 엔티티 → Object3D 동기화 */
  syncObjects(): void {
    for (const e of this.entities) if (!e.removed) e.syncObject();
  }

  private cleanup(): void {
    let w = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.removed) {
        this.scene.remove(e.object3d);
        this.byId.delete(e.id);
        if (this.player === e) this.player = null;
        try {
          e.dispose?.();
        } catch (err) {
          console.error('[world] dispose 오류', err);
        }
      } else {
        this.entities[w++] = e;
      }
    }
    this.entities.length = w;
  }

  matches(e: Entity, f: QueryFilter): boolean {
    if (e.removed) return false;
    if ((f.alive ?? true) && !e.alive) return false;
    if (f.exclude === e) return false;
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.targetClasses && !f.targetClasses.includes(e.targetClass)) return false;
    if (f.faction && e.faction !== f.faction) return false;
    if (f.hostileTo && !this.relations.isHostile(f.hostileTo, e.faction)) return false;
    if (f.tag && !e.tags.has(f.tag)) return false;
    if (f.within && e.position.distanceToSquared(f.within.center) > f.within.radius * f.within.radius) return false;
    if (f.predicate && !f.predicate(e)) return false;
    return true;
  }

  query(f: QueryFilter = {}): Entity[] {
    return this.entities.filter((e) => this.matches(e, f));
  }

  count(f: QueryFilter = {}): number {
    let n = 0;
    for (const e of this.entities) if (this.matches(e, f)) n++;
    return n;
  }

  nearest(from: THREE.Vector3, f: QueryFilter = {}): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.entities) {
      if (!this.matches(e, f)) continue;
      const d = e.position.distanceToSquared(from);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** 모두 제거 (미션 종료) */
  clear(): void {
    for (const e of this.entities) e.removed = true;
    this.cleanup();
    this.player = null;
  }
}
