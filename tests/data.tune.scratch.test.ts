import { it } from 'vitest';
import { DB } from '../src/data/db';
import { computeStats, emptyLoadout } from '../src/data/loadout';
import { maxLevelMach, sustainedTurn } from '../src/data/performance';
import type { DerivedStats } from '../src/data/schema';
declare const process: { env: Record<string, string | undefined> };
// id: [top Mach @11km (AB), turn deg/s @5km M0.8, wdr/cd0 ratio]
const T: Record<string, [number, number, number]> = {
  f15ex: [2.5, 14.5, 1.1], f22d: [2.32, 18.0, 0.45], fa18i: [1.8, 14.5, 1.4], f16p: [2.0, 17.5, 1.4], f14ex: [2.34, 13.2, 1.1],
  su27s: [2.25, 15.5, 1.3], su30mkk: [2.0, 14.5, 1.6], j11: [2.25, 15.5, 1.3], su35s: [2.25, 17.5, 1.3], mig29s: [2.25, 16.0, 1.2],
  mig31bm: [2.83, 11.9, 1.0], su47: [2.2, 16.5, 1.2], tu22m3: [1.88, 0, 1.5], a50: [0.75, 0, 0], typhoon: [2.05, 16.5, 0.35],
  tornado_f3: [2.2, 12.3, 1.2], tornado_ids: [2.1, 11.5, 1.4], su27_imperial: [2.25, 15.5, 1.3], xf1: [2.05, 16.5, 0.35], mirage_f1: [2.2, 13.0, 1.3], mig21: [2.05, 12.5, 1.3],
};
it('tune aero', () => {
  const rows: any[] = []; const out: Record<string, any> = {};
  for (const [id, [top, turn, r]] of Object.entries(T)) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) continue;
    const def = DB.aircraft[id]; const sw = def.variableSweep;
    const base = computeStats(emptyLoadout(id));
    const mk = (cd0: number, k: number): DerivedStats => ({ ...base, cd0: cd0 + (base.cd0 - def.aero.cd0), waveDragRise: r * cd0, k: k * (base.k / def.aero.k) });
    const opts = { variableSweep: sw, fuelFraction: 0.5 };
    let cd0 = def.aero.cd0, k = def.aero.k;
    for (let it = 0; it < 12; it++) {
      let lo = 0.004, hi = 0.09;
      for (let i = 0; i < 40; i++) { const c = (lo + hi) / 2; const ok = id === 'a50' ? maxLevelMach(mk(c, k), 11000, false, opts) > top : maxLevelMach(mk(c, k), 11000, true, opts) > top; if (ok) lo = c; else hi = c; }
      cd0 = lo;
      if (turn > 0) { let klo = 0.02, khi = 0.6; for (let i = 0; i < 40; i++) { const kk = (klo + khi) / 2; if (sustainedTurn(mk(cd0, kk), 5000, 0.8, opts).rateDeg > turn) klo = kk; else khi = kk; } k = Math.min((klo + khi) / 2, 0.59); }
    }
    const s = mk(cd0, k); const st = sustainedTurn(s, 5000, 0.8, opts);
    out[id] = { cd0: +cd0.toFixed(4), wdr: +(r * cd0).toFixed(4), k: +k.toFixed(3) };
    rows.push({ id, cd0: +cd0.toFixed(4), wdr: +(r * cd0).toFixed(4), k: +k.toFixed(3), M11: +maxLevelMach(s, 11000, true, opts).toFixed(3), SL: +maxLevelMach(s, 0, true, opts).toFixed(3), SC: +maxLevelMach(s, 11000, false, opts).toFixed(3), turn: +st.rateDeg.toFixed(2), n: +st.loadFactor.toFixed(2), lim: st.limitedBy });
  }
  console.table(rows);
  console.log('JSON' + JSON.stringify(out));
}, 600000);
