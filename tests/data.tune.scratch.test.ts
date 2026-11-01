import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { WEAPONS } from '../src/data/weapons';
import { estimateEnvelope } from '../src/data/ballistics';
import type { WeaponDef } from '../src/data/schema';
// S: s→NEZ, cd0→Rmax, life fixed;  C: s→NEZ, life→Rmax, cd0 fixed
type Mode = ['S', number] | ['C', number];
const T: Record<string,[number,number,Mode]> = {
 'AIM-120D':[80,25,['S',115]],'AIM-120C-7':[70,20,['S',100]],'AIM-7M':[45,12,['S',75]],'AIM-54C':[150,40,['C',0.22]],'R-77':[65,18,['S',95]],'R-77-1':[75,22,['S',105]],
 'R-27ER':[70,20,['S',100]],'R-27ET':[60,15,['S',90]],'R-33S':[140,35,['C',0.22]],'R-37':[180,45,['C',0.3]],'Skyflash':[40,10,['S',70]],'R530':[25,7,['S',50]],
 'AIM-9X':[20,8,['C',0.9]],'AIM-9M':[14,5,['C',1.0]],'R-73M':[25,9,['C',0.95]],'ASRAAM':[25,10,['C',0.85]],'IRIS-T':[25,10,['C',0.9]],'R-60M':[8,3,['C',1.0]],'R-13M':[10,3,['C',1.1]],'Magic 2':[15,5,['C',1.0]],'Meteor':[110,55,['C',0.6]] };
const only = process.env.ONLY?.split(',');
const ISP: Record<string, number> = { low: 235, medium: 245, high: 255 };
function mk(base: WeaponDef, s: number, cd0: number, life: number): WeaponDef {
  const d = structuredClone(base); const m = d.motor!;
  if (m.ramjet) m.sustainThrustN *= s; else { m.boostThrustN *= s; m.sustainThrustN *= s;
    m.propellantKg = Math.round((m.boostSec*m.boostThrustN + m.sustainSec*m.sustainThrustN)/(ISP[m.smoke]*9.80665)*10)/10; }
  d.body!.cd0 = cd0; d.guidance!.maxTimeSec = life; return d;
}
it('tune', () => {
  const rows: Record<string, unknown>[] = []; const out: Record<string, unknown> = {};
  for (const [id,[rmax,nez,[mode,p]]] of Object.entries(T)) {
    if (only && !only.includes(id)) continue;
    const base = WEAPONS[id]; let best: any = null;
    let slo = Number(process.env.SLO ?? 0.15), shi = Number(process.env.SHI ?? 3.5);
    for (let i=0;i<13;i++){ const s=(slo+shi)/2;
      if (mode==='S') { let clo=0.05, chi=4; for (let j=0;j<16;j++){ const c=(clo+chi)/2; if (estimateEnvelope(mk(base,s,c,p)).rMaxKm>rmax) clo=c; else chi=c; } const d=mk(base,s,clo,p); best={s,c:clo,t:p,d,e:estimateEnvelope(d)}; }
      else { let tlo=3, thi=Number(process.env.TMAX ?? 240); for (let j=0;j<14;j++){ const t=(tlo+thi)/2; if (estimateEnvelope(mk(base,s,p,t)).rMaxKm>rmax) thi=t; else tlo=t; } const d=mk(base,s,p,thi); best={s,c:p,t:thi,d,e:estimateEnvelope(d)}; }
      if (best.e.rNezKm < nez) slo=s; else shi=s; }
    const m = best.d.motor!; const sl = estimateEnvelope(best.d, { altitudeM: 0 }); const lf = estimateEnvelope(best.d, { loft: true });
    out[id] = { boostSec: m.boostSec, boostKN: +(m.boostThrustN/1000).toFixed(2), sustainSec: m.sustainSec, sustainKN: +(m.sustainThrustN/1000).toFixed(2), prop: m.propellantKg, cd0: +best.c.toFixed(3), life: Math.ceil(best.t) };
    rows.push({ id, mode, s:+best.s.toFixed(2), cd0:+best.c.toFixed(3), life:+best.t.toFixed(1), boost:`${m.boostSec}s ${(m.boostThrustN/1000).toFixed(1)}kN`, sust:`${m.sustainSec}s ${(m.sustainThrustN/1000).toFixed(2)}kN`, prop:m.propellantKg, frac:+((m.propellantKg??0)/base.massKg).toFixed(2), max:+best.e.rMaxKm.toFixed(1), nez:+best.e.rNezKm.toFixed(1), T:`${rmax}/${nez}`, sl:`${sl.rMaxKm.toFixed(1)}/${sl.rNezKm.toFixed(1)}`, loft: lf.rMaxKm.toFixed(0) });
  }
  console.table(rows);
  writeFileSync('/tmp/claude-0/-home-user-T-N-A-/95815414-c6e1-5123-81b8-ae301b32555e/scratchpad/fit.json', JSON.stringify(out, null, 1));
}, 3600000);
