// 한 프레임 동안 렌더러들이 공유하는 상태. Hud 가 하나를 만들어 매 프레임 필드만 갱신한다 (할당 없음).
import * as THREE from 'three';
import type { AircraftLike, FlightTelemetry, LockState, Track } from '../../core/contracts';
import type { UnitSystem } from '../../core/math';
import type { Sim } from '../../core/sim';
import type { WeaponDef } from '../../data/schema';
import type { Ctx, TextMetricsCache } from './draw/primitives';
import { makeScreenPoint, type Projector, type ScreenPoint } from './projection';
import { makeWarningFlags, type WarningFlags } from './warnings';

export interface OwnMissileInfo {
  /** 지정 표적을 향해 비행 중인 내 미사일 수 */
  count: number;
  /** 가장 빠른 예상 명중 시간 (s), 없으면 -1 */
  timeToGo: number;
}

export interface HudFrame {
  ctx: Ctx;
  /** CSS px */
  W: number;
  H: number;
  /** 1280x720 기준 배율 */
  s: number;
  cx: number;
  cy: number;
  /** HUD 시계 (s) — 깜빡임/수명 */
  time: number;
  sim: Sim;
  units: UnitSystem;
  proj: Projector;
  metrics: TextMetricsCache;

  // ---- 플레이어가 있을 때만 유효
  player: AircraftLike | null;
  tel: FlightTelemetry | null;
  readonly fwd: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly right: THREE.Vector3;
  /** 기수 방향 (무한 원점) 화면 위치 */
  readonly bore: ScreenPoint;
  boreOk: boolean;
  /** 비행경로 표시기 */
  readonly fpm: ScreenPoint;
  fpmOk: boolean;
  selected: WeaponDef | null;
  /** lockState() 결과 복사본 (원본은 avionics 가 재사용) */
  readonly lock: LockState;
  designated: Track | null;
  readonly warnings: WarningFlags;
  missileThreats: number;
  lockThreats: number;
  readonly ownMissiles: OwnMissileInfo;
  /** 이번 프레임 최대 G (홀드) */
  maxG: number;
}

export function createFrame(ctx: Ctx, sim: Sim, proj: Projector, metrics: TextMetricsCache): HudFrame {
  return {
    ctx,
    W: 1,
    H: 1,
    s: 1,
    cx: 0,
    cy: 0,
    time: 0,
    sim,
    units: 'nato',
    proj,
    metrics,
    player: null,
    tel: null,
    fwd: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    bore: makeScreenPoint(),
    boreOk: false,
    fpm: makeScreenPoint(),
    fpmOk: false,
    selected: null,
    lock: { status: 'none', progress: 0, target: null },
    designated: null,
    warnings: makeWarningFlags(),
    missileThreats: 0,
    lockThreats: 0,
    ownMissiles: { count: 0, timeToGo: -1 },
    maxG: 0,
  };
}
