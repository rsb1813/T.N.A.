import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFlightModel, FlightModel, flightParamsFromStats, type FlightContext } from '../src/flight/flightModel';
import { FIXTURE_F14_STATS, FIXTURE_F14_SWEEP, FIXTURE_F15_STATS, FIXTURE_F16_STATS } from '../src/flight/fixtures';
import type { ControlInput } from '../src/core/contracts';
import type { DerivedStats } from '../src/data/schema';
import { atmosphere, DEG, G0, quatFromHeadingPitch } from '../src/core/math';
import { engineThrust } from '../src/core/aero';

const DT = 1 / 60;

function make(stats: DerivedStats = FIXTURE_F16_STATS, sweep: { minDeg: number; maxDeg: number } | null = null): FlightModel {
  return createFlightModel(stats, sweep);
}

function ctl(o: Partial<ControlInput> = {}): ControlInput {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0.75, afterburner: false, airbrake: false, ...o };
}

function place(fm: FlightModel, alt: number, speed: number, heading = 0, throttle = 0.75): FlightModel {
  fm.position.set(0, alt, 0);
  fm.placeTrimmed(heading, speed, { throttle });
  return fm;
}

/** secs 동안 적분하며 매 스텝 콜백 */
function run(fm: FlightModel, secs: number, c: ControlInput, ctx: FlightContext = { limiter: true }, each?: (fm: FlightModel, t: number) => void): void {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    fm.step(DT, c, ctx);
    each?.(fm, (i + 1) * DT);
  }
}

function finiteState(fm: FlightModel): boolean {
  const t = fm.telemetry;
  const vals = [
    fm.position.x, fm.position.y, fm.position.z,
    fm.velocity.x, fm.velocity.y, fm.velocity.z,
    fm.quaternion.x, fm.quaternion.y, fm.quaternion.z, fm.quaternion.w,
    t.speed, t.mach, t.aoaDeg, t.sideslipDeg, t.gLoad, t.headingDeg, t.pitchDeg, t.rollDeg, t.thrustN, t.dragN, t.specificExcessPower,
  ];
  return vals.every(Number.isFinite);
}

/** 수평 정상비행 트림 스로틀 (추력 = 항력) */
function trimThrottle(fm: FlightModel, stats: DerivedStats): number {
  const probe = new FlightModel(fm.params, { internalFuelKg: fm.internalFuelKg });
  probe.stores = { ...fm.stores };
  probe.position.copy(fm.position);
  probe.placeTrimmed(0, fm.velocity.length(), { throttle: 0.75 });
  probe.step(DT, ctl(), { limiter: true });
  const atm = atmosphere(probe.position.y);
  const mach = probe.telemetry.mach;
  const full = engineThrust(stats.thrustDryN, stats.thrustAbN, atm.rho, mach, 1, false);
  const level = probe.telemetry.dragN / full; // = 0.05 + 0.95·spool
  return (level - 0.05) / 0.95;
}

describe('FlightModel 부호 규칙', () => {
  it('+pitch = 기수 올림 = 로컬 +X 양의 회전', () => {
    const fm = place(make(), 5000, 250);
    const p0 = fm.telemetry.pitchDeg;
    let sawPositiveRate = false;
    run(fm, 0.6, ctl({ pitch: 1 }), { limiter: true }, (m) => {
      if (m.bodyRates.x > 0.05) sawPositiveRate = true;
    });
    expect(sawPositiveRate).toBe(true);
    // 로컬 +X 축 회전이 기수를 올리는지 직접 확인
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(q).y).toBeGreaterThan(0);
    place(fm, 5000, 250);
    run(fm, 0.6, ctl({ pitch: 1 }));
    expect(fm.telemetry.pitchDeg).toBeGreaterThan(p0 + 3);
    expect(fm.telemetry.aoaDeg).toBeGreaterThan(5);
  });

  it('+roll = 오른쪽 날개 내려감', () => {
    const fm = place(make(), 5000, 250);
    let sawPositiveRate = false;
    run(fm, 0.25, ctl({ roll: 1 }), { limiter: true }, (m) => {
      if (m.bodyRates.z > 0.5) sawPositiveRate = true;
    });
    expect(sawPositiveRate).toBe(true);
    expect(fm.telemetry.rollDeg).toBeGreaterThan(15);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(fm.quaternion);
    expect(right.y).toBeLessThan(-0.2);
  });

  it('+yaw = 기수 오른쪽', () => {
    const fm = place(make(), 5000, 250);
    let sawPositiveRate = false;
    run(fm, 1, ctl({ yaw: 1 }), { limiter: true }, (m) => {
      if (m.bodyRates.y > 0.02) sawPositiveRate = true;
    });
    expect(sawPositiveRate).toBe(true);
    expect(fm.telemetry.headingDeg).toBeGreaterThan(2);
    expect(fm.telemetry.headingDeg).toBeLessThan(90);
    // 기수가 속도보다 오른쪽 → 상대풍이 왼쪽에서 (β < 0)
    expect(fm.telemetry.sideslipDeg).toBeLessThan(-1);
  });

  it('왼쪽 입력은 반대 방향', () => {
    const fm = place(make(), 5000, 250);
    run(fm, 0.25, ctl({ roll: -1 }));
    expect(fm.telemetry.rollDeg).toBeLessThan(-15);
    place(fm, 5000, 250);
    run(fm, 1, ctl({ yaw: -1 }));
    expect(fm.telemetry.headingDeg).toBeGreaterThan(270);
  });
});

