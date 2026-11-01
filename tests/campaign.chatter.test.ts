import { describe, expect, it } from 'vitest';
import type { AircraftSpawn } from '../src/core/services';
import type { GameDatabase, WeaponDef } from '../src/data/schema';
import { brevityFor, createChatter } from '../src/campaign';
import { createHeadlessSim, EMPTY_DB, type HeadlessAircraft } from '../src/campaign/headless';
import * as THREE from 'three';

const HANGUL = /[가-힣]/;

function w(id: string, category: WeaponDef['category'], guidance?: WeaponDef['guidance']): WeaponDef {
  return { id, name: id, category, description: '', users: ['NATO'], massKg: 100, dragArea: 0.01, rcsAdd: 0.01, unlock: { cost: 0 }, guidance } as WeaponDef;
}

const DB: GameDatabase = {
  ...EMPTY_DB,
  weapons: {
    'AIM-120D': w('AIM-120D', 'aam_radar'),
    'AIM-9X': w('AIM-9X', 'aam_ir'),
    'AIM-7M': w('AIM-7M', 'aam_sarh'),
    'AIM-54C': w('AIM-54C', 'aam_long', { type: 'active_radar', seekerRangeKm: 20, gimbalDeg: 40, offBoresightDeg: 10, navConstant: 4, ccm: 0.5 }),
    'AGM-88E': w('AGM-88E', 'arm'),
    'AGM-84': w('AGM-84', 'ashm'),
    'GBU-31': w('GBU-31', 'bomb_gps'),
    'B61': w('B61', 'nuke'),
    'AN/AAQ-33': w('AN/AAQ-33', 'pod'),
  },
};

