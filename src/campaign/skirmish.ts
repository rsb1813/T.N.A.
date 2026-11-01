// 자유 전투(스커미시) 미션 생성기. 같은 seed 면 같은 편성.
//
//   const def = createSkirmish({ biome: 'desert', enemyFaction: 'WARSAW', enemyCount: 8, skill: 'veteran', includeGround: true, seed: 42 });
//   new MissionRunner(def, sim, { playerLoadout }).start();
import { Rng } from '../core/rng';
import type { BiomeId, EnvironmentOptions, Weather } from '../core/environment';
import type { AISkill, Faction } from '../core/types';
import { FACTION_NAMES } from '../core/types';
import { fleet, samSite, type SamSystem } from './compose';
import type { AIRole, MapMarker, MissionContext, MissionDef } from './missionTypes';

export type SkirmishFaction = Exclude<Faction, 'NATO' | 'NEUTRAL'>;

export interface SkirmishOptions {
  biome: BiomeId;
  enemyFaction: SkirmishFaction;
  /** 적 항공기 총 수 (1..24) */
  enemyCount: number;
  skill: AISkill;
  includeGround: boolean;
  seed: number;
  /** 시각 (생략 시 seed 로 결정) */
  timeOfDay?: number;
  weather?: Weather;
}

interface Roster {
  fighters: string[];
  heavy: string[];
  strike: string[];
  ace: string;
  sam: SamSystem;
  aaa: string;
  vehicles: string[];
  ships: string[];
  callsigns: string[];
}

export const SKIRMISH_ROSTERS: Record<SkirmishFaction, Roster> = {
  WARSAW: {
    fighters: ['su27s', 'mig29s', 'j11', 'su30mkk', 'su35s'],
    heavy: ['mig31bm', 'su35s'],
    strike: ['su30mkk', 'tu22m3'],
    ace: 'su47',
    sam: 'sa10',
    aaa: 'zsu234',
    vehicles: ['t80', 'bmp2', 'truck', 'scud'],
    ships: ['cruiser_warsaw', 'frigate_warsaw', 'frigate_warsaw'],
    callsigns: ['Berkut', 'Strela', 'Grom', 'Taiga', 'Volga'],
  },
  PAX: {
    fighters: ['typhoon', 'tornado_f3', 'su27_imperial'],
    heavy: ['typhoon', 'su27_imperial'],
    strike: ['tornado_ids'],
    ace: 'xf1',
    sam: 'rapier',
    aaa: 'zu23',
    vehicles: ['mbt_pax', 'truck'],
    ships: ['destroyer_pax', 'frigate_pax', 'frigate_pax'],
    callsigns: ['Lancet', 'Brigand', 'Gauntlet', 'Herald', 'Warden'],
  },
  WON: {
    fighters: ['mirage_f1', 'mig21'],
    heavy: ['mirage_f1'],
    strike: ['mig21'],
    ace: 'mirage_f1',
    sam: 'sa2',
    aaa: 'zu23',
    vehicles: ['technical', 'truck'],
    ships: ['cargo_ship'],
    callsigns: ['Nyati', 'Chui', 'Tembo', 'Kanga', 'Duma'],
  },
};

const SKILL_STEP: readonly AISkill[] = ['rookie', 'regular', 'veteran', 'ace'];
const SKILL_MULT: Record<AISkill, number> = { rookie: 0.7, regular: 1, veteran: 1.3, ace: 1.7 };
const BIOME_NAMES: Record<BiomeId, string> = {
  desert: '사막',
  savanna: '사바나',
  jungle: '밀림',
  mountains: '산악',
  temperate: '온대 평원',
  arctic: '극지',
  ocean: '대양',
  wasteland: '핵 폐허',
};

interface WavePlan {
  aircraft: string[];
  bearing: number;
  distance: number;
  alt: number;
  role: AIRole;
  callsign: string;
  skills: AISkill[];
}

