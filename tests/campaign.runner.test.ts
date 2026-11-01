import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/core/entity';
import type { Sim } from '../src/core/sim';
import {
  MissionRunner,
  OBJECTIVE_SCORE,
  TARGET_TAG_MULT,
  accuracyBonus,
  computeCredits,
  computeRank,
  damagePenalty,
  expandSkillMix,
  formationOffset,
  timeBonus,
  type MissionContext,
  type MissionDef,
  type MissionRunnerOptions,
} from '../src/campaign';
import { createHeadlessSim, type HeadlessRecorder } from '../src/campaign/headless';

function makeDef(script: (ctx: MissionContext) => void, extra: Partial<MissionDef> = {}): MissionDef {
  return {
    id: 'mtest',
    act: 1,
    index: 9,
    title: '테스트',
    subtitle: '테스트',
    date: '2000-01-01',
    location: '테스트',
    available: true,
    kinds: ['strike'],
    briefing: { paragraphs: [], objectivesText: [], mapMarkers: [] },
    environment: { biome: 'desert', seed: 1, timeOfDay: 12, weather: 'clear' },
    player: { position: { x: 0, z: 0, alt: 5000 }, heading: 0, speed: 250 },
    wingmen: [],
    parTime: 600,
    rankThresholds: { S: 2000, A: 1500, B: 1000, C: 500 },
    reward: 1000,
    script,
    ...extra,
  };
}

interface Rig {
  sim: Sim;
  rec: HeadlessRecorder;
  runner: MissionRunner;
  ended: Array<{ result: string; reason?: string }>;
  step(seconds: number, dt?: number): void;
  kill(e: Entity, byPlayer?: boolean, weaponId?: string): void;
}

function rig(def: MissionDef, opts: MissionRunnerOptions = {}): Rig {
  const { sim, rec } = createHeadlessSim();
  const runner = new MissionRunner(def, sim, opts);
  const ended: Rig['ended'] = [];
  sim.events.on('missionEnded', (e) => ended.push(e));
  runner.start();
  return {
    sim,
    rec,
    runner,
    ended,
    step(seconds, dt = 1 / 60) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        sim.time += dt;
        runner.fixedUpdate(dt, sim);
        sim.world.step(dt, sim);
      }
    },
    kill(e, byPlayer = true, weaponId = 'AIM-120D') {
      e.applyDamage({ amount: 1e6, kind: 'blast', source: byPlayer ? runner.player : null, weaponId }, sim);
    },
  };
}

