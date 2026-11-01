// campaign 모듈 공개 API.
//
// 통합(src/game) 사용 예:
//   import { CAMPAIGN, getMission, MissionRunner, createChatter, loadSave, saveGame, applyMissionResult } from './campaign';
//   const def = getMission('m01')!;
//   createEnvironment(def.environment, game);                       // world
//   const chatter = createChatter(sim);                              // 전투 무전
//   const runner = new MissionRunner(def, sim, { playerLoadout, rearm: refillAircraft, chatter });
//   game.addSystem(runner); if (def.chatter !== false) game.addSystem(chatter);
//   runner.start();                                                 // 플레이어·윙맨 스폰 + 스크립트 시작
//   sim.events.once('missionEnded', () => { const r = runner.result(); applyMissionResult(save, def, r); saveGame(save); });
//
// 스폰 서비스 계약 보충 (docs/contract-notes.md "## campaign" 참고):
//   spawn.aircraft(req) 의 req 는 실제로 CampaignAircraftSpawn 이다 — role / orders 필드와 태그 'role:<id>', 'holdfire' 를 AI 에 전달할 것.
export * from './missionTypes';
export * from './cast';
export { MissionRunner, radioDuration, expandSkillMix, formationOffset, type MissionRunnerOptions } from './missionRunner';
export { createChatter, brevityFor, DEFAULT_CHATTER_CAST, type ChatterCast, type ChatterSystem, type ChatterVoice, type Brevity } from './chatter';
export { createSkirmish, SKIRMISH_ROSTERS, type SkirmishOptions, type SkirmishFaction } from './skirmish';
export { CAMPAIGN, ALL_MISSIONS, getMission, availableMissions, nextMission, missionAircraftIds, missionModelIds } from './campaign';
export {
  SAVE_KEY,
  SAVE_VERSION,
  STARTING_CREDITS,
  newSave,
  loadSave,
  saveGame,
  deleteSave,
  sanitizeSave,
  isUnlocked,
  canBuy,
  purchase,
  unlockedAircraft,
  applyMissionResult,
  isMissionUnlocked,
  nextMissionId,
  campaignProgress,
  rememberLoadout,
  type SaveData,
  type StorageLike,
  type UnlockKind,
  type PurchaseCheck,
  type MissionRewardSummary,
} from './save';
export * from './scoring';
export { resolvePresetId, emptyLoadout, pickWeapon, PRESET_INTENTS, type PresetIntent } from './presets';
export { samSite, airfield, convoy, fleet, nearestAlive, type SamSystem, type SamSite, type Airfield } from './compose';
