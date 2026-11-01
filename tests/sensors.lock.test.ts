import { describe, expect, it } from 'vitest';
import {
  SAMPLE_DATALINK,
  SAMPLE_HELMET,
  SAMPLE_RADAR,
  SAMPLE_RWR,
  SAMPLE_WEAPONS,
  TestAircraft,
  TestUnit,
  createTestSim,
  mountainTerrain,
  polar,
  recordingAudio,
  stepSim,
  type SensorSuite,
  type TestAircraftOptions,
} from '../src/combat/avionics/testkit';
import type { TerrainService } from '../src/core/services';
import type { LockState } from '../src/core/contracts';
import type { Sim } from '../src/core/sim';
import type { WeaponDef } from '../src/data/schema';

function setup(weapon: WeaponDef | null, sensors: SensorSuite = { radar: SAMPLE_RADAR.aesa, rwr: SAMPLE_RWR.modern }, extra: Partial<TestAircraftOptions> = {}, terrain?: TerrainService) {
  const sim = createTestSim({ seed: 31, terrain });
  const audio = recordingAudio();
  sim.services.audio = audio;
  const player = new TestAircraft(sim, { faction: 'NATO', isPlayer: true, position: [0, 9000, 0], heading: 0, speed: 250, sensors, weapon, ...extra });
  player.moving = false;
  return { sim, player, audio };
}

function bandit(sim: Sim, bearing: number, rangeM: number, alt = 9000, heading = 0) {
  const e = new TestAircraft(sim, { faction: 'WARSAW', position: polar(bearing, rangeM, alt), heading, speed: 250 });
  e.moving = false;
  return e;
}

/** 락 상태가 처음 locking 이 된 시각과 locked 가 된 시각 */
function lockTiming(sim: Sim, player: TestAircraft, weapon: WeaponDef, maxSec = 4): { start: number; locked: number; last: LockState } {
  let start = -1;
  let locked = -1;
  let last: LockState = player.avionics.lockState(weapon, sim);
  const dt = 1 / 60;
  for (let t = 0; t < maxSec; t += dt) {
    stepSim(sim, dt);
    last = player.avionics.lockState(weapon, sim);
    if (start < 0 && last.status === 'locking') start = sim.time;
    if (last.status === 'locked') {
      locked = sim.time;
      break;
    }
  }
  return { start, locked, last };
}

describe('IR 락', () => {
  it('정면 표적: 약 0.6초에 락, 진행률이 오른다, IR 탐색음/락음', () => {
    const { sim, player, audio } = setup(SAMPLE_WEAPONS.aim9x);
    const e = bandit(sim, 0, 3000);
    stepSim(sim, 0.1);
    const mid = (() => {
      for (let i = 0; i < 120; i++) {
        stepSim(sim, 1 / 60);
        const s = player.avionics.lockState(SAMPLE_WEAPONS.aim9x, sim);
        if (s.status === 'locking' && s.progress > 0.3) return s.progress;
      }
      return -1;
    })();
    expect(mid).toBeGreaterThan(0.3);
    expect(audio.tones.get('ir_search')).toBe(true);
    const { locked, last } = lockTiming(sim, player, SAMPLE_WEAPONS.aim9x);
    expect(locked).toBeGreaterThan(0);
    expect(last.target).toBe(e);
    expect(last.progress).toBe(1);
    expect(audio.tones.get('ir_lock')).toBe(true);
    expect(audio.tones.get('ir_search')).toBe(false);
  });

  it('락 시간: 정면 0.6 s, 짐벌 가장자리일수록 길어짐 (최대 1.0 s)', () => {
    const a = setup(SAMPLE_WEAPONS.aim9x);
    bandit(a.sim, 0, 3000);
    const t0 = lockTiming(a.sim, a.player, SAMPLE_WEAPONS.aim9x);
    expect(t0.locked - t0.start).toBeGreaterThan(0.55);
    expect(t0.locked - t0.start).toBeLessThan(0.7);

    const b = setup(SAMPLE_WEAPONS.aim9x, { rwr: SAMPLE_RWR.modern, helmet: SAMPLE_HELMET });
    bandit(b.sim, 60, 3000);
    const t1 = lockTiming(b.sim, b.player, SAMPLE_WEAPONS.aim9x);
    // 60° / 80° → 0.6 + 0.4 × 0.75 = 0.9 s
    expect(t1.locked - t1.start).toBeGreaterThan(0.85);
    expect(t1.locked - t1.start).toBeLessThan(0.97);
  });

  it('짐벌/HUD 한계: HMD 없으면 25° 밖은 탐색만, HMD 있으면 고 off-boresight 락', () => {
    const noHmd = setup(SAMPLE_WEAPONS.aim9x, { rwr: SAMPLE_RWR.modern });
    bandit(noHmd.sim, 40, 3000);
    const r0 = lockTiming(noHmd.sim, noHmd.player, SAMPLE_WEAPONS.aim9x, 2);
    expect(r0.locked).toBeLessThan(0);
    expect(r0.last.status).toBe('searching');
    expect(noHmd.audio.tones.get('ir_search')).toBe(true);

    const hmd = setup(SAMPLE_WEAPONS.aim9x, { rwr: SAMPLE_RWR.modern, helmet: SAMPLE_HELMET });
    bandit(hmd.sim, 40, 3000);
    expect(lockTiming(hmd.sim, hmd.player, SAMPLE_WEAPONS.aim9x, 2).locked).toBeGreaterThan(0);
  });

  it('구형 시커(AIM-9M, 짐벌 27°)는 HMD 가 있어도 40° 표적을 못 잡는다', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.aim9m, { rwr: SAMPLE_RWR.modern, helmet: SAMPLE_HELMET });
    bandit(sim, 40, 3000);
    expect(lockTiming(sim, player, SAMPLE_WEAPONS.aim9m, 2).locked).toBeLessThan(0);
  });

  it('시커 거리: 정면(차가운) 표적은 IR 사거리 밖이면 락 불가', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.aim9m);
    // AIM-9M 12 km × 정면 0.6 = 7.2 km. 레이더 트랙은 있음
    bandit(sim, 0, 15_000, 9000, 180);
    stepSim(sim, 2);
    expect(lockTiming(sim, player, SAMPLE_WEAPONS.aim9m, 2).last.status).toBe('searching');
  });
});

