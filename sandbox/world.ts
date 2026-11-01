// World/FX sandbox.
//   sandbox/world.html?biome=<id>&time=<h>&weather=<w>&alt=<m>[&heading=deg&pitch=deg&x=&z=&seed=&coast=north:20000&fov=60]
//   sandbox/world.html?fx=1   (explosions, missile trails, flares, afterburner on getModel('f15ex'))
import * as THREE from 'three';
import { findNode, findNodes, getModel, preloadModels } from '../src/core/assets';
import type { BiomeId, EnvironmentOptions, Weather } from '../src/core/environment';
import { Entity } from '../src/core/entity';
import { Game } from '../src/core/game';
import { headingToDir, quatFromHeadingPitch } from '../src/core/math';
import { createSim, type Sim } from '../src/core/sim';
import type { EntityKind } from '../src/core/types';
import type { GameDatabase, WeaponDef } from '../src/data/schema';
import { createEnvironment, createFx, type FxSystem, type WorldEnvironment } from '../src/world';

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

// ------------------------------------------------------------------ FX sandbox

/** Scripted mover standing in for aircraft / missiles / decoys */
class Mover extends Entity {
  readonly kind: EntityKind;
  motorBurning = true;
  strength = 1;
  def: WeaponDef | undefined;
  /** angular rate (rad/s) of the velocity vector around world Y, and pitch rate */
  turn = 0;
  climb = 0;
  burnTime = Infinity;
  life = Infinity;
  gravity = 0;
  drag = 0;
  constructor(kind: EntityKind, name: string) {
    super('NATO', name);
    this.kind = kind;
  }
  update(dt: number): void {
    if (this.turn !== 0) this.velocity.applyAxisAngle(_up, this.turn * dt);
    if (this.climb !== 0) {
      const sp = this.velocity.length();
      this.velocity.y += this.climb * dt * sp;
      this.velocity.setLength(sp);
    }
    this.velocity.y -= this.gravity * dt;
    if (this.drag > 0) this.velocity.multiplyScalar(Math.exp(-this.drag * dt));
    this.position.addScaledVector(this.velocity, dt);
    if (this.velocity.lengthSq() > 1) {
      // Matrix4.lookAt puts +Z along (eye - target): target = velocity gives nose (-Z) along velocity
      _m4.lookAt(_zero, _dir.copy(this.velocity), _up);
      this.quaternion.setFromRotationMatrix(_m4);
    }
    this.burnTime -= dt;
    if (this.burnTime <= 0) this.motorBurning = false;
    this.life -= dt;
    if (this.kind === 'decoy') this.strength = Math.max(0, this.strength - dt / 4.5);
    if (this.life <= 0) this.removed = true;
  }
}
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

function hideOptional(root: THREE.Object3D): void {
  for (const n of findNodes(root, 'opt_')) n.visible = false;
}

function nozzlesOf(model: THREE.Object3D): THREE.Vector3[] {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const out: THREE.Vector3[] = [];
  for (const name of ['nozzle_L', 'nozzle_R', 'nozzle']) {
    const n = findNode(model, name);
    if (n) out.push(n.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
  }
  return out.length ? out : [new THREE.Vector3(-0.65, 0, 8.6), new THREE.Vector3(0.65, 0, 8.6)];
}

function wingtipsOf(model: THREE.Object3D): THREE.Vector3[] {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const l = findNode(model, 'wingtip_L');
  const r = findNode(model, 'wingtip_R');
  if (l && r) return [l.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), r.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)];
  return [new THREE.Vector3(-6.5, 0, 2), new THREE.Vector3(6.5, 0, 2)];
}

/** Advance simulation + effects without rendering (software GL is slow), then render once */
function advance(game: Game, sim: Sim, systems: Array<{ update?(dt: number, sim: Sim): void }>, seconds: number, step = 1 / 30): void {
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      sim.time += step / 2;
      sim.world.step(step / 2, sim);
    }
    sim.world.syncObjects();
    for (const s of systems) s.update?.(step, sim);
  }
}

