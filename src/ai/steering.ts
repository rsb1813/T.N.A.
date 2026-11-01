// 비행 방향 조종 기본기: flyToward(원하는 비행 방향, 원하는 속도) → roll / pitch / yaw / throttle.
//
// 비행모델(src/flight)의 조종 규칙에 맞춘 협조 선회 오토파일럿.
//   pitch = 요구 피치 각속도 비율. 비행모델은 a_req = V·pitch·pitchRate·auth + g·liftDir.y 를 양력 방향으로 만든다
//           (중립 = 비행경로 유지). 그래서 원하는 법선 가속 A 에 대해 pitch = (A − g·liftDir.y) / (V·pitchRate·auth).
//   roll  = 안정축(속도벡터) 기준 롤 각속도 비율.
//
// 알고리즘
//   1. 속도벡터 v̂ 를 목표 방향 d 로 돌리는 경로 선회율 ω = K·(오차각 − 리드 보정) (가용 G 로 제한).
//   2. 필요한 양력 가속 L = ω·V (선회 평면 안쪽) + 중력 보상 (v̂ 에 수직인 성분). |L| ≤ gLimit·g.
//   3. 양력 방향(liftDir)을 L 쪽으로 굴리고(roll), 정렬된 만큼 당긴다(pitch). 작은 아래쪽 수정은 뒤집지 않고 민다.
//   4. 오차가 작으면 러더로 미세 조준. 스로틀 PI + 애프터버너/에어브레이크 히스테리시스.
// 이득 K 는 동압 권한(authority)으로 스케줄 → 저속에서도 진동 없음. 롤 PD 는 비행모델 롤 지연(0.08 s)에 맞춘 감쇠비 ~0.8.
import * as THREE from 'three';
import type { AircraftLike, ControlInput } from '../core/contracts';
import { atmosphere, clamp, DEG, G0, headingToDir, RHO0, smoothstep, type Atmosphere } from '../core/math';

export interface SteerOptions {
  /** 사용할 최대 양의 하중배수 (G). 기본 stats.gMax */
  gLimit?: number;
  /** 밀어 내릴 때 허용하는 음의 하중배수 크기 (G). 기본 1 */
  negGLimit?: number;
  /** 경로 선회 이득 배율 (기본 1). 조준 때 높이고 순항 때 낮춘다 */
  gain?: number;
  /** 애프터버너: true = 필요하면 사용(기본), false = 금지, 'force' = 항상 */
  afterburner?: boolean | 'force';
  /** 에어브레이크 허용 (기본 true) */
  airbrake?: boolean;
  /** 작은 오차에서 러더 미세 조준 (기본 true) */
  rudder?: boolean;
  /** true = 속도벡터가 아니라 기수(기관포 축)를 d 로 맞춘다 (받음각만큼 보정) */
  aimNose?: boolean;
  /** 최저 스로틀 (기본 0) */
  minThrottle?: number;
}

/** 마지막 flyToward 진단 값 (테스트/디버그) */
export interface SteerDiagnostics {
  errDeg: number;
  rollErrDeg: number;
  /** 요구 양력 가속 (G) */
  cmdG: number;
  push: boolean;
  afterburner: boolean;
  airbrake: boolean;
}

interface AuthoritySource {
  flight?: { authority(qbar: number): number };
}

/** 경로 선회 이득 (1/s, 권한 1 기준) */
const PATH_GAIN = 2.3;
/** 이득 하한/상한 (1/s) */
const PATH_GAIN_MIN = 0.45;
/** 리드 보정 시간 (s): 현재 경로 회전율만큼 오차를 미리 줄여 본다 (비행모델 받음각 지연 보상) */
const LEAD_TAU = 0.14;
/** 롤 오차 → 롤레이트 이득 (1/s) */
const ROLL_GAIN = 5.2;
/** 러더 미세 조준 이득 */
const YAW_GAIN = 7;
/** 밀기 모드 진입/유지 최대 오차각 */
const PUSH_ENTER = 22 * DEG;
const PUSH_EXIT = 32 * DEG;