describe('FlightModel 기본 물리', () => {
  it('수평 정상비행 트림 가능 (30 s 동안 고도/속도 유지)', () => {
    const fm = place(make(), 5000, 250);
    const thr = trimThrottle(fm, FIXTURE_F16_STATS);
    expect(thr).toBeGreaterThan(0.2);
    expect(thr).toBeLessThan(1);
    place(fm, 5000, 250, 0, thr);
    run(fm, 30, ctl({ throttle: thr }));
    expect(Math.abs(fm.position.y - 5000)).toBeLessThan(40);
    expect(Math.abs(fm.telemetry.speed - 250)).toBeLessThan(4);
    expect(fm.telemetry.gLoad).toBeCloseTo(1, 1);
    expect(Math.abs(fm.telemetry.specificExcessPower)).toBeLessThan(2);
  });

  it('양력은 속도에 수직이고 대칭면 안에 있다', () => {
    const fm = place(make(), 4000, 220);
    run(fm, 0.3, ctl({ roll: 0.6 }));
    run(fm, 1, ctl({ pitch: 0.8, yaw: 0.5 }));
    const L = fm.forces.lift;
    const v = fm.velocity;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(fm.quaternion);
    expect(L.length()).toBeGreaterThan(1000);
    // 적분 후 속도로 비교하므로 약간의 오차 허용
    expect(Math.abs(L.clone().normalize().dot(v.clone().normalize()))).toBeLessThan(0.03);
    // 힘은 스텝 시작 자세로 계산되므로 한 스텝 회전만큼 오차 허용
    expect(Math.abs(L.clone().normalize().dot(right))).toBeLessThan(5e-3);
  });

  it('당기면 속도벡터가 기수보다 늦게 따라온다 (받음각 발생)', () => {
    const fm = place(make(), 5000, 250);
    const a0 = fm.telemetry.aoaDeg;
    run(fm, 0.5, ctl({ pitch: 0.7 }));
    expect(fm.telemetry.aoaDeg).toBeGreaterThan(a0 + 4);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(fm.quaternion);
    // 기수가 속도벡터 위
    expect(fwd.y).toBeGreaterThan(fm.velocity.clone().normalize().y);
  });

  it('F-15 계열은 11 km 에서 애프터버너로 M2 를 넘는다', () => {
    const fm = make(FIXTURE_F15_STATS);
    fm.position.set(0, 11000, 0);
    fm.placeTrimmed(0, 1.5 * atmosphere(11000).speedOfSound, { throttle: 1, afterburner: true });
    run(fm, 150, ctl({ throttle: 1, afterburner: true }));
    expect(fm.telemetry.mach).toBeGreaterThan(2.0);
    expect(fm.telemetry.mach).toBeLessThan(FIXTURE_F15_STATS.maxMach);
    expect(Math.abs(fm.position.y - 11000)).toBeLessThan(500);
    expect(fm.telemetry.afterburner).toBe(true);
  });

  it('순간선회 vs 지속선회: 최대 G 를 유지하면 속도가 깎인다', () => {
    const fm = place(make(), 5000, 250, 0, 1);
    let peakG = 0;
    run(fm, 2, ctl({ pitch: 1, throttle: 1, afterburner: true }), { limiter: true }, (m, t) => {
      peakG = Math.max(peakG, m.telemetry.gLoad);
      // G 가 걸리면 유도항력이 추력을 넘는다
      if (t > 1) expect(m.telemetry.specificExcessPower).toBeLessThan(0);
    });
    run(fm, 10, ctl({ pitch: 1, throttle: 1, afterburner: true }));
    // 5 km / 250 m/s 에서는 CLmax 로 제한 (≈ 7.9 G)
    expect(peakG).toBeGreaterThan(7.5);
    expect(fm.telemetry.gLoad).toBeLessThan(peakG - 2);
    expect(fm.telemetry.speed).toBeLessThan(200);

    // 반만 당기면 에너지 손실이 훨씬 작다
    const half = place(make(), 5000, 250, 0, 1);
    run(half, 0.3, ctl({ roll: 1, throttle: 1, afterburner: true }));
    run(half, 12, ctl({ pitch: 0.35, throttle: 1, afterburner: true }));
    const fullLoss = 250 - fm.telemetry.speed;
    const halfLoss = 250 - half.telemetry.speed;
    expect(halfLoss).toBeLessThan(fullLoss * 0.5);
  });

  it('줌 상승: 속도를 고도로 바꾼다', () => {
    const fm = place(make(), 2000, 320, 0, 0);
    const e0 = fm.position.y + (320 * 320) / (2 * G0);
    run(fm, 4, ctl({ pitch: 0.45, throttle: 0 }));
    let top = 0;
    let vTop = 0;
    run(fm, 25, ctl({ throttle: 0 }), { limiter: true }, (m) => {
      if (m.position.y > top) {
        top = m.position.y;
        vTop = m.telemetry.speed;
      }
    });
    expect(top).toBeGreaterThan(4500);
    expect(vTop).toBeLessThan(150);
    const e1 = top + vTop ** 2 / (2 * G0);
    // 아이들 + 유도항력 손실: 에너지 고도는 줄지만 대부분 보존
    expect(e1).toBeLessThan(e0);
    expect(e1).toBeGreaterThan(e0 * 0.75);
  });

  it('Ps 는 에너지 고도 변화율과 일치한다', () => {
    const fm = place(make(), 3000, 200, 0, 1);
    run(fm, 0.3, ctl({ throttle: 1, afterburner: true, pitch: 0.4 }));
    let psSum = 0;
    let n = 0;
    const eh = () => fm.position.y + fm.telemetry.speed ** 2 / (2 * G0);
    const e0 = eh();
    run(fm, 5, ctl({ throttle: 1, afterburner: true, pitch: 0.4 }), { limiter: true }, (m) => {
      psSum += m.telemetry.specificExcessPower;
      n++;
    });
    const measured = (eh() - e0) / 5;
    expect(Math.abs(measured - psSum / n)).toBeLessThan(Math.abs(measured) * 0.03 + 0.2);
  });

  it('결정적: 같은 입력이면 같은 결과', () => {
    const a = place(make(), 4000, 230);
    const b = place(make(), 4000, 230);
    const seq = [ctl({ pitch: 0.7, roll: 0.3 }), ctl({ roll: -1, yaw: 0.4 }), ctl({ pitch: -0.5, throttle: 1, afterburner: true })];
    for (const c of seq) {
      run(a, 3, c);
      run(b, 3, c);
    }
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(a.quaternion.toArray()).toEqual(b.quaternion.toArray());
  });
});

