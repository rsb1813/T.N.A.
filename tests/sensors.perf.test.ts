import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SAMPLE_DATALINK,
  SAMPLE_EW,
  SAMPLE_IRST,
  SAMPLE_MAW,
  SAMPLE_RADAR,
  SAMPLE_RWR,
  SAMPLE_WEAPONS,
  TestAircraft,
  TestMissile,
  TestUnit,
  createTestSim,
  mountainTerrain,
  stepSim,
} from '../src/combat/avionics/testkit';

/** 이 프로세스의 CPU 시간 (ms). 다른 프로세스 부하에 덜 흔들린다. Node 가 아니면 벽시계 */
function cpuMs(): number {
  const proc = (globalThis as { process?: { cpuUsage(): { user: number; system: number } } }).process;
  if (proc?.cpuUsage) {
    const u = proc.cpuUsage();
    return (u.user + u.system) / 1000;
  }
  return performance.now();
}

describe('성능', () => {
  it('항공기 40 + 지상 150 + 미사일 20: 시뮬레이션 1초(60 스텝)의 항전 비용', () => {
    const base = mountainTerrain(
      Array.from({ length: 12 }, (_, i) => ({ x: Math.cos(i) * 40_000, z: Math.sin(i * 1.7) * 40_000, radius: 6000, height: 2500 })),
      1000,
    );
    let losCalls = 0;
    const terrain = { ...base, lineOfSight: (a: THREE.Vector3, b: THREE.Vector3) => (losCalls++, base.lineOfSight(a, b)) };
    const sim = createTestSim({ seed: 9, terrain });
    const rnd = sim.rng.fork(1);
    const aircraft: TestAircraft[] = [];
    for (let i = 0; i < 40; i++) {
      const nato = i < 12;
      const ac = new TestAircraft(sim, {
        faction: nato ? 'NATO' : i % 3 === 0 ? 'PAX' : 'WARSAW',
        isPlayer: i === 0,
        position: [rnd.range(-60_000, 60_000), rnd.range(2000, 11_000), rnd.range(-60_000, 60_000)],
        heading: rnd.range(0, 360),
        speed: rnd.range(200, 320),
        sensors: {
          radar: i % 4 === 0 ? SAMPLE_RADAR.pd : i % 4 === 1 ? SAMPLE_RADAR.pesa : SAMPLE_RADAR.aesa,
          irst: i % 2 === 0 ? SAMPLE_IRST : null,
          rwr: SAMPLE_RWR.modern,
          maw: i % 2 === 1 ? SAMPLE_MAW.full : null,
          ew: SAMPLE_EW.towed,
          datalink: SAMPLE_DATALINK,
        },
        weapon: i % 5 === 0 ? SAMPLE_WEAPONS.aim9x : SAMPLE_WEAPONS.aim120d,
        tags: i === 5 ? ['awacs'] : [],
      });
      ac.avionics.jammerActive = i % 7 === 0;
      aircraft.push(ac);
    }
    for (let i = 0; i < 150; i++) {
      const u = new TestUnit(sim, {
        faction: i % 2 ? 'WARSAW' : 'PAX',
        position: [rnd.range(-70_000, 70_000), 0, rnd.range(-70_000, 70_000)],
        tags: i % 10 === 0 ? ['target'] : [],
      });
      if (i % 6 === 0) u.emission = { mode: 'search', rangeM: 80_000, azimuthDeg: 180, lpi: 0, trackedIds: [], label: 'SA-11' };
    }
    for (let i = 0; i < 20; i++) {
      const shooter = aircraft[12 + i];
      const target = aircraft[i % 12];
      const dir = new THREE.Vector3().subVectors(target.position, shooter.position).normalize();
      new TestMissile(sim, { def: SAMPLE_WEAPONS.aim120d, shooter, target, position: shooter.position.clone(), velocity: dir.multiplyScalar(900), seekerActive: i % 2 === 0, burnSec: 8 });
    }
    stepSim(sim, 2); // 워밍업
    losCalls = 0;
    const w0 = performance.now();
    const c0 = cpuMs();
    stepSim(sim, 1);
    const ms = cpuMs() - c0;
    const wall = performance.now() - w0;
    const avgTracks = aircraft.reduce((n, a) => n + a.avionics.tracks.length, 0) / aircraft.length;
    // 60 fps 의 1초 = 1000 ms 예산 중 항전 전체가 작은 몫이어야 한다 (CI 여유 포함 상한).
    // 지형 시선 검사는 캐시 덕분에 초당 수천 번 이하
    expect(ms).toBeLessThan(200);
    expect(losCalls).toBeLessThan(2500);
    expect(avgTracks).toBeGreaterThan(3);
    console.info(`[perf] avionics 40기 + 지상 150 + 미사일 20: CPU ${ms.toFixed(1)} ms (벽시계 ${wall.toFixed(1)} ms) / sim-s, LOS ${losCalls}/s, 평균 트랙 ${avgTracks.toFixed(1)}`);
  });
});
