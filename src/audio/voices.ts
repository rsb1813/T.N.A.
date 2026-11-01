// 원샷 보이스 풀과 중복 요청 병합 (순수 로직 — WebAudio 없이 테스트 가능).
import type * as THREE from 'three';

export interface PooledVoice {
  readonly soundId: string;
  readonly priority: number;
  /** 시작 시각 (오디오 시계 s) */
  readonly start: number;
  /** 끝나는 시각 (오디오 시계 s) */
  end: number;
}

export type Admission<V> = { ok: false } | { ok: true; steal: V | null };

/**
 * 동시 재생 제한.
 * - 같은 소리가 maxPerSound 에 도달하면 그 소리의 가장 오래된 보이스를 끊는다.
 * - 전체가 maxVoices 에 도달하면 우선순위가 가장 낮은(같으면 가장 오래된) 보이스를 끊는다.
 *   그 보이스가 새 소리보다 우선순위가 높으면 새 소리를 거절한다.
 */
export class VoicePool<V extends PooledVoice> {
  readonly voices: V[] = [];

  constructor(readonly maxVoices: number) {}

  countOf(soundId: string): number {
    let n = 0;
    for (const v of this.voices) if (v.soundId === soundId) n++;
    return n;
  }

  admit(soundId: string, priority: number, maxPerSound: number): Admission<V> {
    if (maxPerSound <= 0) return { ok: false };
    if (this.countOf(soundId) >= maxPerSound) {
      let oldest: V | null = null;
      for (const v of this.voices) if (v.soundId === soundId && (!oldest || v.start < oldest.start)) oldest = v;
      return { ok: true, steal: oldest };
    }
    if (this.voices.length < this.maxVoices) return { ok: true, steal: null };
    let victim: V | null = null;
    for (const v of this.voices) {
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
    }
    if (!victim || victim.priority > priority) return { ok: false };
    return { ok: true, steal: victim };
  }

  add(v: V): void {
    this.voices.push(v);
  }

  remove(v: V): boolean {
    const i = this.voices.indexOf(v);
    if (i < 0) return false;
    this.voices.splice(i, 1);
    return true;
  }

  /** end 가 now 이전인 보이스를 꺼내 out 에 담는다 */
  prune(now: number, out: V[] = []): V[] {
    let w = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.end < now) out.push(v);
      else this.voices[w++] = v;
    }
    this.voices.length = w;
    return out;
  }

  clear(out: V[] = []): V[] {
    out.push(...this.voices);
    this.voices.length = 0;
    return out;
  }
}

interface RecentRequest {
  soundId: string;
  time: number;
  ownship: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * 같은 소리를 여러 모듈이 동시에 요청하는 경우(예: 무장 모듈의 발사음 + 이벤트 훅)를 하나로 합친다.
 * 같은 soundId, window 초 안, 그리고 (둘 다 자기 기체 소리 또는 서로 radiusM 안) 이면 중복.
 */
export class Coalescer {
  private readonly ring: RecentRequest[] = [];
  private head = 0;

  constructor(
    private readonly size = 48,
    private readonly radiusM = 30,
  ) {}

  /** 중복이면 true (기록하지 않음). 아니면 기록하고 false */
  check(soundId: string, now: number, windowSec: number, ownship: boolean, pos: THREE.Vector3 | null): boolean {
    if (windowSec > 0) {
      const r2 = this.radiusM * this.radiusM;
      for (const r of this.ring) {
        if (r.soundId !== soundId || now - r.time > windowSec || now < r.time) continue;
        if (ownship || !pos) {
          if (r.ownship) return true;
          continue;
        }
        if (r.ownship) continue;
        const dx = r.x - pos.x;
        const dy = r.y - pos.y;
        const dz = r.z - pos.z;
        if (dx * dx + dy * dy + dz * dz <= r2) return true;
      }
    }
    this.record(soundId, now, ownship || !pos, pos);
    return false;
  }

  private record(soundId: string, time: number, ownship: boolean, pos: THREE.Vector3 | null): void {
    let r: RecentRequest;
    if (this.ring.length < this.size) {
      r = { soundId, time, ownship, x: 0, y: 0, z: 0 };
      this.ring.push(r);
    } else {
      r = this.ring[this.head];
      this.head = (this.head + 1) % this.size;
      r.soundId = soundId;
      r.time = time;
      r.ownship = ownship;
    }
    r.x = pos?.x ?? 0;
    r.y = pos?.y ?? 0;
    r.z = pos?.z ?? 0;
  }

  clear(): void {
    this.ring.length = 0;
    this.head = 0;
  }
}