const _vhat = new THREE.Vector3();
const _d = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _aTurn = new THREE.Vector3();
const _gPerp = new THREE.Vector3();
const _L = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _side = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _w = new THREE.Vector3();
const _sideH = new THREE.Vector3();
const _atm: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 };

/** 동압 권한 0..1 (비행모델이 있으면 그 값, 없으면 같은 식의 근사) */
export function controlAuthority(ac: AircraftLike): number {
  const ias = ac.telemetry.ias;
  const qbar = 0.5 * RHO0 * ias * ias;
  const fm = (ac as AircraftLike & AuthoritySource).flight;
  if (fm && typeof fm.authority === 'function') return fm.authority(qbar);
  const vc = Math.max(60, ac.stats.cornerSpeed || 170);
  const x = (ias * ias) / (vc * vc);
  if (x >= 1) return 1;
  const t = 1 - x;
  return 0.06 + 0.94 * (1 - t * t);
}

/** 방위(deg)와 상승각(deg) → 단위 방향 */
export function directionFrom(headingDeg: number, climbDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  headingToDir(headingDeg, out);
  const c = Math.cos(climbDeg * DEG);
  out.multiplyScalar(c);
  out.y = Math.sin(climbDeg * DEG);
  return out;
}

/**
 * 고도 유지 방향: 수평 방향 horizDir(정규화 불필요, y 무시) 로 가면서 targetAlt 로 1차 수렴 (시정수 tau).
 * maxClimbDeg 로 상승/강하각 제한.
 */
export function altitudeHoldDirection(
  ac: AircraftLike,
  horizDir: THREE.Vector3,
  targetAlt: number,
  out = new THREE.Vector3(),
  maxClimbDeg = 25,
  tau = 5,
): THREE.Vector3 {
  const V = Math.max(ac.velocity.length(), 50);
  const vs = clamp((targetAlt - ac.position.y) / tau, -V * Math.sin(maxClimbDeg * DEG), V * Math.sin(maxClimbDeg * DEG));
  const s = clamp(vs / V, -0.95, 0.95);
  out.set(horizDir.x, 0, horizDir.z);
  const h = out.length();
  if (h < 1e-6) ac.getForward(out).setY(0);
  out.normalize().multiplyScalar(Math.sqrt(1 - s * s));
  out.y = s;
  return out;
}

/** 고도에서의 음속 (m/s) */
export function speedOfSoundAt(altitude: number): number {
  return atmosphere(altitude, _atm).speedOfSound;
}

export class Steering {
  readonly diag: SteerDiagnostics = { errDeg: 0, rollErrDeg: 0, cmdG: 1, push: false, afterburner: false, airbrake: false };

  private rollSign: 1 | -1 = 1;
  private turnSign: 1 | -1 = 1;
  private pushMode = false;
  private abLatch = false;
  private brakeLatch = false;
  private speedInt = 0;
  private readonly prevVhat = new THREE.Vector3();
  private hasPrev = false;

  reset(): void {
    this.pushMode = false;
    this.abLatch = false;
    this.brakeLatch = false;
    this.speedInt = 0;
    this.hasPrev = false;
  }

