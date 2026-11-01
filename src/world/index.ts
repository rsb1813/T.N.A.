// World & FX module public API.
//
//   const env = createEnvironment(opts, game);      // Environment & TerrainService & System
//   sim.services.terrain = env; game.addSystem(env); env.prewarm(); // prewarm during the loading screen
//   const fx = createFx(game.scene, game.camera);   // FxService & System (+ flash 0..1 for a screen overlay)
//   sim.services.fx = fx; game.addSystem(fx);
export { createEnvironment } from './environment';
export type { WorldEnvironment, EnvironmentBuildOptions, EnvironmentStats } from './environment';
export { BIOMES, BIOME_IDS } from './biomes';
export type { BiomeDef, BiomePalette, TreeStyle } from './biomes';
export { Terrain } from './terrain/terrain';
export type { TerrainBuildOptions, SurfaceSample, FlattenZone } from './terrain/terrain';
export { computeSkyState, sunAngles } from './sky';
export { createFx, FxSystem } from './fx/fx';
export type { FxStats } from './fx/fx';
export type { SkyState } from './sky';