describe('FlightModel FBW 리미터', () => {
  it('리미터: 고속 최대 당김에서 G ≤ gMax', () => {
    const fm = place(make(), 1000, 350, 0, 1);
    let maxG = 0;
    let overG = false;
    run(fm, 4, ctl({ pitch: 1, throttle: 1 }), { limiter: true }, (m) => {
      maxG = Math.max(maxG, m.telemetry.gLoad);
      overG ||= m.telemetry.overG;
    });
    expect(maxG).toBeLessThanOrEqual(FIXTURE_F16_STATS.gMax + 0.3);
    expect(maxG).toBeGreaterThan(FIXTURE_F16_STATS.gMax - 0.5);
    expect(overG).toBe(false);
    expect(fm.airframeStress).toBe(0);
  });

  it('리미터: 음의 G 도 gMin 이내', () => {
    const fm = place(make(), 3000, 350, 0, 1);
    let minG = 1;
    run(fm, 2, ctl({ pitch: -1, throttle: 1 }), { limiter: true }, (m) => {
      minG = Math.min(minG, m.telemetry.gLoad);
    });
    expect(minG).toBeGreaterThanOrEqual(FIXTURE_F16_STATS.gMin - 0.3);
    expect(minG).toBeLessThan(FIXTURE_F16_STATS.gMin + 1);
  });

  it('리미터: 저속 최대 당김에서 AoA ≤ aoaMax', () => {
    const fm = place(make(), 3000, 150, 0, 1);
    let maxA = 0;
    run(fm, 6, ctl({ pitch: 1, throttle: 1, afterburner: true }), { limiter: true }, (m) => {
      maxA = Math.max(maxA, m.telemetry.aoaDeg);
    });
    expect(maxA).toBeLessThanOrEqual(FIXTURE_F16_STATS.aoaMaxDeg + 0.5);
    expect(maxA).toBeGreaterThan(FIXTURE_F16_STATS.aoaMaxDeg - 2);
  });

  it('리미터 해제: 과G → overG 경고 + 기체 응력 누적', () => {
    const fm = place(make(), 1000, 350, 0, 1);
    let maxG = 0;
    let overG = false;
    run(fm, 2, ctl({ pitch: 1, throttle: 1 }), { limiter: false }, (m) => {
      maxG = Math.max(maxG, m.telemetry.gLoad);
      overG ||= m.telemetry.overG;
    });
    expect(maxG).toBeGreaterThan(FIXTURE_F16_STATS.gMax + 2);
    expect(overG).toBe(true);
    expect(fm.airframeStress).toBeGreaterThan(0.2);
  });

  it('리미터 해제: 받음각 초과 → 실속, 날개 흔들림', () => {
    const fm = place(make(), 3000, 140, 0, 1);
    let maxA = 0;
    let maxRoll = 0;
    let stalled = false;
    run(fm, 6, ctl({ pitch: 1, throttle: 1 }), { limiter: false }, (m) => {
      maxA = Math.max(maxA, m.telemetry.aoaDeg);
      maxRoll = Math.max(maxRoll, Math.abs(m.telemetry.rollDeg));
      stalled ||= m.telemetry.stalled;
    });
    expect(maxA).toBeGreaterThan(FIXTURE_F16_STATS.aoaMaxDeg + 5);
    expect(stalled).toBe(true);
    expect(maxRoll).toBeGreaterThan(3);
  });
});