describe('레이더 락', () => {
  it('능동(AIM-120D): 레이더 트랙이 있으면 약 0.8 s, 레이더 락음, 상대 RWR 에 추적으로 보임', () => {
    const { sim, player, audio } = setup(SAMPLE_WEAPONS.aim120d);
    const e = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 60_000, 9000), heading: 180, sensors: { rwr: SAMPLE_RWR.modern } });
    e.moving = false;
    const r = lockTiming(sim, player, SAMPLE_WEAPONS.aim120d);
    expect(r.locked).toBeGreaterThan(0);
    expect(r.locked - r.start).toBeGreaterThan(0.75);
    expect(r.locked - r.start).toBeLessThan(0.85);
    expect(player.avionics.radarMode).toBe('tws');
    expect(audio.tones.get('radar_lock')).toBe(true);
    stepSim(sim, 0.5);
    expect(player.emission?.mode).toBe('track');
    expect(e.avionics.threats.find((t) => t.source === player)?.kind).toBe('track');
    expect(player.avionics.isTracked(e)).toBe(true);
  });

  it('레이더를 끄면 락 불가 (육안 트랙만으로는 안 됨)', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.aim120d);
    player.avionics.setRadarMode('off');
    bandit(sim, 0, 5000);
    const r = lockTiming(sim, player, SAMPLE_WEAPONS.aim120d, 2);
    expect(r.locked).toBeLessThan(0);
    expect(r.last.status).toBe('searching');
    expect(player.avionics.isTracked(player.avionics.target!.entity)).toBe(false);
  });

  it('협동 교전: 레이더를 꺼도 AWACS 데이터링크 트랙으로 AIM-120D 락', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.aim120d, { radar: SAMPLE_RADAR.aesa, datalink: SAMPLE_DATALINK });
    player.avionics.setRadarMode('off');
    const awacs = new TestAircraft(sim, { faction: 'NATO', name: 'E-3G Sentry', position: polar(180, 100_000, 10_000), tags: ['awacs'] });
    awacs.moving = false;
    const e = bandit(sim, 5, 80_000, 9000, 180);
    const r = lockTiming(sim, player, SAMPLE_WEAPONS.aim120d);
    expect(r.locked).toBeGreaterThan(0);
    expect(player.avionics.trackOf(e)?.source).toBe('datalink');
    expect(player.avionics.isTracked(e)).toBe(true);
    expect(player.emission).toBeNull();
  });

  it('반능동(AIM-7M): 락을 걸면 자동 STT, 다른 무장으로 바꾸면 탐색 모드 복귀', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.aim7m);
    const e = bandit(sim, 0, 40_000, 9000, 180);
    const r = lockTiming(sim, player, SAMPLE_WEAPONS.aim7m);
    expect(r.locked).toBeGreaterThan(0);
    expect(player.avionics.radarMode).toBe('stt');
    expect(player.avionics.isIlluminating(e)).toBe(true);
    player.stores.weapon = SAMPLE_WEAPONS.aim9x;
    stepSim(sim, 1);
    expect(player.avionics.radarMode).toBe('tws');
  });

  it('사거리: rMax × 1.2 밖은 락 불가', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.aim7m, { radar: { ...SAMPLE_RADAR.aesa, rangeKm: 250 } });
    bandit(sim, 0, 95_000, 9000, 180);
    stepSim(sim, 2);
    expect(lockTiming(sim, player, SAMPLE_WEAPONS.aim7m, 2).locked).toBeLessThan(0);
  });
});