describe('MissionRunner — 스폰과 서비스 등록', () => {
  it('플레이어와 윙맨을 스폰하고 sim.services.mission 에 등록', () => {
    const def = makeDef(() => {}, {
      wingmen: [
        { callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'air' },
        { callsign: 'Halberd 3', aircraftId: 'fa18i' },
      ],
    });
    const r = rig(def, { playerCallsign: 'Halberd 1' });
    expect(r.sim.services.mission).toBe(r.runner);
    expect(r.runner.player?.isPlayer).toBe(true);
    expect(r.sim.world.player).toBe(r.runner.player);
    expect(r.rec.aircraft[0]).toMatchObject({ controller: 'player', callsign: 'Halberd 1', defId: 'f15ex' });
    expect(r.rec.aircraft.slice(1).map((a) => [a.controller, a.callsign, a.formationSlot, a.leader])).toEqual([
      ['wingman', 'Halberd 2', 1, r.runner.player],
      ['wingman', 'Halberd 3', 2, r.runner.player],
    ]);
    expect(r.runner.wingmen.length).toBe(2);
    // 윙맨은 편대장 뒤쪽(남쪽)에 배치
    for (const w of r.rec.aircraft.slice(1)) expect(w.position.z).toBeGreaterThan(0);
    r.runner.dispose();
    expect(r.sim.services.mission.state).toBeNull();
  });

  it('spawnAir 는 태그/역할/지시를 CampaignAircraftSpawn 으로 넘긴다', () => {
    const r = rig(
      makeDef((ctx) => {
        ctx.spawnAir({
          aircraftId: 'su35s', faction: 'WARSAW', at: { x: 1000, z: -2000, alt: 6000 }, heading: 90, role: 'strike',
          targetTag: 'base', waypoints: [{ x: 0, z: 0, alt: 1000 }], target: true, tags: ['wave1'], callsign: 'Grom 1', name: '미확인',
        });
      }),
    );
    const req = r.rec.aircraft.find((a) => a.defId === 'su35s')!;
    expect(req.role).toBe('strike');
    expect(req.orders?.targetTag).toBe('base');
    expect(req.orders?.waypoints?.[0].toArray()).toEqual([0, 1000, 0]);
    expect(req.tags).toEqual(expect.arrayContaining(['wave1', 'target', 'role:strike']));
    expect(req.position.toArray()).toEqual([1000, 6000, -2000]);
    const e = r.runner.context.alive('wave1')[0];
    expect(e.name).toBe('미확인');
    expect(e.tags.has('target')).toBe(true);
  });

  it('spawnGroup: 편대 위치, 숙련도 비율, 콜사인', () => {
    let group: Entity[] = [];
    rig(
      makeDef((ctx) => {
        group = ctx.spawnGroup({ aircraftId: 'typhoon', faction: 'PAX', count: 4, at: { x: 0, z: -30000, alt: 7000 }, heading: 180, skill: { ace: 1, veteran: 1 }, callsign: 'Lancet', tags: ['g'] });
      }),
    );
    expect(group.map((e) => e.callsign)).toEqual(['Lancet 1', 'Lancet 2', 'Lancet 3', 'Lancet 4']);
    expect(expandSkillMix({ ace: 1, veteran: 1 }, 4)).toEqual(['ace', 'veteran', 'veteran', 'veteran']);
    expect(expandSkillMix(['regular', 'rookie'], 3)).toEqual(['regular', 'rookie', 'rookie']);
    // 남쪽(180)을 향하면 뒤 = 북쪽(-Z)
    expect(group[1].position.z).toBeLessThan(group[0].position.z);
    expect(new Set(group.map((e) => `${e.position.x},${e.position.z}`)).size).toBe(4);
    expect(formationOffset('trail', 2, 400)[1]).toBe(800);
  });
});