describe('FlightModel 실속과 극한 자세', () => {
  it('~70 m/s 미만: 1G 를 못 버티고 기수가 떨어진다 (리미터 켜짐)', () => {
    const fm = place(make(), 3000, 65, 0, 0);
    const pitch0 = fm.telemetry.pitchDeg;
    let stalled = false;
    let maxA = 0;
    run(fm, 6, ctl({ throttle: 0 }), { limiter: true }, (m) => {
      stalled ||= m.telemetry.stalled;
      maxA = Math.max(maxA, m.telemetry.aoaDeg);
    });
    expect(stalled).toBe(true);
    expect(maxA).toBeLessThanOrEqual(FIXTURE_F16_STATS.aoaMaxDeg + 0.5);
    expect(fm.telemetry.pitchDeg).toBeLessThan(pitch0 - 5);
    expect(fm.velocity.y).toBeLessThan(-3);
    // 기수를 내려 속도를 회복한다
    run(fm, 20, ctl({ throttle: 1 }));
    expect(fm.telemetry.speed).toBeGreaterThan(90);
    expect(fm.telemetry.stalled).toBe(false);
  });

  it('영속도: 탄도 낙하, NaN 없음, 기수가 아래로', () => {
    const fm = make();
    fm.position.set(0, 3000, 0);
    fm.placeTrimmed(0, 0, { throttle: 0 });
    run(fm, 2, ctl({ throttle: 0 }));
    expect(finiteState(fm)).toBe(true);
    expect(fm.velocity.y).toBeLessThan(-15);
    run(fm, 15, ctl({ throttle: 0 }));
    expect(finiteState(fm)).toBe(true);
    expect(fm.telemetry.pitchDeg).toBeLessThan(-20);
  });

  const attitudes: Array<[string, number, number, number, number]> = [
    // 이름, 피치, 롤, 속도, 속도방향 피치
    ['수직 상승 정지', 90, 0, 0, 0],
    ['수직 상승 100 m/s', 90, 0, 100, 90],
    ['수직 강하 300 m/s', -90, 0, 300, -90],
    ['배면 비행', 0, 180, 200, 0],
    ['꼬리 미끄럼', 80, 0, 40, -90],
    ['나이프엣지 저속', 0, 90, 60, 0],
  ];
  for (const [name, pitch, roll, speed, vpitch] of attitudes) {
    it(`NaN 없음: ${name}`, () => {
      const fm = make();
      fm.position.set(0, 6000, 0);
      fm.quaternion.copy(quatFromHeadingPitch(0, pitch, roll));
      fm.velocity.set(0, Math.sin(vpitch * DEG), -Math.cos(vpitch * DEG)).multiplyScalar(speed);
      const inputs = [ctl({ throttle: 0 }), ctl({ pitch: 1, roll: 1, throttle: 1, afterburner: true }), ctl({ pitch: -1, yaw: 1 })];
      for (const c of inputs) {
        for (const limiter of [true, false]) {
          run(fm, 4, c, { limiter });
          expect(finiteState(fm)).toBe(true);
        }
      }
      expect(Math.abs(fm.quaternion.length() - 1)).toBeLessThan(1e-6);
    });
  }
});

