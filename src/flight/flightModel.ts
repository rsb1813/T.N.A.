// 하이브리드 비행모델: 점질량 병진 운동 + FBW 각속도 명령 자세 모델.
//
// 순수 계산 클래스 (three.js 의 Vector3/Quaternion 만 사용). 렌더링/서비스 의존 없음 → 단위 테스트 가능.
// 공력/추진 공식은 반드시 core/aero.ts 를 쓴다 (data 보정과 같은 식).
//
// 모델 요약
//   - 힘: 추력(기수 방향), 양력(속도에 수직, 대칭면 내), 항력(속도 반대), 측력(옆미끄럼), 중력.
//   - 자세: 기수는 속도벡터의 회전(비행경로 각속도)을 따라가고, 그 위에 FBW 보정 각속도가 더해진다.
//       피치: 조종간 → 요구 피치 각속도 → 필요한 양력 → 명령 받음각(α_cmd). 기체는 α 를 α_cmd 로 수렴시킨다.
//             조종간 중립 = 비행경로 유지(중력 보상) → 수평비행 트림 가능.
//             속도가 모자라 CLmax 로도 1G 를 못 만들면 경로가 처지고 기수가 경로를 따라 떨어진다(실속).
//       요: 러더 → 명령 옆미끄럼각(β_cmd). 측력이 경로를 천천히 돌린다.
//       롤: 안정축(속도벡터) 기준 롤 각속도 명령 + 1차 지연.
//   - FBW 리미터: α ≤ min(aoaMax, 실속각), 하중배수 gMin..gMax. 끄면 과G/실속(날개 흔들림) 가능.
//
// 부호 규칙 (tests/flight.model.test.ts 로 검증)
//   +pitch = 기수 올림 = 로컬 +X 축 양의 회전
//   +roll  = 오른쪽 날개 내려감 = 기수 축(-Z) 양의 회전
//   +yaw   = 기수 오른쪽 = 로컬 +Y 축 음의 회전
import * as THREE from 'three';
import { dragCoefficient, dragForce, engineThrust, fuelFlow, liftCoefficient } from '../core/aero';
import type { AircraftDamageState, ControlInput, FlightTelemetry } from '../core/contracts';
import { atmosphere, clamp, DEG, G0, headingToDir, moveTowards, quatFromHeadingPitch, RAD, RHO0, smoothstep, tasToIas, wrap360, type Atmosphere } from '../core/math';
import type { DerivedStats } from '../data/schema';

// ---------------------------------------------------------------- 매개변수

export interface FlightParams {
  /** 기체 + 모듈 (연료/무장 제외) kg */
  massEmptyKg: number;
  /** 내부 연료(+CFT) 용량 kg */
  internalFuelCapacityKg: number;
  /** 전체 연료 용량 (내부 + 외부탱크) kg — 연료 비율 표시용 */
  fuelCapacityKg: number;
  wingArea: number;
  cd0: number;
  k: number;
  clAlpha: number;
  clMax: number;
  aoaMaxDeg: number;
  waveDragRise: number;
  thrustDryN: number;
  thrustAbN: number;
  tsfcDry: number;
  tsfcAB: number;
  spoolTime: number;
  gMax: number;
  gMin: number;
  maxMach: number;
  /** 구조 한계 지시대기속도 (m/s). 0 = 제한 없음. 넘으면 과속 항력 */
  maxIas: number;
  /** rad/s */
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  /** 코너 속도 (m/s, 지시속도 기준). 0 이면 gMax·CLmax 로 계산 */
  cornerSpeed: number;
  /** 가변익 (없으면 null) */
  variableSweep: { minDeg: number; maxDeg: number } | null;
}

/** 비행모델이 매 스텝 읽는 외부 무장 상태. combat 의 Stores 가 그대로 맞는다 */
export interface FlightStoresLoad {
  readonly massKg: number;
  readonly dragArea: number;
  externalFuelKg: number;
}

export type FlightDamage = Pick<AircraftDamageState, 'engine' | 'wings' | 'control' | 'fuelLeak'>;

export interface FlightContext {
  /** FBW 리미터 (AoA/G 제한). AI 는 항상 true, 플레이어는 settings.assists.flightLimiter */
  limiter: boolean;
  /** 중력가속도 (기본 G0) */
  gravity?: number;
  /** 바로 아래 지면 높이 (AGL 계산용, 기본 0) */
  groundHeight?: number;
  /** 조종 불능 (격추된 잔해): 중력 보상/리미터 없이 조종면 입력만 반영 */
  uncontrolled?: boolean;
}

