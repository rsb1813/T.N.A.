// 트랙 파일: 센서별 마지막 탐지 시각을 기록하고, 코스팅(외삽)·품질 감쇠·만료를 처리한다.
import * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { Track } from '../../core/contracts';
import { lerp } from '../../core/math';
import { COAST, HOLD, QUALITY } from './constants';

export type TrackSource = Track['source'];

/** ESM(수동 RF) 트랙 유지 시간 */
const ESM_COAST = 4;
const ESM_HOLD = 1.2;
const ESM_QUALITY = 0.35;
/** 사령부 정보는 매 센서 주기 갱신. 태그가 빠지면 이 시간 뒤 사라짐 */
const INTEL_HOLD = 1.0;

/** Track 계약 구현 + 내부 센서 상태. 외부에는 Track 으로만 노출된다 */
export class TrackRecord implements Track {
  entity!: Entity;
  id = 0;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  source: TrackSource = 'radar';
  lastUpdate = 0;
  quality = 0;
  identified = false;
  hostile = false;
  rangeM = 0;

  /** 마지막 정밀 위치 (외삽 기준) */
  readonly basePos = new THREE.Vector3();
  readonly baseVel = new THREE.Vector3();
  baseTime = -Infinity;

  radarAt = -Infinity;
  /** 마지막 레이더 탐지 시 품질 등급 / 유지 / 코스팅 시간 */
  radarQ = 0;
  radarHold = 0;
  radarCoast = 0;
  /** 마지막 레이더 탐지의 50% 탐지거리 (m) */
  radarRangeM = 0;
  /** TWS 트랙 파일 소속 */
  tws = false;
  /** 현재 STT 표적 (아바이오닉스가 매 주기 지정) */
  stt = false;

  irstAt = -Infinity;
  visualAt = -Infinity;
  esmAt = -Infinity;

  datalinkAt = -Infinity;
  datalinkQ = 0;
  /** 데이터링크 원 트랙이 레이더급 정밀도 (협동 교전 가능) */
  datalinkCoop = false;

  /** 사령부 정보 (미션 표적) */
  intelAt = -Infinity;

  /** 표적 순위 계산용 임시값 */
  rankGroup = 0;
  rankKey = 0;

  reset(entity: Entity): void {
    this.entity = entity;
    this.id = entity.id;
    this.position.copy(entity.position);
    this.velocity.copy(entity.velocity);
    this.basePos.copy(entity.position);
    this.baseVel.copy(entity.velocity);
    this.baseTime = -Infinity;
    this.source = 'radar';
    this.lastUpdate = 0;
    this.quality = 0;
    this.identified = false;
    this.hostile = false;
    this.rangeM = 0;
    this.radarAt = -Infinity;
    this.radarQ = 0;
    this.radarHold = 0;
    this.radarCoast = 0;
    this.radarRangeM = 0;
    this.tws = false;
    this.stt = false;
    this.irstAt = -Infinity;
    this.visualAt = -Infinity;
    this.esmAt = -Infinity;
    this.datalinkAt = -Infinity;
    this.datalinkQ = 0;
    this.datalinkCoop = false;
    this.intelAt = -Infinity;
  }

  /** 자기 센서의 정밀 위치 갱신 */
  fixFromEntity(now: number): void {
    this.basePos.copy(this.entity.position);
    this.baseVel.copy(this.entity.velocity);
    this.baseTime = now;
    this.lastUpdate = now;
  }

  /** 자기 센서가 현재 붙잡고 있는가 (데이터링크 위치로 덮어쓰지 않기 위해) */
  ownSensorHeld(now: number): boolean {
    return now - this.radarAt <= this.radarHold || now - this.visualAt <= HOLD.visual || now - this.irstAt <= HOLD.irst;
  }

  /** 외부(데이터링크/ESM) 위치 갱신 */
  fixFrom(pos: THREE.Vector3, vel: THREE.Vector3, now: number): void {
    this.basePos.copy(pos);
    this.baseVel.copy(vel);
    this.baseTime = now;
    if (now > this.lastUpdate) this.lastUpdate = now;
  }

