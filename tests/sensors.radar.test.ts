import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  clutterRangeFactor,
  detectionProbability,
  irAspectFactor,
  irSignatureFactor,
  jamRangeFactor,
  lookDownSeverity,
  radarRangeForRcs,
  rcsAspectFactor,
  stealthiness,
} from '../src/combat/avionics/sensorMath';
import {
  SAMPLE_EW,
  SAMPLE_IRST,
  SAMPLE_RADAR,
  SAMPLE_RWR,
  SAMPLE_WEAPONS,
  TestAircraft,
  TestUnit,
  createTestSim,
  mountainTerrain,
  polar,
  stepSim,
  type SensorSuite,
} from '../src/combat/avionics/testkit';
import type { TerrainService } from '../src/core/services';
import type { Track } from '../src/core/contracts';
import type { Entity } from '../src/core/entity';

function trackOf(ac: TestAircraft, e: Entity): Track | undefined {
  return ac.avionics.tracks.find((t) => t.entity === e);
}

function setup(sensors: SensorSuite = { radar: SAMPLE_RADAR.aesa, rwr: SAMPLE_RWR.modern }, terrain?: TerrainService) {
  const sim = createTestSim({ seed: 11, terrain });
  const player = new TestAircraft(sim, { faction: 'NATO', isPlayer: true, position: [0, 9000, 0], heading: 0, speed: 250, sensors });
  return { sim, player };
}

/** 북쪽 range(m) 지점, 정면으로 마주 오는 적 */
function headOn(sim: ReturnType<typeof createTestSim>, rangeM: number, opts: Partial<ConstructorParameters<typeof TestAircraft>[1]> = {}) {
  const p = polar(0, rangeM, 9000);
  return new TestAircraft(sim, { faction: 'WARSAW', position: p, heading: 180, speed: 250, ...opts });
}

describe('레이더 공식', () => {
  it('탐지거리 ∝ RCS^(1/4): 5 m² = 기준, 0.0002 m² 스텔스 ≈ 8%', () => {
    expect(radarRangeForRcs(150, 5)).toBeCloseTo(150_000, 3);
    const ratio = radarRangeForRcs(150, 0.0002) / radarRangeForRcs(150, 5);
    expect(ratio).toBeCloseTo(0.0795, 3);
    expect(radarRangeForRcs(150, 80) / radarRangeForRcs(150, 5)).toBeCloseTo(2, 3);
  });

  it('자세각 배율: 일반기 측면 2배, 스텔스 측면 ~1.2배, 정면 1배', () => {
    expect(rcsAspectFactor(5, 1)).toBeCloseTo(1, 6);
    expect(rcsAspectFactor(5, 0)).toBeCloseTo(2, 6);
    expect(rcsAspectFactor(5, -1)).toBeCloseTo(1.5, 6);
    expect(rcsAspectFactor(0.0002, 0)).toBeCloseTo(1.2, 6);
    expect(stealthiness(5)).toBe(0);
    expect(stealthiness(0.001)).toBe(1);
  });

  it('재밍 배율 = 1 − 0.6·jam·(1 − eccm)', () => {
    expect(jamRangeFactor(1, 0)).toBeCloseTo(0.4, 6);
    expect(jamRangeFactor(0.9, 0.6)).toBeCloseTo(1 - 0.6 * 0.9 * 0.4, 6);
    expect(jamRangeFactor(1, 1)).toBeCloseTo(1, 6);
  });

  it('하방 클러터: 지평선 아래 + 저고도에서만, PD 가 AESA 보다 크게 손해', () => {
    expect(lookDownSeverity(5, 300)).toBe(0);
    expect(lookDownSeverity(-10, 9000)).toBe(0);
    expect(lookDownSeverity(-10, 300)).toBeCloseTo(1, 6);
    expect(clutterRangeFactor('PD', 1)).toBeCloseTo(0.55, 6);
    expect(clutterRangeFactor('AESA', 1)).toBeCloseTo(0.9, 6);
  });

  it('탐지확률: R 에서 50%, 0.7R 에서 ~97%, 1.2R 에서 ~8%', () => {
    expect(detectionProbability(1)).toBeCloseTo(0.5, 6);
    expect(detectionProbability(0.7)).toBeGreaterThan(0.96);
    expect(detectionProbability(1.2)).toBeLessThan(0.1);
  });

  it('IR: 애프터버너 ≈1.5배, 정면 0.6배', () => {
    expect(irSignatureFactor(3.4)).toBeCloseTo(1.53, 1);
    expect(irAspectFactor(1)).toBeCloseTo(0.6, 6);
    expect(irAspectFactor(-1)).toBeCloseTo(1, 6);
  });
});

