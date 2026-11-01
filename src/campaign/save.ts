// 세이브 데이터, 크레딧 경제, 해금.
//
//   const save = loadSave(DB);                       // localStorage (없거나 깨졌으면 새 세이브)
//   const r = purchase(save, 'weapons', 'AIM-120D', DB);  // { ok, reason?, cost }
//   applyMissionResult(save, def, runner.result());  // 크레딧 지급, 최고 기록, 미션 해금
//   saveGame(save);
import type { GameDatabase, Loadout, UnlockReq } from '../data/schema';
import { SQUADRON } from './cast';
import { MISSION_IDS, type MissionDef, type MissionResult, type Rank } from './missionTypes';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'tna.save.v1';
/** 새 게임 시작 크레딧 */
export const STARTING_CREDITS = 20_000;

export type UnlockKind = 'aircraft' | 'weapons' | 'modules';

export interface SaveData {
  version: number;
  credits: number;
  /** 미션별 최고 기록 */
  completed: Record<string, { rank: Rank; score: number }>;
  /** 구매(해금)한 항목. 가격 0 이고 선행 미션 조건이 없는 기본 항목은 목록에 없어도 해금된 것으로 본다 */
  unlocked: { aircraft: string[]; weapons: string[]; modules: string[] };
  /** 기체별 마지막 로드아웃 */
  hangar: Record<string, Loadout>;
  /** 플레이어 TAC 네임 */
  callsign: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const RANK_ORDER: Record<Rank, number> = { S: 4, A: 3, B: 2, C: 1, D: 0 };

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function unlockReqOf(db: GameDatabase, kind: UnlockKind, id: string): UnlockReq | null {
  const table = kind === 'aircraft' ? db.aircraft : kind === 'weapons' ? db.weapons : db.modules;
  const def = table?.[id];
  return def ? def.unlock : null;
}

/** 새 세이브. db 가 있으면 무료 기본 항목을 해금 목록에 미리 넣는다 */
export function newSave(db?: GameDatabase | null): SaveData {
  const save: SaveData = {
    version: SAVE_VERSION,
    credits: STARTING_CREDITS,
    completed: {},
    unlocked: { aircraft: [], weapons: [], modules: [] },
    hangar: {},
    callsign: SQUADRON.defaultTacName,
  };
  if (db) {
    for (const kind of ['aircraft', 'weapons', 'modules'] as const) {
      const table = kind === 'aircraft' ? db.aircraft : kind === 'weapons' ? db.weapons : db.modules;
      for (const id in table ?? {}) {
        if (kind === 'aircraft' && !db.aircraft[id].playable) continue;
        const u = table[id].unlock;
        if (u && u.cost === 0 && !u.afterMission) save.unlocked[kind].push(id);
      }
    }
  }
  return save;
}

function isRank(v: unknown): v is Rank {
  return v === 'S' || v === 'A' || v === 'B' || v === 'C' || v === 'D';
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 신뢰할 수 없는 JSON → SaveData (잘못된 필드는 기본값으로) */
export function sanitizeSave(raw: unknown, db?: GameDatabase | null): SaveData {
  const base = newSave(db);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Record<keyof SaveData, unknown>>;
  if (typeof r.credits === 'number' && Number.isFinite(r.credits)) base.credits = Math.max(0, Math.floor(r.credits));
  if (typeof r.callsign === 'string' && r.callsign.trim()) base.callsign = r.callsign.trim().slice(0, 24);
  if (r.completed && typeof r.completed === 'object') {
    for (const [id, v] of Object.entries(r.completed as Record<string, unknown>)) {
      const c = v as { rank?: unknown; score?: unknown } | null;
      if (c && isRank(c.rank) && typeof c.score === 'number') base.completed[id] = { rank: c.rank, score: c.score };
    }
  }
  if (r.unlocked && typeof r.unlocked === 'object') {
    const u = r.unlocked as Record<string, unknown>;
    for (const kind of ['aircraft', 'weapons', 'modules'] as const) {
      base.unlocked[kind] = [...new Set([...base.unlocked[kind], ...strArray(u[kind])])];
    }
  }
  if (r.hangar && typeof r.hangar === 'object') {
    for (const [id, v] of Object.entries(r.hangar as Record<string, unknown>)) {
      const l = v as Partial<Loadout> | null;
      if (l && typeof l.aircraftId === 'string' && l.stations && typeof l.stations === 'object' && l.modules && typeof l.modules === 'object') {
        base.hangar[id] = { aircraftId: l.aircraftId, modules: l.modules, stations: l.stations, fuel: typeof l.fuel === 'number' ? l.fuel : 1, livery: l.livery };
      }
    }
  }
  return base;
}

export function loadSave(db?: GameDatabase | null, storage: StorageLike | null = defaultStorage()): SaveData {
  if (!storage) return newSave(db);
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return newSave(db);
    return sanitizeSave(JSON.parse(raw), db);
  } catch (err) {
    console.warn('[campaign] 세이브 읽기 실패 — 새 세이브로 시작', err);
    return newSave(db);
  }
}

export function saveGame(save: SaveData, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (err) {
    console.warn('[campaign] 세이브 저장 실패', err);
    return false;
  }
}

export function deleteSave(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem?.(SAVE_KEY);
  } catch {
    /* 저장소 접근 불가 */
  }
}

// ---------------------------------------------------------------- 해금/구매