describe('공대지 락', () => {
  it('GPS: 미션 표적(사령부 정보 트랙)이 rMax×1.3 안이면 락, 밖이면 탐색', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.gbu31);
    const near = new TestUnit(sim, { faction: 'WARSAW', name: '지휘 벙커', kind: 'structure', position: polar(0, 30_000, 0), tags: ['target'] });
    const r = lockTiming(sim, player, SAMPLE_WEAPONS.gbu31);
    expect(r.last.target).toBe(near);
    expect(r.locked - r.start).toBeLessThan(0.4);
    near.position.copy(polar(0, 40_000, 0));
    stepSim(sim, 0.5);
    expect(player.avionics.lockState(SAMPLE_WEAPONS.gbu31, sim).status).toBe('searching');
  });

  it('대방사(AGM-88E): 방사 중인 레이더만, 끄면 락 상실', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.agm88);
    const radar = new TestUnit(sim, { faction: 'WARSAW', name: 'SA-11 레이더', position: polar(10, 80_000, 0) });
    radar.emission = { mode: 'search', rangeM: 100_000, azimuthDeg: 180, lpi: 0, trackedIds: [], label: 'SA-11' };
    const r = lockTiming(sim, player, SAMPLE_WEAPONS.agm88);
    expect(r.locked).toBeGreaterThan(0);
    expect(r.last.target).toBe(radar);
    radar.emission = null;
    stepSim(sim, 0.5);
    expect(player.avionics.lockState(SAMPLE_WEAPONS.agm88, sim).status).not.toBe('locked');
  });

  it('영상(AGM-65): 시선이 막히면 락 불가', () => {
    const terrain = mountainTerrain([{ x: 0, z: -10_000, radius: 2000, height: 4000 }]);
    const { sim, player } = setup(SAMPLE_WEAPONS.agm65, { radar: SAMPLE_RADAR.aesa }, { position: [0, 2000, 0] }, terrain);
    const tank = new TestUnit(sim, { faction: 'WARSAW', name: 'T-80U', position: polar(0, 15_000, 0), tags: ['target'] });
    expect(lockTiming(sim, player, SAMPLE_WEAPONS.agm65, 2).locked).toBeLessThan(0);
    tank.position.copy(polar(30, 15_000, 0));
    expect(lockTiming(sim, player, SAMPLE_WEAPONS.agm65, 3).locked).toBeGreaterThan(0);
  });

  it('레이저(GBU-12): 표적 포드가 있어야 자체 조사 락', () => {
    const without = setup(SAMPLE_WEAPONS.gbu12);
    new TestUnit(without.sim, { faction: 'WARSAW', position: polar(0, 8000, 0), tags: ['target'] });
    expect(lockTiming(without.sim, without.player, SAMPLE_WEAPONS.gbu12, 2).locked).toBeLessThan(0);

    const withPod = setup(SAMPLE_WEAPONS.gbu12, { radar: SAMPLE_RADAR.aesa }, { stations: { C: { weaponId: 'AN/AAQ-33', count: 1 } } });
    new TestUnit(withPod.sim, { faction: 'WARSAW', position: polar(0, 8000, 0), tags: ['target'] });
    expect(lockTiming(withPod.sim, withPod.player, SAMPLE_WEAPONS.gbu12, 2).locked).toBeGreaterThan(0);
  });

  it('무유도 무장/무장 없음은 락 없음', () => {
    const { sim, player } = setup(SAMPLE_WEAPONS.mk82);
    new TestUnit(sim, { faction: 'WARSAW', position: polar(0, 5000, 0), tags: ['target'] });
    stepSim(sim, 1);
    expect(player.avionics.lockState(SAMPLE_WEAPONS.mk82, sim).status).toBe('none');
    expect(player.avionics.lockState(null, sim).status).toBe('none');
  });
});
