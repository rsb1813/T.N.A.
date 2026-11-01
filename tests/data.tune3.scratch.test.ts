import { it } from 'vitest';
import { WEAPONS } from '../src/data/weapons';
import { estimateSurfaceToAirRange } from '../src/data/ballistics';
const T: Record<string,[number,number]> = { '48N6E':[150,10000],'5V55R':[75,8000],'9M38M1':[35,6000],'9M330':[12,3000],'V-750':[45,8000],'Rapier Mk2':[8,2000],'Sea Dart':[74,8000],'Sea Wolf':[10,2000],'RIM-7M':[26,4000] };
it('sam', () => {
  const rows: any[] = [];
  for (const [id,[r,alt]] of Object.entries(T)) {
    const base = WEAPONS[id]; const cur = estimateSurfaceToAirRange(base, alt);
    let lo=0.05, hi=4; const d = structuredClone(base);
    for (let i=0;i<20;i++){ const c=(lo+hi)/2; d.body!.cd0=c; if (estimateSurfaceToAirRange(d, alt)>r) lo=c; else hi=c; }
    d.body!.cd0=lo; rows.push({ id, alt, cur: cur.toFixed(1), fitCd0: lo.toFixed(3), r: estimateSurfaceToAirRange(d, alt).toFixed(1), low: estimateSurfaceToAirRange(d, 300).toFixed(1) });
  }
  console.table(rows);
}, 600000);
