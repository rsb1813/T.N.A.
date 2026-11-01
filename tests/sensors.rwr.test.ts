import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SAMPLE_EW,
  SAMPLE_MAW,
  SAMPLE_RADAR,
  SAMPLE_RWR,
  SAMPLE_WEAPONS,
  TestAircraft,
  TestMissile,
  TestUnit,
  createTestSim,
  polar,
  recordingAudio,
  stepSim,
  testWeapon,
  type SensorSuite,
} from '../src/combat/avionics/testkit';
import { TowedDecoy } from '../src/combat/avionics/towedDecoy';
import type { Threat } from '../src/core/contracts';
import type { Entity } from '../src/core/entity';
import type { Sim } from '../src/core/sim';

const R73 = testWeapon({
  id: 'R-73',
  category: 'aam_ir',
  users: ['WARSAW'],
  guidance: { type: 'ir', seekerRangeKm: 15, gimbalDeg: 60, offBoresightDeg: 60, navConstant: 4, ccm: 0.4 },
  motor: { boostSec: 2, boostThrustN: 20000, sustainSec: 1, sustainThrustN: 5000, smoke: 'medium' },
});
const R77 = testWeapon({
  id: 'R-77',
  category: 'aam_radar',
  users: ['WARSAW'],
  guidance: { type: 'active_radar', seekerRangeKm: 15, gimbalDeg: 60, offBoresightDeg: 60, navConstant: 4, ccm: 0.4, datalink: true },
  motor: { boostSec: 6, boostThrustN: 15000, sustainSec: 0, sustainThrustN: 0, smoke: 'low' },
});
const R27R = testWeapon({
  id: 'R-27R',
  category: 'aam_sarh',
  users: ['WARSAW'],
  guidance: { type: 'sarh', seekerRangeKm: 60, gimbalDeg: 50, offBoresightDeg: 50, navConstant: 4, ccm: 0.3 },
  envelope: { rMinKm: 1, rMaxKm: 70, rNezKm: 20 },
});

function setup(sensors: SensorSuite = { radar: SAMPLE_RADAR.aesa, rwr: SAMPLE_RWR.modern }) {
  const sim = createTestSim({ seed: 21 });
  const audio = recordingAudio();
  sim.services.audio = audio;
  const player = new TestAircraft(sim, { faction: 'NATO', isPlayer: true, position: [0, 9000, 0], heading: 0, speed: 250, sensors });
  player.moving = false;
  return { sim, player, audio };
}

function enemyFighter(sim: Sim, bearing: number, rangeM: number, sensors: SensorSuite = { radar: SAMPLE_RADAR.pesa }) {
  const e = new TestAircraft(sim, { faction: 'WARSAW', position: polar(bearing, rangeM, 9000), heading: bearing + 180, sensors });
  e.moving = false;
  return e;
}

function threatFrom(ac: TestAircraft, src: Entity): Threat | undefined {
  return ac.avionics.threats.find((t) => t.source === src);
}

/** 미사일: 사수 → 목표 방향으로 speed 로 날아감 */
function missileAt(sim: Sim, def: typeof R73, shooter: Entity | null, target: Entity, from: THREE.Vector3, speed: number, extra: Partial<ConstructorParameters<typeof TestMissile>[1]> = {}) {
  const v = new THREE.Vector3().subVectors(target.position, from).normalize().multiplyScalar(speed);
  return new TestMissile(sim, { def, shooter, target, position: from, velocity: v, faction: 'WARSAW', ...extra });
}

