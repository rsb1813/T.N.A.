// 조종석 경고음 상태와 우선순위 믹싱 (순수 로직 — WebAudio 없이 테스트 가능).
// 급한 경고(미사일 근접, PULL UP)가 켜지면 덜 급한 경고음과 전장 소리를 눌러 또렷하게 들리게 한다.
import type { ToneId } from '../core/services';

export interface ToneSpec {
  /** 0 (정보) .. 5 (즉시 회피) */
  priority: number;
  /** 기본 음량 */
  gain: number;
  /** 한국어 표시 이름 (샌드박스/디버그) */
  label: string;
}

export const TONE_SPECS: Record<ToneId, ToneSpec> = {
  ir_search: { priority: 0, gain: 0.16, label: 'IR 탐색음' },
  ir_lock: { priority: 1, gain: 0.17, label: 'IR 락' },
  radar_lock: { priority: 1, gain: 0.13, label: '레이더 락' },
  low_fuel: { priority: 1, gain: 0.13, label: '연료 부족' },
  rwr_search: { priority: 2, gain: 0.15, label: 'RWR 신규 방사원' },
  rwr_lock: { priority: 2, gain: 0.11, label: 'RWR 추적 경보' },
  stall: { priority: 3, gain: 0.17, label: '실속' },
  overg: { priority: 3, gain: 0.15, label: '과G' },
  missile_launch: { priority: 4, gain: 0.19, label: '미사일 발사 경보' },
  missile_incoming: { priority: 5, gain: 0.23, label: '미사일 근접' },
  pull_up: { priority: 5, gain: 0.22, label: 'PULL UP' },
};

export const TONE_IDS = Object.keys(TONE_SPECS) as ToneId[];

/** 최상위 경고보다 한 단계 낮을 때마다 곱하는 감쇠 */
export const TONE_DUCK_PER_LEVEL = 0.42;
/** 눌린 경고음의 최소 음량 비율 (완전히 사라지지는 않게) */
export const TONE_DUCK_FLOOR = 0.07;
/** 경고음 버스 합계 상한 — 여러 개가 겹쳐도 귀가 아프지 않게 */
export const TONE_BUS_HEADROOM = 0.42;

export class ToneMixer {
  private readonly on = new Set<ToneId>();
  /** 마지막으로 켜진 시각 (rwr_search 재알림 타이머용) */
  private readonly onSince = new Map<ToneId, number>();

  /** 상태가 바뀌었으면 true */
  set(id: ToneId, value: boolean, now = 0): boolean {
    if (!(id in TONE_SPECS)) return false;
    if (value === this.on.has(id)) return false;
    if (value) {
      this.on.add(id);
      this.onSince.set(id, now);
    } else {
      this.on.delete(id);
      this.onSince.delete(id);
    }
    return true;
  }

  isOn(id: ToneId): boolean {
    return this.on.has(id);
  }

  since(id: ToneId): number | null {
    return this.onSince.get(id) ?? null;
  }

  active(): ToneId[] {
    return TONE_IDS.filter((id) => this.on.has(id));
  }

  get count(): number {
    return this.on.size;
  }

  /** 켜진 경고음 중 최고 우선순위 (없으면 -1) */
  topPriority(): number {
    let top = -1;
    for (const id of this.on) top = Math.max(top, TONE_SPECS[id].priority);
    return top;
  }

  /** 우선순위 감쇠만 반영한 비율 0..1 (꺼져 있으면 0) */
  duckOf(id: ToneId): number {
    if (!this.on.has(id)) return 0;
    const steps = this.topPriority() - TONE_SPECS[id].priority;
    return steps <= 0 ? 1 : Math.max(TONE_DUCK_FLOOR, Math.pow(TONE_DUCK_PER_LEVEL, steps));
  }

  /** 최종 음량 (기본 음량 × 우선순위 감쇠 × 버스 헤드룸 보정) */
  levelOf(id: ToneId): number {
    if (!this.on.has(id)) return 0;
    return TONE_SPECS[id].gain * this.duckOf(id) * this.headroomScale();
  }

  /** 겹친 경고음 합이 TONE_BUS_HEADROOM 을 넘지 않게 하는 공통 배율 */
  headroomScale(): number {
    let sum = 0;
    for (const id of this.on) sum += TONE_SPECS[id].gain * this.duckOf(id);
    return sum > TONE_BUS_HEADROOM ? TONE_BUS_HEADROOM / sum : 1;
  }

  /** 전장 소리(world 버스) 덕킹 배율 — 급한 경고일수록 엔진/폭발음을 줄인다 */
  worldDuck(): number {
    const top = this.topPriority();
    if (top >= 5) return 0.5;
    if (top >= 4) return 0.68;
    if (top >= 3) return 0.85;
    return 1;
  }

  clear(): void {
    this.on.clear();
    this.onSince.clear();
  }
}