describe('MissionRunner — 목표와 종료', () => {
  it('태그 표적 파괴 → 목표 완료 → 자동 성공 → 지연 후 missionEnded', () => {
    const def = makeDef((ctx) => {
      ctx.spawnGroup({ unitId: 'sa10_tel', faction: 'WARSAW', at: { x: 0, z: -5000 }, count: 3, pattern: 'line', tags: ['sam'], target: true });
      ctx.objective('sam', 'SAM 파괴', { destroy: 'sam' });
    });
    const r = rig(def);
    r.step(0.1);
    const obj = r.runner.state.objectives[0];
    expect(obj.progress).toEqual({ current: 0, total: 3 });
    const sams = r.runner.context.alive('sam');
    r.kill(sams[0]);
    r.kill(sams[1]);
    r.step(0.1);
    expect(obj.progress).toEqual({ current: 2, total: 3 });
    expect(obj.status).toBe('active');
    r.kill(sams[2]);
    r.step(0.1);
    expect(obj.status).toBe('complete');
    expect(r.runner.state.result).toBeNull();
    r.step(2.1);
    expect(r.runner.state.result).toBe('success');
    expect(r.ended.length).toBe(0);
    r.step(5.1);
    expect(r.ended).toEqual([{ result: 'success', reason: '모든 주목표 달성' }]);
    expect(r.runner.finished).toBe(true);
    const res = r.runner.result();
    expect(res.success).toBe(true);
    expect(res.totalKills).toBe(3);
    expect(res.kills[0].count).toBe(3);
  });

  it('숨김 주목표가 공개되면 자동 성공이 미뤄진다', () => {
    const r = rig(
      makeDef((ctx) => {
        ctx.spawnGround({ unitId: 'truck', faction: 'PAX', at: { x: 0, z: -1000 }, tags: ['a'] });
        const b = ctx.objective('b', '2단계', { hidden: true, total: 1 });
        ctx.objective('a', '1단계', { destroy: 'a' }).onComplete(() => b.show());
      }),
    );
    r.kill(r.runner.context.alive('a')[0]);
    r.step(3);
    expect(r.runner.state.result).toBeNull();
    r.runner.context.getObjective('b')!.increment();
    r.step(2.1);
    expect(r.runner.state.result).toBe('success');
  });

  it('플레이어 격추 → 지연 후 실패, 랭크 D', () => {
    const r = rig(makeDef((ctx) => ctx.objective('x', '아무거나', { total: 1 })));
    r.step(1);
    r.kill(r.runner.player!, false);
    r.step(2.9);
    expect(r.runner.state.result).toBeNull();
    r.step(0.2);
    expect(r.runner.state.result).toBe('failure');
    expect(r.runner.state.failReason).toBe('플레이어 기체 손실');
    r.step(3);
    expect(r.ended[0].result).toBe('failure');
    expect(r.runner.result().rank).toBe('D');
    expect(r.rec.radio.some((m) => m.speaker === 'Lantern' && m.text.includes('신호 소실'))).toBe(true);
  });

  it('보호 대상 손실이 한도를 넘으면 실패', () => {
    const r = rig(
      makeDef((ctx) => {
        ctx.spawnGroup({ unitId: 'cargo_ship', faction: 'NATO', at: { x: 0, z: 0 }, count: 3, pattern: 'line', tags: ['convoy'] });
        ctx.objective('convoy', '선단 보호', { protect: 'convoy', maxLosses: 1 });
      }),
    );
    const ships = r.runner.context.alive('convoy');
    r.kill(ships[0], false);
    r.step(0.1);
    expect(r.runner.state.result).toBeNull();
    expect(r.runner.state.objectives[0].progress).toEqual({ current: 2, total: 3 });
    r.kill(ships[1], false);
    r.step(0.1);
    expect(r.runner.state.result).toBe('failure');
    expect(r.runner.result().friendlyLosses).toBe(2);
  });

  it('제한 시간 초과 → 실패 (onTimeUp 이 있으면 그것을 호출)', () => {
    const r = rig(makeDef((ctx) => ctx.objective('x', '버텨라', { total: 1 }), { timeLimit: 130 }));
    r.step(100, 0.1);
    expect(r.runner.state.timeLeft).toBeCloseTo(30, 0);
    r.step(31, 0.1);
    expect(r.runner.state.result).toBe('failure');
    expect(r.runner.state.failReason).toBe('제한 시간 초과');
    expect(r.rec.radio.some((m) => m.text.includes('60초'))).toBe(true);

    const fn = vi.fn();
    const r2 = rig(makeDef((ctx) => ctx.onTimeUp(fn), { timeLimit: 70 }));
    r2.step(71, 0.1);
    expect(fn).toHaveBeenCalledOnce();
    expect(r2.runner.state.result).toBeNull();
  });

  it('작전 구역 이탈 15초 → 실패', () => {
    const r = rig(makeDef(() => {}));
    r.runner.player!.position.set(150_000, 5000, 0);
    r.step(14, 0.1);
    expect(r.runner.state.result).toBeNull();
    r.step(1.2, 0.1);
    expect(r.runner.state.failReason).toBe('작전 구역 이탈');
  });

  it('주목표 수동 실패 → 미션 실패, 성공 확정 후의 실패는 무시', () => {
    const r = rig(makeDef((ctx) => ctx.objective('x', '목표', {}).fail('증거 소실')));
    expect(r.runner.state.result).toBe('failure');
    expect(r.runner.state.failReason).toBe('증거 소실');
    const r2 = rig(makeDef((ctx) => ctx.end(true, '끝')));
    r2.runner.context.objective('y', '늦은 목표').fail();
    expect(r2.runner.state.result).toBe('success');
  });
});

