// 세력 간 적대 관계. 미션이 바꿀 수 있다 (예: 공동의 적에 맞선 일시적 협력).
import type { Faction } from './types';

const ALL: Faction[] = ['NATO', 'WARSAW', 'PAX', 'WON', 'NEUTRAL'];

export class Relations {
  private hostile = new Set<string>();

  constructor() {
    this.reset();
  }

  /** 세계관 기본값: NATO·바르샤바·팍스는 서로 적대. WON 은 팍스와 적대, 나머지와는 중립 */
  reset(): void {
    this.hostile.clear();
    this.set('NATO', 'WARSAW', true);
    this.set('NATO', 'PAX', true);
    this.set('WARSAW', 'PAX', true);
    this.set('WON', 'PAX', true);
  }

  private key(a: Faction, b: Faction): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  set(a: Faction, b: Faction, hostile: boolean): void {
    if (a === b) return;
    if (hostile) this.hostile.add(this.key(a, b));
    else this.hostile.delete(this.key(a, b));
  }

  isHostile(a: Faction, b: Faction): boolean {
    return a !== b && this.hostile.has(this.key(a, b));
  }

  isFriendly(a: Faction, b: Faction): boolean {
    return a === b;
  }

  hostilesOf(a: Faction): Faction[] {
    return ALL.filter((f) => this.isHostile(a, f));
  }
}