function setup() {
  const { sim, rec } = createHeadlessSim({ db: DB, seed: 3 });
  const spawn = (req: Partial<AircraftSpawn>) =>
    sim.services.spawn.aircraft({
      defId: 'f15ex', faction: 'NATO', position: new THREE.Vector3(), heading: 0, speed: 250, controller: 'ai', ...req,
    } as AircraftSpawn) as unknown as HeadlessAircraft;
  const player = spawn({ controller: 'player', callsign: 'Halberd 1' });
  const magpie = spawn({ controller: 'wingman', callsign: 'Halberd 2' });
  const tarot = spawn({ controller: 'wingman', callsign: 'Halberd 3' });
  const enemy = spawn({ defId: 'su35s', faction: 'WARSAW', callsign: 'Grom 1', position: new THREE.Vector3(0, 5000, -20000) });
  const enemy2 = spawn({ defId: 'su35s', faction: 'WARSAW', callsign: 'Grom 2', position: new THREE.Vector3(500, 5000, -20000) });
  const chatter = createChatter(sim);
  const step = (sec: number) => {
    for (let i = 0; i < Math.round(sec * 60); i++) {
      sim.time += 1 / 60;
      chatter.fixedUpdate!(1 / 60, sim);
    }
  };
  const launch = (shooter: HeadlessAircraft, weaponId: string, target: HeadlessAircraft | null = enemy) =>
    sim.services.weapons.launch({ weaponId, shooter, target, position: shooter.position.clone(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, sim);
  return { sim, rec, chatter, player, magpie, tarot, enemy, enemy2, step, launch };
}

describe('brevityFor', () => {
  it('카테고리/유도 방식별 브레비티', () => {
    expect(brevityFor('AIM-120D', DB)).toBe('Fox Three');
    expect(brevityFor('AIM-9X', DB)).toBe('Fox Two');
    expect(brevityFor('AIM-7M', DB)).toBe('Fox One');
    expect(brevityFor('AIM-54C', DB)).toBe('Fox Three');
    expect(brevityFor('AGM-88E', DB)).toBe('Magnum');
    expect(brevityFor('AGM-84', DB)).toBe('Rifle');
    expect(brevityFor('GBU-31', DB)).toBe('Pickle');
    expect(brevityFor('B61', DB)).toBe('Pickle');
    expect(brevityFor('AN/AAQ-33', DB)).toBeNull();
  });
  it('DB 에 없으면 제식명으로 추정', () => {
    expect(brevityFor('R-77', null)).toBe('Fox Three');
    expect(brevityFor('R-73M', null)).toBe('Fox Two');
    expect(brevityFor('Kh-31P', null)).toBe('Magnum');
    expect(brevityFor('Storm Shadow', null)).toBe('Rifle');
    expect(brevityFor('Mk 82', null)).toBe('Pickle');
  });
});

describe('createChatter', () => {
  it('플레이어/윙맨 발사 콜, 쿨다운', () => {
    const t = setup();
    for (let i = 0; i < 6; i++) {
      t.launch(t.player, 'AIM-120D');
      t.step(3);
    }
    const calls = t.rec.radio.filter((m) => m.speaker === 'Halberd 1');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((m) => m.text === 'Fox Three.')).toBe(true);
    // 연속 발사는 쿨다운으로 묶인다
    const before = t.rec.radio.length;
    t.launch(t.magpie, 'AGM-88E');
    t.launch(t.magpie, 'AGM-88E');
    t.launch(t.magpie, 'AGM-88E');
    const magnum = t.rec.radio.slice(before).filter((m) => m.speaker === 'Magpie');
    expect(magnum.length).toBeLessThanOrEqual(1);
    if (magnum[0]) expect(magnum[0].text).toContain('Halberd 2, Magnum');
  });

  it('플레이어 격추 → 칭찬, 윙맨 격추 → 자기 보고', () => {
    const t = setup();
    t.enemy.applyDamage({ amount: 1e6, kind: 'blast', source: t.player, weaponId: 'AIM-120D' }, t.sim);
    t.step(1);
    const praise = t.rec.radio.filter((m) => m.side === 'friendly' || m.side === 'command');
    expect(praise.length).toBeGreaterThan(0);
    expect(praise[0].text).toMatch(HANGUL);
    t.step(5);
    const n = t.rec.radio.length;
    t.enemy2.applyDamage({ amount: 1e6, kind: 'blast', source: t.tarot, weaponId: 'AIM-9X' }, t.sim);
    t.step(1);
    const own = t.rec.radio.slice(n).find((m) => m.speaker === 'Tarot');
    expect(own?.text).toContain('Halberd 3');
  });

  it('미사일 경보 상승 에지에만 경고', () => {
    const t = setup();
    t.player.avionics.missileWarning = true;
    t.step(2);
    const warn = t.rec.radio.filter((m) => m.text.includes('미사일'));
    expect(warn.length).toBe(1);
    expect(warn[0].text).toContain('Halberd 1');
    t.step(8);
    expect(t.rec.radio.filter((m) => m.text.includes('미사일')).length).toBe(1);
    t.player.avionics.missileWarning = false;
    t.step(0.5);
    t.player.avionics.missileWarning = true;
    t.step(0.5);
    expect(t.rec.radio.filter((m) => m.text.includes('미사일')).length).toBe(2);
  });

  it('피격 임계 통과 시 걱정 대사', () => {
    const t = setup();
    t.player.applyDamage({ amount: 10, kind: 'kinetic', source: t.enemy, weaponId: null }, t.sim);
    t.step(1);
    expect(t.rec.radio.length).toBe(0);
    t.player.applyDamage({ amount: 20, kind: 'kinetic', source: t.enemy, weaponId: null }, t.sim);
    t.step(1);
    expect(t.rec.radio.length).toBe(1);
    expect(t.rec.radio[0].text).toMatch(HANGUL);
  });

  it('윙맨 명령 응답 — 살아있는 윙맨마다 순서대로', () => {
    const t = setup();
    t.sim.events.emit('wingmanCommand', { command: 'cover' });
    t.step(4);
    expect(t.rec.radio.map((m) => m.speaker)).toEqual(['Magpie', 'Tarot']);
    expect(t.rec.radio[0].text).toContain('Halberd 2');
  });

  it('스토리 대사 중에는 잡담을 줄이고, 꺼지면 침묵', () => {
    const t = setup();
    t.sim.services.radio.say({ speaker: 'Citadel', text: '아주 긴 스토리 대사가 이어지는 중이다. 모두 집중하라. 반복한다, 집중하라.', priority: 6, duration: 8 });
    t.sim.events.emit('wingmanCommand', { command: 'attack' });
    t.step(3);
    expect(t.rec.radio.length).toBe(1);
    t.chatter.enabled = false;
    t.player.avionics.missileWarning = true;
    t.step(10);
    expect(t.rec.radio.length).toBe(1);
    t.chatter.dispose();
  });

  it('윙맨 격추 시 탈출 무전과 관제 확인', () => {
    const t = setup();
    t.magpie.applyDamage({ amount: 1e6, kind: 'blast', source: t.enemy, weaponId: 'R-77' }, t.sim);
    t.step(5);
    expect(t.rec.radio.map((m) => m.speaker)).toEqual(['Magpie', 'Lantern']);
  });
});