describe('MissionRunner — 스크립트 API', () => {
  it('after / every / when / dialogue 순서', () => {
    const log: string[] = [];
    const r = rig(
      makeDef((ctx) => {
        ctx.after(1, () => log.push('after1'));
        ctx.every(0.5, () => log.push('tick'), { times: 3 });
        ctx.when(() => ctx.time > 2, () => log.push('when'));
        ctx.dialogue([['magpie', '첫 줄'], ['tarot', '둘째 줄']], { then: () => log.push('dialogue_done') });
        const h = ctx.after(1.5, () => log.push('cancelled'));
        h.cancel();
      }),
    );
    r.step(10);
    expect(log.filter((l) => l === 'tick').length).toBe(3);
    expect(log.indexOf('after1')).toBeLessThan(log.indexOf('when'));
    expect(log).toContain('dialogue_done');
    expect(log).not.toContain('cancelled');
    const lines = r.rec.radio.map((m) => [m.speaker, m.text, m.side]);
    expect(lines.slice(0, 2)).toEqual([
      ['Magpie', '첫 줄', 'friendly'],
      ['Tarot', '둘째 줄', 'friendly'],
    ]);
  });

  it('areaTrigger: 플레이어 진입 시 한 번, 고도 조건', () => {
    const hits: number[] = [];
    const r = rig(makeDef((ctx) => ctx.areaTrigger({ x: 10000, z: 0, alt: 3000 }, 800, () => hits.push(ctx.time), { minAlt: 2500, maxAlt: 3500, marker: { label: 'WP' } })));
    expect(r.runner.markers).toEqual([expect.objectContaining({ label: 'WP', x: 10000, alt: 3000 })]);
    const p = r.runner.player!;
    p.position.set(10000, 6000, 0);
    r.step(0.5);
    expect(hits.length).toBe(0);
    p.position.set(10100, 3000, 100);
    r.step(0.5);
    p.position.set(0, 3000, 0);
    r.step(0.5);
    p.position.set(10000, 3000, 0);
    r.step(0.5);
    expect(hits.length).toBe(1);
    expect(r.runner.markers.length).toBe(0);
  });

  it('onDestroyed / onAllDestroyed / countAlive', () => {
    const seen: string[] = [];
    let all = 0;
    const r = rig(
      makeDef((ctx) => {
        ctx.spawnGroup({ unitId: 'truck', faction: 'PAX', at: { x: 0, z: 0 }, count: 2, pattern: 'line', tags: ['t'] });
        ctx.onDestroyed('t', (e, by) => seen.push(`${e.name}:${by === ctx.player}`));
        ctx.onAllDestroyed('t', () => all++);
      }),
    );
    const ctx = r.runner.context;
    expect(ctx.countAlive('t')).toBe(2);
    r.kill(ctx.alive('t')[0]);
    r.kill(ctx.alive('t')[0], false);
    expect(seen).toEqual(['truck:true', 'truck:false']);
    expect(all).toBe(1);
    expect(ctx.countAlive('t')).toBe(0);
  });

  it('무적과 이탈(withdraw)', () => {
    let ace: Entity | null = null;
    const r = rig(
      makeDef((ctx) => {
        ace = ctx.spawnAir({ aircraftId: 'xf1', faction: 'PAX', at: { x: 0, z: -3000, alt: 5000 }, heading: 0, invulnerable: true, tags: ['regalia'] });
      }),
    );
    r.kill(ace!);
    expect(ace!.alive).toBe(true);
    expect(ace!.hp).toBe(ace!.maxHp);
    r.runner.context.withdraw('regalia', { maxTime: 3, removeDistance: 1e9 });
    expect(ace!.faction).toBe('NEUTRAL');
    expect(r.sim.relations.isHostile('NATO', ace!.faction)).toBe(false);
    r.step(2.5);
    expect(ace!.removed).toBe(false);
    r.step(1);
    expect(ace!.removed).toBe(true);
  });

  it('rearmZone: 머문 뒤 훅 호출, 재사용 대기', () => {
    const rearm = vi.fn();
    const r = rig(makeDef((ctx) => ctx.rearmZone({ x: 0, z: 0, alt: 5000 }, 2000, { dwell: 1, cooldown: 30 })), { rearm });
    r.step(0.5);
    expect(rearm).not.toHaveBeenCalled();
    r.step(1);
    expect(rearm).toHaveBeenCalledOnce();
    expect(rearm.mock.calls[0][0]).toBe(r.runner.player);
    r.step(10);
    expect(rearm).toHaveBeenCalledOnce();
    r.step(25);
    expect(rearm).toHaveBeenCalledTimes(2);
    expect(r.rec.radio.some((m) => m.text.includes('재무장'))).toBe(true);
  });

  it('launch: DB 후보 중 첫 무장, 표적 방향 속도', () => {
    let target: Entity | null = null;
    const r = rig(
      makeDef((ctx) => {
        const ship = ctx.spawnGround({ unitId: 'frigate_pax', faction: 'PAX', at: { x: 0, z: -20000 } });
        target = ctx.spawnGround({ unitId: 'cargo_ship', faction: 'NATO', at: { x: 0, z: 0 } });
        ctx.launch({ weapon: ['Sea Eagle', 'Storm Shadow'], from: ship, target, speed: 200 });
      }),
    );
    const l = r.rec.launches[0];
    expect(l.weaponId).toBe('Sea Eagle'); // 빈 DB 에서는 첫 후보
    expect(l.target).toBe(target);
    expect(l.velocity.z).toBeGreaterThan(150); // 남쪽(+Z)으로
  });

  it('setRelations 와 비적대 격추 감점', () => {
    const r = rig(
      makeDef((ctx) => {
        ctx.spawnAir({ aircraftId: 'mirage_f1', faction: 'WON', at: { x: 0, z: -3000, alt: 5000 }, heading: 0, tags: ['won'] });
        ctx.spawnAir({ aircraftId: 'mirage_f1', faction: 'WON', at: { x: 500, z: -3000, alt: 5000 }, heading: 0, tags: ['won'] });
      }),
    );
    const ctx = r.runner.context;
    ctx.setRelations('NATO', 'WON', true);
    r.kill(ctx.alive('won')[0]);
    ctx.setRelations('NATO', 'WON', false);
    r.kill(ctx.alive('won')[0]);
    r.step(0.1);
    const res = r.runner.result();
    expect(res.totalKills).toBe(1);
    expect(res.breakdown.find((b) => b.label.includes('비적대'))?.value).toBe(-300);
  });
});