describe('RWR', () => {
  it('탐색 레이더: search, 방사원 표시 문자, 방위', () => {
    const { sim, player } = setup();
    const e = enemyFighter(sim, 30, 80_000);
    stepSim(sim, 1);
    expect(e.emission?.mode).toBe('search');
    const t = threatFrom(player, e)!;
    expect(t.kind).toBe('search');
    expect(t.detectedBy).toBe('rwr');
    expect(t.label).toBe('Su-35S');
    expect(t.rangeM).toBeNull();
    expect(Math.abs(t.bearingDeg - 30)).toBeLessThan(40);
    expect(player.avionics.missileWarning).toBe(false);
  });

  it('식별 불가 RWR 은 U, 방사 범위(×1.5) 밖이나 빔 밖이면 감지 안 됨', () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.legacy });
    const e = enemyFighter(sim, 0, 80_000);
    // 탐지거리 170 km × 0.9(TWS) × 1.5 ≈ 230 km 밖
    const far = enemyFighter(sim, 20, 260_000);
    // 우리 쪽을 등지고 있음 (레이더 빔 밖)
    const away = new TestAircraft(sim, { faction: 'WARSAW', position: polar(-30, 60_000, 9000), heading: -30, sensors: { radar: SAMPLE_RADAR.pesa } });
    // PESA lpi 0.2 vs lpiDetect 0.1 → 초당 84% 로 잡힘
    stepSim(sim, 3);
    expect(threatFrom(player, e)?.label).toBe('U');
    expect(threatFrom(player, far)).toBeUndefined();
    expect(threatFrom(player, away)).toBeUndefined();
  });

  it('STT 락 → track, 반능동 미사일 유도 → launch (발사 경보)', () => {
    const { sim, player, audio } = setup();
    const e = enemyFighter(sim, 0, 40_000);
    stepSim(sim, 3);
    e.avionics.designate(player);
    e.avionics.setRadarMode('stt');
    stepSim(sim, 1);
    expect(e.emission?.mode).toBe('track');
    expect(e.emission?.trackedIds).toContain(player.id);
    expect(threatFrom(player, e)?.kind).toBe('track');
    expect(audio.tones.get('rwr_lock')).toBe(true);

    missileAt(sim, R27R, e, player, polar(0, 39_000, 9000), 900);
    stepSim(sim, 0.5);
    expect(e.emission?.mode).toBe('guidance');
    expect(threatFrom(player, e)?.kind).toBe('launch');
    expect(player.avionics.missileWarning).toBe(true);
    expect(audio.tones.get('missile_launch')).toBe(true);
    expect(audio.tones.get('rwr_lock')).toBe(false);
  });

  it('발사 경보 기능이 없는 RWR 은 유도 신호를 track 으로만 본다', () => {
    const { sim, player } = setup({ rwr: { ...SAMPLE_RWR.modern, launchWarning: false } });
    const e = enemyFighter(sim, 0, 40_000);
    stepSim(sim, 3);
    e.avionics.designate(player);
    e.avionics.setRadarMode('stt');
    missileAt(sim, R27R, e, player, polar(0, 39_000, 9000), 900);
    stepSim(sim, 1);
    expect(threatFrom(player, e)?.kind).toBe('track');
    expect(player.avionics.missileWarning).toBe(false);
  });

  it('지상 SAM 레이더 방사도 감지', () => {
    const { sim, player } = setup();
    const radar = new TestUnit(sim, { faction: 'WARSAW', name: 'SA-10 레이더', position: polar(60, 70_000, 0) });
    radar.emission = { mode: 'search', rangeM: 150_000, azimuthDeg: 180, lpi: 0, trackedIds: [], label: 'SA-10' };
    stepSim(sim, 1);
    const t = threatFrom(player, radar)!;
    expect(t.kind).toBe('search');
    expect(t.label).toBe('SA-10');
  });

  it('LPI: 저피탐 레이더는 LPI 탐지력이 낮은 RWR 에 드문드문 잡힌다', () => {
    const presence = (rwr: typeof SAMPLE_RWR.modern) => {
      const { sim, player } = setup({ rwr });
      const e = enemyFighter(sim, 0, 60_000, { radar: { ...SAMPLE_RADAR.aesa, lpi: 0.9 } });
      let seen = 0;
      const samples = 80;
      for (let i = 0; i < samples; i++) {
        stepSim(sim, 0.25);
        if (threatFrom(player, e)) seen++;
      }
      return seen / samples;
    };
    expect(presence(SAMPLE_RWR.legacy)).toBeLessThan(0.5);
    expect(presence({ ...SAMPLE_RWR.modern, lpiDetect: 0.95 })).toBeGreaterThan(0.95);
  });

  it('레이더 시커가 켜진 미사일 → missile (rwr), 레이더 꺼진 재머는 J', () => {
    const { sim, player } = setup();
    const jam = enemyFighter(sim, -40, 90_000, { ew: SAMPLE_EW.strong });
    jam.avionics.jammerActive = true;
    const m = missileAt(sim, R77, null, player, polar(10, 12_000, 9000), 1000, { seekerActive: true, timeOfFlight: 30 });
    stepSim(sim, 0.5);
    const t = threatFrom(player, m)!;
    expect(t.kind).toBe('missile');
    expect(t.detectedBy).toBe('rwr');
    expect(t.label).toBe('MSL');
    expect(player.avionics.missileWarning).toBe(true);
    expect(threatFrom(player, jam)?.label).toBe('J');
    expect(threatFrom(player, jam)?.kind).toBe('search');
  });
});