/** DerivedStats → FlightParams. externalFuelKg = 장착된 외부탱크 연료 (내부 용량 계산용) */
export function flightParamsFromStats(
  stats: DerivedStats,
  variableSweep: { minDeg: number; maxDeg: number } | null | undefined,
  externalFuelKg = 0,
): FlightParams {
  return {
    massEmptyKg: stats.massEmptyKg,
    internalFuelCapacityKg: Math.max(0, stats.fuelCapacityKg - externalFuelKg),
    fuelCapacityKg: Math.max(1, stats.fuelCapacityKg),
    wingArea: stats.wingArea,
    cd0: stats.cd0,
    k: stats.k,
    clAlpha: stats.clAlpha,
    clMax: stats.clMax,
    aoaMaxDeg: stats.aoaMaxDeg,
    waveDragRise: stats.waveDragRise,
    thrustDryN: stats.thrustDryN,
    thrustAbN: stats.thrustAbN,
    tsfcDry: stats.tsfcDry,
    tsfcAB: stats.tsfcAB,
    spoolTime: stats.spoolTime,
    gMax: stats.gMax,
    gMin: stats.gMin,
    maxMach: stats.maxMach,
    maxIas: stats.maxIas ?? 0,
    rollRate: stats.rollRate,
    pitchRate: stats.pitchRate,
    yawRate: stats.yawRate,
    cornerSpeed: stats.cornerSpeed,
    variableSweep: variableSweep ?? null,
  };
}

/**
 * DerivedStats 로 독립 비행모델 생성 (data 보정 테스트, AI 기동 예측용).
 * 무장 질량/항력은 stats 값으로 고정, 내부 연료 = stats.fuelKg (내부 용량 이내).
 */
export function createFlightModel(
  stats: DerivedStats,
  variableSweep?: { minDeg: number; maxDeg: number } | null,
  init: FlightModelInit = {},
): FlightModel {
  const fm = new FlightModel(flightParamsFromStats(stats, variableSweep), {
    internalFuelKg: Math.min(stats.fuelKg, stats.fuelCapacityKg),
    ...init,
  });
  fm.stores = { massKg: stats.storesMassKg, dragArea: stats.storesDragArea, externalFuelKg: 0 };
  fm.massKg = fm.currentMass();
  return fm;
}

// ---------------------------------------------------------------- 튜닝 상수

/** 아이들 추력 (군용추력 대비) */
const IDLE_THRUST = 0.05;
/** 에어브레이크 ΔCD */
const AIRBRAKE_DCD = 0.05;
/** 측력 기울기 CYβ (1/rad, 날개면적 기준) */
const CY_BETA = 0.9;
/** 옆미끄럼 항력 계수 (ΔCD = k·β²) */
const SIDESLIP_DRAG = 0.6;
/** 실속 이후 박리 항력 (ΔCD = k·(sin²α - sin²α_stall)) */
const SEPARATION_DRAG = 1.4;
/** 최대 마하 초과 ΔCD = a·ΔM + b·ΔM² */
const OVERSPEED_DRAG_LIN = 0.6;
const OVERSPEED_DRAG_QUAD = 4;
/** 구조 한계 IAS 초과 ΔCD = a·x + b·x² (x = 초과 비율) */
const OVER_IAS_DRAG_LIN = 0.3;
const OVER_IAS_DRAG_QUAD = 6;
/** 러더 최대 옆미끄럼 (rad) */
const BETA_MAX = 8 * DEG;
/** α 수렴 이득 (1/s, 권한 1 기준) — FBW + 공력 풍향안정 */
const PITCH_GAIN = 5.5;
const YAW_GAIN = 3.5;
/** 보정 각속도의 1차 지연 시정수 (s) */
const PITCH_TAU = 0.07;
const YAW_TAU = 0.12;
const ROLL_TAU = 0.08;
/** 최저 조종 권한 (동압 0 근처) */
const AUTH_MIN = 0.06;
/** 리미터 해제 시 승강타 권한 한계 (gMax 배수) */
const UNLIMITED_G_FACTOR = 1.6;
/** 리미터 해제 시 실속각 너머 추가 가능 받음각 */
const UNLIMITED_EXTRA_ALPHA = 12 * DEG;
/** 과G 판정 여유 (G) */
const OVERG_MARGIN = 0.3;
/** 가변익 후퇴 속도 (deg/s) */
const SWEEP_RATE = 7.5;
/** 가변익: 최대 후퇴 시 CLmax 감소율, k 증가율, (최소 후퇴 시) 조파항력 증가율 */
const SWEEP_CLMAX_LOSS = 0.25;
const SWEEP_K_GAIN = 0.3;
const SWEEP_WAVE_PENALTY = 0.6;
/** 연료 누출 (kg/s) */
const FUEL_LEAK_RATE = 1.5;
/** 날개 손상 1 일 때 롤 쏠림 (최대 롤레이트 배수) */
const WING_ROLL_BIAS = 0.35;
/** 이 속도 미만은 공력 무시 (탄도 낙하) */
const MIN_AERO_SPEED = 0.5;