describe('레이더 탐지 (통합)', () => {
  it('5 m² 표적은 120 km 에서 탐지, 220 km 에서는 미탐지', () => {
    const { sim, player } = setup();
    const near = headOn(sim, 120_000);
    const far = new TestAircraft(sim, { faction: 'WARSAW', position: polar(-20, 220_000, 9000), heading: 180 });
    stepSim(sim, 3);
    expect(trackOf(player, near)?.source).toBe('radar');
    expect(trackOf(player, far)).toBeUndefined();
  });

  it('스텔스(0.0002 m²) 탐지거리는 5 m² 의 ~8%: 20 km 미탐지, 9 km 탐지', () => {
    const { sim, player } = setup();
    const conv = headOn(sim, 60_000);
    const stealth = new TestAircraft(sim, { faction: 'PAX', name: 'XF-1 Lampyris', position: polar(10, 20_000, 9000), heading: 190, rcs: 0.0002 });
    stepSim(sim, 0.2);
    const ratio = player.avionics.assessRadar(stealth, sim).rangeM / player.avionics.assessRadar(conv, sim).rangeM;
    expect(ratio).toBeGreaterThan(0.075);
    expect(ratio).toBeLessThan(0.085);
    stepSim(sim, 4);
    expect(trackOf(player, stealth)).toBeUndefined();
    stealth.position.copy(polar(10, 9000, 9000));
    stepSim(sim, 3);
    expect(trackOf(player, stealth)?.source).toBe('radar');
  });

  it('재밍은 탐지거리를 줄이고, 번스루 거리 안에서는 다시 잡힌다', () => {
    const { sim, player } = setup({ radar: SAMPLE_RADAR.pd });
    player.avionics.setRadarMode('rws');
    player.moving = false;
    // 110 km PD (eccm 0.3): 무재밍 100 km 는 R 의 91%, 재밍 시 번스루 거리 ≈ 68 km
    const jammer = headOn(sim, 100_000, { sensors: { ew: SAMPLE_EW.strong } });
    jammer.moving = false;
    stepSim(sim, 4);
    expect(trackOf(player, jammer)?.source).toBe('radar');

    jammer.avionics.jammerActive = true;
    const a = player.avionics.assessRadar(jammer, sim);
    expect(a.jammed).toBe(true);
    expect(a.rangeM / a.unjammedRangeM).toBeCloseTo(jamRangeFactor(0.9, SAMPLE_RADAR.pd.eccm), 5);
    stepSim(sim, 6);
    expect(trackOf(player, jammer)).toBeUndefined();

    jammer.position.copy(polar(0, 40_000, 9000));
    stepSim(sim, 3);
    expect(trackOf(player, jammer)?.source).toBe('radar');
  });

  it('재머 범위 밖(전방 재머의 후방)에서는 재밍 효과 없음', () => {
    const { sim, player } = setup({ radar: SAMPLE_RADAR.pd });
    const jammer = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 80_000, 9000), heading: 0, sensors: { ew: SAMPLE_EW.forward } });
    jammer.avionics.jammerActive = true;
    stepSim(sim, 0.2);
    expect(player.avionics.assessRadar(jammer, sim).jammed).toBe(false);
  });

  it('재머가 없는 기체는 jammerActive 를 켤 수 없다', () => {
    const { sim } = setup();
    const e = headOn(sim, 50_000);
    e.avionics.jammerActive = true;
    expect(e.avionics.jammerActive).toBe(false);
  });

  it('지형 차폐: 산 뒤 저고도 표적은 안 보이고, 산 위로 올라오면 보인다', () => {
    const terrain = mountainTerrain([{ x: 0, z: -40_000, radius: 10_000, height: 6000 }]);
    const sim = createTestSim({ seed: 5, terrain });
    const player = new TestAircraft(sim, { faction: 'NATO', isPlayer: true, position: [0, 3000, 0], heading: 0, sensors: { radar: SAMPLE_RADAR.aesa } });
    const low = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 60_000, 1000), heading: 180 });
    stepSim(sim, 3);
    expect(player.avionics.assessRadar(low, sim).masked).toBe(true);
    expect(trackOf(player, low)).toBeUndefined();
    low.position.y = 9000;
    stepSim(sim, 3);
    expect(trackOf(player, low)?.source).toBe('radar');
  });

  it('도플러 노치: 내려다볼 때 수직으로 나는 표적을 놓친다 (같은 고도면 놓치지 않음)', () => {
    const { sim, player } = setup();
    const beam = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 40_000, 500), heading: 90, speed: 250 });
    stepSim(sim, 4);
    expect(player.avionics.assessRadar(beam, sim).notched).toBe(true);
    expect(trackOf(player, beam)).toBeUndefined();

    beam.setHeading(180);
    stepSim(sim, 3);
    expect(trackOf(player, beam)?.source).toBe('radar');

    const sim2 = createTestSim({ seed: 3 });
    const p2 = new TestAircraft(sim2, { faction: 'NATO', isPlayer: true, position: [0, 9000, 0], sensors: { radar: SAMPLE_RADAR.aesa } });
    const level = new TestAircraft(sim2, { faction: 'WARSAW', position: polar(0, 40_000, 9000), heading: 90, speed: 250 });
    stepSim(sim2, 3);
    expect(p2.avionics.assessRadar(level, sim2).notched).toBe(false);
    expect(trackOf(p2, level)?.source).toBe('radar');
  });

  it('하방 클러터: 저고도 표적에 대한 PD 레이더 거리 감소가 AESA 보다 크다', () => {
    const ratioFor = (radar: typeof SAMPLE_RADAR.pd) => {
      const { sim, player } = setup({ radar });
      const low = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 30_000, 400), heading: 180 });
      const high = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 30_000, 9000), heading: 180 });
      stepSim(sim, 0.2);
      return player.avionics.assessRadar(low, sim).rangeM / player.avionics.assessRadar(high, sim).rangeM;
    };
    const pd = ratioFor(SAMPLE_RADAR.pd);
    const aesa = ratioFor(SAMPLE_RADAR.aesa);
    expect(pd).toBeLessThan(0.65);
    expect(aesa).toBeGreaterThan(0.85);
  });

  it('스캔 볼륨: 방위 ±60° 밖은 레이더가 보지 못한다', () => {
    const { sim, player } = setup();
    const side = new TestAircraft(sim, { faction: 'WARSAW', position: polar(90, 30_000, 9000), heading: 270 });
    const above = new TestAircraft(sim, { faction: 'WARSAW', position: polar(0, 4000, 9000 + 12_000), heading: 180 });
    stepSim(sim, 3);
    expect(trackOf(player, side)).toBeUndefined();
    expect(player.avionics.assessRadar(above, sim).inVolume).toBe(false);
  });

  it('코스팅: 놓친 트랙은 외삽되며 품질이 떨어지다가 TWS 코스팅 시간 뒤 사라진다', () => {
    const { sim, player } = setup();
    const e = headOn(sim, 50_000);
    stepSim(sim, 3);
    const t = trackOf(player, e)!;
    expect(t.quality).toBeCloseTo(0.8, 2);
    // 스캔 볼륨 밖으로 순간이동 → 더 이상 탐지 안 됨
    e.position.copy(polar(150, 50_000, 9000));
    stepSim(sim, 4);
    const coast = trackOf(player, e);
    expect(coast).toBeDefined();
    expect(coast!.quality).toBeLessThan(0.8);
    // 외삽 위치는 마지막 탐지 위치 근처(정면 50 km) 에 남는다
    expect(coast!.position.z).toBeLessThan(-30_000);
    stepSim(sim, 6);
    expect(trackOf(player, e)).toBeUndefined();
  });

  it('스캔 주기: RWS/TWS 트랙은 약 1초마다 갱신된다', () => {
    const { sim, player } = setup();
    const e = headOn(sim, 50_000);
    const updates = new Set<number>();
    for (let i = 0; i < 300; i++) {
      stepSim(sim, 1 / 60);
      const t = trackOf(player, e);
      if (t) updates.add(Math.round(t.lastUpdate * 1000));
    }
    // 5초 동안 4~6회
    expect(updates.size).toBeGreaterThanOrEqual(4);
    expect(updates.size).toBeLessThanOrEqual(6);
  });

  it('TWS 는 maxTracks 개만 정밀 추적, 나머지는 RWS 품질', () => {
    const { sim, player } = setup({ radar: SAMPLE_RADAR.pd });
    for (let i = 0; i < 10; i++) headOn(sim, 30_000 + i * 3000, { position: polar(-30 + i * 6, 30_000 + i * 3000, 9000) });
    stepSim(sim, 4);
    const radarTracks = player.avionics.tracks.filter((t) => t.source === 'radar');
    expect(radarTracks.length).toBe(10);
    expect(radarTracks.filter((t) => t.quality >= 0.79).length).toBe(SAMPLE_RADAR.pd.maxTracks);
  });

  it('IFF: 아군은 자동 식별, 적은 NCTR 거리(60%) 안에서만 식별', () => {
    const { sim, player } = setup();
    const friend = new TestAircraft(sim, { faction: 'NATO', position: polar(-10, 100_000, 9000), heading: 0, name: 'F-16P Viper' });
    const farFoe = headOn(sim, 115_000, { position: polar(15, 115_000, 9000) });
    const nearFoe = headOn(sim, 50_000, { position: polar(-25, 50_000, 9000) });
    stepSim(sim, 4);
    const tf = trackOf(player, friend)!;
    expect(tf.hostile).toBe(false);
    expect(tf.identified).toBe(true);
    expect(trackOf(player, farFoe)?.identified).toBe(false);
    expect(trackOf(player, nearFoe)?.identified).toBe(true);
    expect(trackOf(player, nearFoe)?.hostile).toBe(true);
  });

  it('육안: 레이더를 꺼도 전방 7 km / 후방 3 km 안의 항공기와 8 km 안의 지상 표적은 보인다', () => {
    const terrain = mountainTerrain([{ x: 6000, z: 0, radius: 1500, height: 3000 }]);
    const sim = createTestSim({ seed: 2, terrain });
    const player = new TestAircraft(sim, { faction: 'NATO', isPlayer: true, position: [0, 1500, 0], heading: 0, sensors: { radar: SAMPLE_RADAR.aesa } });
    player.avionics.setRadarMode('off');
    const front = new TestAircraft(sim, { faction: 'WARSAW', position: polar(20, 6000, 1500), heading: 180 });
    const rear5 = new TestAircraft(sim, { faction: 'WARSAW', position: polar(180, 5000, 1500), heading: 0 });
    const rear2 = new TestAircraft(sim, { faction: 'WARSAW', position: polar(170, 2500, 1500), heading: 0 });
    const tank = new TestUnit(sim, { faction: 'WARSAW', name: 'T-80U', position: polar(-40, 6000, 0) });
    const hidden = new TestUnit(sim, { faction: 'WARSAW', name: 'T-80U', position: [8000, 0, 0] });
    stepSim(sim, 1);
    expect(trackOf(player, front)?.source).toBe('visual');
    expect(trackOf(player, rear5)).toBeUndefined();
    expect(trackOf(player, rear2)?.source).toBe('visual');
    expect(trackOf(player, tank)?.source).toBe('visual');
    expect(trackOf(player, hidden)).toBeUndefined();
    expect(player.emission).toBeNull();
  });

  it('IRST: 후방은 멀리, 정면은 짧게, 애프터버너면 다시 멀리', () => {
    const { sim, player } = setup({ irst: SAMPLE_IRST });
    const away = new TestAircraft(sim, { faction: 'WARSAW', position: polar(-10, 50_000, 9000), heading: 0, ir: 1 });
    const nose = new TestAircraft(sim, { faction: 'WARSAW', position: polar(10, 52_000, 9000), heading: 180, ir: 1 });
    stepSim(sim, 3);
    expect(trackOf(player, away)?.source).toBe('irst');
    expect(trackOf(player, nose)).toBeUndefined();
    nose.irSignature = 3.4;
    stepSim(sim, 3);
    expect(trackOf(player, nose)?.source).toBe('irst');
    expect(player.emission).toBeNull();
  });

  it("지상 모드('ag'): SAR 레이더는 40 km 지상 표적을 잡고, 공중 모드는 지상을 보지 않는다", () => {
    const { sim, player } = setup();
    const sam = new TestUnit(sim, { faction: 'WARSAW', position: polar(5, 40_000, 0), rcs: 15 });
    stepSim(sim, 3);
    expect(trackOf(player, sam)).toBeUndefined();
    player.avionics.setRadarMode('ag');
    stepSim(sim, 4);
    expect(trackOf(player, sam)?.source).toBe('radar');

    const pdSet = setup({ radar: SAMPLE_RADAR.pd });
    const sam2 = new TestUnit(pdSet.sim, { faction: 'WARSAW', position: polar(5, 40_000, 0), rcs: 15 });
    pdSet.player.avionics.setRadarMode('ag');
    stepSim(pdSet.sim, 4);
    expect(trackOf(pdSet.player, sam2)).toBeUndefined();
  });

  it('마스터 모드: 공대지 무장 선택 → ag, 공대공으로 돌아오면 원래 모드', () => {
    const { sim, player } = setup();
    expect(player.avionics.radarMode).toBe('tws');
    player.stores.weapon = SAMPLE_WEAPONS.gbu31;
    stepSim(sim, 0.1);
    expect(player.avionics.radarMode).toBe('ag');
    player.stores.weapon = SAMPLE_WEAPONS.aim120d;
    stepSim(sim, 0.1);
    expect(player.avionics.radarMode).toBe('tws');
  });

  it('레이더가 없는 기체는 항상 off', () => {
    const { sim, player } = setup({ rwr: SAMPLE_RWR.modern });
    player.avionics.setRadarMode('tws');
    stepSim(sim, 0.5);
    expect(player.avionics.radarMode).toBe('off');
    expect(player.emission).toBeNull();
  });

  it('트랙 위치는 매 스텝 갱신되고 거리도 따라온다', () => {
    const { sim, player } = setup();
    const e = headOn(sim, 20_000);
    stepSim(sim, 2);
    const t = trackOf(player, e)!;
    const r0 = t.rangeM;
    stepSim(sim, 0.5);
    // 서로 250 m/s 로 마주 접근 → 0.5 s 에 ~250 m
    expect(r0 - t.rangeM).toBeGreaterThan(200);
    expect(t.position.distanceTo(e.position)).toBeLessThan(50);
    expect(t.velocity.length()).toBeCloseTo(250, 0);
    expect(new THREE.Vector3().copy(t.position).sub(player.position).length()).toBeCloseTo(t.rangeM, 0);
  });
});