function planWaves(o: SkirmishOptions, rng: Rng): WavePlan[] {
  const roster = SKIRMISH_ROSTERS[o.enemyFaction];
  const total = Math.max(1, Math.min(24, Math.round(o.enemyCount)));
  const sizes: number[] = [];
  let left = total;
  while (left > 0) {
    const n = Math.min(left, left <= 4 ? left : rng.int(2, 4));
    sizes.push(n);
    left -= n;
  }
  const base = SKILL_STEP.indexOf(o.skill);
  return sizes.map((n, w) => {
    const last = w === sizes.length - 1;
    const pool = w > 0 && rng.chance(0.35) ? roster.heavy : roster.fighters;
    const type = rng.pick(pool);
    const aircraft = new Array<string>(n).fill(type);
    if (last && base >= 2) aircraft[0] = roster.ace;
    if (rng.chance(0.3) && n >= 3) aircraft[n - 1] = rng.pick(roster.strike);
    const lead = SKILL_STEP[Math.min(3, base + (last ? 1 : 0))];
    const skills = aircraft.map((_, i) => (i === 0 ? lead : SKILL_STEP[Math.max(0, base - (rng.chance(0.3) ? 1 : 0))]));
    return {
      aircraft,
      bearing: rng.range(-70, 70),
      distance: rng.range(42_000, 60_000),
      alt: rng.range(4500, 9500),
      role: (rng.chance(0.5) ? 'sweep' : 'cap') as AIRole,
      callsign: roster.callsigns[w % roster.callsigns.length],
      skills,
    };
  });
}

const SAM_UNITS: Record<SamSystem, string[]> = {
  sa10: ['sa10_radar', 'sa10_tel', 'zsu234'],
  sa11: ['sa11', 'zsu234'],
  sa15: ['sa15', 'zsu234'],
  sa2: ['sa2_radar', 'sa2_launcher', 'zu23'],
  rapier: ['rapier', 'zu23'],
};

function skirmishRoster(o: SkirmishOptions, waves: WavePlan[]): { aircraft: string[]; units: string[] } {
  const r = SKIRMISH_ROSTERS[o.enemyFaction];
  const units: string[] = [];
  if (o.includeGround) units.push(...(o.biome === 'ocean' ? r.ships : [...SAM_UNITS[r.sam], r.vehicles[0], r.aaa]));
  return { aircraft: [...new Set(waves.flatMap((w) => w.aircraft))], units: [...new Set(units)] };
}

/** 플레이어 시작점(0, 0, 50km) 기준 방위/거리 → 위치 */
function polar(bearingDeg: number, dist: number): { x: number; z: number } {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(r) * dist, z: 50_000 - Math.cos(r) * dist };
}