// ---------------------------------------------------------------- 임시 객체 (핫패스 재사용)

const _atm: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 };
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vhat = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _liftDir = new THREE.Vector3();
const _sideDir = new THREE.Vector3();
const _force = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _omegaPath = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _rollAxis = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _euler = new THREE.Euler();

const NO_DAMAGE: FlightDamage = { engine: 0, wings: 0, control: 0, fuelLeak: false };

/** CL → α (선형 역함수; CLmax 를 넘는 요구는 실속각 너머로 연장) */
export function alphaForCl(cl: number, clAlpha: number, clMax: number): number {
  const a = Math.abs(cl);
  const stall = clMax / clAlpha;
  const alpha = a <= clMax ? a / clAlpha : stall + (a - clMax) / clAlpha;
  return Math.sign(cl) * alpha;
}

function createTelemetry(): FlightTelemetry {
  return {
    speed: 0,
    ias: 0,
    mach: 0,
    altitude: 0,
    agl: 0,
    verticalSpeed: 0,
    aoaDeg: 0,
    sideslipDeg: 0,
    gLoad: 1,
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    throttle: 0,
    afterburner: false,
    fuelKg: 0,
    fuelFraction: 0,
    thrustN: 0,
    dragN: 0,
    specificExcessPower: 0,
    stalled: false,
    overG: false,
    sweepDeg: null,
  };
}

export interface FlightModelInit {
  /** 엔티티와 벡터를 공유하려면 넘긴다 (비행모델이 직접 갱신) */
  position?: THREE.Vector3;
  velocity?: THREE.Vector3;
  quaternion?: THREE.Quaternion;
  /** 내부 연료 kg (기본: 내부 용량 전부) */
  internalFuelKg?: number;
  /** 엔진 초기 출력 0..1 (기본 0.75) */
  throttle?: number;
}

export class FlightModel {
  params: FlightParams;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** 외부 무장 상태 (Aircraft 가 combat Stores 를 연결). 기본 = 빈 상태 */
  stores: FlightStoresLoad = { massKg: 0, dragArea: 0, externalFuelKg: 0 };
  /** 부위 피해 (Aircraft 의 damageState 를 연결) */
  damage: FlightDamage = NO_DAMAGE;
  /** 날개 손상 롤 쏠림 방향 (+1 = 오른쪽으로 말림) */
  rollBiasSign: 1 | -1 = 1;

  /** 실제 동체 각속도 rad/s: x = 피치(+기수 올림), y = 요(+기수 오른쪽), z = 롤(+오른쪽) */
  readonly bodyRates = new THREE.Vector3();
  readonly telemetry: FlightTelemetry = createTelemetry();
  /** 마지막 스텝의 힘 (월드, N) — 디버그/테스트용 */
  readonly forces = {
    lift: new THREE.Vector3(),
    drag: new THREE.Vector3(),
    thrust: new THREE.Vector3(),
    side: new THREE.Vector3(),
    gravity: new THREE.Vector3(),
  };

  internalFuelKg: number;
  /** 엔진 회전 (스풀) 0..1 */
  spool: number;
  /** 애프터버너 점화 정도 0..1 */
  abLevel = 0;
  airbrakeLevel = 0;
  engineRunning = true;
  /** 가변익 후퇴각 (deg) — 가변익이 아니면 null */
  sweepDeg: number | null = null;
  /** 누적 기체 응력 (과G 적분). Aircraft 가 증가분을 날개 피해로 바꾼다 */
  airframeStress = 0;
  /** 마지막 스텝의 명령 받음각 (deg) — 디버그 */
  alphaCmdDeg = 0;
  /** 마지막 스텝 질량 kg */
  massKg = 0;
  /** 비행 경과 시간 (날개 흔들림 위상) */
  private time = 0;
  /** FBW 보정 각속도 상태 (rad/s): 피치(+X), 요(+Y 회전), 롤(기수축) */
  private qRel = 0;
  private rRel = 0;
  private pRate = 0;

