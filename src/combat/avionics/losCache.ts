// 지형 시선(LOS) 결과 캐시. 지형 가림은 천천히 바뀌므로 거리별 유효시간 동안 재사용한다
// (항공기 40기 × 센서 주기 × 표적/방사원 수만큼의 lineOfSight 호출을 크게 줄인다).
import type * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { TerrainService } from '../../core/services';

interface Entry {
  at: number;
  ok: boolean;
}

/** 거리별 유효시간 (s): 가까울수록 가림이 빨리 바뀐다 */
export function losTtl(distM: number): number {
  return distM < 10_000 ? 0.15 : distM < 40_000 ? 0.4 : 0.8;
}

const SWEEP_SEC = 5;
const STALE_SEC = 3;

export class LosCache {
  private readonly map = new Map<number, Entry>();
  private lastSweep = 0;
  calls = 0;

  /** from → (엔티티 위치 + raise) 시선. 같은 엔티티는 TTL 동안 결과 재사용 */
  check(terrain: TerrainService, from: THREE.Vector3, e: Entity, to: THREE.Vector3, distM: number, now: number): boolean {
    let c = this.map.get(e.id);
    if (c && now - c.at <= losTtl(distM)) return c.ok;
    this.calls++;
    const ok = terrain.lineOfSight(from, to);
    if (c) {
      c.at = now;
      c.ok = ok;
    } else {
      c = { at: now, ok };
      this.map.set(e.id, c);
    }
    if (now - this.lastSweep > SWEEP_SEC) this.sweep(now);
    return ok;
  }

  private sweep(now: number): void {
    this.lastSweep = now;
    for (const [id, c] of this.map) if (now - c.at > STALE_SEC) this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }
}
