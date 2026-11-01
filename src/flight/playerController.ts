// 플레이어 조종: 입력 → ControlInput + 무장/항전/UI 동작.
//
//   const pc = new PlayerController(input, sim);
//   ac.controller = pc;               // Aircraft.update 가 매 스텝 pc.update 를 호출
//   pc.aimDirection                   // 마우스 에임 모드의 가상 조준 방향 (월드, HUD/카메라용)
//
// 모드 (sim.settings.controlMode)
//   standard  — 직접 각속도 조종. 스로틀은 에이스컴뱃식: 중립 = 순항(0.75), 가속 = 최대 + AB, 감속 = 아이들 + 에어브레이크
//   mouseAim  — 마우스로 조준 방향을 움직이면 교관 오토파일럿이 양력 벡터를 그쪽으로 굴려 당긴다(워썬더식).
//               피치/롤 키를 누르는 동안은 직접 조종 우선.
import * as THREE from 'three';
import type { AircraftController, AircraftLike, RadarMode } from '../core/contracts';
import { clamp, DEG, smoothstep } from '../core/math';
import type { Sim } from '../core/sim';
import type { WeaponCategory } from '../data/schema';
import type { InputManager } from './input';

/** 중립 스로틀 (순항) */
export const CRUISE_THROTTLE = 0.75;
/** 마우스 1px 당 조준 회전 (rad, 감도 1 기준) */
const MOUSE_AIM_RAD_PER_PX = 0.0022;
/** 디코이 연속 투하 간격 (누르고 있을 때) */
const DECOY_REPEAT = 0.45;

const GROUND_CATEGORIES = new Set<WeaponCategory>(['agm', 'arm', 'ashm', 'bomb_gps', 'bomb_laser', 'bomb_dumb', 'bomb_cluster', 'nuke']);

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _mouse = { x: 0, y: 0 };

export class PlayerController implements AircraftController {
  /** 마우스 에임 가상 조준 방향 (월드 단위벡터) */
  readonly aimDirection = new THREE.Vector3(0, 0, -1);
  /** 마우스 에임이 실제로 조종 중 (키 직접 조종 중이면 false) */
  mouseAimActive = false;
  /** 마지막 스텝의 모드 */
  mode: 'standard' | 'mouseAim' = 'standard';

  private aimInitialized = false;
  private flareTimer = 0;
  private chaffTimer = 0;

  constructor(
    readonly input: InputManager,
    readonly sim: Sim,
  ) {}

  update(ac: AircraftLike, dt: number, sim: Sim): void {
    const input = this.input;
    input.poll(dt);
    const settings = sim.settings;
    const mode = settings.controlMode;
    if (mode !== this.mode) this.aimInitialized = false;
    this.mode = mode;
    const c = ac.controls;
    const invert = settings.invertPitch ? -1 : 1;

    // ---- 스로틀 (에이스컴뱃식)
    const ax = input.axes;
    if (ax.accel > 0.05) {
      c.throttle = CRUISE_THROTTLE + (1 - CRUISE_THROTTLE) * clamp(ax.accel / 0.9, 0, 1);
      c.afterburner = ax.accel > 0.9;
      c.airbrake = false;
    } else if (ax.brake > 0.05) {
      c.throttle = CRUISE_THROTTLE * (1 - clamp(ax.brake / 0.9, 0, 1));
      c.afterburner = false;
      c.airbrake = ax.brake > 0.5;
    } else {
      c.throttle = CRUISE_THROTTLE;
      c.afterburner = false;
      c.airbrake = false;
    }

    // ---- 자세
    if (!this.aimInitialized) {
      ac.getForward(this.aimDirection);
      this.aimInitialized = true;
    }
    if (mode === 'mouseAim') {
      this.updateMouseAim(ac, dt, invert);
    } else {
      this.mouseAimActive = false;
      input.consumeMouseDelta('aim', _mouse);
      c.pitch = clamp(ax.pitch * invert, -1, 1);
      c.roll = clamp(ax.roll, -1, 1);
      c.yaw = clamp(ax.yaw, -1, 1);
      ac.getForward(this.aimDirection);
    }

    this.handleActions(ac, dt, sim);
  }

  // ---------------------------------------------------------------- 마우스 에임