  radarFresh(now: number, window: number): boolean {
    return now - this.radarAt <= window;
  }

  hasIntel(now: number): boolean {
    return now - this.intelAt <= INTEL_HOLD;
  }

  /**
   * 품질/표시 출처/위치를 갱신한다. 모든 센서가 만료되면 false.
   * 붙잡고 있는 센서가 육안·STT·사령부 정보면 실제 위치를, 아니면 마지막 탐지에서 외삽한 위치를 쓴다.
   */
  refresh(now: number, observer: THREE.Vector3): boolean {
    let best = -1;
    let src: TrackSource = this.source;
    let live = false;
    let continuous = false;

    const ra = now - this.radarAt;
    if (ra <= this.radarCoast) {
      live = true;
      const q = decayed(this.radarQ, ra, this.radarHold, this.radarCoast);
      if (q > best) {
        best = q;
        src = 'radar';
      }
      if (this.stt && ra <= HOLD.stt) continuous = true;
    }
    const ia = now - this.irstAt;
    if (ia <= COAST.irst) {
      live = true;
      const q = decayed(QUALITY.irst, ia, HOLD.irst, COAST.irst);
      if (q > best) {
        best = q;
        src = 'irst';
      }
    }
    const va = now - this.visualAt;
    if (va <= COAST.visual) {
      live = true;
      const q = decayed(QUALITY.visual, va, HOLD.visual, COAST.visual);
      if (q > best) {
        best = q;
        src = 'visual';
      }
      if (va <= HOLD.visual) continuous = true;
    }
    const ea = now - this.esmAt;
    if (ea <= ESM_COAST) {
      live = true;
      const q = decayed(ESM_QUALITY, ea, ESM_HOLD, ESM_COAST);
      if (q > best) {
        best = q;
        src = 'radar';
      }
    }
    const da = now - this.datalinkAt;
    if (da <= COAST.datalink) {
      live = true;
      const q = decayed(this.datalinkQ, da, HOLD.datalink, COAST.datalink);
      if (q > best) {
        best = q;
        src = 'datalink';
      }
    }
    if (this.hasIntel(now)) {
      live = true;
      continuous = true;
      if (QUALITY.intel > best) {
        best = QUALITY.intel;
        src = 'datalink';
      }
    }
    if (!live) return false;

    this.quality = best;
    this.source = src;
    if (continuous) {
      this.position.copy(this.entity.position);
      this.velocity.copy(this.entity.velocity);
    } else if (this.baseTime > -Infinity) {
      this.position.copy(this.basePos).addScaledVector(this.baseVel, now - this.baseTime);
      this.velocity.copy(this.baseVel);
    }
    this.rangeM = this.position.distanceTo(observer);
    return true;
  }
}

function decayed(q: number, age: number, hold: number, coast: number): number {
  if (age <= hold) return q;
  const t = coast > hold ? (age - hold) / (coast - hold) : 1;
  return lerp(q, Math.min(q, QUALITY.coastFloor), Math.min(1, t));
}

/** 엔티티 id → TrackRecord. 레코드는 풀에서 재사용한다 */
export class TrackFile {
  readonly list: TrackRecord[] = [];
  private readonly byId = new Map<number, TrackRecord>();
  private readonly pool: TrackRecord[] = [];

  get(e: Entity | null): TrackRecord | undefined {
    return e ? this.byId.get(e.id) : undefined;
  }

  getById(id: number): TrackRecord | undefined {
    return this.byId.get(id);
  }

  acquire(e: Entity): TrackRecord {
    let r = this.byId.get(e.id);
    if (r) return r;
    r = this.pool.pop() ?? new TrackRecord();
    r.reset(e);
    this.byId.set(e.id, r);
    this.list.push(r);
    return r;
  }

  /** keep 이 false 인 레코드를 제거 (순서 유지) */
  compact(keep: (r: TrackRecord) => boolean): void {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (keep(r)) list[w++] = r;
      else {
        this.byId.delete(r.id);
        this.pool.push(r);
      }
    }
    list.length = w;
  }

  clear(): void {
    for (const r of this.list) this.pool.push(r);
    this.list.length = 0;
    this.byId.clear();
  }
}
