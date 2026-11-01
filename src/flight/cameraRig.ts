// 카메라: 추적(기본) / 조종석 / 둘러보기 / 표적 시점 / 미사일 시점 / 격추 시점.
//
//   const rig = new CameraRig(game.camera, input);
//   rig.setTarget(playerAircraft);
//   game.addSystem(rig);              // 렌더 프레임마다 update
//
// 시점 전환은 PlayerController 가 내보내는 sim.events 'uiAction' (view / missileCam / targetView / targetViewEnd) 을 듣는다.
// 둘러보기는 input.held('freeLook') + 마우스 'look' 채널, 또는 오른쪽 스틱.
import * as THREE from 'three';
import type { AircraftLike } from '../core/contracts';
import type { System } from '../core/game';
import { clamp, damp, DEG, smoothstep } from '../core/math';
import type { Entity } from '../core/entity';
import type { Sim } from '../core/sim';
import type { InputManager } from './input';

export type CameraView = 'chase' | 'cockpit';
export type CameraState = 'chase' | 'cockpit' | 'target' | 'missile' | 'death';

/** 상태 전환 블렌드 시간 (s) */
const BLEND_TIME = 0.35;
/** 미사일 소멸 후 그 자리에서 보여주는 시간 (s) */
const MISSILE_LINGER = 1.6;
const LOOK_RAD_PER_PX = 0.004;
const BASE_FOV = 62;

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
/** update() 전용 목표 자세 (자세 계산 함수 안의 임시 객체와 겹치지 않게) */
const _posePos = new THREE.Vector3();
const _poseQuat = new THREE.Quaternion();
const _e = new THREE.Euler();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _mouse = { x: 0, y: 0 };

interface AimSource {
  aimDirection?: THREE.Vector3;
  mouseAimActive?: boolean;
}

interface CockpitSource {
  getCockpitWorldPosition?(out: THREE.Vector3): THREE.Vector3;
}

export class CameraRig implements System {
  readonly name = 'cameraRig';
  /** 사용자가 고른 기본 시점 (V 로 전환) */
  view: CameraView = 'chase';
  target: AircraftLike | null = null;
  /** 추적 시점 거리 배율 (설정/휠) */
  distanceScale = 1;

  private stateNow: CameraState = 'chase';
  private sim: Sim | null = null;
  private unsubs: Array<() => void> = [];
  private initialized = false;

  // 추적 시점 스무딩 상태
  private readonly camFwd = new THREE.Vector3(0, 0, -1);
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private readonly accel = new THREE.Vector3();
  private readonly prevVel = new THREE.Vector3();
  private fov = BASE_FOV;
  private abSmooth = 0;

  // 둘러보기
  private lookYaw = 0;
  private lookPitch = 0;

  // 블렌드 (대상 기준 오프셋으로 저장 — 고속에서도 끌리지 않게)
  private blend = 1;
  private readonly fromOffset = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();

  // 미사일/표적/격추
  private targetViewHeld = false;
  private missileMode = false;
  private lastMissile: Entity | null = null;
  private missileEndTime: number | null = null;
  private readonly lastMissilePos = new THREE.Vector3();
  private readonly lastMissileDir = new THREE.Vector3(0, 0, -1);
  private readonly deathPos = new THREE.Vector3();
  private deathAngle = 0;
  private deathTime = 0;
  private hiddenModel: THREE.Object3D | null = null;

