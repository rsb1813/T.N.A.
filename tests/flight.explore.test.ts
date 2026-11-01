import { it } from 'vitest';
import { FlightModel, flightParamsFromStats } from '../src/flight/flightModel';
import { FIXTURE_F15_STATS, FIXTURE_F16_STATS, FIXTURE_F14_STATS, FIXTURE_F14_SWEEP } from '../src/flight/fixtures';
import type { ControlInput } from '../src/core/contracts';

function mk(stats = FIXTURE_F16_STATS, sweep: any = null) {
  const fm = new FlightModel(flightParamsFromStats(stats, sweep));
  fm.stores = { massKg: stats.storesMassKg, dragArea: stats.storesDragArea, externalFuelKg: 0 };
  return fm;
}
const ctl = (o: Partial<ControlInput> = {}): ControlInput => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0.75, afterburner: false, airbrake: false, ...o });
function run(fm: FlightModel, secs: number, c: ControlInput, limiter = true, every = 1, label = '') {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) {
    fm.step(1 / 60, c, { limiter });
    if ((i + 1) % Math.round(every * 60) === 0) {
      const t = fm.telemetry;
      console.log(label, ((i + 1) / 60).toFixed(1), 'V', t.speed.toFixed(1), 'M', t.mach.toFixed(2), 'alt', t.altitude.toFixed(0), 'aoa', t.aoaDeg.toFixed(1), 'cmd', fm.alphaCmdDeg.toFixed(1), 'G', t.gLoad.toFixed(2), 'pitch', t.pitchDeg.toFixed(1), 'roll', t.rollDeg.toFixed(1), 'hdg', t.headingDeg.toFixed(1), 'Ps', t.specificExcessPower.toFixed(0), 'st', t.stalled, 'oG', t.overG, 'fuel', t.fuelKg.toFixed(0), 'sw', t.sweepDeg);
    }
  }
}
it('explore', () => {
  let fm = mk();
  fm.position.set(0, 1000, 0);
  fm.placeTrimmed(0, 350, { throttle: 1 });
  let maxG = 0, maxA = 0;
  for (let i = 0; i < 180; i++) { fm.step(1/60, ctl({ pitch: 1, throttle: 1 }), { limiter: true }); maxG = Math.max(maxG, fm.telemetry.gLoad); if (i % 6 == 5) console.log('lim', i, fm.telemetry.gLoad.toFixed(2), fm.telemetry.aoaDeg.toFixed(2)); }
  console.log('limiter maxG', maxG);
  fm = mk(); fm.position.set(0, 1000, 0); fm.placeTrimmed(0, 350, { throttle: 1 });
  maxG = 0;
  for (let i = 0; i < 120; i++) { fm.step(1/60, ctl({ pitch: 1, throttle: 1 }), { limiter: false }); maxG = Math.max(maxG, fm.telemetry.gLoad); }
  console.log('unlimited maxG', maxG, 'stress', fm.airframeStress, fm.telemetry.overG);
  fm = mk(); fm.position.set(0, 3000, 0); fm.placeTrimmed(0, 140, { throttle: 1 });
  maxA = 0;
  for (let i = 0; i < 300; i++) { fm.step(1/60, ctl({ pitch: 1, throttle: 1 }), { limiter: false }); maxA = Math.max(maxA, fm.telemetry.aoaDeg); if (i % 20 == 19) console.log('unl-slow', i, fm.telemetry.aoaDeg.toFixed(1), fm.telemetry.rollDeg.toFixed(1), fm.telemetry.gLoad.toFixed(2), fm.telemetry.speed.toFixed(0), fm.telemetry.pitchDeg.toFixed(1)); }
  console.log('unlimited maxAoA', maxA);
  // bank & pull
  fm = mk(); fm.position.set(0, 5000, 0); fm.placeTrimmed(0, 220, { throttle: 1 });
  run(fm, 0.5, ctl({ roll: 1, throttle: 1 }), true, 0.1, 'roll');
  run(fm, 10, ctl({ pitch: 0.6, throttle: 1, afterburner: true }), true, 1, 'turn');
  run(fm, 3, ctl({ throttle: 1 }), true, 1, 'release');
  fm = mk(); fm.position.set(0, 5000, 0); fm.placeTrimmed(0, 220, { throttle: 0.8 });
  run(fm, 4, ctl({ yaw: 1, throttle: 0.8 }), true, 0.5, 'yaw');
});