  constructor(params: FlightParams, init: FlightModelInit = {}) {
    this.params = params;
    this.position = init.position ?? new THREE.Vector3();
    this.velocity = init.velocity ?? new THREE.Vector3();
    this.quaternion = init.quaternion ?? new THREE.Quaternion();
    this.internalFuelKg = Math.max(0, init.internalFuelKg ?? params.internalFuelCapacityKg);
    this.spool = clamp(init.throttle ?? 0.75, 0, 1);
    if (params.variableSweep) this.sweepDeg = params.variableSweep.minDeg;
    this.massKg = this.currentMass();
    this.refreshTelemetry(0, 0, 0, 1, 0, 0, 0, false, false);
  }

  get fuelKg(): number {
    return this.internalFuelKg + this.stores.externalFuelKg;
  }

  currentMass(): number {
    const s = this.stores;
    return this.params.massEmptyKg + this.internalFuelKg + s.externalFuelKg + s.massKg;
  }

  /** 내부 연료 보충 (보급) */
  refuel(kg = Infinity): void {
    this.internalFuelKg = Math.min(this.params.internalFuelCapacityKg, this.internalFuelKg + kg);
  }

  /** 가변익 자동 스케줄 목표 후퇴각: M0.4 이하 최소 → M1.2 이상 최대 */
  sweepTarget(mach: number): number | null {
    const vs = this.params.variableSweep;
    if (!vs) return null;
    return vs.minDeg + (vs.maxDeg - vs.minDeg) * clamp((mach - 0.4) / 0.8, 0, 1);
  }

  /** 0 = 최소 후퇴, 1 = 최대 후퇴 */
  private sweepFraction(): number {
    const vs = this.params.variableSweep;
    if (!vs || this.sweepDeg === null || vs.maxDeg <= vs.minDeg) return 0;
    return clamp((this.sweepDeg - vs.minDeg) / (vs.maxDeg - vs.minDeg), 0, 1);
  }

  /** 현재 형상(손상/가변익 반영) CLmax */
  effectiveClMax(): number {
    return this.params.clMax * (1 - 0.5 * clamp(this.damage.wings, 0, 1)) * (1 - SWEEP_CLMAX_LOSS * this.sweepFraction());
  }

  /** 동압 기반 조종 권한 0..1 (저속 둔함 → 코너 속도 부근 최대) */
  authority(qbar: number): number {
    const qc = this.cornerDynamicPressure();
    const x = qbar / qc;
    if (x >= 1) return 1;
    const t = 1 - x;
    return AUTH_MIN + (1 - AUTH_MIN) * (1 - t * t);
  }

  /** 코너 속도의 동압 (해면 밀도 기준 = 지시속도) */
  cornerDynamicPressure(): number {
    const p = this.params;
    let vc = p.cornerSpeed;
    if (!(vc > 0)) {
      const w = (p.massEmptyKg + p.internalFuelCapacityKg * 0.5) * G0;
      vc = Math.sqrt((2 * p.gMax * w) / (RHO0 * p.wingArea * p.clMax));
    }
    return Math.max(500, 0.5 * RHO0 * vc * vc);
  }

  /** 현재 질량/고도에서 1G 실속 속도 (TAS, m/s) */
  stallSpeed(altitude = this.position.y, gravity = G0): number {
    atmosphere(altitude, _atm);
    return Math.sqrt((2 * this.currentMass() * gravity) / (_atm.rho * this.params.wingArea * this.effectiveClMax()));
  }

  /** 수평 1G 에 필요한 받음각 (rad) */
  trimAlpha(speed: number, altitude = this.position.y, gravity = G0): number {
    atmosphere(altitude, _atm);
    const qbar = 0.5 * _atm.rho * speed * speed;
    if (qbar < 1) return clamp(this.params.aoaMaxDeg * DEG, 0, this.effectiveClMax() / this.params.clAlpha);
    const cl = Math.min((this.currentMass() * gravity) / (qbar * this.params.wingArea), this.effectiveClMax());
    return alphaForCl(cl, this.params.clAlpha, this.effectiveClMax());
  }

