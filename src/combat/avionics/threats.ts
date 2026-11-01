// RWR/MAW 위협 기록. 센서 주기마다 감지를 기록하고, 매 스텝 방위/거리/충돌시간을 갱신한다.
import * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { Threat } from '../../core/contracts';
import type { Rng } from '../../core/rng';
import { MAW_HOLD_SEC, MAW_RANGE_ERROR, RWR_HOLD_SEC, BEARING_BIAS_PERIOD } from './constants';
import { bodyAngles, makeLocalAngles, wrapDeg180 } from './geometry';

export type ThreatKind = Threat['kind'];

const KIND_RANK: Record<ThreatKind, number> = { search: 0, track: 1, launch: 2, missile: 3 };

export class ThreatRecord implements Threat {
  kind: ThreatKind = 'search';
  source!: Entity;
  bearingDeg = 0;
  elevationDeg = 0;
  rangeM: number | null = null;
  timeToImpact: number | null = null;
  detectedBy: 'rwr' | 'maw' = 'rwr';
  label = '';

  isMissile = false;
  /** 이번 센서 주기에 RWR 이 정한 종류 (재머/레이더 중 높은 쪽) */
  rwrKind: ThreatKind = 'search';
  rwrTick = -1;
  rwrAt = -Infinity;
  mawAt = -Infinity;
  visualAt = -Infinity;
  /** MAW 가 충돌시간을 표시할 수 있음 */
  ttiCapable = false;
  firstAt = 0;
  biasAz = 0;
  biasEl = 0;
  biasAt = -Infinity;
  rangeErr = 1;
  /** 실제 거리/접근율 (경고음 판단용, 표시는 rangeM) */
  trueRange = 0;
  closure = 0;

  reset(source: Entity, now: number): void {
    this.source = source;
    this.kind = 'search';
    this.bearingDeg = 0;
    this.elevationDeg = 0;
    this.rangeM = null;
    this.timeToImpact = null;
    this.detectedBy = 'rwr';
    this.label = '';
    this.isMissile = false;
    this.rwrKind = 'search';
    this.rwrTick = -1;
    this.rwrAt = -Infinity;
    this.mawAt = -Infinity;
    this.visualAt = -Infinity;
    this.ttiCapable = false;
    this.firstAt = now;
    this.biasAz = 0;
    this.biasEl = 0;
    this.biasAt = -Infinity;
    this.rangeErr = 1;
    this.trueRange = 0;
    this.closure = 0;
  }

  mawHeld(now: number): boolean {
    return now - this.mawAt <= MAW_HOLD_SEC || now - this.visualAt <= MAW_HOLD_SEC;
  }

  expired(now: number): boolean {
    return now - this.rwrAt > RWR_HOLD_SEC && !this.mawHeld(now);
  }
}

const _ang = makeLocalAngles();
const _u = new THREE.Vector3();
const _rel = new THREE.Vector3();

export class ThreatBoard {
  readonly list: ThreatRecord[] = [];
  private readonly byId = new Map<number, ThreatRecord>();
  private readonly pool: ThreatRecord[] = [];
  /** 마지막으로 새 방사원(미사일 제외)이 나타난 시각 */
  newEmitterAt = -Infinity;

  get(source: Entity): ThreatRecord | undefined {
    return this.byId.get(source.id);
  }

  private acquire(source: Entity, now: number): ThreatRecord {
    let r = this.byId.get(source.id);
    if (r) return r;
    r = this.pool.pop() ?? new ThreatRecord();
    r.reset(source, now);
    this.byId.set(source.id, r);
    this.list.push(r);
    return r;
  }

  /**
   * RWR 이 방사원(레이더/재머)을 감지. 같은 주기에 여러 번 불리면 높은 종류를 남긴다
   * (레이더 방사를 재머보다 먼저 넣으면 같은 등급일 때 레이더 표시 문자가 남는다).
   */
  rwrEmitter(source: Entity, kind: ThreatKind, label: string, now: number, tick: number, bearingErrDeg: number, rng: Rng): ThreatRecord {
    const fresh = !this.byId.has(source.id);
    const r = this.acquire(source, now);
    if (fresh) this.newEmitterAt = now;
    if (r.rwrTick !== tick || KIND_RANK[kind] > KIND_RANK[r.rwrKind]) {
      r.label = label;
      r.rwrKind = kind;
    }
    r.rwrTick = tick;
    r.rwrAt = now;
    r.kind = r.rwrKind;
    r.detectedBy = 'rwr';
    this.rollBias(r, now, bearingErrDeg, rng);
    return r;
  }

