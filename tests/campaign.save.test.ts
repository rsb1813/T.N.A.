import { describe, expect, it } from 'vitest';
import type { AircraftDef, GameDatabase, ModuleDef, WeaponDef } from '../src/data/schema';
import {
  ALL_MISSIONS,
  SAVE_KEY,
  STARTING_CREDITS,
  applyMissionResult,
  canBuy,
  campaignProgress,
  isMissionUnlocked,
  isUnlocked,
  loadSave,
  newSave,
  nextMissionId,
  purchase,
  rememberLoadout,
  saveGame,
  unlockedAircraft,
  type MissionResult,
  type StorageLike,
} from '../src/campaign';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

class BrokenStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('SecurityError');
  }
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

const ac = (id: string, cost: number, playable = true, afterMission?: string) => ({ id, playable, unlock: { cost, afterMission } }) as unknown as AircraftDef;
const wp = (id: string, cost: number, afterMission?: string) => ({ id, unlock: { cost, afterMission } }) as unknown as WeaponDef;
const md = (id: string, cost: number, afterMission?: string) => ({ id, unlock: { cost, afterMission } }) as unknown as ModuleDef;

const DB: GameDatabase = {
  aircraft: { f15ex: ac('f15ex', 0), f22d: ac('f22d', 60000, true, 'm03'), f16p: ac('f16p', 15000), su35s: ac('su35s', 0, false) },
  weapons: { 'AIM-120C-7': wp('AIM-120C-7', 0), 'AIM-120D': wp('AIM-120D', 12000), 'AGM-88E': wp('AGM-88E', 8000, 'm01'), B61: wp('B61', 0, 'm17') },
  modules: { apg82: md('apg82', 0), das: md('das', 20000) },
  units: {},
};

function result(over: Partial<MissionResult> = {}): MissionResult {
  return {
    missionId: 'm01', title: '균열의 계곡', success: true, rank: 'A', score: 4000, timeSec: 500, kills: [], totalKills: 10,
    killsByClass: { air: 8, ground: 2, sea: 0, structure: 0, weapon: 0 },
    shotsFired: 10, hits: 7, accuracy: 0.7, gunHits: 0, damageTaken: 10, creditsEarned: 9000, breakdown: [], objectives: [],
    wingmanKills: 2, friendlyLosses: 0, ...over,
  };
}

describe('세이브', () => {
  it('새 세이브: 시작 크레딧, 무료 기본 항목, 기본 TAC 네임', () => {
    const s = newSave(DB);
    expect(s.credits).toBe(STARTING_CREDITS);
    expect(s.unlocked.aircraft).toEqual(['f15ex']);
    expect(s.unlocked.weapons).toEqual(['AIM-120C-7']);
    expect(s.unlocked.modules).toEqual(['apg82']);
    expect(s.callsign).toBe('Lodestar');
  });

  it('localStorage 왕복', () => {
    const st = new MemoryStorage();
    const s = newSave(DB);
    s.credits = 123456;
    s.completed.m00 = { rank: 'S', score: 2500 };
    s.callsign = 'Nightjar';
    rememberLoadout(s, { aircraftId: 'f15ex', modules: { radar: 'apg82' }, stations: { L1: { weaponId: 'AIM-9X', count: 1 } }, fuel: 0.8 });
    expect(saveGame(s, st)).toBe(true);
    expect(st.data.has(SAVE_KEY)).toBe(true);
    const loaded = loadSave(DB, st);
    expect(loaded).toEqual(s);
  });

  it('손상/이상 데이터는 기본값으로 정리', () => {
    const st = new MemoryStorage();
    st.setItem(SAVE_KEY, '{not json');
    expect(loadSave(DB, st).credits).toBe(STARTING_CREDITS);
    st.setItem(SAVE_KEY, JSON.stringify({ credits: -50, completed: { m01: { rank: 'Z', score: 1 }, m02: { rank: 'B', score: 900 } }, unlocked: { weapons: ['AIM-120D', 7] }, callsign: '   ' }));
    const s = loadSave(DB, st);
    expect(s.credits).toBe(0);
    expect(s.completed).toEqual({ m02: { rank: 'B', score: 900 } });
    expect(s.unlocked.weapons).toEqual(['AIM-120C-7', 'AIM-120D']);
    expect(s.callsign).toBe('Lodestar');
  });

  it('저장소 접근 불가여도 예외 없이 동작', () => {
    const st = new BrokenStorage();
    expect(loadSave(DB, st).credits).toBe(STARTING_CREDITS);
    expect(saveGame(newSave(DB), st)).toBe(false);
    expect(loadSave(DB, null).version).toBe(1);
  });
});

