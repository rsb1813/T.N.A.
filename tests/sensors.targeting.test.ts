import { describe, expect, it } from 'vitest';
import {
  SAMPLE_DATALINK,
  SAMPLE_RADAR,
  SAMPLE_RWR,
  SAMPLE_WEAPONS,
  TestAircraft,
  TestUnit,
  createTestSim,
  polar,
  recordingAudio,
  stepSim,
  type SensorSuite,
} from '../src/combat/avionics/testkit';
import type { Entity } from '../src/core/entity';
import type { Sim } from '../src/core/sim';

function setup(sensors: SensorSuite = { radar: SAMPLE_RADAR.aesa, rwr: SAMPLE_RWR.modern }) {
  const sim = createTestSim({ seed: 41 });
  const audio = recordingAudio();
  sim.services.audio = audio;
  const changes: Array<Entity | null> = [];
  sim.events.on('targetChanged', (p) => changes.push(p.entity));
  const player = new TestAircraft(sim, { faction: 'NATO', isPlayer: true, position: [0, 9000, 0], heading: 0, speed: 250, sensors, weapon: SAMPLE_WEAPONS.aim120d });
  player.moving = false;
  return { sim, player, audio, changes };
}

function bandit(sim: Sim, bearing: number, rangeM: number, opts: { tags?: string[]; sensors?: SensorSuite; name?: string } = {}) {
  const e = new TestAircraft(sim, { faction: 'WARSAW', position: polar(bearing, rangeM, 9000), heading: bearing + 180, speed: 250, ...opts });
  e.moving = false;
  return e;
}

describe('자동 표적 지정', () => {
  it('30° 원뿔 안에서 기수에 가장 가까운 표적 > 원뿔 밖의 더 가까운 표적', () => {
    const { sim, player, changes, audio } = setup();
    const near = bandit(sim, 45, 20_000);
    const cone = bandit(sim, 8, 60_000);
    const cone2 = bandit(sim, -20, 50_000);
    stepSim(sim, 3);
    expect(player.avionics.target?.entity).toBe(cone);
    // 첫 스캔 동안 더 나은 후보로 조용히 갈아탄 뒤 고정 (효과음은 첫 지정 때 한 번)
    expect(changes[changes.length - 1]).toBe(cone);
    expect(audio.played.filter((x) => x === 'target_switch').length).toBe(1);
    expect(near.alive && cone2.alive).toBe(true);
  });

  it('원뿔 밖: 미션 표적 → 우리를 추적 중인 위협 → 거리 순', () => {
    const { sim, player } = setup();
    const close = bandit(sim, 50, 20_000);
    const locker = bandit(sim, -50, 40_000, { sensors: { radar: SAMPLE_RADAR.pesa } });
    const tgt = bandit(sim, 55, 55_000, { tags: ['target'] });
    stepSim(sim, 3);
    locker.avionics.designate(player);
    locker.avionics.setRadarMode('stt');
    stepSim(sim, 1);
    // 이미 지정된 표적은 바꾸지 않는다 → 해제 후 재지정으로 순위 확인
    expect(player.avionics.target?.entity).toBe(tgt);
    tgt.kill(sim, null);
    stepSim(sim, 0.1);
    expect(player.avionics.target?.entity).toBe(locker);
    locker.kill(sim, null);
    stepSim(sim, 0.1);
    expect(player.avionics.target?.entity).toBe(close);
  });

  it('표적이 격추되거나 트랙이 사라지면 다음 후보 자동 지정, targetChanged 이벤트', () => {
    const { sim, player, changes } = setup();
    const a = bandit(sim, 0, 40_000);
    const b = bandit(sim, 15, 45_000);
    stepSim(sim, 3);
    expect(player.avionics.target?.entity).toBe(a);
    a.kill(sim, null);
    stepSim(sim, 0.05);
    expect(player.avionics.target?.entity).toBe(b);
    expect(changes).toContain(null);
    expect(changes[changes.length - 1]).toBe(b);
    b.kill(sim, null);
    stepSim(sim, 0.05);
    expect(player.avionics.target).toBeNull();
  });

  it('autoDesignate = false 면 스스로 고르지 않는다 (AI 용)', () => {
    const { sim, player } = setup();
    player.avionics.autoDesignate = false;
    bandit(sim, 0, 40_000);
    stepSim(sim, 3);
    expect(player.avionics.target).toBeNull();
  });

  it('아군/중립은 지정 후보가 아니다', () => {
    const { sim, player } = setup();
    const f = new TestAircraft(sim, { faction: 'NATO', position: polar(0, 30_000, 9000), heading: 0 });
    const n = new TestAircraft(sim, { faction: 'WON', position: polar(5, 30_000, 9000), heading: 180, name: 'Mirage F1' });
    stepSim(sim, 3);
    expect(player.avionics.tracks.some((t) => t.entity === f)).toBe(true);
    expect(player.avionics.tracks.find((t) => t.entity === n)?.hostile).toBe(false);
    expect(player.avionics.target).toBeNull();
  });
});