  /**
   * 트림된 상태로 배치: 방위/속도/비행경로각, 기수는 1G 받음각만큼 들림. 엔진 스풀 = throttle.
   * position.y (고도)는 미리 설정해 둘 것.
   */
  placeTrimmed(headingDeg: number, speed: number, opts: { pathDeg?: number; rollDeg?: number; throttle?: number; afterburner?: boolean } = {}): void {
    const path = (opts.pathDeg ?? 0) * DEG;
    headingToDir(headingDeg, this.velocity).multiplyScalar(Math.cos(path) * speed);
    this.velocity.y = Math.sin(path) * speed;
    if (this.params.variableSweep) {
      atmosphere(this.position.y, _atm);
      this.sweepDeg = this.sweepTarget(speed / _atm.speedOfSound);
    }
    const alpha = speed > MIN_AERO_SPEED ? this.trimAlpha(speed) * Math.cos((opts.rollDeg ?? 0) * DEG) : 0;
    quatFromHeadingPitch(headingDeg, (path + alpha) * RAD, opts.rollDeg ?? 0, this.quaternion);
    this.qRel = this.rRel = this.pRate = 0;
    this.bodyRates.set(0, 0, 0);
    this.spool = clamp(opts.throttle ?? this.spool, 0, 1);
    this.abLevel = opts.afterburner && this.spool >= 1 ? 1 : 0;
    this.massKg = this.currentMass();
    this.alphaCmdDeg = alpha * RAD;
    this.refreshTelemetry(0, 0, 0, Math.cos((opts.rollDeg ?? 0) * DEG), alpha, 0, this.position.y, false, false);
  }