describe('점수 / 랭크 / 크레딧', () => {
  it('순수 함수', () => {
    expect(timeBonus(300, 600)).toBe(600);
    expect(timeBonus(900, 600)).toBe(0);
    expect(timeBonus(0, 5000)).toBe(1500);
    expect(accuracyBonus(3, 3)).toBe(0);
    expect(accuracyBonus(3, 4)).toBe(450);
    expect(damagePenalty(25)).toBe(200);
    expect(computeRank(2100, { S: 2000, A: 1500, B: 1000, C: 500 }, true)).toBe('S');
    expect(computeRank(1200, { S: 2000, A: 1500, B: 1000, C: 500 }, true)).toBe('B');
    expect(computeRank(100, { S: 2000, A: 1500, B: 1000, C: 500 }, true)).toBe('D');
    expect(computeRank(99999, { S: 2000, A: 1500, B: 1000, C: 500 }, false)).toBe('D');
    expect(computeCredits({ success: true, reward: 1000, score: 2000, killScore: 500, rank: 'A' })).toBe(2500);
    expect(computeCredits({ success: false, reward: 1000, score: 2000, killScore: 400, rank: 'D' })).toBe(100);
  });

  it('통합: 격추·목표·시간·명중률·피해·난이도', () => {
    const def = makeDef((ctx) => {
      ctx.spawnGround({ unitId: 'sa10_radar', faction: 'WARSAW', at: { x: 0, z: -9000 }, tags: ['site'], target: true });
      ctx.spawnGround({ unitId: 'truck', faction: 'WARSAW', at: { x: 300, z: -9000 }, tags: ['site'] });
      ctx.objective('site', '거점 파괴', { destroy: 'site' });
    });
    const r = rig(def);
    r.sim.settings.difficulty = 'hard'; // x1.5
    const ctx = r.runner.context;
    const [radar, truck] = ctx.alive('site');
    const player = r.runner.player!;
    // 4발 발사, 3발 명중 (같은 미사일의 폭발 피해는 한 번만 명중으로)
    const missiles: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const m = r.sim.services.weapons.launch(
        { weaponId: 'AGM-88E', shooter: player, target: radar, position: player.position.clone(), velocity: player.velocity.clone(), quaternion: player.quaternion.clone() },
        r.sim,
      )!;
      missiles.push(m);
    }
    missiles[0].position.copy(radar.position);
    radar.applyDamage({ amount: 10, kind: 'blast', source: player, weaponId: 'AGM-88E', point: radar.position.clone() }, r.sim);
    truck.applyDamage({ amount: 10, kind: 'blast', source: player, weaponId: 'AGM-88E', point: radar.position.clone() }, r.sim);
    missiles[1].position.copy(truck.position);
    truck.applyDamage({ amount: 10, kind: 'blast', source: player, weaponId: 'AGM-88E', point: truck.position.clone() }, r.sim);
    missiles[2].position.copy(radar.position).x += 5;
    radar.applyDamage({ amount: 1e6, kind: 'blast', source: player, weaponId: 'AGM-88E', point: radar.position.clone().setX(radar.position.x + 5) }, r.sim);
    // 기관포 명중
    r.sim.events.emit('gunFired', { shooter: player, weaponId: 'M61A2' });
    truck.applyDamage({ amount: 1e6, kind: 'kinetic', source: player, weaponId: 'M61A2' }, r.sim);
    // 피해 25%
    player.applyDamage({ amount: 25, kind: 'kinetic', source: radar, weaponId: null }, r.sim);
    r.step(10, 0.1); // 목표 완료 + 2초 자동 성공 판정

    const res = r.runner.result();
    expect(res.success).toBe(true);
    expect(res.shotsFired).toBe(4);
    expect(res.hits).toBe(3);
    expect(res.accuracy).toBeCloseTo(0.75);
    expect(res.gunHits).toBe(1);
    expect(res.damageTaken).toBeCloseTo(25);
    const radarScore = Math.round(50 * TARGET_TAG_MULT); // 빈 DB → 클래스 점수(ground 50) x 표적 배율
    const truckScore = 50;
    expect(res.kills.reduce((s, k) => s + k.score, 0)).toBe(radarScore + truckScore);
    const t = res.timeSec;
    const raw = radarScore + truckScore + OBJECTIVE_SCORE.primary + timeBonus(t, 600) + accuracyBonus(3, 4) - damagePenalty(25);
    expect(res.score).toBe(Math.round(raw * 1.5));
    expect(res.breakdown.map((b) => b.label)).toEqual(['격추', '목표 달성', '시간 보너스', '명중률 보너스', '피해 감점', '난이도 보정 (x1.5)']);
    expect(res.breakdown.reduce((s, b) => s + b.value, 0)).toBe(res.score);
    expect(res.rank).toBe(computeRank(res.score, def.rankThresholds, true));
    expect(res.creditsEarned).toBe(computeCredits({ success: true, reward: 1000, score: res.score, killScore: radarScore + truckScore, rank: res.rank }));
    // 결과 확정 후 점수는 고정
    const frozen = r.runner.state.score;
    r.step(1);
    expect(r.runner.state.score).toBe(frozen);
  });
});