  private readonly listenerVel = new THREE.Vector3();
  private readonly prevCamPos = new THREE.Vector3();
  private time = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly input: InputManager,
  ) {}

  get state(): CameraState {
    return this.stateNow;
  }

  setTarget(ac: AircraftLike | null): void {
    if (ac === this.target) return;
    this.showOwnModel();
    this.target = ac;
    this.initialized = false;
    this.missileMode = false;
    this.lastMissile = null;
    this.missileEndTime = null;
    this.lookYaw = this.lookPitch = 0;
    this.blend = 1;
  }

  cycleView(): void {
    this.view = this.view === 'chase' ? 'cockpit' : 'chase';
  }

  // ---------------------------------------------------------------- 이벤트

  private bind(sim: Sim): void {
    if (this.sim === sim) return;
    for (const u of this.unsubs) u();
    this.sim = sim;
    this.unsubs = [
      sim.events.on('uiAction', ({ action }) => {
        if (action === 'view') this.cycleView();
        else if (action === 'missileCam') this.toggleMissileCam();
        else if (action === 'targetView') this.targetViewHeld = true;
        else if (action === 'targetViewEnd') this.targetViewHeld = false;
      }),
      sim.events.on('weaponLaunched', ({ weapon, shooter }) => {
        if (shooter && shooter === this.target) {
          this.lastMissile = weapon;
          this.missileEndTime = null;
        }
      }),
    ];
  }

  private toggleMissileCam(): void {
    if (this.missileMode) this.missileMode = false;
    else if (this.lastMissile && !this.lastMissile.removed && this.lastMissile.alive) this.missileMode = true;
  }

  // ---------------------------------------------------------------- 프레임

  update(dt: number, sim: Sim): void {
    this.bind(sim);
    this.time += dt;
    const ac = this.target;
    const cam = this.camera;
    if (!ac) {
      this.updateListener(dt, sim);
      return;
    }
    if (!this.initialized) this.snapTo(ac);

    this.updateFreeLook(dt);
    const next = this.pickState(ac, sim);
    if (next !== this.stateNow) this.beginBlend(ac, next);

    const fov = this.computePose(next, ac, dt, sim, _posePos, _poseQuat);
    // 상태 전환 블렌드 (대상 기준 상대 위치로)
    if (this.blend < 1 && dt > 0) {
      this.blend = Math.min(1, this.blend + dt / BLEND_TIME);
      const t = smoothstep(0, 1, this.blend);
      _tmp.subVectors(_posePos, ac.position);
      _tmp.lerpVectors(this.fromOffset, _tmp, t);
      _posePos.copy(ac.position).add(_tmp);
      _poseQuat.slerpQuaternions(this.fromQuat, _poseQuat, t);
    }
    cam.position.copy(_posePos);
    cam.quaternion.copy(_poseQuat);
    this.applyShake(ac, sim, dt);
    this.fov = dt > 0 ? damp(this.fov, fov, 3, dt) : this.fov;
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    // 조종석 시점에서는 자기 기체 모델을 숨긴다
    if (this.stateNow === 'cockpit' && ac.alive) this.hideOwnModel(ac);
    else this.showOwnModel();

    this.updateListener(dt, sim);
  }

  private snapTo(ac: AircraftLike): void {
    ac.getForward(this.camFwd);
    ac.getUp(this.camUp);
    this.prevVel.copy(ac.velocity);
    this.accel.set(0, 0, 0);
    this.abSmooth = ac.telemetry.afterburner ? 1 : 0;
    this.initialized = true;
    this.stateNow = this.view;
    this.blend = 1;
  }

  private pickState(ac: AircraftLike, sim: Sim): CameraState {
    if (!ac.alive || ac.removed) {
      if (this.stateNow !== 'death') {
        this.deathTime = sim.time;
        this.deathAngle = Math.atan2(this.camera.position.x - ac.position.x, this.camera.position.z - ac.position.z);
      }
      if (!ac.removed) this.deathPos.copy(ac.position);
      return 'death';
    }
    if (this.missileMode) {
      const m = this.lastMissile;
      if (m && !m.removed && m.alive) {
        this.lastMissilePos.copy(m.position);
        if (m.velocity.lengthSq() > 1) this.lastMissileDir.copy(m.velocity).normalize();
        this.missileEndTime = null;
        return 'missile';
      }
      if (this.missileEndTime === null) this.missileEndTime = sim.time;
      if (sim.time - this.missileEndTime < MISSILE_LINGER) return 'missile';
      this.missileMode = false;
      this.lastMissile = null;
    }
    if ((this.targetViewHeld || this.input.held('targetView')) && ac.avionics.target) return 'target';
    return this.view;
  }

  private beginBlend(ac: AircraftLike, next: CameraState): void {
    const instant = next === 'cockpit' || this.stateNow === 'cockpit';
    this.stateNow = next;
    if (instant) {
      this.blend = 1;
      return;
    }
    this.fromOffset.subVectors(this.camera.position, ac.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.blend = 0;
  }

  private updateFreeLook(dt: number): void {
    const input = this.input;
    input.consumeMouseDelta('look', _mouse);
    const sens = this.sim?.settings.mouseSensitivity ?? 1;
    const stickX = input.axes.lookX;
    const stickY = input.axes.lookY;
    if (input.held('freeLook')) {
      this.lookYaw = clamp(this.lookYaw - _mouse.x * LOOK_RAD_PER_PX * sens, -170 * DEG, 170 * DEG);
      this.lookPitch = clamp(this.lookPitch - _mouse.y * LOOK_RAD_PER_PX * sens, -60 * DEG, 80 * DEG);
    } else if (Math.abs(stickX) > 0.01 || Math.abs(stickY) > 0.01) {
      this.lookYaw = damp(this.lookYaw, -stickX * 160 * DEG, 8, dt);
      this.lookPitch = damp(this.lookPitch, stickY * 70 * DEG, 8, dt);
    } else if (dt > 0) {
      this.lookYaw = damp(this.lookYaw, 0, 4, dt);
      this.lookPitch = damp(this.lookPitch, 0, 4, dt);
    }
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.distanceScale = clamp(this.distanceScale * Math.exp(wheel * 0.001), 0.6, 2.5);
  }

  /** 상태별 목표 자세. 반환값 = 목표 FOV */
  private computePose(state: CameraState, ac: AircraftLike, dt: number, sim: Sim, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    switch (state) {
      case 'cockpit':
        return this.cockpitPose(ac, pos, quat);
      case 'target':
        this.updateChaseSmoothing(ac, dt);
        return this.targetPose(ac, pos, quat);
      case 'missile':
        this.updateChaseSmoothing(ac, dt);
        return this.missilePose(pos, quat);
      case 'death':
        return this.deathPose(ac, dt, sim, pos, quat);
      default:
        this.updateChaseSmoothing(ac, dt);
        return this.chasePose(ac, pos, quat);
    }
  }

  private updateChaseSmoothing(ac: AircraftLike, dt: number): void {
    if (dt <= 0) return;
    ac.getForward(_fwd);
    ac.getUp(_up);
    // 방향은 빠르게, 롤은 조금 늦게 따라간다
    if (this.camFwd.dot(_fwd) < 0) this.camFwd.copy(_fwd);
    else this.camFwd.lerp(_fwd, 1 - Math.exp(-10 * dt)).normalize();
    this.camUp.lerp(_up, 1 - Math.exp(-4.5 * dt));
    this.camUp.addScaledVector(this.camFwd, -this.camUp.dot(this.camFwd));
    if (this.camUp.lengthSq() < 1e-6) this.camUp.copy(_up);
    this.camUp.normalize();
    // 가속도 (부드럽게): 애프터버너 점화 시 카메라가 살짝 뒤로 밀린다
    _tmp.subVectors(ac.velocity, this.prevVel).divideScalar(dt);
    this.prevVel.copy(ac.velocity);
    if (_tmp.lengthSq() < 400 * 400) this.accel.lerp(_tmp, 1 - Math.exp(-3 * dt));
    this.abSmooth = damp(this.abSmooth, ac.telemetry.afterburner ? 1 : 0, 2.5, dt);
  }

  private chaseDistance(ac: AircraftLike): number {
    const len = ac.def.dimensions.length;
    return (len * 1.15 + 7 + Math.min(8, ac.telemetry.speed * 0.008)) * this.distanceScale;
  }

  private chaseFov(ac: AircraftLike): number {
    return BASE_FOV + 10 * smoothstep(120, 650, ac.telemetry.speed) + 6 * this.abSmooth;
  }

  private chasePose(ac: AircraftLike, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const aimSrc = ac.controller as AimSource | null;
    const mouseAim = !!aimSrc?.mouseAimActive && !!aimSrc.aimDirection;
    const D = this.chaseDistance(ac);
    const H = D * 0.21;
    const fwd = _fwd.copy(mouseAim ? aimSrc!.aimDirection! : this.camFwd);
    // 마우스 에임: 수평선 유지 (워썬더식), 일반: 기체 위쪽(롤 지연)
    const up = mouseAim ? _up.copy(WORLD_UP).addScaledVector(fwd, -fwd.dot(WORLD_UP)).normalize() : _up.copy(this.camUp);
    if (up.lengthSq() < 1e-6) up.copy(this.camUp);
    _right.crossVectors(fwd, up).normalize();

    // 둘러보기: 기체 주위를 공전
    const orbit = _q.setFromAxisAngle(up, this.lookYaw).multiply(_q2.setFromAxisAngle(_right, this.lookPitch));
    _tmp.copy(fwd).multiplyScalar(-D).addScaledVector(up, H).applyQuaternion(orbit);
    // 가속 시 뒤로 밀림 (최대 3 m)
    const along = clamp(this.accel.dot(fwd) * 0.05, -1.5, 3);
    _tmp.addScaledVector(fwd, -along);
    pos.copy(ac.position).add(_tmp);

    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 0.02) {
      _look.copy(ac.position).addScaledVector(up, H * 0.25);
    } else {
      _look.copy(ac.position).addScaledVector(fwd, 45).addScaledVector(up, H * 0.3);
    }
    lookRotation(pos, _look, up, quat);
    return this.chaseFov(ac);
  }

  private cockpitPose(ac: AircraftLike, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const src = ac as AircraftLike & CockpitSource;
    if (src.getCockpitWorldPosition) src.getCockpitWorldPosition(pos);
    else pos.copy(ac.position).addScaledVector(ac.getUp(_up), 1).addScaledVector(ac.getForward(_fwd), ac.def.dimensions.length * 0.3);
    _e.set(this.lookPitch, this.lookYaw, 0, 'YXZ');
    quat.copy(ac.quaternion).multiply(_q.setFromEuler(_e));
    // 고G 에서 머리가 살짝 눌린다
    pos.addScaledVector(ac.getUp(_up), -clamp((ac.telemetry.gLoad - 1) * 0.012, -0.05, 0.1));
    return 70 + 4 * this.abSmooth;
  }

  private targetPose(ac: AircraftLike, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const tgt = ac.avionics.target;
    if (!tgt) return this.chasePose(ac, pos, quat);
    _fwd.subVectors(tgt.position, ac.position);
    const range = _fwd.length();
    if (range < 1) return this.chasePose(ac, pos, quat);
    _fwd.divideScalar(range);
    const D = this.chaseDistance(ac) * 1.15;
    _up.copy(this.camUp).lerp(WORLD_UP, 0.6).normalize();
    _up.addScaledVector(_fwd, -_up.dot(_fwd));
    if (_up.lengthSq() < 1e-6) _up.copy(WORLD_UP);
    _up.normalize();
    pos.copy(ac.position).addScaledVector(_fwd, -D).addScaledVector(_up, D * 0.28);
    // 가까운 표적은 두 기체 사이를, 먼 표적은 표적을 본다
    const w = smoothstep(150, 1500, range);
    _look.copy(ac.position).lerp(tgt.position, 0.5 + 0.5 * w);
    lookRotation(pos, _look, _up, quat);
    return BASE_FOV - 6 * w;
  }

  private missilePose(pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const m = this.lastMissile;
    const alive = !!m && !m.removed && m.alive;
    const mp = alive ? m!.position : this.lastMissilePos;
    const dir = this.lastMissileDir;
    _up.copy(WORLD_UP).addScaledVector(dir, -dir.dot(WORLD_UP));
    if (_up.lengthSq() < 1e-6) _up.set(1, 0, 0);
    _up.normalize();
    if (alive) {
      pos.copy(mp).addScaledVector(dir, -12).addScaledVector(_up, 2.5);
      const tgt = (m as Entity & { target?: Entity | null }).target;
      if (tgt && !tgt.removed && tgt.position.distanceToSquared(mp) < 25_000 * 25_000) _look.copy(tgt.position);
      else _look.copy(mp).addScaledVector(dir, 200);
    } else {
      // 소멸 지점을 약간 떨어져서 바라본다
      pos.copy(mp).addScaledVector(dir, -60).addScaledVector(_up, 20);
      _look.copy(mp);
    }
    lookRotation(pos, _look, _up, quat);
    return 55;
  }

  private deathPose(ac: AircraftLike, dt: number, sim: Sim, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const since = sim.time - this.deathTime;
    this.deathAngle += dt * 0.35;
    const len = ac.def.dimensions.length;
    const radius = len * 2.5 + 30 + Math.min(120, since * 6);
    const height = 12 + Math.min(80, since * 4) + this.lookPitch * 20;
    const center = this.deathPos;
    pos.set(center.x + Math.sin(this.deathAngle + this.lookYaw) * radius, center.y + height, center.z + Math.cos(this.deathAngle + this.lookYaw) * radius);
    const ground = sim.services.terrain.heightAt(pos.x, pos.z) + 5;
    if (pos.y < ground) pos.y = ground;
    lookRotation(pos, center, WORLD_UP, quat);
    return BASE_FOV;
  }

  private applyShake(ac: AircraftLike, sim: Sim, dt: number): void {
    const t = ac.telemetry;
    const aoaMax = ac.stats.aoaMaxDeg || 25;
    const buffet = ac.alive ? 0.12 * smoothstep(aoaMax * 0.75, aoaMax, Math.abs(t.aoaDeg)) * smoothstep(50, 120, t.speed) : 0;
    const transonic = ac.alive ? 0.05 * (1 - Math.abs(t.mach - 1) / 0.08) : 0;
    const amount = clamp(sim.services.fx.shakeAmount + buffet + Math.max(0, transonic) + 0.02 * this.abSmooth, 0, 1.5);
    if (amount < 1e-3 || dt <= 0) return;
    const cam = this.camera;
    const s = this.time;
    const scale = this.stateNow === 'cockpit' ? 0.08 : 0.5;
    // 비정수비 사인 합 → 부드러운 노이즈 (순수 시각 효과)
    const nx = Math.sin(s * 37.1) * 0.6 + Math.sin(s * 23.7 + 1.3) * 0.4;
    const ny = Math.sin(s * 31.3 + 0.7) * 0.6 + Math.sin(s * 19.9 + 2.1) * 0.4;
    const nr = Math.sin(s * 27.9 + 0.4);
    cam.position.addScaledVector(_tmp.set(1, 0, 0).applyQuaternion(cam.quaternion), nx * amount * scale);
    cam.position.addScaledVector(_tmp.set(0, 1, 0).applyQuaternion(cam.quaternion), ny * amount * scale);
    _e.set(ny * amount * 0.6 * DEG, nx * amount * 0.6 * DEG, nr * amount * 0.8 * DEG, 'YXZ');
    cam.quaternion.multiply(_q.setFromEuler(_e));
  }

  private updateListener(dt: number, sim: Sim): void {
    const cam = this.camera;
    if (dt > 0) {
      _tmp.subVectors(cam.position, this.prevCamPos).divideScalar(dt);
      if (_tmp.lengthSq() < 2000 * 2000) this.listenerVel.lerp(_tmp, 1 - Math.exp(-8 * dt));
    }
    this.prevCamPos.copy(cam.position);
    sim.services.audio.setListener(cam.position, cam.quaternion, this.listenerVel);
  }

  private hideOwnModel(ac: AircraftLike): void {
    if (this.hiddenModel === ac.object3d) return;
    this.showOwnModel();
    ac.object3d.visible = false;
    this.hiddenModel = ac.object3d;
  }

  private showOwnModel(): void {
    if (this.hiddenModel) this.hiddenModel.visible = true;
    this.hiddenModel = null;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.sim = null;
    this.showOwnModel();
  }
}

/** eye 에서 target 을 바라보는 카메라 자세 (-Z 가 target 쪽) */
function lookRotation(eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  if (eye.distanceToSquared(target) < 1e-8) return out;
  _m.lookAt(eye, target, up);
  return out.setFromRotationMatrix(_m);
}