  /** 고정 스텝 1회 적분 */
  step(dt: number, input: ControlInput, ctx: FlightContext): void {
    if (!(dt > 0)) return;
    const p = this.params;
    const g = ctx.gravity ?? G0;
    const dmg = this.damage;
    const pos = this.position;
    const vel = this.velocity;
    const quat = this.quaternion;
    const uncontrolled = ctx.uncontrolled === true;
    this.time += dt;

    // ---- 대기, 속도, 받음각/옆미끄럼각
    atmosphere(pos.y, _atm);
    const rho = _atm.rho;
    const V = vel.length();
    const mach = V / _atm.speedOfSound;
    const qbar = 0.5 * rho * V * V;
    const aero = V > MIN_AERO_SPEED;

    _fwd.set(0, 0, -1).applyQuaternion(quat);
    _up.set(0, 1, 0).applyQuaternion(quat);
    _right.set(1, 0, 0).applyQuaternion(quat);

    let alpha = 0;
    let beta = 0;
    if (aero) {
      _vhat.copy(vel).divideScalar(V);
      _qInv.copy(quat).invert();
      _vb.copy(vel).applyQuaternion(_qInv);
      // 정확히 0 인 경우 ±π 모호성 방지
      const vy = _vb.y === 0 ? -1e-9 : _vb.y;
      alpha = Math.atan2(-vy, -_vb.z);
      beta = Math.asin(clamp(_vb.x / V, -1, 1));
      // 양력 방향: 대칭면 안에서 속도에 수직 (right × v̂)
      _liftDir.crossVectors(_right, _vhat);
      if (_liftDir.lengthSq() < 1e-8) _liftDir.copy(_up);
      else _liftDir.normalize();
      _sideDir.crossVectors(_vhat, _liftDir);
    } else {
      _vhat.copy(_fwd);
      _liftDir.copy(_up);
      _sideDir.copy(_right);
    }

    // ---- 가변익
    if (p.variableSweep) {
      const target = this.sweepTarget(mach)!;
      this.sweepDeg = moveTowards(this.sweepDeg ?? target, target, SWEEP_RATE * dt);
    } else {
      this.sweepDeg = null;
    }
    const sweep = this.sweepFraction();

    // ---- 유효 공력 계수 (손상/가변익)
    const clMax = this.effectiveClMax();
    const k = p.k * (1 + SWEEP_K_GAIN * sweep);
    const waveRise = p.variableSweep ? p.waveDragRise * (1 + SWEEP_WAVE_PENALTY * (1 - sweep)) : p.waveDragRise;
    const alphaStall = clMax / p.clAlpha;
    const absAlpha = Math.abs(alpha);

    // ---- 질량
    const stores = this.stores;
    const mass = p.massEmptyKg + this.internalFuelKg + stores.externalFuelKg + stores.massKg;
    this.massKg = mass;
    const weight = mass * g;

    // ---- 엔진 (스풀 지연, 애프터버너, 연료)
    const fuelAvailable = this.internalFuelKg + stores.externalFuelKg > 0;
    this.engineRunning = fuelAvailable;
    const throttleCmd = this.engineRunning ? clamp(input.throttle, 0, 1) : 0;
    const spoolRate = 1 / Math.max(0.2, p.spoolTime);
    this.spool = moveTowards(this.spool, throttleCmd, (throttleCmd > this.spool ? 1 : 1.6) * spoolRate * dt);
    const abWanted = this.engineRunning && input.afterburner && input.throttle >= 0.999 && this.spool >= 0.92;
    this.abLevel = moveTowards(this.abLevel, abWanted ? 1 : 0, (abWanted ? 2.5 : 4) * dt);
    let dryT = 0;
    let abT = 0;
    if (this.engineRunning) {
      dryT = engineThrust(p.thrustDryN, p.thrustAbN, rho, mach, IDLE_THRUST + (1 - IDLE_THRUST) * this.spool, false);
      if (this.abLevel > 0) abT = engineThrust(p.thrustDryN, p.thrustAbN, rho, mach, 1, true);
    }
    const grossThrust = dryT * (1 - this.abLevel) + abT * this.abLevel;
    const thrust = grossThrust * (1 - 0.7 * clamp(dmg.engine, 0, 1));
    if (this.engineRunning) {
      const flow = (1 - this.abLevel) * fuelFlow(dryT, p.tsfcDry) + this.abLevel * fuelFlow(abT, p.tsfcAB);
      this.burnFuel(flow * dt);
    }
    if (dmg.fuelLeak) this.leakFuel(FUEL_LEAK_RATE * dt);
    this.airbrakeLevel = moveTowards(this.airbrakeLevel, input.airbrake ? 1 : 0, 1.6 * dt);

    // ---- 공력
    let cl = aero ? liftCoefficient(alpha, p.clAlpha, clMax) : 0;
    if (absAlpha > alphaStall) cl *= 1 - smoothstep(50 * DEG, 90 * DEG, absAlpha);
    let cd = dragCoefficient(cl, mach, p.cd0, k, waveRise);
    cd += AIRBRAKE_DCD * this.airbrakeLevel + SIDESLIP_DRAG * beta * beta;
    if (absAlpha > alphaStall) {
      const s0 = Math.sin(alphaStall);
      const s1 = Math.sin(absAlpha);
      cd += SEPARATION_DRAG * Math.max(0, s1 * s1 - s0 * s0);
    }
    const over = mach - p.maxMach;
    if (over > 0) cd += OVERSPEED_DRAG_LIN * over + OVERSPEED_DRAG_QUAD * over * over;
    if (p.maxIas > 0) {
      const overIas = tasToIas(V, rho) / p.maxIas - 1;
      if (overIas > 0) cd += OVER_IAS_DRAG_LIN * overIas + OVER_IAS_DRAG_QUAD * overIas * overIas;
    }
    const drag = aero ? dragForce(qbar, p.wingArea, cd, stores.dragArea) : 0;
    const lift = qbar * p.wingArea * cl;
    const side = -qbar * p.wingArea * CY_BETA * beta;

    const F = this.forces;
    F.thrust.copy(_fwd).multiplyScalar(thrust);
    F.lift.copy(_liftDir).multiplyScalar(lift);
    F.drag.copy(_vhat).multiplyScalar(-drag);
    F.side.copy(_sideDir).multiplyScalar(side);
    F.gravity.set(0, -weight, 0);
    _force.copy(F.thrust).add(F.lift).add(F.drag).add(F.side);
    // 비중력 비력 (가속도계) → 하중배수
    const gLoad = _force.dot(_up) / weight;
    const thrustAlongV = thrust * _fwd.dot(_vhat);
    _force.add(F.gravity);
    _acc.copy(_force).divideScalar(mass);

    // ---- 비행경로 각속도 (속도벡터 회전): 기수가 이를 따라간다
    _omegaPath.set(0, 0, 0);
    if (V > 1) _omegaPath.crossVectors(vel, _acc).divideScalar(V * V);

    // ---- FBW 피치: 조종간 → 요구 각속도 → 필요 양력 → α_cmd
    const auth = this.authority(qbar);
    const ctrlEff = 1 - 0.6 * clamp(dmg.control, 0, 1);
    const limiter = ctx.limiter && !uncontrolled;
    const qDes = clamp(input.pitch, -1, 1) * p.pitchRate * auth * ctrlEff;
    const thrustNormal = thrust * _fwd.dot(_liftDir);
    let aReq = V * qDes;
    if (!uncontrolled) aReq += g * _liftDir.y; // 중력 보상: 중립 = 경로 유지
    let alphaCmd = 0;
    if (aero && qbar > 1) {
      const qs = qbar * p.wingArea;
      const gHi = limiter ? p.gMax : p.gMax * UNLIMITED_G_FACTOR;
      const gLo = limiter ? p.gMin : p.gMin * UNLIMITED_G_FACTOR;
      const clReq = clamp((mass * aReq - thrustNormal) / qs, (gLo * weight - thrustNormal) / qs, (gHi * weight - thrustNormal) / qs);
      alphaCmd = alphaForCl(clReq, p.clAlpha, clMax);
      const aoaMax = p.aoaMaxDeg * DEG;
      const hi = limiter ? Math.min(aoaMax, alphaStall) : Math.max(aoaMax, alphaStall) + UNLIMITED_EXTRA_ALPHA;
      const lo = limiter ? -0.5 * Math.min(aoaMax, alphaStall) : -(alphaStall + 0.4 * UNLIMITED_EXTRA_ALPHA);
      alphaCmd = clamp(alphaCmd, lo, hi);
      // 동압이 거의 없으면 조종면이 듣지 않는다 → 풍향안정만 (α→0)
      alphaCmd *= smoothstep(20, 200, qbar);
    }
    this.alphaCmdDeg = alphaCmd * RAD;

    const rateFloor = Math.max(auth, 0.15) * ctrlEff;
    const maxQ = p.pitchRate * rateFloor * 1.2;
    const qTarget = clamp(PITCH_GAIN * auth * (alphaCmd - alpha), -maxQ, maxQ);
    this.qRel += (qTarget - this.qRel) * (1 - Math.exp(-dt / PITCH_TAU));

    // ---- 요: 러더 → β_cmd
    const betaCmd = -clamp(input.yaw, -1, 1) * BETA_MAX * ctrlEff;
    const maxR = p.yawRate * rateFloor;
    let rTarget = clamp(YAW_GAIN * auth * (betaCmd - beta), -maxR, maxR);

    // ---- 롤 (+ 날개 손상 쏠림, 실속 시 날개 흔들림)
    const highAlphaRoll = 1 - 0.5 * smoothstep(alphaStall * 0.6, alphaStall, absAlpha);
    let pTarget = clamp(input.roll, -1, 1) * p.rollRate * auth * ctrlEff * highAlphaRoll;
    pTarget += this.rollBiasSign * clamp(dmg.wings, 0, 1) * WING_ROLL_BIAS * p.rollRate * auth;
    const departure = aero ? smoothstep(0, 8 * DEG, absAlpha - alphaStall) * smoothstep(15, 40, V) : 0;
    if (departure > 0) {
      pTarget += departure * 0.7 * Math.cos(this.time * 2.8);
      rTarget += departure * 0.15 * Math.cos(this.time * 1.9 + 1.3);
    }
    this.pRate += (pTarget - this.pRate) * (1 - Math.exp(-dt / ROLL_TAU));
    this.rRel += (rTarget - this.rRel) * (1 - Math.exp(-dt / YAW_TAU));

    // ---- 롤 축: 안정축(속도벡터), 저속/큰 받음각이면 기수축
    const vw = aero ? smoothstep(0.5, 0.9, _vhat.dot(_fwd)) * smoothstep(5, 30, V) : 0;
    _rollAxis.copy(_fwd).multiplyScalar(1 - vw).addScaledVector(_vhat, vw);
    if (_rollAxis.lengthSq() < 1e-8) _rollAxis.copy(_fwd);
    else _rollAxis.normalize();

    _omega.copy(_omegaPath).addScaledVector(_rollAxis, this.pRate).addScaledVector(_right, this.qRel).addScaledVector(_up, this.rRel);

    // ---- 적분: 법선 가속은 속도벡터 회전으로(에너지 보존), 접선 가속만 크기 변화로
    if (V > 1) {
      const wPath = _omegaPath.length();
      if (wPath > 1e-12) {
        _dq.setFromAxisAngle(_tmp.copy(_omegaPath).divideScalar(wPath), wPath * dt);
        vel.applyQuaternion(_dq);
      }
      vel.addScaledVector(_vhat, _acc.dot(_vhat) * dt);
    } else {
      vel.addScaledVector(_acc, dt);
    }
    pos.addScaledVector(vel, dt);
    const w = _omega.length();
    if (w > 1e-9) {
      _dq.setFromAxisAngle(_tmp.copy(_omega).divideScalar(w), w * dt);
      quat.premultiply(_dq).normalize();
    }

    // ---- 실제 동체 각속도 (표시/테스트)
    _qInv.copy(quat).invert();
    _tmp.copy(_omega).applyQuaternion(_qInv);
    this.bodyRates.set(_tmp.x, -_tmp.y, -_tmp.z);

    // ---- 과G 응력
    let overG = false;
    if (gLoad > p.gMax + OVERG_MARGIN) {
      overG = true;
      this.airframeStress += ((gLoad - p.gMax - OVERG_MARGIN) / (0.5 * p.gMax)) * dt;
    } else if (gLoad < p.gMin - OVERG_MARGIN) {
      overG = true;
      this.airframeStress += ((p.gMin - OVERG_MARGIN - gLoad) / (0.5 * Math.abs(p.gMin || -3))) * dt;
    }

    // ---- 실속 판정: 실속각 초과, 또는 CLmax 로 1G 를 못 버티는 속도
    const vStall = aero ? Math.sqrt((2 * weight) / (rho * p.wingArea * clMax)) : Infinity;
    const stalled = absAlpha > alphaStall + 0.5 * DEG || V < vStall * 0.98;

    this.sanitize();
    const agl = pos.y - (ctx.groundHeight ?? 0);
    const ps = V > 0 ? ((thrustAlongV - drag) * V) / weight : 0;
    this.refreshTelemetry(thrust, drag, ps, gLoad, alpha, beta, agl, stalled, overG);
  }