export function createSkirmish(opts: SkirmishOptions): MissionDef {
  const rng = new Rng(opts.seed);
  const roster = SKIRMISH_ROSTERS[opts.enemyFaction];
  const waves = planWaves(opts, rng);
  const total = waves.reduce((s, w) => s + w.aircraft.length, 0);
  const naval = opts.biome === 'ocean';
  const groundAt = { x: rng.range(-15_000, 15_000), z: rng.range(-25_000, -10_000) };
  const timeOfDay = opts.timeOfDay ?? rng.pick([6.5, 9, 12, 15.5, 18.2]);
  const weather = opts.weather ?? rng.pick<Weather>(['clear', 'clear', 'scattered', 'overcast']);
  const rearm = { x: 0, z: 62_000, alt: 4000 };

  const environment: EnvironmentOptions = {
    biome: opts.biome,
    seed: opts.seed,
    timeOfDay,
    weather,
    mapRadius: 100_000,
    relief: opts.biome === 'mountains' ? 1.6 : 1,
    flatten: opts.includeGround && !naval ? [{ x: groundAt.x, z: groundAt.z, radius: 1500 }] : undefined,
  };

  const markers: MapMarker[] = [
    { x: 0, z: 50_000, label: '할버드 진입점', kind: 'friendly' },
    { x: rearm.x, z: rearm.z, label: '보급 구역', kind: 'friendly', radius: 4000 },
    ...waves.slice(0, 1).map((w) => ({ ...polar(w.bearing, w.distance), label: `${w.callsign} 편대`, kind: 'enemy' as const })),
  ];
  if (opts.includeGround) markers.push({ ...groundAt, label: naval ? '적 함대' : '적 지상 거점', kind: 'target', radius: 3000 });

  const mult = SKILL_MULT[opts.skill];
  const groundScore = opts.includeGround ? 1500 : 0;
  const expected = (total * 130 + groundScore + 600) * mult;

  const script = (ctx: MissionContext): void => {
    ctx.rearmZone(rearm, 4000);
    ctx.objective('air', `${FACTION_NAMES[opts.enemyFaction]} 항공기 ${total}기 격추`, { destroy: 'skirmish_air', required: total });
    if (opts.includeGround) {
      if (naval) {
        fleet(ctx, { ships: roster.ships, faction: opts.enemyFaction, at: groundAt, heading: rng.range(0, 360), tags: ['skirmish_ground'], target: true });
      } else {
        samSite(ctx, { at: groundAt, faction: opts.enemyFaction, system: roster.sam, coreTags: ['skirmish_ground'], target: true });
        ctx.spawnGroup({
          unitId: roster.vehicles[0],
          faction: opts.enemyFaction,
          at: { x: groundAt.x + 1500, z: groundAt.z + 800 },
          count: 4,
          pattern: 'grid',
          spacing: 70,
          tags: ['skirmish_ground'],
          target: true,
        });
        ctx.spawnGroup({ unitId: roster.aaa, faction: opts.enemyFaction, at: groundAt, count: 3, pattern: 'ring', radius: 1200, tags: ['skirmish_aaa'] });
      }
      ctx.objective('ground', naval ? '적 함대 격침' : '적 지상 거점 파괴', { destroy: 'skirmish_ground' });
    }

    let next = 0;
    const spawnWave = (): void => {
      const w = waves[next++];
      if (!w) return;
      const at = polar(w.bearing, w.distance);
      const heading = ((Math.atan2(-at.x, at.z - 50_000) * 180) / Math.PI + 360) % 360;
      w.aircraft.forEach((aircraftId, i) => {
        const off = (i - (w.aircraft.length - 1) / 2) * 500;
        ctx.spawnAir({
          aircraftId,
          faction: opts.enemyFaction,
          at: { x: at.x + off, z: at.z + Math.abs(off) * 0.6, alt: w.alt + i * 60 },
          heading,
          speed: 240,
          skill: w.skills[i],
          role: aircraftId === 'tu22m3' ? 'bomber' : w.role,
          callsign: `${w.callsign} ${i + 1}`,
          tags: ['skirmish_air', `wave${next}`],
          target: aircraftId === roster.ace && w.skills[i] === 'ace',
          presetId: 'air',
        });
      });
      if (next > 1) ctx.say('lantern', `새 접촉. ${w.callsign} 편대, ${w.aircraft.length}기. 교전하라.`, { priority: 4 });
    };
    spawnWave();
    ctx.every(2, (h) => {
      if (next >= waves.length) return h.cancel();
      if (ctx.countAlive(`wave${next}`) <= 1) spawnWave();
    });
    ctx.say('lantern', `할버드, 자유 교전 구역이다. ${FACTION_NAMES[opts.enemyFaction]} 전력 ${total}기 확인. 행운을 빈다.`);
  };

  return {
    id: 'skirmish',
    act: 0,
    index: 0,
    title: '자유 전투',
    subtitle: `${BIOME_NAMES[opts.biome]} · ${FACTION_NAMES[opts.enemyFaction]} ${total}기`,
    date: '2000',
    location: `${BIOME_NAMES[opts.biome]} 훈련 공역`,
    available: true,
    kinds: ['skirmish'],
    briefing: {
      paragraphs: [
        `${FACTION_NAMES[opts.enemyFaction]} 항공 전력 ${total}기가 ${waves.length}개 편대로 나뉘어 접근한다. 앞 편대가 무너지면 다음 편대가 들어온다.`,
        opts.includeGround ? (naval ? '적 수상 전투단이 해역에 있다. 함대공 미사일에 주의하라.' : '적 지상 거점이 방공망과 함께 있다. 지상 표적도 목표에 포함된다.') : '이번 공역에는 지상 표적이 없다.',
        `후방 보급 구역에서 재무장할 수 있다. 적 숙련도: ${opts.skill}.`,
      ],
      objectivesText: [`적 항공기 ${total}기 격추`, ...(opts.includeGround ? [naval ? '적 함대 격침' : '적 지상 거점 파괴'] : [])],
      mapMarkers: markers,
      threats: [...new Set(waves.flatMap((w) => w.aircraft))],
    },
    environment,
    player: { position: { x: 0, z: 50_000, alt: 5000 }, heading: 0, speed: 250 },
    wingmen: [
      { callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'air', skill: 'ace' },
      { callsign: 'Halberd 3', aircraftId: 'fa18i', presetId: opts.includeGround ? 'strike' : 'air', skill: 'veteran' },
      { callsign: 'Halberd 4', aircraftId: 'f16p', presetId: 'air', skill: 'regular' },
    ],
    parTime: 300 + total * 45 + (opts.includeGround ? 180 : 0),
    rankThresholds: {
      S: Math.round(expected * 1.25),
      A: Math.round(expected),
      B: Math.round(expected * 0.7),
      C: Math.round(expected * 0.4),
    },
    reward: Math.round((1500 + total * 400 + groundScore) * mult),
    roster: skirmishRoster(opts, waves),
    script,
  };
}