describe('표적 순환', () => {
  it('순위대로 모두 한 번씩 돌고 처음으로, 반대 방향은 되돌아감', () => {
    const { sim, player } = setup();
    const c0 = bandit(sim, 2, 60_000);
    const c1 = bandit(sim, -12, 50_000);
    const out1 = bandit(sim, 50, 30_000);
    const out2 = bandit(sim, -55, 40_000);
    stepSim(sim, 3);
    expect(player.avionics.target?.entity).toBe(c0);
    const seen: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      player.avionics.cycleTarget(sim, 1, 'air');
      seen.push(player.avionics.target!.entity);
      stepSim(sim, 0.1);
    }
    expect(seen).toEqual([c1, out1, out2, c0]);
    player.avionics.cycleTarget(sim, -1, 'air');
    expect(player.avionics.target?.entity).toBe(out2);
  });

  it("filter 'ground' 는 지상 표적을 먼저, 없으면 전체", () => {
    const { sim, player } = setup();
    const air = bandit(sim, 0, 30_000);
    const sam = new TestUnit(sim, { faction: 'WARSAW', position: polar(20, 60_000, 0), tags: ['target'] });
    stepSim(sim, 3);
    expect(player.avionics.target?.entity).toBe(air);
    player.avionics.cycleTarget(sim, 1, 'ground');
    expect(player.avionics.target?.entity).toBe(sam);
    player.avionics.cycleTarget(sim, 1, 'ground');
    expect(player.avionics.target?.entity).toBe(sam);
    sam.kill(sim, null);
    stepSim(sim, 0.1);
    player.avionics.cycleTarget(sim, 1, 'ground');
    expect(player.avionics.target?.entity).toBe(air);
  });

  it('기수 정면 표적 지정', () => {
    const { sim, player } = setup();
    bandit(sim, 0, 80_000);
    const b = bandit(sim, -3, 70_000);
    stepSim(sim, 3);
    player.pointAt(b.position);
    player.avionics.targetNearestToBoresight(sim, 'air');
    expect(player.avionics.target?.entity).toBe(b);
  });

  it('공대지 무장 선택 시 자동 지정은 지상 우선', () => {
    const { sim, player } = setup();
    bandit(sim, 0, 30_000);
    const bunker = new TestUnit(sim, { faction: 'WARSAW', kind: 'structure', position: polar(40, 30_000, 0), tags: ['target'] });
    player.stores.weapon = SAMPLE_WEAPONS.gbu31;
    stepSim(sim, 2);
    expect(player.avionics.target?.entity).toBe(bunker);
  });
});

