// createEnvironment: terrain (TerrainService) + LOD terrain mesh + ocean + sky/lighting + clouds + decor.
import * as THREE from 'three';
import type { Environment, EnvironmentOptions } from '../core/environment';
import type { Sim } from '../core/sim';
import { BIOMES } from './biomes';
import { CloudSystem } from './clouds';
import { AIRBASE_FLAT_RADIUS, AirbaseBuilder } from './decor/airbase';
import { buildCities, createBuildingMaterial } from './decor/city';
import { TreeField } from './decor/trees';
import { Ocean, bakeWaterTexture } from './ocean';
import { SkySystem, type SkyState } from './sky';
import { TerrainRenderer, type TerrainRendererOptions } from './terrain/chunks';
import { createTerrainMaterial } from './terrain/material';
import { Terrain, type TerrainBuildOptions } from './terrain/terrain';
import { acquireSharedTextures, releaseSharedTextures } from './textures';

export interface EnvironmentBuildOptions extends TerrainBuildOptions {
  /** Terrain LOD / chunk settings */
  render?: TerrainRendererOptions;
  /** Per-frame CPU budget for terrain chunk builds (ms). Default 2.5 */
  terrainBudgetMs?: number;
  /** Per-frame CPU budget for tree placement (ms). Default 1 */
  treeBudgetMs?: number;
}

export interface EnvironmentStats {
  terrainBuildMs: number;
  chunksBuilt: number;
  chunksVisible: number;
  chunkQueue: number;
  terrainTriangles: number;
  trees: number;
  cloudPuffs: number;
  lastChunkBuildMs: number;
}

/** Environment plus extras for loading screens, debugging and day/night changes */
export interface WorldEnvironment extends Environment {
  readonly terrain: Terrain;
  readonly sky: SkyState;
  readonly stats: EnvironmentStats;
  /** 0..1 lightning flash (storm) — for thunder audio / screen flashes */
  readonly lightning: number;
  /** Synchronously build terrain chunks and trees around a position (default: current camera) */
  prewarm(position?: THREE.Vector3): void;
  setTimeOfDay(hours: number): void;
}

const WAVE_ROUGHNESS = { clear: 1, scattered: 1.15, overcast: 1.35, storm: 2 } as const;

/** Adds flatten zones under airbases and cities so decor always sits on level ground */
function withDecorFlatten(opts: EnvironmentOptions): EnvironmentOptions {
  const flatten = [...(opts.flatten ?? [])];
  for (const b of opts.airbases ?? []) {
    const near = flatten.find((f) => Math.hypot(f.x - b.x, f.z - b.z) < 400);
    if (near && near.radius >= AIRBASE_FLAT_RADIUS) continue;
    flatten.push({ x: b.x, z: b.z, radius: AIRBASE_FLAT_RADIUS, height: near?.height });
  }
  for (const c of opts.cities ?? []) {
    const near = flatten.find((f) => Math.hypot(f.x - c.x, f.z - c.z) < c.radius * 0.5);
    if (near && near.radius >= c.radius) continue;
    flatten.push({ x: c.x, z: c.z, radius: c.radius * 1.02, height: near?.height });
  }
  return { ...opts, mapRadius: opts.mapRadius ?? 100_000, relief: opts.relief ?? 1, flatten };
}

const _cam = new THREE.Vector3();