describe('FlightModel 엔진과 연료', () => {
  it('애프터버너는 군용추력보다 연료를 크게 먹는다', () => {
    const dry = place(make(), 5000, 250, 0, 1);
    const ab = place(make(), 5000, 250, 0, 1);
    const f0 = dry.fuelKg;
    run(dry, 30, ctl({ throttle: 1 }));
    run(ab, 30, ctl({ throttle: 1, afterburner: true }));
    const burnDry = f0 - dry.fuelKg;
    const burnAb = f0 - ab.fuelKg;
    expect(burnDry).toBeGreaterThan(10);
    expect(burnAb).toBeGreaterThan(burnDry * 2.5);
    expect(ab.telemetry.thrustN).toBeGreaterThan(dry.telemetry.thrustN * 1.3);
  });

  it('외부탱크 연료부터 소모한다', () => {
    const fm = place(make(), 5000, 250, 0, 1);
    fm.stores = { massKg: 300, dragArea: 0.3, externalFuelKg: 200 };
    const int0 = fm.internalFuelKg;
    run(fm, 5, ctl({ throttle: 1, afterburner: true }));
    expect(fm.internalFuelKg).toBe(int0);
    expect(fm.stores.externalFuelKg).toBeLessThan(200);
    run(fm, 60, ctl({ throttle: 1, afterburner: true }));
    expect(fm.stores.externalFuelKg).toBe(0);
    expect(fm.internalFuelKg).toBeLessThan(int0);
  });

  it('연료가 바닥나면 엔진 정지', () => {
    const fm = new FlightModel(flightParamsFromStats(FIXTURE_F16_STATS, null), { internalFuelKg: 3 });
    place(fm, 5000, 250, 0, 1);
    run(fm, 10, ctl({ throttle: 1, afterburner: true }));
    expect(fm.engineRunning).toBe(false);
    expect(fm.telemetry.thrustN).toBe(0);
    expect(fm.telemetry.throttle).toBe(0);
    expect(fm.telemetry.fuelKg).toBe(0);
  });

  it('스풀 지연: 아이들 → 최대는 spoolTime 정도 걸린다', () => {
    const fm = place(make(), 3000, 200, 0, 0);
    run(fm, 0.5, ctl({ throttle: 1 }));
    expect(fm.telemetry.throttle).toBeLessThan(0.3);
    run(fm, FIXTURE_F16_STATS.spoolTime, ctl({ throttle: 1 }));
    expect(fm.telemetry.throttle).toBe(1);
  });

  it('애프터버너는 스로틀 1 에서만', () => {
    const fm = place(make(), 3000, 200, 0, 0.9);
    run(fm, 3, ctl({ throttle: 0.9, afterburner: true }));
    expect(fm.abLevel).toBe(0);
    expect(fm.telemetry.afterburner).toBe(false);
    run(fm, 3, ctl({ throttle: 1, afterburner: true }));
    expect(fm.telemetry.afterburner).toBe(true);
  });

  it('에어브레이크는 ΔCD ≈ 0.05', () => {
    const a = place(make(), 3000, 200);
    const b = place(make(), 3000, 200);
    run(a, 2, ctl());
    run(b, 2, ctl({ airbrake: true }));
    const q = 0.5 * atmosphere(3000).rho * 200 * 200;
    const dCd = (b.telemetry.dragN - a.telemetry.dragN) / (q * FIXTURE_F16_STATS.wingArea);
    expect(dCd).toBeGreaterThan(0.04);
    expect(dCd).toBeLessThan(0.065);
  });

  it('최대 마하 초과 시 추가 항력 (소프트 리밋)', () => {
    const fast = make();
    const ref = new FlightModel({ ...fast.params, maxMach: 5 });
    ref.stores = fast.stores;
    for (const m of [fast, ref]) place(m, 9000, 2.15 * atmosphere(9000).speedOfSound, 0, 1);
    fast.step(DT, ctl({ throttle: 1 }), { limiter: true });
    ref.step(DT, ctl({ throttle: 1 }), { limiter: true });
    expect(fast.telemetry.dragN).toBeGreaterThan(ref.telemetry.dragN * 1.5);
  });
});