  /**
   * 원하는 비행 방향(월드, 정규화 불필요)과 속도(m/s)로 조종 입력을 계산해 out(기본 ac.controls)에 쓴다.
   */
  flyToward(
    ac: AircraftLike,
    desiredDirection: THREE.Vector3,
    desiredSpeed: number,
    dt: number,
    opts: SteerOptions = {},
    out: ControlInput = ac.controls,
  ): ControlInput {
    const st = ac.stats;
    const V = ac.velocity.length();
    const fwd = ac.getForward(_fwd);
    if (V > 1) _vhat.copy(ac.velocity).divideScalar(V);
    else _vhat.copy(fwd);
    const Vc = Math.max(V, 40);

    _d.copy(desiredDirection);
    if (_d.lengthSq() < 1e-12) _d.copy(_vhat);
    _d.normalize();
    if (opts.aimNose) {
      // 기수 = v̂ 를 받음각만큼 돌린 것 → 기수를 d 에 두려면 v̂ 목표 = d − (기수 − v̂)
      _d.sub(_perp.subVectors(fwd, _vhat)).normalize();
    }

    const auth = Math.max(0.05, controlAuthority(ac));
    const ctrlEff = 1 - 0.6 * clamp(ac.damageState?.control ?? 0, 0, 1);
    const gMax = Math.max(1.5, Math.min(opts.gLimit ?? st.gMax, st.gMax));
    const negG = clamp(opts.negGLimit ?? 1, 0, Math.abs(st.gMin || 3));

    // ---- 기체 축: 양력 방향 = right × v̂ (비행모델과 같은 정의), 옆 = v̂ × lift
    const right = ac.getRight(_right);
    _lift.crossVectors(right, _vhat);
    if (_lift.lengthSq() < 1e-8) ac.getUp(_lift);
    _lift.normalize();
    _side.crossVectors(_vhat, _lift);

    // ---- 경로 오차
    const cosE = clamp(_vhat.dot(_d), -1, 1);
    const err = Math.acos(cosE);
    _perp.copy(_d).addScaledVector(_vhat, -cosE);
    let s = _perp.length();
    // 수평 오른쪽 (v̂ 기준) — 거의 뒤쪽 목표의 선회 방향 유지용
    _sideH.set(-_vhat.z, 0, _vhat.x);
    if (_sideH.lengthSq() < 1e-8) _sideH.copy(_side);
    _sideH.normalize();
    if (s < 1e-5) {
      if (cosE < 0) {
        _perp.copy(_sideH).multiplyScalar(this.turnSign);
        s = 1;
      } else {
        _perp.set(0, 0, 0);
      }
    } else {
      const lat = _perp.dot(_sideH);
      if (err > 150 * DEG) {
        // 뒤쪽 목표: 좌우 반전으로 선회 방향이 흔들리지 않게 이전 방향 유지
        if (lat * this.turnSign < 0) _perp.addScaledVector(_sideH, -2 * lat);
      } else if (Math.abs(lat) > 0.2 * s) {
        this.turnSign = lat > 0 ? 1 : -1;
      }
      _perp.divideScalar(_perp.length() || 1);
    }

    // ---- 리드 보정: 지금 경로가 목표 쪽으로 도는 속도
    let wNow = 0;
    if (this.hasPrev && dt > 0 && s > 1e-5) {
      _w.crossVectors(this.prevVhat, _vhat).divideScalar(dt);
      _axis.crossVectors(_vhat, _perp);
      wNow = _w.dot(_axis);
    }
    this.prevVhat.copy(_vhat);
    this.hasPrev = true;

    const K = (opts.gain ?? 1) * clamp(PATH_GAIN * auth, PATH_GAIN_MIN, PATH_GAIN);
    const errPred = Math.max(0, err - LEAD_TAU * wNow);
    const aTurnMag = Math.min(K * errPred * Vc, gMax * G0 * 1.05);
    _aTurn.copy(_perp).multiplyScalar(aTurnMag);

    // ---- 중력 보상 (v̂ 에 수직 성분)
    _gPerp.set(0, G0, 0).addScaledVector(_vhat, -G0 * _vhat.y);
    _L.copy(_aTurn).add(_gPerp);
    const Lmax = gMax * G0;
    if (_L.lengthSq() > Lmax * Lmax) {
      // 선회 성분을 줄여 |aTurn·s + gPerp| = Lmax
      const aa = _aTurn.lengthSq();
      const ag = _aTurn.dot(_gPerp);
      const gg = _gPerp.lengthSq();
      const disc = ag * ag - aa * (gg - Lmax * Lmax);
      const k = aa > 1e-9 && disc >= 0 ? clamp((-ag + Math.sqrt(disc)) / aa, 0, 1) : 0;
      _L.copy(_aTurn).multiplyScalar(k).add(_gPerp);
    }
    const Lmag = _L.length();
    const lx = _L.dot(_side);
    const ly = _L.dot(_lift);

    // ---- 밀기 모드: 작은 아래쪽 수정은 뒤집지 않고 음의 G 로
    const pushLimit = (this.pushMode ? 1.2 : 1) * negG * G0;
    const pushOk = negG > 0.05 && err < (this.pushMode ? PUSH_EXIT : PUSH_ENTER) && Lmag <= pushLimit && ly < (this.pushMode ? 0.3 * Lmag : 0);
    this.pushMode = pushOk;
    const sigma = pushOk ? -1 : 1;

    let rollErr = Math.atan2(sigma * lx, sigma * ly);
    if (Math.abs(rollErr) > 165 * DEG) rollErr = this.rollSign * Math.abs(rollErr);
    else if (Math.abs(rollErr) > 5 * DEG) this.rollSign = rollErr > 0 ? 1 : -1;
    rollErr *= smoothstep(0.08 * G0, 0.35 * G0, Lmag);

    // ---- 피치: 정렬된 만큼 당기고, 나머지는 경로 유지
    const c = Math.max(0, Math.cos(rollErr));
    const hold = _gPerp.dot(_lift);
    let A = c * sigma * Lmag + (1 - c) * hold;
    A = clamp(A, -negG * G0 - 0.5, Lmax);
    const pitchDen = Vc * st.pitchRate * auth * ctrlEff;
    out.pitch = clamp((A - G0 * _lift.y) / Math.max(pitchDen, 1e-3), -1, 1);

    // ---- 롤
    const t = ac.telemetry;
    const alphaStall = st.clMax > 0 && st.clAlpha > 0 ? st.clMax / st.clAlpha : 0.4;
    const highAlpha = 1 - 0.5 * smoothstep(alphaStall * 0.6, alphaStall, Math.abs(t.aoaDeg) * DEG);
    const pMax = st.rollRate * auth * ctrlEff * highAlpha;
    const pDes = clamp(ROLL_GAIN * rollErr, -pMax, pMax);
    out.roll = clamp(pDes / Math.max(pMax, 1e-3), -1, 1);

    // ---- 요: 작은 오차 미세 조준
    if (opts.rudder !== false) {
      const fine = 1 - smoothstep(2 * DEG, 6 * DEG, err);
      out.yaw = clamp(YAW_GAIN * _d.dot(_side) * fine, -0.6, 0.6);
    } else out.yaw = 0;

    // ---- 속도
    const eV = desiredSpeed - V;
    let thr = 0.55 + 0.022 * eV + this.speedInt;
    const minThr = clamp(opts.minThrottle ?? 0, 0, 1);
    if (!((thr >= 1 && eV > 0) || (thr <= minThr && eV < 0))) {
      this.speedInt = clamp(this.speedInt + 0.012 * eV * dt, -0.5, 0.5);
    }
    thr = clamp(thr, minThr, 1);
    const abMode = opts.afterburner ?? true;
    if (abMode === 'force') this.abLatch = true;
    else if (!abMode) this.abLatch = false;
    else if (this.abLatch) this.abLatch = eV > 4;
    else this.abLatch = eV > 22 && thr >= 0.999;
    const brakeOk = opts.airbrake ?? true;
    if (!brakeOk) this.brakeLatch = false;
    else if (this.brakeLatch) this.brakeLatch = eV < -12;
    else this.brakeLatch = eV < -45;
    if (this.abLatch) thr = 1;
    if (this.brakeLatch) thr = minThr;
    out.throttle = thr;
    out.afterburner = this.abLatch;
    out.airbrake = this.brakeLatch;

    const d = this.diag;
    d.errDeg = err / DEG;
    d.rollErrDeg = rollErr / DEG;
    d.cmdG = Lmag / G0;
    d.push = pushOk;
    d.afterburner = this.abLatch;
    d.airbrake = this.brakeLatch;
    return out;
  }
}