  private burnFuel(kg: number): void {
    if (kg <= 0) return;
    const s = this.stores;
    const fromExt = Math.min(s.externalFuelKg, kg);
    if (fromExt > 0) s.externalFuelKg -= fromExt;
    this.internalFuelKg = Math.max(0, this.internalFuelKg - (kg - fromExt));
  }

  private leakFuel(kg: number): void {
    this.internalFuelKg = Math.max(0, this.internalFuelKg - kg);
  }

  /** 수치 안전장치: 비정상 값이 생기면 안전 상태로 되돌린다 */
  private sanitize(): void {
    const v = this.velocity;
    const q = this.quaternion;
    if (!Number.isFinite(v.x + v.y + v.z)) v.set(0, 0, 0);
    if (!Number.isFinite(q.x + q.y + q.z + q.w) || q.lengthSq() < 1e-12) q.identity();
    const p = this.position;
    if (!Number.isFinite(p.x + p.y + p.z)) p.set(0, Math.max(0, Number.isFinite(p.y) ? p.y : 0), 0);
    if (!Number.isFinite(this.qRel + this.rRel + this.pRate)) this.qRel = this.rRel = this.pRate = 0;
  }

  private refreshTelemetry(
    thrust: number,
    drag: number,
    ps: number,
    gLoad: number,
    alpha: number,
    beta: number,
    agl: number,
    stalled: boolean,
    overG: boolean,
  ): void {
    const t = this.telemetry;
    const p = this.params;
    const V = this.velocity.length();
    atmosphere(this.position.y, _atm);
    t.speed = V;
    t.ias = tasToIas(V, _atm.rho);
    t.mach = V / _atm.speedOfSound;
    t.altitude = this.position.y;
    t.agl = agl;
    t.verticalSpeed = this.velocity.y;
    t.aoaDeg = alpha * RAD;
    t.sideslipDeg = beta * RAD;
    t.gLoad = Number.isFinite(gLoad) ? gLoad : 0;
    _euler.setFromQuaternion(this.quaternion, 'YXZ');
    t.headingDeg = wrap360(-_euler.y * RAD);
    t.pitchDeg = _euler.x * RAD;
    t.rollDeg = -_euler.z * RAD;
    t.throttle = this.engineRunning ? this.spool : 0;
    t.afterburner = this.abLevel > 0.5;
    t.fuelKg = this.fuelKg;
    t.fuelFraction = clamp(this.fuelKg / p.fuelCapacityKg, 0, 1);
    t.thrustN = thrust;
    t.dragN = drag;
    t.specificExcessPower = Number.isFinite(ps) ? ps : 0;
    t.stalled = stalled;
    t.overG = overG;
    t.sweepDeg = this.sweepDeg;
  }
}
