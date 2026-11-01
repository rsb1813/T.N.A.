import { it } from 'vitest';
import { LodNodeCache, selectChunks, DEFAULT_LOD } from '../src/world/terrain/lod';
it('lod counts', () => {
  for (const [K, minSize, res] of [[2.4, 512, 32], [1.6, 512, 32], [1.4, 1024, 64], [1.2, 1024, 64], [1.5, 512, 32], [1.3, 1024, 48]] as const) {
    const cache = new LodNodeCache({ ...DEFAULT_LOD, splitFactor: K, minSize }, null);
    const out = [];
    for (const alt of [300, 3000, 10000]) {
      const sel = selectChunks(cache, 100, alt, 300);
      const byLevel: Record<number, number> = {};
      for (const n of sel) byLevel[n.size] = (byLevel[n.size] ?? 0) + 1;
      out.push(`alt ${alt}: ${sel.length} (tris ${(sel.length * res * res * 2 / 1000).toFixed(0)}k) near spacing ${(Math.min(...sel.map(n=>n.size))/res).toFixed(0)}m`);
    }
    console.log(`K=${K} min=${minSize} res=${res} ::`, out.join(' | '));
  }
});
