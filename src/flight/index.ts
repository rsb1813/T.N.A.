// 비행 모듈 공개 API.
//
//   const input = new InputManager(); input.attach(canvas);
//   const ac = new Aircraft({ def, loadout, faction: 'NATO', sim, callsign: 'Lancer 1' });
//   ac.placeAt(position, headingDeg, speedMs);
//   ac.isPlayer = true; ac.controller = new PlayerController(input, sim);
//   sim.world.add(ac, sim); sim.world.player = ac;
//   const rig = new CameraRig(game.camera, input); rig.setTarget(ac); game.addSystem(rig);
//
// FlightModel 은 순수 계산 클래스 (AI 의 기동 예측/테스트용으로 단독 사용 가능).
export { FlightModel, flightParamsFromStats, createFlightModel, alphaForCl } from './flightModel';
export type { FlightParams, FlightContext, FlightStoresLoad, FlightDamage, FlightModelInit } from './flightModel';
export { Aircraft, FACTION_PAINT, turnRateDeg } from './aircraft';
export type { AircraftOptions } from './aircraft';
export {
  InputManager,
  DEFAULT_BINDINGS,
  ACTION_IDS,
  LONG_PRESS_TIME,
  keyLabel,
  mouseButtonLabel,
  bindingLabel,
  cloneBindings,
  loadBindings,
  saveBindings,
} from './input';
export type { ActionId, ActionBinding, BindingMap, InputAxes, MouseChannel, InputManagerOptions } from './input';
export { PlayerController, CRUISE_THROTTLE, instructorControls, targetFilter, nextRadarMode } from './playerController';
export { CameraRig } from './cameraRig';
export type { CameraView, CameraState } from './cameraRig';