export function createEnvironment(
  options: EnvironmentOptions,
  game: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera },
  build: EnvironmentBuildOptions = {},
): WorldEnvironment {
  const opts = withDecorFlatten(options);
  const biome = BIOMES[opts.biome] ?? BIOMES.temperate;
  const { renderer, scene, camera } = game;
  acquireSharedTextures();

  const terrain = new Terrain(opts, build);
  const sky = new SkySystem(renderer, scene, opts.timeOfDay, opts.weather, biome);
  const waterTex = bakeWaterTexture(terrain);
  const terrainMat = createTerrainMaterial(biome, waterTex, terrain.extent);
  const chunks = new TerrainRenderer(terrain, terrainMat.material, build.render);
  scene.add(chunks.group);

  const ocean = new Ocean(terrain, biome, WAVE_ROUGHNESS[opts.weather] ?? 1, waterTex);
  scene.add(ocean.mesh);

  const clouds = new CloudSystem(opts.weather, biome, opts.seed, sky.state.lightDir, (a) => sky.triggerFlash(a));
  scene.add(clouds.group);

  const decor = new THREE.Group();
  decor.name = 'tna_decor';
  scene.add(decor);
  const airbases = new AirbaseBuilder(terrain);
  const baseGroups = (opts.airbases ?? []).map((b) => {
    const g = airbases.build(b);
    decor.add(g);
    return g;
  });
  const buildingMat = createBuildingMaterial();
  const cityMesh = buildCities(opts.cities ?? [], terrain, opts.seed, buildingMat.material);
  if (cityMesh) decor.add(cityMesh);
  const trees = biome.trees ? new TreeField(terrain, biome.trees, biome.treeDensity, opts.seed * 31 + 7) : null;
  if (trees) scene.add(trees.group);

  const terrainBudget = build.terrainBudgetMs ?? 2.5;
  const treeBudget = build.treeBudgetMs ?? 1;
  const stats: EnvironmentStats = {
    terrainBuildMs: terrain.buildMs,
    chunksBuilt: 0,
    chunksVisible: 0,
    chunkQueue: 0,
    terrainTriangles: 0,
    trees: 0,
    cloudPuffs: clouds.count,
    lastChunkBuildMs: 0,
  };
  const sunDirection = sky.state.sunDir.clone();

  const applySky = (): void => {
    const s = sky.state;
    sunDirection.copy(s.sunDir);
    ocean.setSky(s);
    clouds.setSky(s);
    const night = THREE.MathUtils.smoothstep(s.night, 0.15, 0.85);
    terrainMat.night.value = night;
    buildingMat.night.value = night;
    for (const g of baseGroups) airbases.setNight(night, g);
  };
  applySky();

  const agl = (p: THREE.Vector3): number => p.y - terrain.heightAt(p.x, p.z);
  const heightAt = (x: number, z: number): number => terrain.heightAt(x, z);

  const updateStats = (): void => {
    const st = chunks.stats;
    stats.chunksBuilt = st.built;
    stats.chunksVisible = st.visible;
    stats.chunkQueue = st.queued;
    stats.terrainTriangles = st.triangles;
    stats.lastChunkBuildMs = st.buildMsThisFrame;
    stats.trees = trees?.instanceCount ?? 0;
  };

  let disposed = false;
  const env: WorldEnvironment = {
    name: 'environment',
    options: opts,
    sunDirection,
    terrain,
    mapRadius: terrain.mapRadius,
    get sky() {
      return sky.state;
    },
    stats,
    get lightning() {
      return clouds.lightning;
    },
    heightAt: (x, z) => terrain.heightAt(x, z),
    isWater: (x, z) => terrain.isWater(x, z),
    normalAt: (x, z, out) => terrain.normalAt(x, z, out),
    lineOfSight: (a, b) => terrain.lineOfSight(a, b),

    update(dt: number, sim: Sim): void {
      if (disposed) return;
      const cam = _cam.copy((sim?.camera ?? camera).position);
      sky.update(dt);
      chunks.update(cam, terrainBudget);
      ocean.update(dt, cam);
      clouds.update(dt, cam, heightAt, biome.cloudBase);
      trees?.update(cam, agl(cam), treeBudget);
      updateStats();
    },

    prewarm(position?: THREE.Vector3): void {
      const p = _cam.copy(position ?? camera.position);
      chunks.prewarm(p);
      trees?.prewarm(p, agl(p));
      ocean.update(0, p);
      clouds.update(0, p, heightAt, biome.cloudBase);
      updateStats();
    },

    setTimeOfDay(hours: number): void {
      sky.setTimeOfDay(hours);
      applySky();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      chunks.dispose();
      terrainMat.material.dispose();
      ocean.dispose();
      waterTex.dispose();
      clouds.dispose();
      sky.dispose();
      airbases.dispose();
      decor.removeFromParent();
      if (cityMesh) {
        cityMesh.geometry.dispose();
        cityMesh.dispose();
      }
      buildingMat.material.dispose();
      trees?.dispose();
      releaseSharedTextures();
    },
  };
  return env;
}