  /** 레이더 시커가 켜진 미사일 (RWR) */
  rwrMissile(source: Entity, now: number, bearingErrDeg: number, rng: Rng): ThreatRecord {
    const r = this.acquire(source, now);
    r.isMissile = true;
    r.kind = 'missile';
    r.label = 'MSL';
    r.rwrAt = now;
    this.rollBias(r, now, bearingErrDeg, rng);
    return r;
  }

  /** MAW (또는 육안) 이 미사일을 감지 */
  mawMissile(source: Entity, now: number, viaVisual: boolean, ttiCapable: boolean, rng: Rng): ThreatRecord {
    const r = this.acquire(source, now);
    r.isMissile = true;
    r.kind = 'missile';
    r.label = 'MSL';
    if (viaVisual) r.visualAt = now;
    else {
      r.mawAt = now;
      r.ttiCapable = ttiCapable;
    }
    if (now - r.biasAt > BEARING_BIAS_PERIOD) {
      // MAW 방위는 정확(수 도), 거리는 대략
      r.biasAz = rng.gaussian() * 2;
      r.biasEl = rng.gaussian() * 1;
      r.rangeErr = 1 + rng.gaussian() * MAW_RANGE_ERROR * (viaVisual ? 3 : 1);
      r.biasAt = now;
    }
    return r;
  }

  private rollBias(r: ThreatRecord, now: number, errDeg: number, rng: Rng): void {
    if (now - r.biasAt <= BEARING_BIAS_PERIOD) return;
    r.biasAz = rng.gaussian() * errDeg;
    r.biasEl = rng.gaussian() * errDeg * 0.5;
    r.biasAt = now;
  }

  /** 만료/파괴된 위협 제거 */
  prune(now: number): void {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const src = r.source;
      const gone = src.removed || !src.alive || r.expired(now);
      if (!gone) list[w++] = r;
      else {
        this.byId.delete(src.id);
        this.pool.push(r);
      }
    }
    list.length = w;
  }

  /** 매 스텝: 방위·고각·거리·충돌시간 갱신 */
  refresh(invQ: THREE.Quaternion, ownerPos: THREE.Vector3, ownerVel: THREE.Vector3, now: number): void {
    for (const r of this.list) {
      const src = r.source;
      bodyAngles(invQ, ownerPos, src.position, _ang);
      r.bearingDeg = wrapDeg180(_ang.az + r.biasAz);
      r.elevationDeg = Math.max(-90, Math.min(90, _ang.el + r.biasEl));
      r.trueRange = _ang.dist;
      if (_ang.dist > 1e-3) {
        _u.subVectors(src.position, ownerPos).divideScalar(_ang.dist);
        _rel.subVectors(src.velocity, ownerVel);
        r.closure = -_rel.dot(_u);
      } else r.closure = 0;

      if (r.isMissile && r.mawHeld(now)) {
        r.detectedBy = 'maw';
        r.rangeM = Math.max(0, _ang.dist * r.rangeErr);
        const mawFresh = now - r.mawAt <= MAW_HOLD_SEC;
        r.timeToImpact = mawFresh && r.ttiCapable && r.closure > 1 ? r.rangeM / r.closure : null;
      } else {
        r.detectedBy = 'rwr';
        r.rangeM = null;
        r.timeToImpact = null;
      }
    }
  }

  /** 소스가 우리를 추적/유도 중 (track/launch) */
  isLockingUs(source: Entity): boolean {
    const r = this.byId.get(source.id);
    return !!r && (r.kind === 'track' || r.kind === 'launch');
  }

  clear(): void {
    for (const r of this.list) this.pool.push(r);
    this.list.length = 0;
    this.byId.clear();
  }
}
