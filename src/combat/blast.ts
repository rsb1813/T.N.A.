// 폭발 피해(거리 감쇠) + 폭발 효과/소리.
import * as THREE from 'three';
import type { Entity } from '../core/entity';
import type { Sim } from '../core/sim';
import type { ExplosionKind } from '../core/services';
import type { DamageKind } from '../core/types';

/** 폭발 소리가 'near' 로 들리는 플레이어 거리 (m) */
const NEAR_SOUND_M = 3000;
const MAX_SOUND_M = 30000;

export interface BlastOptions {
  /** 효과 종류. 생략하면 고도로 판단 (air / ground / water) */
  kind?: ExplosionKind;
  damageKind?: DamageKind;
  /** 효과 크기 배율 (기본 = 반경 기반) */
  fxSize?: number;
  /** 피해에서 제외할 엔티티 (예: 직격으로 이미 처리한 표적) */
  exclude?: Entity | null;
  /** 효과/소리 생략 */
  silent?: boolean;
}

/** 거리 감쇠: 표면 거리 0 → 1, 반경 → 0 */
export function blastFalloff(surfaceDist: number, radius: number): number {
  if (radius <= 0) return surfaceDist <= 0 ? 1 : 0;
  const t = 1 - surfaceDist / radius;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * Math.sqrt(t);
}

/** 고도와 지형으로 폭발 효과 종류 결정 */
export function explosionKindAt(pos: THREE.Vector3, sim: Sim): ExplosionKind {
  const terrain = sim.services.terrain;
  const ground = terrain.heightAt(pos.x, pos.z);
  if (pos.y - ground > 25) return 'air';
  return terrain.isWater(pos.x, pos.z) ? 'water' : 'ground';
}

/**
 * 반경 내 엔티티에 거리 감쇠 피해를 주고 효과/소리를 낸다.
 * 거리는 엔티티 표면(중심 거리 - radius) 기준이라 큰 표적(함정/건물)은 가장자리부터 맞는다.
 */
export function detonate(
  center: THREE.Vector3,
  radiusM: number,
  damage: number,
  source: Entity | null,
  weaponId: string | null,
  sim: Sim,
  opts: BlastOptions = {},
): void {
  const kind = opts.kind ?? explosionKindAt(center, sim);
  const dKind: DamageKind = opts.damageKind ?? (kind === 'nuclear' ? 'nuclear' : kind === 'mouk' ? 'mouk' : 'blast');
  if (damage > 0 && radiusM > 0) {
    const ents = sim.world.entities;
    // 피해 적용 중 엔티티가 파괴되며 배열이 바뀌지 않도록 대상만 먼저 모은다
    const hits: Entity[] = [];
    const amounts: number[] = [];
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive || e.removed || e === opts.exclude || e.kind === 'decoy') continue;
      const d = e.position.distanceTo(center) - e.radius;
      if (d > radiusM) continue;
      const f = blastFalloff(Math.max(0, d), radiusM);
      if (f <= 0) continue;
      hits.push(e);
      amounts.push(damage * f);
    }
    for (let i = 0; i < hits.length; i++) {
      hits[i].applyDamage({ amount: amounts[i], kind: dKind, source, weaponId, point: center }, sim);
    }
  }
  if (opts.silent) return;
  const fx = sim.services.fx;
  const size = opts.fxSize ?? Math.max(1, radiusM / 12);
  fx.explosion(center, { size, kind });
  const player = sim.world.player;
  if (player) {
    const dist = player.position.distanceTo(center);
    if (kind === 'nuclear' || kind === 'mouk') {
      fx.shake(Math.max(0.15, 1 - dist / (radiusM * 6)));
      sim.services.audio.play(dist < radiusM * 3 ? 'explosion_near' : 'explosion_far', { position: center, volume: 1 });
    } else if (dist < MAX_SOUND_M) {
      sim.services.audio.play(dist < NEAR_SOUND_M ? 'explosion_near' : 'explosion_far', { position: center });
      if (dist < radiusM * 8) fx.shake(Math.min(0.6, (radiusM * 4) / Math.max(dist, 1) * 0.15));
    }
  } else {
    sim.services.audio.play('explosion_far', { position: center });
  }
}

/** 전술핵 위력 → 피해 반경 (m). 게임 밸런스용 세제곱근 스케일 */
export function nuclearRadius(yieldKt: number): number {
  return 650 * Math.cbrt(Math.max(0.01, yieldKt));
}