describe('FlightModel 손상', () => {
  it('엔진 손상: 추력 ×(1 - 0.7d)', () => {
    const a = place(make(), 3000, 200, 0, 1);
    const b = place(make(), 3000, 200, 0, 1);
    b.damage = { engine: 1, wings: 0, control: 0, fuelLeak: false };
    a.step(DT, ctl({ throttle: 1 }), { limiter: true });
    b.step(DT, ctl({ throttle: 1 }), { limiter: true });
    expect(b.telemetry.thrustN / a.telemetry.thrustN).toBeCloseTo(0.3, 3);
  });

  it('날개 손상: CLmax 감소 + 롤 쏠림', () => {
    const fm = place(make(), 4000, 220);
    const cl0 = fm.effectiveClMax();
    fm.damage = { engine: 0, wings: 0.6, control: 0, fuelLeak: false };
    fm.rollBiasSign = -1;
    expect(fm.effectiveClMax()).toBeCloseTo(cl0 * 0.7, 6);
    run(fm, 1.5, ctl());
    expect(fm.telemetry.rollDeg).toBeLessThan(-20);
  });

  it('조종 손상: 롤레이트 ×(1 - 0.6d)', () => {
    const a = place(make(), 4000, 250);
    const b = place(make(), 4000, 250);
    b.damage = { engine: 0, wings: 0, control: 1, fuelLeak: false };
    run(a, 0.4, ctl({ roll: 1 }));
    run(b, 0.4, ctl({ roll: 1 }));
    expect(b.bodyRates.z / a.bodyRates.z).toBeCloseTo(0.4, 1);
  });
});

describe('FlightModel 가변익', () => {
  it('자동 스케줄: M0.4 이하 최소 → M1.2 이상 최대, 속도 제한', () => {
    const fm = make(FIXTURE_F14_STATS, FIXTURE_F14_SWEEP);
    const a = atmosphere(6000).speedOfSound;
    place(fm, 6000, 0.3 * a, 0, 0.8);
    expect(fm.telemetry.sweepDeg).toBe(20);
    expect(fm.sweepTarget(0.8)).toBeCloseTo(44, 6);
    expect(fm.sweepTarget(1.2)).toBe(68);
    expect(fm.sweepTarget(2)).toBe(68);
    // 저속 배치 상태에서 갑자기 M1.3 → 즉시 바뀌지 않고 서서히 후퇴
    fm.velocity.setLength(1.3 * a);
    run(fm, 1, ctl({ throttle: 1, afterburner: true }));
    expect(fm.telemetry.sweepDeg!).toBeGreaterThan(22);
    expect(fm.telemetry.sweepDeg!).toBeLessThan(30);
    run(fm, 8, ctl({ throttle: 1, afterburner: true }));
    expect(fm.telemetry.sweepDeg).toBe(68);
  });

  it('고후퇴각은 CLmax 를 낮춘다, 고정익은 sweepDeg = null', () => {
    const fm = make(FIXTURE_F14_STATS, FIXTURE_F14_SWEEP);
    place(fm, 6000, 100);
    const low = fm.effectiveClMax();
    place(fm, 6000, 450);
    expect(fm.effectiveClMax()).toBeLessThan(low * 0.8);
    const f16 = place(make(), 6000, 200);
    f16.step(DT, ctl(), { limiter: true });
    expect(f16.telemetry.sweepDeg).toBeNull();
  });
});