describe('구매와 해금', () => {
  it('가격, 선행 미션, 보유 여부', () => {
    const s = newSave(DB);
    expect(isUnlocked(s, 'aircraft', 'f15ex', DB)).toBe(true);
    expect(isUnlocked(s, 'aircraft', 'su35s', DB)).toBe(false);
    expect(canBuy(s, 'aircraft', 'su35s', DB).ok).toBe(false);
    expect(canBuy(s, 'aircraft', 'f15ex', DB)).toMatchObject({ ok: false, reason: '이미 보유' });
    expect(canBuy(s, 'aircraft', 'f22d', DB)).toMatchObject({ ok: false, reason: '미션 M03 완료 후 구매 가능' });
    expect(canBuy(s, 'weapons', 'nope', DB)).toMatchObject({ ok: false, reason: '알 수 없는 항목' });

    expect(purchase(s, 'aircraft', 'f16p', DB)).toEqual({ ok: true, cost: 15000 });
    expect(s.credits).toBe(STARTING_CREDITS - 15000);
    expect(isUnlocked(s, 'aircraft', 'f16p', DB)).toBe(true);
    expect(unlockedAircraft(s, DB).sort()).toEqual(['f15ex', 'f16p']);

    const r = purchase(s, 'weapons', 'AIM-120D', DB);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('크레딧 부족');
    expect(s.credits).toBe(STARTING_CREDITS - 15000);
  });

  it('무료지만 선행 미션이 있는 항목은 완료 시 자동 해금', () => {
    const s = newSave(DB);
    expect(isUnlocked(s, 'weapons', 'B61', DB)).toBe(false);
    s.completed.m17 = { rank: 'B', score: 1 };
    expect(isUnlocked(s, 'weapons', 'B61', DB)).toBe(true);
  });
});

describe('미션 보상과 진행', () => {
  it('성공: 크레딧, 최고 기록, 첫 클리어 해금', () => {
    const s = newSave(DB);
    const def = { id: 'm01', unlocks: { weapons: ['AGM-88E'] } };
    const a = applyMissionResult(s, def, result());
    expect(a).toMatchObject({ creditsEarned: 9000, firstClear: true, newBest: true });
    expect(a.unlocked.weapons).toEqual(['AGM-88E']);
    expect(s.credits).toBe(STARTING_CREDITS + 9000);
    expect(s.completed.m01).toEqual({ rank: 'A', score: 4000 });

    const b = applyMissionResult(s, def, result({ rank: 'B', score: 3000, creditsEarned: 5000 }));
    expect(b).toMatchObject({ firstClear: false, newBest: false });
    expect(s.completed.m01).toEqual({ rank: 'A', score: 4000 });

    applyMissionResult(s, def, result({ rank: 'S', score: 3500, creditsEarned: 100 }));
    expect(s.completed.m01).toEqual({ rank: 'S', score: 4000 });
    expect(s.unlocked.weapons.filter((w) => w === 'AGM-88E').length).toBe(1);
  });

  it('실패: 크레딧만, 기록 없음', () => {
    const s = newSave(DB);
    const r = applyMissionResult(s, { id: 'm02' }, result({ success: false, rank: 'D', creditsEarned: 300 }));
    expect(r.firstClear).toBe(false);
    expect(s.credits).toBe(STARTING_CREDITS + 300);
    expect(s.completed.m02).toBeUndefined();
  });

  it('캠페인 순서 해금', () => {
    const s = newSave(DB);
    expect(isMissionUnlocked(s, 'm00', ALL_MISSIONS)).toBe(true);
    expect(isMissionUnlocked(s, 'm01', ALL_MISSIONS)).toBe(true);
    expect(isMissionUnlocked(s, 'm02', ALL_MISSIONS)).toBe(false);
    expect(nextMissionId(s, ALL_MISSIONS)).toBe('m00');
    s.completed.m00 = { rank: 'A', score: 1 };
    s.completed.m01 = { rank: 'A', score: 1 };
    expect(isMissionUnlocked(s, 'm02', ALL_MISSIONS)).toBe(true);
    expect(nextMissionId(s, ALL_MISSIONS)).toBe('m02');
    s.completed.m02 = { rank: 'A', score: 1 };
    s.completed.m03 = { rank: 'A', score: 1 };
    expect(isMissionUnlocked(s, 'm04', ALL_MISSIONS)).toBe(false); // 개발 중
    expect(nextMissionId(s, ALL_MISSIONS)).toBeNull();
    expect(campaignProgress(s)).toBeCloseTo(3 / 20);
  });
});
