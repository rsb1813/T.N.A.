// 무전 자막 대기열 (순수 로직). 우선순위가 높은 메시지는 현재 메시지를 끊고, 같으면 도착 순서대로.
// 오래 기다린 잡담(priority < 1)은 버려서 상황이 지난 대사가 늦게 뜨지 않게 한다.
import type { RadioMessage } from '../../core/services';

export type RadioSide = NonNullable<RadioMessage['side']>;

export interface RadioEntry {
  speaker: string;
  text: string;
  side: RadioSide;
  duration: number;
  priority: number;
  /** 도착 시각 */
  arrived: number;
  seq: number;
}

/** 글자 수 기반 표시 시간 (s) */
export function radioDuration(text: string): number {
  return Math.min(9, Math.max(2.6, 1.6 + text.length * 0.075));
}

export const RADIO_FADE_SEC = 0.25;

export interface RadioQueueOptions {
  maxQueued?: number;
  /** priority < 1 메시지를 대기열에서 버리는 대기 시간 (s) */
  staleAfter?: number;
}

export class RadioQueue {
  current: RadioEntry | null = null;
  /** current 표시 시작 시각 */
  currentStart = 0;
  readonly queue: RadioEntry[] = [];
  private seq = 0;
  private readonly maxQueued: number;
  private readonly staleAfter: number;

  constructor(opts: RadioQueueOptions = {}) {
    this.maxQueued = opts.maxQueued ?? 6;
    this.staleAfter = opts.staleAfter ?? 10;
  }

  push(msg: RadioMessage, now: number): RadioEntry {
    const e: RadioEntry = {
      speaker: msg.speaker,
      text: msg.text,
      side: msg.side ?? 'neutral',
      duration: msg.duration && msg.duration > 0 ? msg.duration : radioDuration(msg.text),
      priority: msg.priority ?? 0,
      arrived: now,
      seq: this.seq++,
    };
    const cur = this.current;
    if (cur && e.priority > cur.priority) {
      // 끊긴 메시지가 중요하면(우선순위 1 이상) 남은 부분을 다시 보여주지 않고 대기열 앞쪽에 넣는다
      if (cur.priority >= 1) this.insert({ ...cur, arrived: now });
      this.show(e, now);
    } else if (!cur) {
      this.show(e, now);
    } else {
      this.insert(e);
    }
    return e;
  }

  private insert(e: RadioEntry): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].priority < e.priority) i--;
    this.queue.splice(i, 0, e);
    while (this.queue.length > this.maxQueued) {
      // 가장 낮은 우선순위 중 가장 오래된 것을 버린다
      let worst = 0;
      for (let j = 1; j < this.queue.length; j++) {
        const q = this.queue[j];
        const w = this.queue[worst];
        if (q.priority < w.priority || (q.priority === w.priority && q.seq < w.seq)) worst = j;
      }
      this.queue.splice(worst, 1);
    }
  }

  private show(e: RadioEntry, now: number): void {
    this.current = e;
    this.currentStart = now;
  }

  update(now: number): void {
    const cur = this.current;
    if (cur && now - this.currentStart >= cur.duration + RADIO_FADE_SEC) this.current = null;
    if (!this.current) {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        if (next.priority < 1 && now - next.arrived > this.staleAfter) continue;
        this.show(next, now);
        break;
      }
    }
  }

  /** 현재 메시지 불투명도 0..1 (등장/퇴장 페이드) */
  alpha(now: number): number {
    const cur = this.current;
    if (!cur) return 0;
    const t = now - this.currentStart;
    if (t < RADIO_FADE_SEC) return Math.max(0, t / RADIO_FADE_SEC);
    const end = cur.duration;
    if (t > end) return Math.max(0, 1 - (t - end) / RADIO_FADE_SEC);
    return 1;
  }

  clear(): void {
    this.current = null;
    this.queue.length = 0;
  }
}