async function runFx(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const flashEl = document.getElementById('flash') as HTMLDivElement;
  const game = new Game(canvas);
  game.renderer.setPixelRatio(1);
  game.resize();
  const sim = createSim({ scene: game.scene, camera: game.camera, db: emptyDb, seed: 3 });
  game.setSim(sim);
  const scene = q.get('scene') ?? 'combat';
  const biome = (q.get('biome') ?? (scene === 'ground' ? 'temperate' : 'temperate')) as BiomeId;
  const env: WorldEnvironment = createEnvironment(
    {
      biome,
      seed: 11,
      timeOfDay: num('time', 16.5),
      weather: (q.get('weather') ?? 'scattered') as Weather,
      coast: { side: 'north', distanceM: 6000 },
    },
    game,
    { gridSize: 768 },
  );
  sim.services.terrain = env;
  const fx: FxSystem = createFx(game.scene, game.camera);
  sim.services.fx = fx;
  game.addSystem(env);
  game.addSystem(fx);
  await preloadModels(['f15ex', 'aim120']);

  const cam = game.camera;
  const report: Record<string, unknown> = { scene };
  const systems = [env, fx];
  const spawn = <T extends Entity>(e: T): T => sim.world.add(e, sim);

  const makeJet = (pos: THREE.Vector3, heading: number, speed: number, level: () => number): Mover => {
    const jet = new Mover('aircraft', 'F-15EX');
    jet.object3d = getModel('f15ex', { kind: 'aircraft', length: 19.4 });
    hideOptional(jet.object3d);
    jet.position.copy(pos);
    headingToDir(heading, jet.velocity).multiplyScalar(speed);
    quatFromHeadingPitch(heading, 0, 0, jet.quaternion);
    spawn(jet);
    jet.syncObject();
    fx.afterburner(jet.object3d, nozzlesOf(jet.object3d), level);
    return jet;
  };
  const makeMissile = (pos: THREE.Vector3, vel: THREE.Vector3, smoke: 'low' | 'medium' | 'high', turn: number, climb: number): Mover => {
    const m = new Mover('missile', 'AIM-120D');
    m.def = { body: { lengthM: 3.65, diameterM: 0.178 } } as unknown as WeaponDef;
    m.object3d = getModel('aim120', { kind: 'missile', length: 3.65 });
    m.position.copy(pos);
    m.velocity.copy(vel);
    m.turn = turn;
    m.climb = climb;
    m.burnTime = 7;
    m.life = 30;
    spawn(m);
    fx.missileTrail(m, smoke);
    return m;
  };
  const dropDecoy = (from: Mover, type: 'flare' | 'chaff', side: number): void => {
    const d = new Mover('decoy', type);
    d.position.copy(from.position);
    d.velocity.copy(from.velocity).multiplyScalar(0.75);
    d.velocity.x += side * 25;
    d.velocity.y -= 12;
    d.gravity = 9.8;
    d.drag = 0.6;
    d.life = 5;
    spawn(d);
    fx.decoy(d, type);
  };

  if (scene === 'combat' || scene === 'ab') {
    const alt = scene === 'ab' ? 1200 : 1600;
    const start = new THREE.Vector3(0, env.heightAt(0, 2000) + alt, 2000);
    const level = scene === 'ab' ? num('level', 2) : 2;
    const jet = makeJet(start, 0, 260, () => level);
    const pull = 0.9;
    fx.vapor(jet, wingtipsOf(jet.object3d), () => pull);
    if (scene === 'combat') {
      // wingman at military power off the right wing
      const wing = makeJet(start.clone().add(new THREE.Vector3(60, -12, 70)), 0, 260, () => 0.9);
      // missiles launched ahead, curving
      advance(game, sim, systems, 0.5);
      makeMissile(jet.position.clone().add(new THREE.Vector3(-3, -2, -12)), headingToDir(352).multiplyScalar(700), 'high', 0.08, 0.03);
      makeMissile(wing.position.clone().add(new THREE.Vector3(3, -2, -12)), headingToDir(8).multiplyScalar(680), 'medium', -0.06, 0.06);
      advance(game, sim, systems, 1.2);
      // enemy-side flares and an air burst ahead
      const bandit = new Mover('aircraft', 'bandit');
      bandit.position.copy(jet.position).add(new THREE.Vector3(500, 120, -2600));
      bandit.velocity.set(-120, 10, 200);
      spawn(bandit);
      for (let i = 0; i < 6; i++) {
        dropDecoy(bandit, i % 3 === 2 ? 'chaff' : 'flare', i % 2 ? 1 : -1);
        advance(game, sim, systems, 0.18);
      }
      fx.explosion(jet.position.clone().add(new THREE.Vector3(-420, 160, -2300)), { size: 1.6, kind: 'air' });
      fx.damageTrail(bandit, 'fire');
      advance(game, sim, systems, 0.9);
      // gun tracers from the wingman
      for (let i = 0; i < 14; i++) {
        const v = headingToDir(1.5).multiplyScalar(1030);
        v.y = 18;
        fx.tracer(wing.position.clone().add(new THREE.Vector3(-1, 0, -8)), v.add(wing.velocity), 2);
        advance(game, sim, systems, 0.05);
      }
      advance(game, sim, systems, 0.25);
    } else {
      advance(game, sim, systems, 0.5);
    }
    // chase camera
    const view = q.get('view') ?? 'chase';
    jet.object3d.updateMatrixWorld();
    if (view === 'side') {
      cam.position.copy(jet.position).add(new THREE.Vector3(26, 3, 9));
      cam.lookAt(jet.position.clone().add(new THREE.Vector3(0, 0, 6)));
    } else if (view === 'rear') {
      cam.position.copy(jet.position).add(new THREE.Vector3(0, 2.2, 34));
      cam.lookAt(jet.position.clone().add(new THREE.Vector3(0, 0.5, 0)));
    } else {
      cam.position.copy(jet.position).add(new THREE.Vector3(0, 7.5, 32));
      cam.lookAt(jet.position.clone().add(new THREE.Vector3(0, 1.5, -40)));
    }
  } else if (scene === 'ground') {
    const center = new THREE.Vector3(0, 0, -1500);
    center.y = env.heightAt(center.x, center.z);
    cam.position.set(900, center.y + 420, 600);
    cam.lookAt(center.x - 200, center.y + 60, center.z);
    const pts = [new THREE.Vector3(-300, 0, -1700), new THREE.Vector3(150, 0, -1400), new THREE.Vector3(-80, 0, -1250)];
    for (const p of pts) p.y = env.heightAt(p.x, p.z);
    fx.explosion(pts[0], { size: 2.5, kind: 'ground' });
    advance(game, sim, systems, 0.6);
    fx.explosion(pts[1], { size: 1.6, kind: 'ground' });
    advance(game, sim, systems, 0.5);
    fx.explosion(pts[2], { size: 1.2 });
    // a burning wreck falling in
    const wreck = new Mover('aircraft', 'wreck');
    wreck.position.set(-600, center.y + 500, -2100);
    wreck.velocity.set(140, -60, 60);
    wreck.gravity = 9.8;
    spawn(wreck);
    fx.damageTrail(wreck, 'fire');
    // water splash on the river/sea if any, plus hits
    for (let i = 0; i < 12; i++) fx.hit(new THREE.Vector3(80 + i * 9, env.heightAt(80 + i * 9, -1500), -1500 + (i % 3) * 6), 'dust');
    fx.explosion(new THREE.Vector3(400, 0, -9000), { size: 2, kind: 'water' });
    advance(game, sim, systems, 0.9);
  } else if (scene === 'nuke' || scene === 'mouk') {
    const t = num('t', scene === 'nuke' ? 9 : 3.2);
    const target = new THREE.Vector3(2000, 0, -26000);
    target.y = env.heightAt(target.x, target.z) + (scene === 'nuke' ? 250 : 1200);
    cam.position.set(0, env.heightAt(0, 0) + 1800, 0);
    cam.lookAt(target.x, target.y + 1600, target.z);
    fx.explosion(target, { kind: scene === 'nuke' ? 'nuclear' : 'mouk', size: 1 });
    advance(game, sim, systems, t, 1 / 20);
    report.flash = fx.flash;
  }

  cam.updateMatrixWorld();
  env.prewarm(cam.position);
  flashEl.style.background = `#${fx.flashColor.getHexString()}`;
  flashEl.style.opacity = String(fx.flash);
  // freeze the simulation for the capture frames (systems still run with dt = 0)
  game.paused = true;
  let now = performance.now();
  const times: number[] = [];
  for (let i = 0; i < 2; i++) {
    now += 16.7;
    const f0 = performance.now();
    game.frame(now);
    times.push(Math.round(performance.now() - f0));
    await waitFrame();
  }
  Object.assign(report, { frameMs: times, fx: fx.stats, drawCalls: game.renderer.info.render.calls, shake: +fx.shakeAmount.toFixed(3) });
  info.textContent = `fx: ${scene}  particles ${fx.stats.particlesAdditive}+${fx.stats.particlesAlpha}  ribbons ${fx.stats.ribbons}`;
  window.__report = report;
  window.__ready = true;
}

if (q.get('fx') === '1') runFx().catch((e) => console.error(e));
else runWorld().catch((e) => console.error(e));