describe('데이터링크', () => {
  it('아군 트랙 공유: 자기 레이더 밖 표적이 datalink 트랙으로, 아군 자신도 보임', () => {
    const { sim, player } = setup({ radar: SAMPLE_RADAR.aesa, rwr: SAMPLE_RWR.modern, datalink: SAMPLE_DATALINK });
    const wing = new TestAircraft(sim, { faction: 'NATO', name: 'F-16P Viper', position: polar(0, 130_000, 9000), heading: 0, sensors: { radar: { ...SAMPLE_RADAR.aesa, rangeKm: 120 }, datalink: SAMPLE_DATALINK } });
    wing.moving = false;
    const far = bandit(sim, -4, 230_000);
    stepSim(sim, 4);
    expect(wing.avionics.tracks.find((t) => t.entity === far)?.source).toBe('radar');
    const shared = player.avionics.trackOf(far);
    expect(shared?.source).toBe('datalink');
    expect(shared?.hostile).toBe(true);
    expect(player.avionics.trackOf(wing)?.source).toBe('datalink');
    expect(player.avionics.trackOf(wing)?.identified).toBe(true);
    // 반향 방지: 플레이어가 받은 datalink 트랙을 윙맨이 다시 받지 않는다 (윙맨은 자기 레이더 트랙을 유지)
    expect(wing.avionics.trackOf(far)?.source).toBe('radar');
  });

  it('데이터링크가 없으면 공유 트랙 없음', () => {
    const { sim, player } = setup();
    const wing = new TestAircraft(sim, { faction: 'NATO', position: polar(0, 130_000, 9000), heading: 0, sensors: { radar: SAMPLE_RADAR.aesa, datalink: SAMPLE_DATALINK } });
    wing.moving = false;
    const far = bandit(sim, -4, 230_000);
    stepSim(sim, 4);
    expect(player.avionics.trackOf(far)).toBeNull();
  });

  it("AWACS: 'awacs' 태그 아군 300 km 안의 적기 전부 (스텔스 제외)", () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern, datalink: SAMPLE_DATALINK });
    const awacs = new TestAircraft(sim, { faction: 'NATO', name: 'E-3G Sentry', position: polar(180, 150_000, 10_000), tags: ['awacs'] });
    awacs.moving = false;
    const inside = bandit(sim, 150, 80_000);
    const outside = bandit(sim, 0, 200_000);
    const stealth = new TestAircraft(sim, { faction: 'PAX', name: 'XF-1 Lampyris', position: polar(170, 60_000, 9000), heading: 0, rcs: 0.0002 });
    stealth.moving = false;
    stepSim(sim, 2);
    expect(player.avionics.trackOf(inside)?.source).toBe('datalink');
    expect(player.avionics.trackOf(inside)?.identified).toBe(true);
    expect(player.avionics.trackOf(outside)).toBeNull();
    expect(player.avionics.trackOf(stealth)).toBeNull();
    awacs.kill(sim, null);
    stepSim(sim, 4);
    expect(player.avionics.trackOf(inside)).toBeNull();
  });
});

describe('사령부 정보 (미션 표적)', () => {
  it("플레이어는 'target' 태그 표적을 항상 저품질 datalink 트랙으로 본다 (레이더 off 여도)", () => {
    const { sim, player } = setup();
    player.avionics.setRadarMode('off');
    const ai = new TestAircraft(sim, { faction: 'NATO', position: [5000, 9000, 0], heading: 0, sensors: { radar: SAMPLE_RADAR.aesa } });
    const ship = new TestUnit(sim, { faction: 'WARSAW', name: 'Slava 순양함', kind: 'ship', position: polar(30, 120_000, 0), radius: 90, rcs: 5000, tags: ['target'] });
    stepSim(sim, 1);
    const t = player.avionics.trackOf(ship)!;
    expect(t.source).toBe('datalink');
    expect(t.quality).toBeCloseTo(0.2, 3);
    expect(t.identified).toBe(true);
    expect(t.position.distanceTo(ship.position)).toBeLessThan(1);
    expect(ai.avionics.trackOf(ship)).toBeNull();
    expect(player.avionics.target?.entity).toBe(ship);
  });
});