describe('MAW', () => {
  it('연소 중인 미사일만 감지, 거리와 충돌시간 표시, 연소 종료 2초 뒤 사라짐', () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern, maw: SAMPLE_MAW.full });
    const m = missileAt(sim, R73, null, player, polar(160, 6000, 9000), 600, { burnSec: 3, timeOfFlight: 0 });
    stepSim(sim, 0.5);
    let t = threatFrom(player, m)!;
    expect(t.kind).toBe('missile');
    expect(t.detectedBy).toBe('maw');
    expect(t.rangeM!).toBeGreaterThan(4000);
    expect(t.rangeM!).toBeLessThan(6500);
    // 접근율은 상대속도: 미사일 600 m/s − 앞으로 도망가는 우리 250 m/s 의 시선 성분
    const closure = 600 - 250 * Math.cos((20 * Math.PI) / 180);
    expect(t.timeToImpact!).toBeCloseTo(t.rangeM! / closure, 0);
    expect(player.avionics.missileWarning).toBe(true);
    // 연소 종료(3 s) + 2 s 동안은 유지
    m.moving = false;
    stepSim(sim, 3.5);
    expect(threatFrom(player, m)).toBeDefined();
    stepSim(sim, 2.5);
    expect(threatFrom(player, m)).toBeUndefined();
    expect(player.avionics.missileWarning).toBe(false);
  });

  it("후방 MAW 는 전방 미사일을 못 본다 (후방은 봄, 충돌시간 없음)", () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern, maw: SAMPLE_MAW.rear });
    const front = missileAt(sim, R73, null, player, polar(10, 5000, 9000), 700);
    const rear = missileAt(sim, R73, null, player, polar(170, 5000, 9000), 700);
    stepSim(sim, 0.4);
    expect(threatFrom(player, front)).toBeUndefined();
    const t = threatFrom(player, rear)!;
    expect(t.detectedBy).toBe('maw');
    expect(t.timeToImpact).toBeNull();
  });

  it('MAW 가 없으면 IR 미사일 경고 없음 (1.5 km 안 육안 발견 제외)', () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern });
    const m = missileAt(sim, R73, null, player, polar(170, 5000, 9000), 700);
    stepSim(sim, 3);
    expect(threatFrom(player, m)).toBeUndefined();
    expect(player.avionics.missileWarning).toBe(false);
    m.position.copy(polar(170, 1300, 9000));
    stepSim(sim, 0.3);
    expect(threatFrom(player, m)?.kind).toBe('missile');
    expect(player.avionics.missileWarning).toBe(true);
  });

  it('멀어지는 미사일은 경고하지 않는다', () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern, maw: SAMPLE_MAW.full });
    const from = polar(90, 4000, 9000);
    const m = new TestMissile(sim, { def: R73, shooter: null, target: null, position: from, velocity: new THREE.Vector3(700, 0, 0), faction: 'WARSAW' });
    stepSim(sim, 0.5);
    expect(threatFrom(player, m)).toBeUndefined();
  });

  it('근접 미사일 경고음 (4 km 안)', () => {
    const { sim, player, audio } = setup({ rwr: SAMPLE_RWR.modern, maw: SAMPLE_MAW.full });
    missileAt(sim, R73, null, player, polar(170, 3500, 9000), 400);
    stepSim(sim, 0.3);
    expect(audio.tones.get('missile_incoming')).toBe(true);
    expect(audio.tones.get('missile_launch') ?? false).toBe(false);
  });
});

