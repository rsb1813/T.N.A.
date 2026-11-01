// HUD 모듈 공개 API.
//
//   import { Hud } from './ui/hud';
//   const hud = new Hud(document.getElementById('ui')!);  // 컨테이너 안에 전체 화면 캔버스 2장(발광+본체)을 만든다
//   game.addSystem(hud);                                   // 매 렌더 프레임 update(dt, sim)
//   hud.setVisible(false);                                 // 메뉴/일시정지/킬캠 중 숨김 (이벤트 구독·무전 대기열은 계속)
//   hud.dispose();                                         // 구독 해제 + DOM 제거
//
// 읽는 것: sim.world.player (AircraftLike: telemetry, avionics, stores, damageState, controller.aimDirection?),
//   sim.camera(투영), sim.services.mission.state (+ 선택: MissionRunner.markers), sim.services.terrain.mapRadius/heightAt,
//   sim.settings(units, assists.gunLead/threatArrows, controlMode).
// 구독: radio, damaged, destroyed, weaponLaunched, weaponMissed, missionEnded, objectiveChanged.
// 시스템 등록 순서: 카메라 리그(CameraRig) 다음에 등록해야 같은 프레임의 카메라로 투영된다.
export { Hud } from './hud';
export { HUD_COLORS, RADIO_SIDE_COLORS, FONT_MONO, FONT_SANS, hudScale } from './style';
export { Projector, edgeArrow, bearingToCanvasAngle, makeScreenPoint, type ScreenPoint, type EdgeArrow } from './projection';
export { TickBuffer, computeTapeTicks, computeHeadingTicks, headingDiff, cardinalLabel, SPEED_TAPE, ALTITUDE_TAPE, type TapeTick } from './tape';
export { computeDlz, makeDlzGeometry, niceCeil, type DlzGeometry, type DlzState } from './dlz';
export {
  speedIn,
  altitudeIn,
  verticalSpeedIn,
  distanceIn,
  metersPerDistanceUnit,
  formatRange,
  formatThousands,
  formatSigned,
  formatVerticalSpeed,
  formatClock,
  formatHeading,
  formatAspect,
  speedLabel,
  altitudeLabel,
  distanceLabel,
} from './units';
export { computeGunLead, gunStreamPoint, predictBombImpact, ballisticBodyOf, isUnguidedBomb, type BallisticBody } from './gunnery';
export { RadioQueue, radioDuration, type RadioEntry } from './radioQueue';
export { EventFeed, type FeedItem, type KillPopup } from './feed';
export { evaluateWarnings, pullUpRequired, makeWarningFlags, BINGO_FRACTION, type WarningFlags } from './warnings';
export { worldToMap, autoMapRange, MAP_RANGES } from './mapMath';
export { closureRate, aspectInfo, markerShape } from './targeting';