export function isUnlocked(save: SaveData, kind: UnlockKind, id: string, db: GameDatabase): boolean {
  if (save.unlocked[kind].includes(id)) return true;
  const req = unlockReqOf(db, kind, id);
  if (!req) return false;
  if (kind === 'aircraft' && db.aircraft[id] && !db.aircraft[id].playable) return false;
  return req.cost === 0 && (!req.afterMission || !!save.completed[req.afterMission]);
}

export interface PurchaseCheck {
  ok: boolean;
  cost: number;
  /** 불가 사유 (한국어) */
  reason?: string;
}

export function canBuy(save: SaveData, kind: UnlockKind, id: string, db: GameDatabase): PurchaseCheck {
  const req = unlockReqOf(db, kind, id);
  if (!req) return { ok: false, cost: 0, reason: '알 수 없는 항목' };
  if (kind === 'aircraft' && !db.aircraft[id].playable) return { ok: false, cost: req.cost, reason: '조종할 수 없는 기체' };
  if (isUnlocked(save, kind, id, db)) return { ok: false, cost: req.cost, reason: '이미 보유' };
  if (req.afterMission && !save.completed[req.afterMission]) {
    return { ok: false, cost: req.cost, reason: `미션 ${req.afterMission.toUpperCase()} 완료 후 구매 가능` };
  }
  if (save.credits < req.cost) return { ok: false, cost: req.cost, reason: `크레딧 부족 (${(req.cost - save.credits).toLocaleString('ko-KR')} 부족)` };
  return { ok: true, cost: req.cost };
}

/** 구매 (save 를 직접 수정) */
export function purchase(save: SaveData, kind: UnlockKind, id: string, db: GameDatabase): PurchaseCheck {
  const check = canBuy(save, kind, id, db);
  if (!check.ok) return check;
  save.credits -= check.cost;
  if (!save.unlocked[kind].includes(id)) save.unlocked[kind].push(id);
  return check;
}

/** 해금된 플레이어 기체 id */
export function unlockedAircraft(save: SaveData, db: GameDatabase): string[] {
  return Object.keys(db.aircraft).filter((id) => db.aircraft[id].playable && isUnlocked(save, 'aircraft', id, db));
}

// ---------------------------------------------------------------- 미션 보상/진행

export interface MissionRewardSummary {
  creditsEarned: number;
  firstClear: boolean;
  newBest: boolean;
  /** 이번 첫 성공으로 해금된 항목 */
  unlocked: { aircraft: string[]; weapons: string[]; modules: string[] };
}

/** 미션 결과 반영 (save 를 직접 수정). 크레딧은 성공/실패 모두 result.creditsEarned 만큼 */
export function applyMissionResult(save: SaveData, def: Pick<MissionDef, 'id' | 'unlocks'>, result: MissionResult): MissionRewardSummary {
  const summary: MissionRewardSummary = {
    creditsEarned: Math.max(0, Math.round(result.creditsEarned)),
    firstClear: false,
    newBest: false,
    unlocked: { aircraft: [], weapons: [], modules: [] },
  };
  save.credits += summary.creditsEarned;
  if (!result.success) return summary;
  const prev = save.completed[def.id];
  summary.firstClear = !prev;
  if (!prev || result.score > prev.score || RANK_ORDER[result.rank] > RANK_ORDER[prev.rank]) {
    summary.newBest = true;
    save.completed[def.id] = {
      rank: prev && RANK_ORDER[prev.rank] > RANK_ORDER[result.rank] ? prev.rank : result.rank,
      score: Math.max(prev?.score ?? 0, result.score),
    };
  }
  if (summary.firstClear && def.unlocks) {
    for (const kind of ['aircraft', 'weapons', 'modules'] as const) {
      for (const id of def.unlocks[kind] ?? []) {
        if (!save.unlocked[kind].includes(id)) {
          save.unlocked[kind].push(id);
          summary.unlocked[kind].push(id);
        }
      }
    }
  }
  return summary;
}

/** 캠페인 순서상 플레이 가능 여부: 개발 중이 아니고, 직전 미션을 완료했거나 첫 미션 */
export function isMissionUnlocked(save: SaveData, missionId: string, missions: ReadonlyArray<Pick<MissionDef, 'id' | 'available'>>): boolean {
  const i = missions.findIndex((m) => m.id === missionId);
  if (i < 0 || !missions[i].available) return false;
  if (i <= 1) return true; // 튜토리얼과 첫 미션은 항상
  return !!save.completed[missions[i - 1].id] || !!save.completed[missionId];
}

/** 다음에 할 미션 (완료하지 않은 첫 플레이 가능 미션) */
export function nextMissionId(save: SaveData, missions: ReadonlyArray<Pick<MissionDef, 'id' | 'available'>>): string | null {
  for (const m of missions) if (m.available && !save.completed[m.id] && isMissionUnlocked(save, m.id, missions)) return m.id;
  return null;
}

/** 캠페인 진행률 0..1 */
export function campaignProgress(save: SaveData): number {
  const done = MISSION_IDS.filter((id) => id !== 'm00' && save.completed[id]).length;
  return done / (MISSION_IDS.length - 1);
}

/** 기체별 로드아웃 기억 */
export function rememberLoadout(save: SaveData, loadout: Loadout): void {
  save.hangar[loadout.aircraftId] = structuredClone(loadout);
}
