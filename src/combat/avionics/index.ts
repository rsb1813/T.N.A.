// 센서/항전 모듈 공개 API.
//
//   import { createAvionics } from './combat/avionics';
//   createWeaponService({ createAvionics })        // 무장 모듈이 WeaponService.createAvionics 로 노출
//   const av = createAvionics(aircraft, sim);      // Aircraft 생성자 안에서 (stats 계산 후)
//   av.update(dt, sim);                            // Aircraft.update 에서 매 고정 스텝 (컨트롤러 → 비행모델 다음이면 됨)
//
// 동작 요약
// - 소유 기체의 owner.stats(radar/irst/rwr/maw/ew/datalink/helmet)를 읽는다. 레이더 기본 모드 'tws'.
// - owner.emission 은 이 모듈이 소유한다 (매 센서 주기 갱신, 레이더 off 면 null). 다른 모듈은 쓰지 말 것.
// - 공대지 무장을 선택하면 레이더가 자동으로 'ag', 공대공으로 돌아오면 원래 모드 (masterModeAuto).
//   반능동(SARH) 무장으로 락을 걸면 자동 STT.
// - lockState(weapon) 는 무장 하나의 락 진행을 추적한다 (보통 stores.selectedDef()). 반환 객체는 재사용되므로 보관하지 말 것.
// - isTracked(e): 자기 레이더가 신선하게 추적 중(STT/TWS/RWS), 또는 협동교전 데이터링크 트랙 → 능동 레이더 미사일 중간유도 조건.
//   isIlluminating(e): STT 로 비추는 중 → 반능동 미사일 유도 조건 (AircraftAvionics 추가 메서드).
// - 견인 디코이: ew.towedDecoys > 0 이면 레이더 미사일 경보 시 자동 전개 (TowedDecoy, kind 'decoy', decoyType 'towed').
// - 플레이어(owner.isPlayer)면 조종석 경고음(setTone)과 'targetChanged' 이벤트/'target_switch' 효과음을 낸다.
import type { AircraftLike } from '../../core/contracts';
import type { Sim } from '../../core/sim';
import { AircraftAvionics } from './avionics';

export function createAvionics(owner: AircraftLike, sim: Sim): AircraftAvionics {
  return new AircraftAvionics(owner, sim);
}

export { AircraftAvionics, type RadarAssessment } from './avionics';
export { TowedDecoy } from './towedDecoy';
export * as sensorMath from './sensorMath';
export * as avionicsConstants from './constants';
export {
  isAirToAir,
  isAirToGround,
  lockKindOf,
  preferredFilter,
  weaponMaxRangeM,
  type LockKind,
  type TargetFilter,
} from './weaponClass';
export { shortLabel } from './geometry';
