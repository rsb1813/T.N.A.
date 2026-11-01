import { it } from 'vitest';
import { Terrain } from '../src/world/terrain/terrain';
import { BIOME_IDS } from '../src/world/biomes';
import * as THREE from 'three';
it('bench', () => {
  for (const biome of BIOME_IDS) {
    const t = new Terrain({ biome, seed: 7, timeOfDay: 12, weather: 'clear' }, { gridSize: Number(process.env.GS ?? 2048) });
    let s = 0; const t0 = performance.now();
    for (let i = 0; i < 1e6; i++) s += t.heightAt((i * 7919) % 200000 - 100000, (i * 104729) % 200000 - 100000);
    const t1 = performance.now();
    let blocked = 0; const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < 2000; i++) { a.set((i*733)%150000-75000, 300, (i*977)%150000-75000); b.set(a.x+20000, 2000, a.z-15000); a.y += t.heightAt(a.x,a.z); if(!t.lineOfSight(a,b)) blocked++; }
    const t2 = performance.now();
    console.log(biome, 'build', t.buildMs.toFixed(0), 'ms; 1e6 heightAt', (t1-t0).toFixed(0), 'ms; 2000 LOS', (t2-t1).toFixed(0), 'ms blocked', blocked, 'max', t.maxHeight.toFixed(0), 'min', t.minHeight.toFixed(0), 'slope', t.maxSlope.toFixed(2), s > 0);
  }
}, 120000);