  private updateMouseAim(ac: AircraftLike, dt: number, invert: number): void {
    const input = this.input;
    const c = ac.controls;
    const aim = this.aimDirection;
    input.consumeMouseDelta('aim', _mouse);
    if (!input.held('freeLook')) {
      const k = MOUSE_AIM_RAD_PER_PX * Math.max(0.05, this.sim.settings.mouseSensitivity);
      // 수평 회전 (월드 위축), 수직 회전 (조준 방향의 오른쪽 축)
      aim.applyQuaternion(_q.setFromAxisAngle(WORLD_UP, -_mouse.x * k));
      _right.crossVectors(aim, WORLD_UP);
      if (_right.lengthSq() > 1e-8) {
        _right.normalize();
        const pitchNow = Math.asin(clamp(aim.y, -1, 1));
        const dPitch = clamp(-_mouse.y * k * invert, -88 * DEG - pitchNow, 88 * DEG - pitchNow);
        aim.applyQuaternion(_q.setFromAxisAngle(_right, dPitch));
      }
      aim.normalize();
    }

    const ax = input.axes;
    const manual = Math.abs(ax.pitch) > 0.05 || Math.abs(ax.roll) > 0.05;
    if (manual) {
      // 키 직접 조종: 조준점은 기수 쪽으로 끌려온다 (놓으면 튀지 않게)
      this.mouseAimActive = false;
      c.pitch = clamp(ax.pitch * invert, -1, 1);
      c.roll = clamp(ax.roll, -1, 1);
      c.yaw = clamp(ax.yaw, -1, 1);
      ac.getForward(_fwd);
      aim.lerp(_fwd, 1 - Math.exp(-6 * dt)).normalize();
      return;
    }
    this.mouseAimActive = true;
    instructorControls(ac, aim, c);
    if (Math.abs(ax.yaw) > 0.05) c.yaw = clamp(ax.yaw, -1, 1);
  }

  // ---------------------------------------------------------------- 동작

  private handleActions(ac: AircraftLike, dt: number, sim: Sim): void {
    const input = this.input;
    const stores = ac.stores;
    const avionics = ac.avionics;
    const audio = sim.services.audio;
    const events = sim.events;

    if (input.pressed('fire')) stores.fire(sim);
    stores.setGunTrigger(input.held('gun'));
    if (input.pressed('weaponNext')) {
      stores.selectNext(1);
      audio.play('weapon_select');
    }

    // 표적: 짧게 = 순환, 길게 = 기수 정면
    const tapped = input.tapped('target');
    const held = input.longPressed('target');
    if (tapped || held) {
      const before = avionics.target?.entity ?? null;
      const filter = targetFilter(stores.selectedDef()?.category);
      if (held) avionics.targetNearestToBoresight(sim, filter);
      else avionics.cycleTarget(sim, 1, filter);
      const after = avionics.target?.entity ?? null;
      if (after !== before) {
        events.emit('targetChanged', { entity: after });
        audio.play('target_switch');
      }
    }

    // 디코이: 누르면 즉시 1회, 계속 누르면 DECOY_REPEAT 간격으로 반복
    this.flareTimer -= dt;
    this.chaffTimer -= dt;
    const both = input.held('countermeasures');
    const bothPressed = input.pressed('countermeasures');
    if (input.pressed('flare') || bothPressed || ((both || input.held('flare')) && this.flareTimer <= 0)) {
      stores.dropFlare(sim);
      this.flareTimer = DECOY_REPEAT;
    }
    if (input.pressed('chaff') || bothPressed || ((both || input.held('chaff')) && this.chaffTimer <= 0)) {
      stores.dropChaff(sim);
      this.chaffTimer = DECOY_REPEAT;
    }

    if (input.pressed('jammer') && ac.stats.ew) {
      avionics.jammerActive = !avionics.jammerActive;
      audio.play('ui_click');
    }
    if (input.pressed('radarMode') && ac.stats.radar) {
      avionics.setRadarMode(nextRadarMode(avionics.radarMode, ac.stats.radar.groundModes));
      audio.play('ui_click');
    }
    if (input.longPressed('jettison')) stores.jettison(sim);

    if (input.pressed('wingAttack')) events.emit('wingmanCommand', { command: 'attack' });
    if (input.pressed('wingCover')) events.emit('wingmanCommand', { command: 'cover' });
    if (input.pressed('wingFormation')) events.emit('wingmanCommand', { command: 'formation' });
    if (input.pressed('wingEngageFree')) events.emit('wingmanCommand', { command: 'engage_free' });

    if (input.pressed('pause')) events.emit('uiAction', { action: 'pause' });
    if (input.pressed('map')) events.emit('uiAction', { action: 'map' });
    if (input.pressed('view')) events.emit('uiAction', { action: 'view' });
    if (input.pressed('missileCam')) events.emit('uiAction', { action: 'missileCam' });
    if (input.pressed('targetView')) events.emit('uiAction', { action: 'targetView' });
    if (input.released('targetView')) events.emit('uiAction', { action: 'targetViewEnd' });
  }

