// World/FX sandbox.
//   sandbox/world.html?biome=<id>&time=<h>&weather=<w>&alt=<m>[&heading=deg&pitch=deg&x=&z=&seed=&coast=north:20000&fov=60]
//   sandbox/world.html?fx=1   (explosions, missile trails, flares, afterburner on getModel('f15ex'))
import * as THREE from 'three';
import type { BiomeId, EnvironmentOptions, Weather } from '../src/core/environment';
import { Game } from '../src/core/game';
import { quatFromHeadingPitch } from '../src/core/math';
import { createSim } from '../src/core/sim';
import type { GameDatabase } from '../src/data/schema';
import { createEnvironment } from '../src/world';

declare global {
  interface Window {
    __ready?: boolean;
    __report?: unknown;
  }
}

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const emptyDb: GameDatabase = { aircraft: {}, weapons: {}, modules: {}, units: {} };
const info = document.getElementById('info')!;

function waitFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function runWorld(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);
  game.renderer.setPixelRatio(1);
  game.resize();
  game.camera.fov = num('fov', 60);
  game.camera.updateProjectionMatrix();
  const sim = createSim({ scene: game.scene, camera: game.camera, db: emptyDb, seed: 1 });
  game.setSim(sim);

  const biome = (q.get('biome') ?? 'temperate') as BiomeId;
  const coastArg = q.get('coast');
  const opts: EnvironmentOptions = {
    biome,
    seed: num('seed', 7),
    timeOfDay: num('time', 11),
    weather: (q.get('weather') ?? 'clear') as Weather,
    relief: num('relief', 1),
    airbases: [{ x: 1500, z: -9000, heading: 340, faction: 'NATO', name: 'Vanguard' }],
    cities: [{ x: -7000, z: -16000, radius: 2600, density: 1 }],
  };
  if (coastArg) {
    const [side, d] = coastArg.split(':');
    opts.coast = { side: side as 'north', distanceM: Number(d) };
  }
  const t0 = performance.now();
  const env = createEnvironment(opts, game);
  const createMs = performance.now() - t0;
  sim.services.terrain = env;
  game.addSystem(env);

  const x = num('x', 0);
  const z = num('z', 0);
  const alt = num('alt', 3000);
  game.camera.position.set(x, env.heightAt(x, z) + alt, z);
  quatFromHeadingPitch(num('heading', 345), num('pitch', alt < 1000 ? -4 : -11), 0, game.camera.quaternion);
  game.camera.updateMatrixWorld();

  const t1 = performance.now();
  env.prewarm(game.camera.position);
  const prewarmMs = performance.now() - t1;

  // a few frames (real updates, budgeted chunk builds) and timing
  let now = performance.now();
  const frameTimes: number[] = [];
  for (let i = 0; i < 4; i++) {
    now += 16.7;
    const f0 = performance.now();
    game.frame(now);
    game.renderer.getContext().finish();
    frameTimes.push(performance.now() - f0);
    await waitFrame();
  }
  const r = game.renderer.info.render;
  const report = {
    biome,
    weather: opts.weather,
    time: opts.timeOfDay,
    heightfieldMs: Math.round(env.stats.terrainBuildMs),
    createMs: Math.round(createMs),
    prewarmMs: Math.round(prewarmMs),
    frameMs: frameTimes.map((v) => Math.round(v)),
    drawCalls: r.calls,
    triangles: r.triangles,
    chunksVisible: env.stats.chunksVisible,
    chunksBuilt: env.stats.chunksBuilt,
    trees: env.stats.trees,
    clouds: env.stats.cloudPuffs,
    groundUnderCamera: Math.round(env.heightAt(x, z)),
  };
  info.textContent = `${biome} ${opts.weather} ${opts.timeOfDay}h  alt ${alt} m\nframe ${report.frameMs.join('/')} ms  calls ${r.calls}  tris ${r.triangles}`;
  window.__report = report;
  window.__ready = true;
}

runWorld().catch((e) => console.error(e));
