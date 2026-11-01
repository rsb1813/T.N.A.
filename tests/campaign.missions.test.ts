import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameDatabase } from '../src/data/schema';
import { ALL_MISSIONS, CAMPAIGN, MISSION_IDS, createSkirmish, getMission, type MissionDef } from '../src/campaign';
import { dryRunMission } from '../src/campaign/headless';

// docs/architecture.md 7절 "데이터 id 목록"
const PLAYER_AIRCRAFT = ['f15ex', 'f22d', 'fa18i', 'f16p', 'f14ex'];
const ENEMY_AIRCRAFT = [
  'su27s', 'su30mkk', 'j11', 'su35s', 'mig29s', 'mig31bm', 'su47', 'tu22m3', 'a50',
  'typhoon', 'tornado_f3', 'tornado_ids', 'su27_imperial', 'xf1',
  'mirage_f1', 'mig21',
];
const ALL_AIRCRAFT = [...PLAYER_AIRCRAFT, ...ENEMY_AIRCRAFT];
const UNIT_IDS = [
  'sa10_tel', 'sa10_radar', 'sa11', 'sa15', 'zsu234', 'ew_radar', 't80', 'bmp2', 'truck', 'scud', 'rapier', 'mbt_pax',
  'sa2_launcher', 'sa2_radar', 'zu23', 'technical', 'frigate_pax', 'destroyer_pax', 'cruiser_warsaw', 'frigate_warsaw',
  'carrier_nato', 'cargo_ship',
  'hangar_has', 'hangar_big', 'building_block', 'building_tower', 'factory', 'fuel_tank', 'bunker', 'comm_tower',
];
const BIOMES = ['desert', 'savanna', 'jungle', 'mountains', 'temperate', 'arctic', 'ocean', 'wasteland'];
const HANGUL = /[가-힣]/;

// src/data/index.ts 가 있으면 DB 와도 대조한다 (병렬 작업 중에는 없을 수 있음)
async function loadDb(): Promise<GameDatabase | null> {
  const mods = import.meta.glob('../src/data/index.ts');
  const load = Object.values(mods)[0];
  if (!load) return null;
  try {
    const mod = (await load()) as { DB?: GameDatabase };
    return mod.DB && Object.keys(mod.DB.aircraft ?? {}).length > 0 ? mod.DB : null;
  } catch (err) {
    console.warn('[campaign test] src/data/index.ts 로드 실패 — 아키텍처 목록만 검사', err);
    return null;
  }
}
const DB = await loadDb();

function checkIds(def: MissionDef, aircraft: string[], units: string[]): void {
  for (const id of aircraft) {
    expect(ALL_AIRCRAFT, `${def.id}: 기체 id ${id}`).toContain(id);
    if (DB) expect(DB.aircraft[id], `${def.id}: DB 에 기체 ${id} 없음`).toBeDefined();
  }
  for (const id of units) {
    expect(UNIT_IDS, `${def.id}: 유닛 id ${id}`).toContain(id);
    if (DB) expect(DB.units[id], `${def.id}: DB 에 유닛 ${id} 없음`).toBeDefined();
  }
}