  dispose(): void {
    this.mouseAimActive = false;
  }
}

/** 선택 무장에 맞는 표적 필터 */
export function targetFilter(category: WeaponCategory | undefined): 'air' | 'ground' | 'any' {
  if (!category || category === 'gun') return 'any';
  if (GROUND_CATEGORIES.has(category)) return 'ground';
  if (category.startsWith('aam')) return 'air';
  return 'any';
}

/** 레이더 모드 순환: RWS → TWS → (AG) → OFF → RWS. STT 는 락으로만 들어가므로 TWS 로 취급 */
export function nextRadarMode(current: RadarMode, groundModes: boolean): RadarMode {
  const cycle: RadarMode[] = groundModes ? ['rws', 'tws', 'ag', 'off'] : ['rws', 'tws', 'off'];
  const cur = current === 'stt' ? 'tws' : current;
  const i = cycle.indexOf(cur);
  return cycle[(i + 1) % cycle.length];
}

/** 교관 수렴 속도 (1/s): 조준 오차각 → 요구 선회율 */
const INSTRUCTOR_GAIN = 2.4;
/** 롤 오차 → 요구 롤레이트 (1/s) */
const INSTRUCTOR_ROLL_GAIN = 6;

interface AuthoritySource {
  flight?: { authority(qbar: number): number };
}

/**
 * 교관 오토파일럿 (워썬더식 마우스 에임).
 * 기수를 조준 방향으로 돌리는 회전(오차각에 비례, 가용 선회율로 제한)을 정하고,
 *   - 그 회전의 동체 피치/요 성분을 각속도 명령으로,
 *   - 그 회전에 필요한 양력 + 중력 보상 방향으로 경사(롤)를 맞춘다 → 협조 선회, 작은 오차에서는 날개 수평.
 * 아래쪽 근거리 조준은 뒤집지 않고 민다.
 */
export function instructorControls(ac: AircraftLike, aim: THREE.Vector3, out: { pitch: number; roll: number; yaw: number }): void {
  const st = ac.stats;
  const t = ac.telemetry;
  const fwd = ac.getForward(_fwd);
  const up = ac.getUp(_v);
  const right = ac.getRight(_right);
  const V = Math.max(ac.velocity.length(), 1);
  const qbar = 0.5 * 1.225 * t.ias * t.ias;
  const auth = Math.max(0.15, (ac as AircraftLike & AuthoritySource).flight?.authority(qbar) ?? clamp(qbar / 20_000, 0.15, 1));

  // 요구 회전 (월드): 축 = fwd × aim, 크기 = min(K·오차, 가용 선회율)
  _axis.crossVectors(fwd, aim);
  const s = _axis.length();
  const off = Math.atan2(s, fwd.dot(aim));
  const wMax = Math.min(st.pitchRate * auth, (st.gMax * 9.80665) / Math.max(V, 60));
  const w = Math.min(INSTRUCTOR_GAIN * off, wMax);
  if (s > 1e-9) _axis.multiplyScalar(w / s);
  else _axis.set(0, 0, 0);

  // 필요한 양력 방향 = 회전에 필요한 법선 가속 + 중력 보상 (기수 수직 성분)
  _lift.crossVectors(_axis, fwd).multiplyScalar(V);
  _lift.y += 9.80665;
  _lift.addScaledVector(fwd, -_lift.dot(fwd));
  let ly = _lift.dot(up);
  let lx = _lift.dot(right);
  const push = ly < 0 && off < 20 * DEG;
  if (push) {
    // 밀어서 내린다: 동체 아래쪽을 양력 방향에 맞춘다
    ly = -ly;
    lx = -lx;
  }
  const rollErr = Math.atan2(lx, ly);
  out.roll = clamp((INSTRUCTOR_ROLL_GAIN * rollErr) / (st.rollRate * auth), -1, 1);

  // 동체 피치(+X)/요(기수 오른쪽 = -Y 회전) 성분
  const wPitch = _axis.dot(right);
  const wYaw = -_axis.dot(up);
  out.pitch = clamp(wPitch / (st.pitchRate * auth), -1, 1);
  out.yaw = clamp(((wYaw / (st.yawRate * auth)) * (1 - smoothstep(6 * DEG, 12 * DEG, off))) * 1.5, -1, 1);
}
