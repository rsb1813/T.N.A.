import { it } from 'vitest';
import { Noise2 } from '../src/world/noise';
it('noise', () => {
  const n = new Noise2(3);
  for (let rep = 0; rep < 3; rep++) {
    let s = 0; let t0 = performance.now();
    for (let i = 0; i < 1e7; i++) s += n.noise(i * 0.0137, i * 0.0071 + 5);
    let t1 = performance.now();
    for (let i = 0; i < 1e6; i++) s += n.ridged(i * 0.0137, i * 0.0071 + 5, 7);
    let t2 = performance.now();
    for (let i = 0; i < 1e6; i++) s += n.fbm(i * 0.0137, i * 0.0071 + 5, 7);
    let t3 = performance.now();
    console.log('noise ns', ((t1 - t0) / 1e7 * 1e6).toFixed(1), 'ridged7 ns', ((t2 - t1)).toFixed(0), 'fbm7 ns', (t3 - t2).toFixed(0), s > 0);
  }
});