describe('캠페인 구성', () => {
  it('4막, m00~m20 이 순서대로 한 번씩', () => {
    expect(CAMPAIGN.acts.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    expect(ALL_MISSIONS.map((m) => m.id)).toEqual([...MISSION_IDS]);
    for (const act of CAMPAIGN.acts) {
      for (const m of act.missions) expect(m.act).toBe(act.id);
      const idx = act.missions.map((m) => m.index);
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
    expect(getMission('m02')?.title).toBe('침묵의 우산');
    expect(getMission('m99')).toBeNull();
  });

  it('m00~m03 만 플레이 가능, 나머지는 개발 중', () => {
    for (const m of ALL_MISSIONS) expect(m.available, m.id).toBe(['m00', 'm01', 'm02', 'm03'].includes(m.id));
  });

  it('작전 일자는 2000년이고 캠페인 순서대로 진행', () => {
    let prev = '2000-01-01';
    for (const m of ALL_MISSIONS) {
      expect(m.date, m.id).toMatch(/^2000-\d\d-\d\d$/);
      expect(Number.isNaN(Date.parse(m.date))).toBe(false);
      expect(m.date >= prev, `${m.id} ${m.date} < ${prev}`).toBe(true);
      prev = m.date;
    }
  });
});

describe.each(ALL_MISSIONS.map((m) => [m.id, m] as const))('MissionDef %s', (_id, def) => {
  it('텍스트와 브리핑이 갖춰져 있다', () => {
    for (const s of [def.title, def.subtitle, def.location]) expect(s).toMatch(HANGUL);
    expect(def.kinds.length).toBeGreaterThan(0);
    expect(def.briefing.paragraphs.length).toBeGreaterThanOrEqual(3);
    for (const p of def.briefing.paragraphs) {
      expect(p).toMatch(HANGUL);
      expect(p.length).toBeGreaterThan(40);
    }
    expect(def.briefing.objectivesText.length).toBeGreaterThan(0);
    expect(def.briefing.mapMarkers.length).toBeGreaterThan(1);
  });

  it('환경·시작 위치·마커가 맵 안에 있다', () => {
    const env = def.environment;
    const R = env.mapRadius ?? 100_000;
    expect(BIOMES).toContain(env.biome);
    expect(Number.isFinite(env.seed)).toBe(true);
    expect(env.timeOfDay).toBeGreaterThanOrEqual(0);
    expect(env.timeOfDay).toBeLessThan(24);
    const p = def.player.position;
    expect(Math.hypot(p.x, p.z)).toBeLessThan(R * 0.9);
    expect(p.alt).toBeGreaterThan(200);
    expect(def.player.heading).toBeGreaterThanOrEqual(0);
    expect(def.player.heading).toBeLessThan(360);
    expect(def.player.speed).toBeGreaterThan(100);
    for (const mk of def.briefing.mapMarkers) {
      expect(Math.hypot(mk.x, mk.z), `${def.id} 마커 ${mk.label}`).toBeLessThanOrEqual(R);
      expect(['friendly', 'enemy', 'target', 'objective']).toContain(mk.kind);
    }
    for (const f of env.flatten ?? []) expect(Math.hypot(f.x, f.z)).toBeLessThan(R);
  });

  it('윙맨·허용 기체·로스터 id 가 공유 목록(및 DB)에 있다', () => {
    for (const w of def.wingmen) {
      expect(PLAYER_AIRCRAFT).toContain(w.aircraftId);
      expect(w.callsign).toMatch(/^Halberd [2-4]$/);
    }
    for (const id of def.player.allowedAircraft ?? []) expect(PLAYER_AIRCRAFT).toContain(id);
    checkIds(def, [...def.wingmen.map((w) => w.aircraftId), ...(def.roster?.aircraft ?? [])], def.roster?.units ?? []);
  });

  it('랭크 기준과 보상', () => {
    const t = def.rankThresholds;
    expect(t.S).toBeGreaterThan(t.A);
    expect(t.A).toBeGreaterThan(t.B);
    expect(t.B).toBeGreaterThan(t.C);
    expect(t.C).toBeGreaterThan(0);
    expect(def.reward).toBeGreaterThan(0);
    if (def.timeLimit != null) expect(def.timeLimit).toBeGreaterThan(60);
  });
});

const PLAYABLE = ALL_MISSIONS.filter((m) => m.available);

describe.each(PLAYABLE.map((m) => [m.id, m] as const))('헤드리스 완주 %s', (_id, def) => {
  const run = dryRunMission(def, { db: DB });

  it('스크립트 오류 없이 성공으로 끝난다', () => {
    expect(run.runner.scriptError).toBeNull();
    expect(run.finished).toBe(true);
    expect(run.result.success).toBe(true);
    expect(run.result.rank).not.toBe('D');
    expect(run.result.totalKills).toBeGreaterThan(0);
    expect(run.result.creditsEarned).toBeGreaterThan(def.reward);
  });

  it('스폰한 id 가 공유 목록(및 DB)에 있고 roster 에 선언돼 있다', () => {
    checkIds(def, run.spawns.aircraft, run.spawns.units);
    const declared = new Set([...def.wingmen.map((w) => w.aircraftId), ...(def.roster?.aircraft ?? []), ...PLAYER_AIRCRAFT]);
    for (const id of run.spawns.aircraft) expect(declared, `${def.id}: roster 에 ${id} 누락`).toContain(id);
    for (const id of run.spawns.units) expect(def.roster?.units ?? [], `${def.id}: roster 에 ${id} 누락`).toContain(id);
  });

  it('스크립트 발사 무장이 DB 에 있다', () => {
    if (!DB) return;
    for (const w of run.launches) expect(DB.weapons[w], `${def.id}: 무장 ${w}`).toBeDefined();
  });

  it('무전 대사는 한국어이고 등장인물 대사가 충분하다', () => {
    const story = run.radio.filter((m) => (m.priority ?? 5) >= 5);
    expect(story.length).toBeGreaterThan(10);
    for (const m of story) {
      expect(m.text, `${m.speaker}: ${m.text}`).toMatch(HANGUL);
      expect(m.speaker.length).toBeGreaterThan(0);
      expect(m.duration).toBeGreaterThan(0);
    }
  });
});

describe('m01 위장 폭격 분기', () => {
  it('위장 폭격기가 길길을 폭격하면 WON 이 적대화했다가, 격추 후 다시 중립이 된다', () => {
    let wonWasHostile = false;
    const run = dryRunMission(getMission('m01')!, {
      db: DB,
      killFilter: (e, sim) => {
        if (sim.relations.isHostile('NATO', 'WON')) wonWasHostile = true;
        if (e.faction === 'WON') return false;
        return !e.tags.has('falseflag') || wonWasHostile;
      },
    });
    expect(run.runner.scriptError).toBeNull();
    expect(wonWasHostile).toBe(true);
    expect(run.sim.relations.isHostile('NATO', 'WON')).toBe(false);
    expect(run.result.success).toBe(true);
    const spare = run.result.objectives.find((o) => o.id === 'won_spare');
    expect(spare?.status).toBe('complete');
  });

  it('폭격 전에 격추하면 WON 과의 충돌 없이 진행', () => {
    let wonEverHostile = false;
    const run = dryRunMission(getMission('m01')!, {
      db: DB,
      killFilter: (_e, sim) => {
        if (sim.relations.isHostile('NATO', 'WON')) wonEverHostile = true;
        return true;
      },
      killInterval: 2,
    });
    expect(run.result.success).toBe(true);
    expect(wonEverHostile).toBe(false);
    expect(run.result.objectives.find((o) => o.id === 'falseflag')?.status).toBe('complete');
  });
});

describe('m00 튜토리얼', () => {
  it('플레이어는 무적이고 모든 단계 목표가 완료된다', () => {
    const run = dryRunMission(getMission('m00')!, { db: DB });
    const ids = run.result.objectives.map((o) => o.id);
    expect(ids).toEqual(['wp', 'ab', 'brake', 'gun', 'ir', 'radar', 'switch', 'evade']);
    for (const o of run.result.objectives) expect(o.status, o.id).toBe('complete');
    const p = run.runner.player!;
    p.applyDamage({ amount: 1e6, kind: 'blast', source: null, weaponId: null }, run.sim);
    expect(p.alive).toBe(true);
  });
});

describe('개발 중 미션', () => {
  it('스크립트가 즉시 종료한다', () => {
    for (const def of ALL_MISSIONS.filter((m) => !m.available)) {
      const run = dryRunMission(def, { db: DB, maxSeconds: 5 });
      expect(run.finished, def.id).toBe(true);
      expect(run.result.success).toBe(false);
    }
  });
});

describe('스커미시', () => {
  const opts = { biome: 'desert' as const, enemyFaction: 'WARSAW' as const, enemyCount: 9, skill: 'veteran' as const, includeGround: true, seed: 42 };

  it('같은 seed 면 같은 편성', () => {
    const a = createSkirmish(opts);
    const b = createSkirmish(opts);
    expect(a.briefing).toEqual(b.briefing);
    expect(a.roster).toEqual(b.roster);
    expect(createSkirmish({ ...opts, seed: 43 }).briefing).not.toEqual(a.briefing);
  });

  it.each([
    ['WARSAW', 'desert', true],
    ['PAX', 'ocean', true],
    ['WON', 'savanna', false],
  ] as const)('%s / %s 완주, 적 수와 id 검증', (faction, biome, ground) => {
    const def = createSkirmish({ ...opts, enemyFaction: faction, biome, includeGround: ground, enemyCount: 7 });
    const run = dryRunMission(def, { db: DB, killInterval: 3 });
    expect(run.runner.scriptError).toBeNull();
    expect(run.result.success).toBe(true);
    const enemyAir = run.recorder.aircraft.filter((r) => r.faction === faction);
    expect(enemyAir.length).toBe(7);
    expect(run.result.totalKills).toBeGreaterThanOrEqual(7);
    checkIds(def, run.spawns.aircraft, run.spawns.units);
    for (const id of run.spawns.aircraft) expect([...def.roster!.aircraft, ...PLAYER_AIRCRAFT]).toContain(id);
    for (const id of run.spawns.units) expect(def.roster!.units).toContain(id);
  });
});

describe('docs/story.md', () => {
  const story = readFileSync(new URL('../docs/story.md', import.meta.url), 'utf8');
  it('모든 미션 제목과 id 가 줄거리 문서에 있다', () => {
    for (const m of ALL_MISSIONS) {
      expect(story, m.id).toContain(m.title);
      expect(story).toContain(m.id.toUpperCase());
    }
  });
});
