// 전과 알림(HIT / MISSED / 격파 DESTROYED)과 격파 지점 점수 팝업 상태.
import * as THREE from 'three';

export type FeedKind = 'hit' | 'miss' | 'kill';

export interface FeedItem {
  kind: FeedKind;
  text: string;
  /** 부가 문구 (격파한 표적 이름) */
  sub: string;
  time: number;
  /** 관련 엔티티 id (같은 표적 HIT 묶기) */
  entityId: number;
  count: number;
}

export interface KillPopup {
  readonly position: THREE.Vector3;
  label: string;
  /** 미션 점수 증가분이 붙으면 표시 (없으면 null) */
  score: number | null;
  time: number;
  isTarget: boolean;
}

export const FEED_LIFETIME = 2.6;
export const POPUP_LIFETIME = 3.0;
/** 같은 종류 알림을 하나로 합치는 간격 (기관포 연속 명중) */
const MERGE_SEC = 0.9;
const MAX_FEED = 4;
const MAX_POPUPS = 8;

export class EventFeed {
  readonly items: FeedItem[] = [];
  readonly popups: KillPopup[] = [];

  push(kind: FeedKind, text: string, sub: string, entityId: number, now: number): void {
    const top = this.items[0];
    if (top && top.kind === kind && top.entityId === entityId && now - top.time < MERGE_SEC) {
      top.time = now;
      top.count++;
      return;
    }
    if (kind === 'kill') {
      // 같은 표적의 직전 HIT 은 격파로 대체
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (it.kind === 'hit' && it.entityId === entityId) this.items.splice(i, 1);
      }
    }
    this.items.unshift({ kind, text, sub, time: now, entityId, count: 1 });
    if (this.items.length > MAX_FEED) this.items.length = MAX_FEED;
  }

  addPopup(position: THREE.Vector3, label: string, isTarget: boolean, now: number): void {
    const p: KillPopup = { position: position.clone(), label, score: null, time: now, isTarget };
    this.popups.push(p);
    if (this.popups.length > MAX_POPUPS) this.popups.shift();
  }

  /** 미션 점수가 늘면 가장 최근의 점수 없는 팝업에 붙인다 */
  attributeScore(delta: number, now: number): boolean {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      if (p.score === null && now - p.time < 1.5) {
        p.score = delta;
        return true;
      }
    }
    return false;
  }

  update(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) if (now - this.items[i].time > FEED_LIFETIME) this.items.splice(i, 1);
    for (let i = this.popups.length - 1; i >= 0; i--) if (now - this.popups[i].time > POPUP_LIFETIME) this.popups.splice(i, 1);
  }

  clear(): void {
    this.items.length = 0;
    this.popups.length = 0;
  }
}
