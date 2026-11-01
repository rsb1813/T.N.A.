// HUD 조준 계산 (순수 함수): 기관포 리드, 기관포 탄도 깔때기, 무유도 폭탄 CCIP 탄착점.
// 폭탄 항력은 combat/kinematics 와 같은 형태(cd0 · (1 + 1.1 · 조파항력 배율))를 쓴다.
import * as THREE from 'three';
import { G0, atmosphere, type Atmosphere } from '../../core/math';
import { waveDragFactor } from '../../core/aero';
import type { WeaponDef } from '../../data/schema';

const _d = new THREE.Vector3();

/**
 * 기관포 리드: 탄이 표적과 만나도록 겨눠야 할 월드 방향(outDir, 정규화)을 구한다.
 * 탄속 = 사수 속도 + 조준방향·muzzleVel, 중력 낙차 포함, 표적 등속 가정. 반환 = 비행시간(s), 해 없으면 -1.
 */
export function computeGunLead(
  shooterPos: THREE.Vector3,
  shooterVel: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetVel: THREE.Vector3,
  muzzleVel: number,
  outDir: THREE.Vector3,
  iterations = 4,
): number {
  if (!(muzzleVel > 0)) return -1;
  let t = shooterPos.distanceTo(targetPos) / muzzleVel;
  for (let i = 0; i < iterations; i++) {
    _d.subVectors(targetPos, shooterPos);
    _d.x += (targetVel.x - shooterVel.x) * t;
    _d.y += (targetVel.y - shooterVel.y) * t + 0.5 * G0 * t * t;
    _d.z += (targetVel.z - shooterVel.z) * t;
    const next = _d.length() / muzzleVel;
    if (!Number.isFinite(next)) return -1;
    t = next;
  }
  const len = _d.length();
  if (len < 1e-6) return -1;
  outDir.copy(_d).multiplyScalar(1 / len);
  return t;
}

/**
 * 기관포 탄도 깔때기 한 점: 지금 쏜 탄이 t 초 뒤 사수 기준(사수와 함께 움직이는 좌표)에서 있을 위치.
 * 카메라도 사수와 함께 움직이므로 현재 카메라로 투영하면 탄 흐름 선이 된다.
 */
export function gunStreamPoint(gunPos: THREE.Vector3, fireDir: THREE.Vector3, muzzleVel: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  out.copy(gunPos).addScaledVector(fireDir, muzzleVel * t);
  out.y -= 0.5 * G0 * t * t;
  return out;
}

export interface BallisticBody {
  massKg: number;
  /** 기준 단면적 (m²) */
  area: number;
  cd0: number;
  /** 활공 날개가 있으면 CCIP 대상 아님 (유도 활공폭탄) */
  glide: boolean;
}

export function ballisticBodyOf(def: WeaponDef): BallisticBody {
  const d = def.body?.diameterM ?? 0.27;
  return {
    massKg: Math.max(1, def.massKg),
    area: (Math.PI * d * d) / 4,
    cd0: def.body?.cd0 ?? 0.3,
    glide: (def.body?.glideRatio ?? 0) > 0,
  };
}

/** CCIP 를 쓰는 무장: 무유도 폭탄류 */
export function isUnguidedBomb(def: WeaponDef | null): boolean {
  if (!def) return false;
  const c = def.category;
  if (c !== 'bomb_dumb' && c !== 'bomb_cluster' && c !== 'nuke') return false;
  return !def.guidance || def.guidance.type === 'none';
}

export interface ImpactOptions {
  /** 적분 간격 (s) */
  dt?: number;
  maxTime?: number;
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _atm: Atmosphere = { rho: 0, temperature: 0, pressure: 0, speedOfSound: 0 };

/**
 * 무유도 낙하체 탄착점 예측 (반암시적 오일러 + 지면 교차 보간).
 * heightAt = 지형 고도 함수. 반환 = 낙하 시간(s), maxTime 안에 지면에 닿지 않으면 -1.
 */
export function predictBombImpact(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  body: BallisticBody,
  heightAt: (x: number, z: number) => number,
  out: THREE.Vector3,
  opts: ImpactOptions = {},
): number {
  const dt = opts.dt ?? 0.1;
  const maxTime = opts.maxTime ?? 90;
  _p.copy(pos);
  _v.copy(vel);
  let ground = heightAt(_p.x, _p.z);
  if (_p.y <= ground) {
    out.set(_p.x, ground, _p.z);
    return 0;
  }
  const k = body.area / body.massKg;
  let t = 0;
  while (t < maxTime) {
    atmosphere(_p.y, _atm);
    const speed = _v.length();
    const mach = speed / _atm.speedOfSound;
    const cd = body.cd0 * (1 + 1.1 * waveDragFactor(mach));
    const dragAcc = 0.5 * _atm.rho * speed * cd * k; // × 속도벡터
    _v.x -= _v.x * dragAcc * dt;
    _v.z -= _v.z * dragAcc * dt;
    _v.y -= (_v.y * dragAcc + G0) * dt;
    const px = _p.x;
    const py = _p.y;
    const pz = _p.z;
    _p.addScaledVector(_v, dt);
    t += dt;
    ground = heightAt(_p.x, _p.z);
    if (_p.y <= ground) {
      // 이전 점과 지면 사이 선형 보간
      const prevGround = heightAt(px, pz);
      const h0 = py - prevGround;
      const h1 = _p.y - ground;
      const f = h0 - h1 > 1e-6 ? h0 / (h0 - h1) : 1;
      out.set(px + (_p.x - px) * f, 0, pz + (_p.z - pz) * f);
      out.y = heightAt(out.x, out.z);
      return t - dt + dt * f;
    }
  }
  return -1;
}