describe('방사 상태 (emission)', () => {
  it('모드별 방사: tws=search, stt=track, 유도 중=guidance, off=null', () => {
    const { sim, player } = setup();
    const e = enemyFighter(sim, 0, 50_000, {});
    stepSim(sim, 3);
    expect(player.emission?.mode).toBe('search');
    expect(player.emission?.label).toBe('F-15EX');
    expect(player.emission?.lpi).toBe(SAMPLE_RADAR.aesa.lpi);
    expect(player.emission?.trackedIds).toContain(e.id);

    player.avionics.designate(e);
    player.avionics.setRadarMode('stt');
    stepSim(sim, 0.5);
    expect(player.emission?.mode).toBe('track');
    expect(player.emission?.trackedIds).toEqual([e.id]);

    player.avionics.setRadarMode('tws');
    const m = new TestMissile(sim, { def: SAMPLE_WEAPONS.aim120d, shooter: player, target: e, position: polar(0, 2000, 9000), velocity: new THREE.Vector3(0, 0, -1000), faction: 'NATO' });
    stepSim(sim, 1.5);
    expect(player.emission?.mode).toBe('guidance');
    expect(player.emission?.trackedIds).toContain(e.id);
    // 능동 시커가 켜지면 더 이상 유도 신호 없음
    m.seekerActive = true;
    stepSim(sim, 0.5);
    expect(player.emission?.mode).not.toBe('guidance');

    player.avionics.setRadarMode('off');
    stepSim(sim, 0.3);
    expect(player.emission).toBeNull();
  });
});

describe('견인 디코이', () => {
  it('레이더 미사일 경보 시 자동 전개, 개수 제한', () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern, ew: SAMPLE_EW.towed });
    expect(player.avionics.towedDecoysRemaining).toBe(2);
    const decoys = () => sim.world.entities.filter((x): x is TowedDecoy => x instanceof TowedDecoy && !x.removed);
    stepSim(sim, 0.5);
    expect(decoys().length).toBe(0);

    const m = missileAt(sim, R77, null, player, polar(0, 15_000, 9000), 1000, { seekerActive: true, timeOfFlight: 20 });
    m.moving = false;
    stepSim(sim, 0.5);
    expect(decoys().length).toBe(1);
    expect(player.avionics.towedDecoyDeployed).toBe(true);
    expect(player.avionics.towedDecoysRemaining).toBe(1);
    const d = decoys()[0];
    expect(d.decoyType).toBe('towed');
    expect(d.owner).toBe(player);
    // 기체 뒤 ~100 m 에 끌려온다
    stepSim(sim, 2);
    expect(d.position.distanceTo(player.position)).toBeGreaterThan(80);
    expect(d.position.z).toBeGreaterThan(player.position.z);

    d.kill(sim, null);
    stepSim(sim, 0.5);
    expect(decoys().length).toBe(1);
    expect(player.avionics.towedDecoysRemaining).toBe(0);
    decoys()[0].kill(sim, null);
    stepSim(sim, 0.5);
    expect(decoys().length).toBe(0);
    expect(player.avionics.towedDecoyDeployed).toBe(false);
  });
});

describe('파괴 시 정리', () => {
  it('플레이어가 격추되면 경고음이 꺼지고 방사가 사라진다', () => {
    const { sim, player, audio } = setup({ rwr: SAMPLE_RWR.modern, maw: SAMPLE_MAW.full, radar: SAMPLE_RADAR.aesa });
    missileAt(sim, R73, null, player, polar(170, 3000, 9000), 400);
    stepSim(sim, 0.3);
    expect(audio.tones.get('missile_incoming')).toBe(true);
    player.kill(sim, null);
    expect(audio.tones.get('missile_incoming')).toBe(false);
    expect(player.emission).toBeNull();
    expect(player.avionics.threats.length).toBe(0);
  });
});
