// 항공기 항전 시스템 (Avionics 계약 구현).
//   센서: 레이더(off/rws/tws/stt/ag) · IRST · 육안 · 데이터링크(아군 트랙, AWACS) · 사령부 정보(미션 표적)
//   표적 지정(에이스컴뱃식 우선순위/순환/자동 지정) · 무장별 락 · RWR/MAW 위협 · 재머/견인 디코이 · 방사 상태 · 조종석 경고음
// 탐지 판정은 센서 주기(플레이어 10 Hz, AI 5 Hz, 엔티티 id 로 위상 분산)에 하고, 트랙/위협 위치·락 진행은 매 스텝 갱신한다.
import * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { Sim } from '../../core/sim';
import type { Faction, RadarEmission } from '../../core/types';
import { clamp, DEG, lerp, RAD, smoothstep } from '../../core/math';
import {
  isAircraft,
  isMissile,
  type AircraftLike,
  type Avionics,
  type LockState,
  type MissileLike,
  type RadarMode,
  type Stores,
  type Threat,
  type Track,
} from '../../core/contracts';
import type { DerivedStats, RadarStats, WeaponDef } from '../../data/schema';
import {
  AESA_AG_AIR_FACTOR,
  CLOSING_CONE_DEG,
  CLOSING_MIN_MS,
  CYCLE_SESSION_SEC,
  DESIGNATION_CONE_DEG,
  GPS_LOCK_CONE_DEG,
  GPS_LOCK_RANGE_FACTOR,
  HOLD,
  HUD_OFFBORESIGHT_DEG,
  INCOMING_RANGE_M,
  INCOMING_TTI_SEC,
  IRST_ID_RATIO,
  JAMMER_RWR_RANGE_M,
  LOCK_DECAY_RATE,
  LOCK_TIME,
  MAW_AFTERBURN_SEC,
  MODE_RANGE_FACTOR,
  NCTR_RATIO,
  NOTCH_LOW_AGL,
  NOTCH_SEVERITY_MIN,
  PD_CUTOFF_RATIO,
  QUALITY,
  RADAR_FRESH_SCANS,
  RADAR_LOCK_RANGE_FACTOR,
  RWR_HOLD_SEC,
  RWR_NEW_PING_SEC,
  SAR_ID_RATIO,
  SCAN_ELEVATION_DEG,
  SCAN_PERIOD,
  SENSOR_TICK_AI,
  SENSOR_TICK_PLAYER,
  STT_BREAK_SEC,
  COAST,
  VISUAL_AIR_FRONT_M,
  VISUAL_ID_AIR_M,
  VISUAL_ID_GROUND_M,
  VISUAL_MISSILE_M,
} from './constants';
import { bodyAngles, cosNoseToward, makeLocalAngles, shortLabel, worldElevationDeg, type LocalAngles } from './geometry';
import {
  awacsRange,
  clutterRangeFactor,
  detectionProbability,
  groundRadarRange,
  inDopplerNotch,
  irDetectionRange,
  jamCoverageWeight,
  jamRangeFactor,
  lookDownSeverity,
  radarRangeForRcs,
  rcsAspectFactor,
  visualAirRange,
  visualGroundRange,
} from './sensorMath';
import { LosCache } from './losCache';
import { CockpitTones } from './tones';
import { ThreatBoard } from './threats';
import { TowedDecoy } from './towedDecoy';
import { TrackFile, type TrackRecord } from './trackFile';
import { isAirEntity, isAirToGround, lockKindOf, matchesFilter, preferredFilter, weaponMaxRangeM, type LockKind, type TargetFilter } from './weaponClass';

/** 레이더가 특정 표적을 얼마나 보는지 (결정적 계산, 난수 없음) */
export interface RadarAssessment {
  distanceM: number;
  /** 스캔 볼륨(방위 ±azimuthDeg, 고각 ±60°) 안 */
  inVolume: boolean;
  /** 50% 탐지 거리 (자세각·클러터·재밍 반영, m) */
  rangeM: number;
  /** 재밍이 없을 때의 거리 (m) */
  unjammedRangeM: number;
  jammed: boolean;
  /** 하방 클러터 심각도 0..1 */
  clutter: number;
  notched: boolean;
  masked: boolean;
  /** inVolume && !notched && !masked && distance <= rangeM */
  detectable: boolean;
}

function makeAssessment(): RadarAssessment {
  return { distanceM: 0, inVolume: false, rangeM: 0, unjammedRangeM: 0, jammed: false, clutter: 0, notched: false, masked: false, detectable: false };
}

const PHI = 0.6180339887498949;
/** 외부에서 지정한 표적에 트랙이 생길 때까지 기다리는 시간 (s) */
const DESIGNATION_GRACE_SEC = 2;
/** 자동 지정 직후 이 시간 동안은 더 나은 후보가 나타나면 조용히 갈아탄다 (첫 레이더 스캔이 다 돌 때까지) */
const AUTO_SETTLE_SEC = 1.5;
/** lockState() 로 요청한 무장이 선택 무장보다 우선하는 시간 (s) */
const LOCK_REQUEST_SEC = 0.5;
const COS_CLOSING = Math.cos(CLOSING_CONE_DEG * DEG);
const DATALINK_SELF_QUALITY = 0.9;
const AI_REFRESH_STRIDE = 3;

const _invQ = new THREE.Quaternion();
const _invQ2 = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _tFwd = new THREE.Vector3();
const _u = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _raised = new THREE.Vector3();
const _ang = makeLocalAngles();
const _ang2 = makeLocalAngles();

function compareRank(a: TrackRecord, b: TrackRecord): number {
  return a.rankGroup - b.rankGroup || a.rankKey - b.rankKey || a.id - b.id;
}

function inRadarVolume(ang: LocalAngles, radar: RadarStats): boolean {
  return Math.abs(ang.az) <= radar.azimuthDeg && Math.abs(ang.el) <= SCAN_ELEVATION_DEG;
}

/** IR 신호. 애프터버너 중인데 엔티티 값이 갱신되지 않았어도 최소 AB 수준으로 본다 */
function effectiveIr(e: Entity): number {
  let sig = e.irSignature;
  if (isAircraft(e) && e.telemetry?.afterburner) sig = Math.max(sig, 3.4 * (e.stats?.ir ?? 1));
  return sig;
}

function missileBurning(m: MissileLike): boolean {
  if (m.motorBurning) return true;
  const motor = m.def?.motor;
  return !!motor && m.timeOfFlight <= motor.boostSec + motor.sustainSec + MAW_AFTERBURN_SEC;
}

export class AircraftAvionics implements Avionics {
  readonly owner: AircraftLike;
  private readonly sim: Sim;

  /** 표적이 없거나 사라지면 최우선 후보를 자동 지정 (AI 가 직접 고르려면 false) */
  autoDesignate = true;
  /** 공대지 무장을 고르면 레이더를 'ag' 로, 공대공으로 돌아오면 원래 모드로 */
  masterModeAuto = true;
  irstEnabled = true;

  private initialized = false;
  private isShutdown = false;
  private _mode: RadarMode = 'off';
  private searchMode: 'rws' | 'tws' = 'tws';
  private autoStt = false;
  private autoAg = false;
  private sttStartAt = -Infinity;
  private _jammer = false;

  private readonly file = new TrackFile();
  private readonly board = new ThreatBoard();
  private _missileWarning = false;
  private radarMissileWarning = false;

  private designated: Entity | null = null;
  private designatedAt = -Infinity;
  private designatedHadTrack = false;
  /** 현재 지정이 자동 지정이면 그 시작 시각, 사용자/AI 지정이면 -Infinity */
  private autoSince = -Infinity;

  private now = 0;
  private nextTick: number;
  private lastTickAt = -Infinity;
  private tickCount = 0;
  private tickDt = 0;

  private scanPhase = 0;
  private sweepA = 0;
  private sweepB = 0;
  private sweepActive = false;
  private sweepAirFactor = 0;
  private sweepPeriod = 1;

  private lockWeapon: WeaponDef | null = null;
  private requestedWeapon: WeaponDef | null = null;
  private requestedAt = -Infinity;
  private lastSelectedId: string | null = null;
  private lockTargetId = -1;
  private lockProgress = 0;
  private readonly lockOut: LockState = { status: 'none', progress: 0, target: null };
  private readonly noLock: LockState = { status: 'none', progress: 0, target: null };

  private readonly emissionObj: RadarEmission = { mode: 'search', rangeM: 0, azimuthDeg: 0, lpi: 0, trackedIds: [], label: '' };
  private readonly guidedTargetIds: number[] = [];
  private guidedSarh = 0;
  private readonly awacs: Entity[] = [];
  private readonly cands: TrackRecord[] = [];
  private readonly cycleOrder: number[] = [];
  private cycleAt = -Infinity;
  private cycleFilter: TargetFilter = 'any';

  private decoysLeft = 0;
  private decoy: TowedDecoy | null = null;
  private laserCapable = false;

  private readonly tones = new CockpitTones();
  private readonly los = new LosCache();
  private readonly hostileCache = new Map<Faction, boolean>();
  private hostileTick = -1;
  /** 이번 센서 주기에 지상 표적을 볼 수 있는 최대 거리 (m) — 먼 지상 유닛을 각도 계산 전에 거른다 */
  private surfaceReach = 0;
  private offDestroyed: (() => void) | null;
  private readonly scratch = makeAssessment();
  private readonly keepTrack = (r: TrackRecord): boolean => this.keep(r);

  constructor(owner: AircraftLike, sim: Sim) {
    this.owner = owner;
    this.sim = sim;
    this.now = sim.time;
    const phase = (owner.id * PHI) % 1;
    this.nextTick = sim.time + this.tickInterval * phase;
    this.offDestroyed = sim.events.on('destroyed', (p) => {
      if (p.entity !== owner) return;
      this.shutdown(sim);
      this.offDestroyed?.();
      this.offDestroyed = null;
    });
    this.init();
  }

  // ------------------------------------------------------------ 계약 속성

  get radarMode(): RadarMode {
    return this._mode;
  }
  set radarMode(mode: RadarMode) {
    this.setRadarMode(mode);
  }
  get tracks(): ReadonlyArray<Track> {
    return this.file.list;
  }
  get target(): Track | null {
    return this.designated ? (this.file.get(this.designated) ?? null) : null;
  }
  get threats(): ReadonlyArray<Threat> {
    return this.board.list;
  }
  get missileWarning(): boolean {
    return this._missileWarning;
  }
  get jammerActive(): boolean {
    return this._jammer;
  }
  set jammerActive(on: boolean) {
    this._jammer = on && !!this.stats?.ew;
  }

  // ------------------------------------------------------------ 추가 공개 정보 (HUD/AI/무장용)

  /** 지정 엔티티 (트랙이 아직 없어도) */
  get designatedEntity(): Entity | null {
    return this.designated;
  }
  get towedDecoysRemaining(): number {
    return this.decoysLeft;
  }
  get towedDecoyDeployed(): boolean {
    return !!this.decoy && !this.decoy.removed && this.decoy.alive;
  }
  get hasRadar(): boolean {
    return !!this.stats?.radar;
  }
  get hasJammer(): boolean {
    return !!this.stats?.ew;
  }
  /** 현재 모드의 공칭 탐지거리 (m): 공중 모드는 5 m², 지상 모드는 10 m² 표적 기준. off 면 0 */
  get radarRangeM(): number {
    const radar = this.stats?.radar;
    if (!radar || this._mode === 'off') return 0;
    if (this._mode === 'ag') return groundRadarRange(radar.groundModes, 10);
    return radar.rangeKm * 1000 * MODE_RANGE_FACTOR[this._mode];
  }
  /** 레이더 빔 현재 방위 (deg, 기수 기준). 스캔 중이 아니면 null — HUD 레이더 화면 연출용 */
  get scanAzimuthDeg(): number | null {
    const radar = this.stats?.radar;
    if (!radar || !this.sweepActive) return null;
    return -radar.azimuthDeg + 2 * radar.azimuthDeg * this.scanPhase;
  }
  /** 이 엔티티의 트랙 (없으면 null) */
  trackOf(entity: Entity): Track | null {
    return this.file.get(entity) ?? null;
  }
  /** STT 로 이 표적을 비추는 중 (반능동 미사일 유도 조건) */
  isIlluminating(entity: Entity): boolean {
    if (this._mode !== 'stt' || this.designated !== entity) return false;
    const rec = this.file.get(entity);
    return !!rec && rec.radarFresh(this.now, STT_BREAK_SEC);
  }

  // ------------------------------------------------------------ 갱신

  private get stats(): DerivedStats | undefined {
    return this.owner.stats as DerivedStats | undefined;
  }

  private get tickInterval(): number {
    return this.owner.isPlayer ? SENSOR_TICK_PLAYER : SENSOR_TICK_AI;
  }

  private init(): void {
    const st = this.stats;
    if (!st) return;
    this.initialized = true;
    this._mode = st.radar ? 'tws' : 'off';
    this.searchMode = 'tws';
    this.decoysLeft = Math.max(0, Math.floor(st.ew?.towedDecoys ?? 0));
    this.laserCapable = this.computeLaserCapable();
  }

  update(dt: number, sim: Sim): void {
    this.now = sim.time;
    if (!this.initialized) {
      this.init();
      if (!this.initialized) return;
    }
    const o = this.owner;
    if (!o.alive || o.removed) {
      this.shutdown(sim);
      return;
    }
    this.isShutdown = false;
    this.syncSelection();
    if (this.now + 1e-9 >= this.nextTick) {
      const interval = this.tickInterval;
      this.tickDt = this.lastTickAt === -Infinity ? interval : Math.min(1, this.now - this.lastTickAt);
      this.lastTickAt = this.now;
      this.nextTick = Math.max(this.nextTick + interval, this.now + interval * 0.5);
      this.tick(sim);
    }
    this.step(dt, sim);
  }

  /** 선택 무장 변화 → 마스터 모드(레이더 자동 전환), 락 대상 무장 */
  private syncSelection(): void {
    const stores = this.owner.stores as Stores | undefined;
    const sel = stores?.selectedDef?.() ?? null;
    const selId = sel?.id ?? null;
    if (selId !== this.lastSelectedId) {
      this.lastSelectedId = selId;
      if (this.masterModeAuto && this.stats?.radar) {
        if (isAirToGround(sel)) {
          if (this._mode === 'rws' || this._mode === 'tws' || this._mode === 'stt') {
            this.leaveStt();
            this._mode = 'ag';
            this.autoAg = true;
          }
        } else if (this._mode === 'ag' && this.autoAg) {
          this._mode = this.searchMode;
          this.autoAg = false;
        }
      }
    }
    const req = this.now - this.requestedAt <= LOCK_REQUEST_SEC ? this.requestedWeapon : null;
    const w = req ?? sel;
    if ((w?.id ?? null) !== (this.lockWeapon?.id ?? null)) {
      this.lockWeapon = w;
      this.lockProgress = 0;
      this.lockTargetId = -1;
    }
  }

  private tick(sim: Sim): void {
    const o = this.owner;
    const st = this.stats!;
    const now = this.now;
    this.tickCount++;
    _invQ.copy(o.quaternion).invert();
    this.computeSweep();
    this.guidedTargetIds.length = 0;
    this.guidedSarh = 0;
    this.awacs.length = 0;
    this.laserCapable = this.computeLaserCapable();
    const lockKind = lockKindOf(this.lockWeapon);
    const esm = lockKind === 'arm' && !!st.rwr;
    this.surfaceReach = Math.max(visualGroundRange(1e6), st.radar && this._mode === 'ag' ? groundRadarRange(st.radar.groundModes, 1e9) * PD_CUTOFF_RATIO : 0);

    const ents = sim.world.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e === o || e.removed || !e.alive) continue;
      if (isMissile(e)) this.scanMissile(e, sim, now);
      else if (e.kind === 'aircraft') this.scanAir(e, sim, now);
      else if (e.kind === 'ground' || e.kind === 'ship' || e.kind === 'structure') this.scanSurface(e, sim, now, esm);
    }
    if (this.awacs.length > 0 && st.datalink) this.scanAwacs(sim, now);

    this.finalizeTracks(now);
    this.board.prune(now);
    this.updateWarnings(now);
    this.maintainStt(now, lockKind);
    this.updateEmission();
    this.manageDecoy(sim);
  }

  private step(dt: number, sim: Sim): void {
    const o = this.owner;
    const now = this.now;
    // 트랙 외삽/위협 방위: 플레이어는 매 스텝(HUD), AI 는 3 스텝마다(엔티티별로 분산)
    if (o.isPlayer || (sim.frame + o.id) % AI_REFRESH_STRIDE === 0) {
      this.file.compact(this.keepTrack);
      _invQ.copy(o.quaternion).invert();
      this.board.prune(now);
      this.board.refresh(_invQ, o.position, o.velocity, now);
      this.updateWarnings(now);
    }
    this.maintainDesignation();
    this.updateLock(dt, sim);
    if (o.isPlayer) this.updateTones(sim);
  }

  // ------------------------------------------------------------ 스캔

  private computeSweep(): void {
    const radar = this.stats?.radar;
    const mode = this._mode;
    this.sweepActive = false;
    this.sweepAirFactor = 0;
    if (!radar || mode === 'off') return;
    let period: number;
    if (mode === 'rws' || mode === 'tws' || mode === 'ag') {
      period = SCAN_PERIOD[mode];
      this.sweepAirFactor = mode === 'ag' ? (radar.type === 'AESA' ? AESA_AG_AIR_FACTOR : 0) : MODE_RANGE_FACTOR[mode];
    } else if (mode === 'stt' && radar.type !== 'PD') {
      // AESA 는 STT 중에도 탐색을 끼워 넣고, PESA 는 절반 속도로. PD 는 STT 표적만 본다
      period = SCAN_PERIOD.tws * (radar.type === 'AESA' ? 1 : 2);
      this.sweepAirFactor = MODE_RANGE_FACTOR.tws;
    } else return;
    this.sweepPeriod = period;
    this.sweepA = this.scanPhase;
    this.sweepB = this.scanPhase + this.tickDt / period;
    this.scanPhase = this.sweepB % 1;
    this.sweepActive = true;
  }

  /** 이번 주기에 빔이 이 방위를 지나갔는가 (단방향 래스터 스캔) */
  private inSweep(az: number, azLimit: number): boolean {
    if (!this.sweepActive) return false;
    const a = this.sweepA;
    const b = this.sweepB;
    if (b - a >= 1) return true;
    const u = Math.min(0.999999, Math.max(0, (az + azLimit) / (2 * azLimit)));
    return (u >= a && u < b) || (b > 1 && u < b - 1);
  }

  /** 소유기 → 엔티티 시선 (캐시). 지상/함정/건물은 바닥이 아니라 조금 위를 본다 */
  private losTo(sim: Sim, e: Entity, dist: number): boolean {
    let p = e.position;
    if (e.kind === 'ground' || e.kind === 'ship' || e.kind === 'structure') {
      p = _raised.copy(e.position);
      p.y += Math.max(2, e.radius * 0.5);
    }
    return this.los.check(sim.services.terrain, this.owner.position, e, p, dist, this.now);
  }

  /** 적대 판정 (세력별로 센서 주기마다 캐시 — Relations.isHostile 은 호출마다 문자열 키를 만든다) */
  private hostileTo(sim: Sim, e: Entity): boolean {
    const f = e.faction;
    if (this.hostileTick !== this.tickCount) {
      this.hostileTick = this.tickCount;
      this.hostileCache.clear();
    }
    let h = this.hostileCache.get(f);
    if (h === undefined) {
      h = sim.relations.isHostile(this.owner.faction, f);
      this.hostileCache.set(f, h);
    }
    return h;
  }

  private scanAir(e: Entity, sim: Sim, now: number): void {
    const o = this.owner;
    const st = this.stats!;
    const hostile = this.hostileTo(sim, e);
    const friendly = e.faction === o.faction;
    const tagged = e.tags.has('target');
    const ang = bodyAngles(_invQ, o.position, e.position, _ang);
    const dist = ang.dist;
    let los: boolean | null = null;
    let rec: TrackRecord | undefined;

    // 육안 (게임플레이 하한선)
    if (dist <= visualAirRange(Math.cos(ang.off * DEG), e.radius)) {
      los = this.losTo(sim, e, dist);
      if (los) {
        rec = this.file.acquire(e);
        rec.visualAt = now;
        rec.fixFromEntity(now);
        this.mark(rec, hostile || tagged, friendly || dist <= VISUAL_ID_AIR_M);
      }
    }

    // 레이더
    const radar = st.radar;
    if (radar && this._mode !== 'off') {
      const isStt = this._mode === 'stt' && e === this.designated;
      const factor = isStt ? MODE_RANGE_FACTOR.stt : this.sweepAirFactor > 0 && this.inSweep(ang.az, radar.azimuthDeg) ? this.sweepAirFactor : 0;
      if (factor > 0 && inRadarVolume(ang, radar)) {
        const a = this.assess(e, sim, factor, ang, los, this.scratch);
        if (a.inVolume && !a.notched && !a.masked && dist <= a.rangeM * PD_CUTOFF_RATIO) {
          los = true;
          if (sim.rng.next() < detectionProbability(dist / a.rangeM)) {
            rec ??= this.file.acquire(e);
            rec.radarAt = now;
            rec.radarRangeM = a.rangeM;
            rec.fixFromEntity(now);
            this.mark(rec, hostile || tagged, friendly || dist <= NCTR_RATIO * a.rangeM);
          }
        } else if (a.masked) los = false;
      }
    }

    // IRST (수동)
    const irst = st.irst;
    if (irst && this.irstEnabled && Math.abs(ang.az) <= irst.fovDeg && Math.abs(ang.el) <= Math.min(irst.fovDeg, SCAN_ELEVATION_DEG)) {
      e.getForward(_tFwd);
      const cosNose = cosNoseToward(e.position, _tFwd, o.position);
      const sev = lookDownSeverity(worldElevationDeg(o.position, e.position), this.aglOf(sim, e));
      const R = irDetectionRange(irst.rangeKm, effectiveIr(e), cosNose, sev);
      if (dist <= R * PD_CUTOFF_RATIO) {
        if (los === null) los = this.losTo(sim, e, dist);
        if (los && sim.rng.next() < detectionProbability(dist / R)) {
          rec ??= this.file.acquire(e);
          rec.irstAt = now;
          rec.fixFromEntity(now);
          this.mark(rec, hostile || tagged, friendly || dist <= IRST_ID_RATIO * R);
        }
      }
    }

    if (friendly) {
      if (isAircraft(e)) this.mergePeer(e, sim, dist, now);
      if (e.tags.has('awacs')) this.awacs.push(e);
    }
    if (hostile) {
      if (e.emission) this.rwrEmitter(e, sim, now, dist);
      if (isAircraft(e) && e.avionics?.jammerActive && e.stats?.ew) this.rwrJammer(e, sim, now, dist);
    }
    if (tagged && o.isPlayer) this.intel(e, now);
  }

  private scanSurface(e: Entity, sim: Sim, now: number, esm: boolean): void {
    const o = this.owner;
    const st = this.stats!;
    if (e.faction === o.faction) {
      if (e.tags.has('awacs')) this.awacs.push(e);
      return;
    }
    const tagged = e.tags.has('target');
    const reach = this.surfaceReach;
    if (!e.emission && !(tagged && o.isPlayer) && o.position.distanceToSquared(e.position) > reach * reach) return;
    const hostile = this.hostileTo(sim, e);
    const ang = bodyAngles(_invQ, o.position, e.position, _ang);
    const dist = ang.dist;
    let los: boolean | null = null;
    let rec: TrackRecord | undefined;

    if (dist <= visualGroundRange(e.radius)) {
      los = this.losTo(sim, e, dist);
      if (los) {
        rec = this.file.acquire(e);
        rec.visualAt = now;
        rec.fixFromEntity(now);
        this.mark(rec, hostile || tagged, dist <= VISUAL_ID_GROUND_M);
      }
    }

    const radar = st.radar;
    if (radar && this._mode === 'ag' && inRadarVolume(ang, radar) && this.inSweep(ang.az, radar.azimuthDeg)) {
      const R = groundRadarRange(radar.groundModes, e.rcs);
      if (dist <= R * PD_CUTOFF_RATIO) {
        if (los === null) los = this.losTo(sim, e, dist);
        if (los && sim.rng.next() < detectionProbability(dist / R)) {
          rec ??= this.file.acquire(e);
          rec.radarAt = now;
          rec.radarRangeM = R;
          rec.fixFromEntity(now);
          this.mark(rec, hostile || tagged, radar.groundModes && dist <= SAR_ID_RATIO * R);
        }
      }
    }

    if (hostile && e.emission && this.rwrEmitter(e, sim, now, dist) && esm) {
      // ARM 선택 중: RWR/ESM 이 방사원 위치를 트랙으로 제공
      rec ??= this.file.acquire(e);
      rec.esmAt = now;
      if (!rec.ownSensorHeld(now)) rec.fixFrom(e.position, e.velocity, now);
      this.mark(rec, true, !!st.rwr?.identify);
    }
    if (tagged && o.isPlayer) this.intel(e, now);
  }

  private scanMissile(m: MissileLike, sim: Sim, now: number): void {
    const o = this.owner;
    if (m.shooter === o) {
      const t = m.target;
      if (t && (m.guidanceType === 'sarh' || (m.guidanceType === 'active_radar' && !!m.def?.guidance?.datalink && !m.seekerActive))) {
        if (!this.guidedTargetIds.includes(t.id)) this.guidedTargetIds.push(t.id);
        if (m.guidanceType === 'sarh') this.guidedSarh++;
      }
      return;
    }
    if (m.tags.has('target')) this.scanAir(m, sim, now);
    if (!this.hostileTo(sim, m)) return;
    const st = this.stats!;
    const rwr = st.rwr;
    if (rwr && m.seekerActive && m.target === o) this.board.rwrMissile(m, now, rwr.bearingErrorDeg, sim.rng);

    _u.subVectors(m.position, o.position);
    const d = _u.length();
    if (d > 1e-3) _u.divideScalar(d);
    _rel.subVectors(m.velocity, o.velocity);
    const rangeRate = _rel.dot(_u);
    const ms = m.velocity.length();
    const closing = d <= 1e-3 || (rangeRate < -CLOSING_MIN_MS && ms > 1 && -m.velocity.dot(_u) >= COS_CLOSING * ms);
    if (!closing) return;

    const maw = st.maw;
    if (maw && d <= maw.rangeKm * 1000 && missileBurning(m) && this.mawCovers(maw.coverage)) {
      this.board.mawMissile(m, now, false, maw.timeToImpact, sim.rng);
    } else if (d <= VISUAL_MISSILE_M) {
      this.board.mawMissile(m, now, true, false, sim.rng);
    }
  }

  /** _u = 소유기 → 미사일 단위벡터 기준 */
  private mawCovers(coverage: 'full' | 'rear'): boolean {
    if (coverage === 'full') return true;
    this.owner.getForward(_fwd);
    return _fwd.dot(_u) < 0;
  }

  private rwrEmitter(e: Entity, sim: Sim, now: number, dist: number): boolean {
    const rwr = this.stats?.rwr;
    const em = e.emission;
    if (!rwr || !em || em.mode === 'seeker') return false;
    const o = this.owner;
    const tracked = em.trackedIds.includes(o.id);
    const pointed = (em.mode === 'track' || em.mode === 'guidance') && tracked;
    const lpiPen = Math.max(0, em.lpi - rwr.lpiDetect) * (pointed ? 0.5 : 1);
    if (dist > em.rangeM * 1.5 * (1 - 0.5 * lpiPen)) return false;
    if (!pointed) {
      // STT 빔이 다른 표적을 향하면 조사되지 않는다
      if (em.mode === 'track') return false;
      if (em.azimuthDeg < 180) {
        e.getForward(_tFwd);
        const c = cosNoseToward(e.position, _tFwd, o.position);
        if (Math.acos(clamp(c, -1, 1)) * RAD > em.azimuthDeg) return false;
      }
    }
    if (!this.losTo(sim, e, dist)) return false;
    if (lpiPen > 0) {
      // 1초 안에 잡힐 확률 pScan 을 센서 주기당 확률로 환산. 작은 LPI 차이는 무시, 큰 차이는 거의 안 잡힘
      const pScan = 1 - 0.92 * smoothstep(0.1, 0.7, lpiPen);
      const pTick = 1 - Math.pow(1 - pScan, this.tickDt);
      if (!sim.rng.chance(pTick)) return false;
    }
    const kind = pointed ? (em.mode === 'guidance' && rwr.launchWarning ? 'launch' : 'track') : 'search';
    this.board.rwrEmitter(e, kind, rwr.identify ? em.label : 'U', now, this.tickCount, rwr.bearingErrorDeg, sim.rng);
    return true;
  }

  private rwrJammer(e: AircraftLike, sim: Sim, now: number, dist: number): void {
    const rwr = this.stats?.rwr;
    const ew = e.stats.ew;
    if (!rwr || !ew || dist > JAMMER_RWR_RANGE_M) return;
    e.getForward(_tFwd);
    const c = cosNoseToward(e.position, _tFwd, this.owner.position);
    if (jamCoverageWeight(Math.acos(clamp(c, -1, 1)) * RAD, ew.coverageDeg) <= 0) return;
    if (!this.losTo(sim, e, dist)) return;
    this.board.rwrEmitter(e, 'search', 'J', now, this.tickCount, rwr.bearingErrorDeg, sim.rng);
  }

  private mergePeer(peer: AircraftLike, sim: Sim, dist: number, now: number): void {
    const dl = this.stats?.datalink;
    if (!dl || !peer.stats?.datalink || dist > dl.rangeKm * 1000) return;
    // 아군 자기 위치 방송 (PPLI)
    const self = this.file.acquire(peer);
    self.datalinkAt = now;
    self.datalinkQ = DATALINK_SELF_QUALITY;
    self.datalinkCoop = false;
    this.mark(self, false, true);
    if (!self.ownSensorHeld(now)) self.fixFrom(peer.position, peer.velocity, now);
    if (!dl.shareTracks) return;
    const shared = peer.avionics?.tracks;
    if (!shared) return;
    for (let i = 0; i < shared.length; i++) {
      const t = shared[i];
      // 자기 센서로 잡은 트랙만 받는다 (데이터링크로 받은 걸 되돌려 주는 반향 방지)
      if (t.source === 'datalink') continue;
      const te = t.entity;
      if (te === this.owner || te.removed || !te.alive) continue;
      const rec = this.file.acquire(te);
      const q = t.quality * QUALITY.datalinkPeer;
      if (rec.datalinkAt !== now) {
        rec.datalinkQ = q;
        rec.datalinkCoop = t.source === 'radar';
      } else {
        rec.datalinkQ = Math.max(rec.datalinkQ, q);
        rec.datalinkCoop ||= t.source === 'radar';
      }
      rec.datalinkAt = now;
      const friendly = te.faction === this.owner.faction;
      this.mark(rec, this.hostileTo(sim, te) || te.tags.has('target'), friendly || t.identified);
      if (!rec.ownSensorHeld(now)) rec.fixFrom(t.position, t.velocity, now);
    }
  }

  private scanAwacs(sim: Sim, now: number): void {
    const ents = sim.world.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e === this.owner || e.removed || !e.alive || e.kind !== 'aircraft' || !this.hostileTo(sim, e)) continue;
      const R = awacsRange(e.rcs);
      for (const a of this.awacs) {
        if (a.removed || !a.alive || e.position.distanceToSquared(a.position) > R * R) continue;
        const rec = this.file.acquire(e);
        if (rec.datalinkAt !== now || rec.datalinkQ < QUALITY.awacs) rec.datalinkQ = QUALITY.awacs;
        rec.datalinkAt = now;
        rec.datalinkCoop = true;
        this.mark(rec, true, true);
        if (!rec.ownSensorHeld(now)) rec.fixFrom(e.position, e.velocity, now);
        break;
      }
    }
  }

  /** 사령부 정보: 미션 표적은 항상 저품질 데이터링크 트랙 (TGT 표시용) */
  private intel(e: Entity, now: number): void {
    const rec = this.file.acquire(e);
    rec.intelAt = now;
    if (rec.lastUpdate < now) rec.lastUpdate = now;
    this.mark(rec, true, true);
  }

  private mark(rec: TrackRecord, hostile: boolean, identified: boolean): void {
    rec.hostile = hostile;
    if (identified) rec.identified = true;
  }

  private aglOf(sim: Sim, e: Entity): number {
    return e.position.y - sim.services.terrain.heightAt(e.position.x, e.position.z);
  }

  /**
   * 레이더 판정 (결정적). los = 이미 알고 있는 시선 결과(null 이면 필요할 때 계산).
   * 반환 객체는 out (재사용).
   */
  private assess(e: Entity, sim: Sim, factor: number, ang: LocalAngles, los: boolean | null, out: RadarAssessment): RadarAssessment {
    const o = this.owner;
    const radar = this.stats!.radar!;
    out.distanceM = ang.dist;
    out.inVolume = inRadarVolume(ang, radar);
    e.getForward(_tFwd);
    const cosNose = cosNoseToward(e.position, _tFwd, o.position);
    let R = radarRangeForRcs(radar.rangeKm, e.rcs * rcsAspectFactor(e.rcs, cosNose)) * factor;
    const agl = this.aglOf(sim, e);
    const sev = lookDownSeverity(worldElevationDeg(o.position, e.position), agl);
    out.clutter = sev;
    R *= clutterRangeFactor(radar.type, sev);
    out.unjammedRangeM = R;
    out.jammed = false;
    if (isAircraft(e) && e.avionics?.jammerActive && e.stats?.ew) {
      const ew = e.stats.ew;
      const w = jamCoverageWeight(Math.acos(clamp(cosNose, -1, 1)) * RAD, ew.coverageDeg);
      if (w > 0) {
        R *= jamRangeFactor(ew.jamPower, radar.eccm, w);
        out.jammed = true;
      }
    }
    out.rangeM = R;
    out.notched = false;
    if (sev > NOTCH_SEVERITY_MIN || agl < NOTCH_LOW_AGL) {
      _u.subVectors(e.position, o.position);
      const len = _u.length();
      if (len > 1e-3) out.notched = inDopplerNotch(radar.type, e.velocity.dot(_u) / len);
    }
    out.masked = false;
    if (out.inVolume && !out.notched && ang.dist <= R * PD_CUTOFF_RATIO) {
      out.masked = !(los ?? this.losTo(sim, e, ang.dist));
    }
    out.detectable = out.inVolume && !out.notched && !out.masked && ang.dist <= R;
    return out;
  }

  /**
   * 현재 레이더 모드로 이 표적을 얼마나 보는지 (HUD/AI/디버그용, 난수 없음).
   * 레이더가 없거나 꺼져 있으면 rangeM = 0.
   */
  assessRadar(e: Entity, sim: Sim, out: RadarAssessment = makeAssessment()): RadarAssessment {
    const radar = this.stats?.radar;
    _invQ2.copy(this.owner.quaternion).invert();
    const ang = bodyAngles(_invQ2, this.owner.position, e.position, _ang2);
    let factor = 0;
    if (radar && this._mode !== 'off') {
      if (this._mode === 'stt') factor = e === this.designated ? MODE_RANGE_FACTOR.stt : radar.type === 'PD' ? 0 : MODE_RANGE_FACTOR.tws;
      else if (this._mode === 'ag') factor = radar.type === 'AESA' ? AESA_AG_AIR_FACTOR : 0;
      else factor = MODE_RANGE_FACTOR[this._mode];
    }
    if (!radar || factor === 0) {
      Object.assign(out, makeAssessment());
      out.distanceM = ang.dist;
      return out;
    }
    return this.assess(e, sim, factor, ang, null, out);
  }

  // ------------------------------------------------------------ 트랙 정리

  private finalizeTracks(now: number): void {
    const radar = this.stats?.radar ?? null;
    const mode = this._mode;
    const twsLike = !!radar && (mode === 'tws' || (mode === 'stt' && radar.type !== 'PD'));
    const maxTracks = radar?.maxTracks ?? 0;
    let fileCount = 0;
    const list = this.file.list;
    for (const r of list) {
      if (twsLike && r.tws && now - r.radarAt <= COAST.tws) fileCount++;
      else r.tws = false;
    }
    const scanHold = this.sweepPeriod * 1.5;
    for (const r of list) {
      r.stt = mode === 'stt' && r.entity === this.designated;
      if (r.radarAt !== now) continue;
      if (r.stt) {
        r.radarQ = QUALITY.stt;
        r.radarHold = HOLD.stt;
        r.radarCoast = COAST.stt;
      } else if (mode === 'ag') {
        r.radarQ = isAirEntity(r.entity) ? QUALITY.rws : QUALITY.ag;
        r.radarHold = scanHold;
        r.radarCoast = COAST.ag;
      } else if (twsLike) {
        if (!r.tws && (fileCount < maxTracks || r.entity === this.designated)) {
          r.tws = true;
          fileCount++;
        }
        r.radarQ = r.tws ? QUALITY.tws : QUALITY.rws;
        r.radarHold = scanHold;
        r.radarCoast = r.tws ? COAST.tws : COAST.rws;
      } else {
        r.radarQ = QUALITY.rws;
        r.radarHold = scanHold;
        r.radarCoast = COAST.rws;
      }
    }
    this.file.compact(this.keepTrack);
  }

  private keep(r: TrackRecord): boolean {
    const e = r.entity;
    if (e.removed || !e.alive) return false;
    r.stt = this._mode === 'stt' && e === this.designated;
    return r.refresh(this.now, this.owner.position);
  }

  private radarFreshWindow(r: TrackRecord): number {
    if (r.stt) return STT_BREAK_SEC;
    return this.sweepPeriod * RADAR_FRESH_SCANS;
  }

  isTracked(entity: Entity): boolean {
    const r = this.file.get(entity);
    if (!r) return false;
    const st = this.stats;
    if (st?.radar && this._mode !== 'off' && r.radarFresh(this.now, this.radarFreshWindow(r))) return true;
    return !!st?.datalink?.cooperativeEngagement && r.datalinkCoop && this.now - r.datalinkAt <= HOLD.datalink;
  }

  // ------------------------------------------------------------ 위협 / 방사 / 디코이

  private updateWarnings(now: number): void {
    let mw = false;
    let radarMw = false;
    for (const r of this.board.list) {
      if (r.kind === 'launch') {
        mw = true;
        radarMw = true;
      } else if (r.kind === 'missile') {
        mw = true;
        if (now - r.rwrAt <= RWR_HOLD_SEC) radarMw = true;
      }
    }
    this._missileWarning = mw;
    this.radarMissileWarning = radarMw;
  }

  private updateEmission(): void {
    const o = this.owner;
    const radar = this.stats?.radar;
    if (!radar || this._mode === 'off') {
      o.emission = null;
      return;
    }
    const em = this.emissionObj;
    em.label = shortLabel(o.def?.name ?? o.name);
    em.lpi = radar.lpi;
    em.azimuthDeg = radar.azimuthDeg;
    em.rangeM = this._mode === 'ag' ? groundRadarRange(radar.groundModes, 10) : radar.rangeKm * 1000 * MODE_RANGE_FACTOR[this._mode];
    const ids = em.trackedIds;
    ids.length = 0;
    em.mode = 'search';
    if (this._mode !== 'ag') {
      for (const id of this.guidedTargetIds) {
        const r = this.file.getById(id);
        if (r && this.isTracked(r.entity)) ids.push(id);
      }
      const d = this.designated;
      if (ids.length > 0) {
        em.mode = 'guidance';
        if (this._mode === 'stt' && d && !ids.includes(d.id)) ids.push(d.id);
      } else if (d && (this._mode === 'stt' || this.radarLockActive())) {
        em.mode = 'track';
        ids.push(d.id);
      } else if (this._mode === 'tws') {
        for (const r of this.file.list) if (r.tws) ids.push(r.id);
      }
    }
    o.emission = em;
  }

  /** 레이더 무장으로 지정 표적에 락을 거는 중 (TWS 에서도 상대 RWR 에 추적으로 보인다) */
  private radarLockActive(): boolean {
    const k = lockKindOf(this.lockWeapon);
    const s = this.lockOut.status;
    return (k === 'radar' || k === 'sarh') && (s === 'locking' || s === 'locked') && this.lockOut.target === this.designated;
  }

  private manageDecoy(sim: Sim): void {
    if (this.decoy && (this.decoy.removed || !this.decoy.alive)) this.decoy = null;
    if (!this.decoy && this.decoysLeft > 0 && this.radarMissileWarning) {
      const d = new TowedDecoy(this.owner);
      sim.world.add(d, sim);
      this.decoy = d;
      this.decoysLeft--;
    }
  }

  private computeLaserCapable(): boolean {
    const stations = this.owner.loadout?.stations;
    const weapons = this.sim.db?.weapons;
    if (!stations || !weapons) return false;
    for (const id in stations) {
      const load = stations[id];
      if (load && load.count > 0 && weapons[load.weaponId]?.pod?.laserDesignator) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ 레이더 모드

  setRadarMode(mode: RadarMode): void {
    const radar = this.stats?.radar;
    if (!radar) {
      this._mode = 'off';
      return;
    }
    if (mode === this._mode) return;
    if (mode === 'stt') {
      this.enterStt(false);
      return;
    }
    if (mode === 'rws' || mode === 'tws') this.searchMode = mode;
    if (mode === 'ag') this.autoAg = false;
    this.autoStt = false;
    this._mode = mode;
  }

  /** 지정 표적이 스캔 볼륨 안이면 STT. 획득은 다음 주기부터, STT_BREAK_SEC 안에 탐지 못 하면 해제 */
  private enterStt(auto: boolean): boolean {
    const radar = this.stats?.radar;
    const d = this.designated;
    if (!radar || !d || this._mode === 'stt') return this._mode === 'stt';
    _invQ2.copy(this.owner.quaternion).invert();
    if (!inRadarVolume(bodyAngles(_invQ2, this.owner.position, d.position, _ang2), radar)) return false;
    if (this._mode === 'rws' || this._mode === 'tws') this.searchMode = this._mode;
    this._mode = 'stt';
    this.autoStt = auto;
    this.autoAg = false;
    this.sttStartAt = this.now;
    return true;
  }

  private leaveStt(): void {
    if (this._mode !== 'stt') return;
    this._mode = this.searchMode;
    this.autoStt = false;
  }

  private maintainStt(now: number, lockKind: LockKind): void {
    if (this._mode !== 'stt') return;
    const radar = this.stats?.radar;
    const d = this.designated;
    const r = this.file.get(d);
    let ok = !!radar && !!d && !!r && d.alive;
    if (ok) {
      _invQ2.copy(this.owner.quaternion).invert();
      ok = inRadarVolume(bodyAngles(_invQ2, this.owner.position, d!.position, _ang2), radar!);
    }
    if (ok) ok = now - Math.max(r!.radarAt, this.sttStartAt) <= STT_BREAK_SEC;
    if (!ok || (this.autoStt && lockKind !== 'sarh' && this.guidedSarh === 0)) this.leaveStt();
  }

  // ------------------------------------------------------------ 표적 지정

  designate(entity: Entity | null): void {
    this.autoSince = -Infinity;
    this.setDesignated(entity);
  }

  private setDesignated(e: Entity | null, sound = true): void {
    if (e === this.designated) return;
    this.designated = e;
    this.designatedAt = this.now;
    this.designatedHadTrack = !!this.file.get(e);
    this.lockProgress = 0;
    this.lockTargetId = -1;
    if (this._mode === 'stt') this.sttStartAt = this.now;
    if (this.owner.isPlayer) {
      this.sim.events.emit('targetChanged', { entity: e });
      if (e && sound) this.sim.services.audio.play('target_switch');
    }
  }

  private maintainDesignation(): void {
    let d = this.designated;
    if (d && (d.removed || !d.alive)) {
      this.setDesignated(null);
      d = null;
    }
    const rec = this.file.get(d);
    if (rec) this.designatedHadTrack = true;
    if (!this.autoDesignate) return;
    const lost = !!d && !rec && (this.designatedHadTrack || this.now - this.designatedAt > DESIGNATION_GRACE_SEC);
    if (!d || lost) {
      const best = this.pickBest(preferredFilter(this.lockWeapon));
      if (best !== d) {
        this.autoSince = best ? this.now : -Infinity;
        this.setDesignated(best);
      }
    } else if (this.now - this.autoSince < AUTO_SETTLE_SEC) {
      const best = this.pickBest(preferredFilter(this.lockWeapon));
      if (best && best !== d) this.setDesignated(best, false);
    }
  }

  /** 후보 수집: 적대·생존 트랙. filter 에 맞는 게 없으면 전체로 대체 */
  private collectCandidates(filter: TargetFilter): TrackRecord[] {
    const c = this.cands;
    c.length = 0;
    for (const r of this.file.list) {
      if (r.hostile && r.entity.alive && !r.entity.removed && matchesFilter(r.entity, filter)) c.push(r);
    }
    if (c.length === 0 && filter !== 'any') {
      for (const r of this.file.list) if (r.hostile && r.entity.alive && !r.entity.removed) c.push(r);
    }
    return c;
  }

  /**
   * 우선순위: 30° 원뿔 안(기수에 가까운 순, 단 선택 무장으로 지금 교전 가능한 표적이 먼저) → 미션 표적
   * → 우리를 추적 중인 위협 → 거리.
   */
  private rank(c: TrackRecord[]): void {
    const o = this.owner;
    o.getForward(_fwd);
    for (const r of c) {
      _u.subVectors(r.position, o.position);
      const d = _u.length();
      const off = d > 1e-6 ? Math.acos(clamp(_fwd.dot(_u) / d, -1, 1)) * RAD : 0;
      if (off <= DESIGNATION_CONE_DEG) {
        r.rankGroup = 0;
        r.rankKey = off + (this.engageable(r, d) ? 0 : DESIGNATION_CONE_DEG);
      } else if (r.entity.tags.has('target')) {
        r.rankGroup = 1;
        r.rankKey = d;
      } else if (this.board.isLockingUs(r.entity)) {
        r.rankGroup = 2;
        r.rankKey = d;
      } else {
        r.rankGroup = 3;
        r.rankKey = d;
      }
    }
    c.sort(compareRank);
  }

  /** 선택 무장으로 이 트랙과 지금 교전할 수 있나 (자동 지정 순위용 — 각도/시선 조건은 보지 않는다) */
  private engageable(r: TrackRecord, d: number): boolean {
    const w = this.lockWeapon;
    const kind = lockKindOf(w);
    if (!w || kind === 'none') {
      const reach = this.radarRangeM;
      return d <= (reach > 0 ? reach : VISUAL_AIR_FRONT_M);
    }
    switch (kind) {
      case 'radar':
      case 'sarh': {
        if (d > weaponMaxRangeM(w) * RADAR_LOCK_RANGE_FACTOR) return false;
        if (this._mode !== 'off' && this._mode !== 'ag' && r.radarFresh(this.now, this.radarFreshWindow(r))) return true;
        return kind === 'radar' && !!w.guidance?.datalink && !!this.stats?.datalink?.cooperativeEngagement && r.datalinkCoop && this.now - r.datalinkAt <= HOLD.datalink;
      }
      case 'ir':
        return d <= (w.guidance?.seekerRangeKm ?? 0) * 1000;
      default:
        return d <= weaponMaxRangeM(w) * GPS_LOCK_RANGE_FACTOR;
    }
  }

  private pickBest(filter: TargetFilter): Entity | null {
    const c = this.collectCandidates(filter);
    if (c.length === 0) return null;
    this.rank(c);
    return c[0].entity;
  }

  cycleTarget(sim: Sim, direction: 1 | -1 = 1, filter?: 'air' | 'ground' | 'any'): void {
    this.now = Math.max(this.now, sim.time);
    const f = filter ?? preferredFilter(this.lockWeapon);
    const c = this.collectCandidates(f);
    if (c.length === 0) return;
    this.rank(c);
    const order = this.cycleOrder;
    if (this.now - this.cycleAt > CYCLE_SESSION_SEC || this.cycleFilter !== f) {
      order.length = 0;
      for (const r of c) order.push(r.id);
    } else {
      // 세션 유지: 사라진 후보는 빼고, 새 후보는 순위대로 뒤에 붙인다
      let w = 0;
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        if (c.some((r) => r.id === id)) order[w++] = id;
      }
      order.length = w;
      for (const r of c) if (!order.includes(r.id)) order.push(r.id);
    }
    this.cycleAt = this.now;
    this.cycleFilter = f;
    const n = order.length;
    const idx = this.designated ? order.indexOf(this.designated.id) : -1;
    const next = idx < 0 ? (direction > 0 ? 0 : n - 1) : (idx + direction + n) % n;
    const rec = this.file.getById(order[next]);
    this.autoSince = -Infinity;
    if (rec) this.setDesignated(rec.entity);
  }

  targetNearestToBoresight(sim: Sim, filter?: 'air' | 'ground' | 'any'): void {
    this.now = Math.max(this.now, sim.time);
    const c = this.collectCandidates(filter ?? preferredFilter(this.lockWeapon));
    if (c.length === 0) return;
    const o = this.owner;
    o.getForward(_fwd);
    let best: TrackRecord | null = null;
    let bestCos = -2;
    for (const r of c) {
      _u.subVectors(r.position, o.position);
      const d = _u.length();
      const cos = d > 1e-6 ? _fwd.dot(_u) / d : 1;
      if (cos > bestCos) {
        bestCos = cos;
        best = r;
      }
    }
    this.cycleAt = -Infinity;
    this.autoSince = -Infinity;
    if (best) this.setDesignated(best.entity);
  }

  // ------------------------------------------------------------ 락

  lockState(weapon: WeaponDef | null, sim: Sim): LockState {
    if (!weapon) {
      this.noLock.status = 'none';
      this.noLock.progress = 0;
      this.noLock.target = null;
      return this.noLock;
    }
    this.now = Math.max(this.now, sim.time);
    this.requestedWeapon = weapon;
    this.requestedAt = sim.time;
    if (weapon.id !== this.lockWeapon?.id) {
      this.lockWeapon = weapon;
      this.lockProgress = 0;
      this.lockTargetId = -1;
      this.updateLock(0, sim);
    }
    return this.lockOut;
  }

  private updateLock(dt: number, sim: Sim): void {
    const w = this.lockWeapon;
    const kind = lockKindOf(w);
    const out = this.lockOut;
    const d = this.designated;
    if (!w || kind === 'none') {
      this.lockProgress = 0;
      out.status = 'none';
      out.progress = 0;
      out.target = null;
      return;
    }
    const tid = d?.id ?? -1;
    if (tid !== this.lockTargetId) {
      this.lockProgress = 0;
      this.lockTargetId = tid;
    }
    const lt = d ? this.lockTimeFor(w, kind, d, sim) : 0;
    if (lt > 0) {
      if (kind === 'sarh' && this._mode !== 'stt') this.enterStt(true);
      this.lockProgress = Math.min(1, this.lockProgress + dt / lt);
      out.status = this.lockProgress >= 1 ? 'locked' : 'locking';
      out.progress = this.lockProgress;
      out.target = d;
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt * LOCK_DECAY_RATE);
      out.status = kind === 'ir' || d ? 'searching' : 'none';
      out.progress = this.lockProgress;
      out.target = null;
    }
  }

  /** 락 조건을 만족하면 락에 걸리는 시간(s), 아니면 0 */
  private lockTimeFor(w: WeaponDef, kind: LockKind, t: Entity, sim: Sim): number {
    const g = w.guidance;
    const o = this.owner;
    const st = this.stats;
    if (!g || !st || !t.alive || t.removed) return 0;
    if (!this.hostileTo(sim, t) && !t.tags.has('target')) return 0;
    const rec = this.file.get(t);
    if (!rec) return 0;
    _invQ2.copy(o.quaternion).invert();
    const ang = bodyAngles(_invQ2, o.position, t.position, _ang2);
    const dist = ang.dist;
    const air = isAirEntity(t);
    switch (kind) {
      case 'ir': {
        if (!air) return 0;
        const noHmd = Math.min(g.gimbalDeg, g.offBoresightDeg, HUD_OFFBORESIGHT_DEG);
        const limit = st.helmet ? Math.max(noHmd, Math.min(st.helmet.offBoresightDeg, g.offBoresightDeg, g.gimbalDeg)) : noHmd;
        if (ang.off > limit) return 0;
        t.getForward(_tFwd);
        const R = irDetectionRange(g.seekerRangeKm, effectiveIr(t), cosNoseToward(t.position, _tFwd, o.position));
        if (dist > R || !this.losTo(sim, t, dist)) return 0;
        return lerp(LOCK_TIME.irMin, LOCK_TIME.irMax, clamp(ang.off / Math.max(limit, 1), 0, 1));
      }
      case 'radar':
      case 'sarh': {
        if (!air || dist > RADAR_LOCK_RANGE_FACTOR * weaponMaxRangeM(w)) return 0;
        const radar = st.radar;
        const own =
          !!radar && this._mode !== 'off' && this._mode !== 'ag' && inRadarVolume(ang, radar) && rec.radarFresh(this.now, this.radarFreshWindow(rec));
        if (own) return LOCK_TIME.radar;
        const coop =
          kind === 'radar' &&
          !!g.datalink &&
          !!st.datalink?.cooperativeEngagement &&
          rec.datalinkCoop &&
          this.now - rec.datalinkAt <= HOLD.datalink &&
          ang.off <= (radar?.azimuthDeg ?? 60);
        return coop ? LOCK_TIME.radar : 0;
      }
      case 'eo':
      case 'laser': {
        if (air) return 0;
        if (kind === 'laser' && !this.laserCapable) return 0;
        // 레이저: 표적 포드가 조사하므로 포드 시야(하반구)·투하 사거리 기준
        const limit = kind === 'laser' ? 90 : g.gimbalDeg;
        const range = kind === 'laser' ? Math.max(g.seekerRangeKm * 1000, GPS_LOCK_RANGE_FACTOR * weaponMaxRangeM(w)) : g.seekerRangeKm * 1000;
        if (ang.off > limit || dist > range || !this.losTo(sim, t, dist)) return 0;
        return kind === 'laser' ? LOCK_TIME.laser : LOCK_TIME.eo;
      }
      case 'gps': {
        if (air || dist > GPS_LOCK_RANGE_FACTOR * weaponMaxRangeM(w) || ang.off > GPS_LOCK_CONE_DEG) return 0;
        return LOCK_TIME.gps;
      }
      case 'arm': {
        if (!t.emission || ang.off > g.gimbalDeg || dist > g.seekerRangeKm * 1000) return 0;
        return LOCK_TIME.arm;
      }
      default:
        return 0;
    }
  }

  // ------------------------------------------------------------ 경고음

  private updateTones(sim: Sim): void {
    const audio = sim.services.audio;
    const t = this.tones;
    const kind = lockKindOf(this.lockWeapon);
    const s = this.lockOut.status;
    t.set(audio, 'ir_search', kind === 'ir' && (s === 'searching' || s === 'locking'));
    t.set(audio, 'ir_lock', kind === 'ir' && s === 'locked');
    t.set(audio, 'radar_lock', (kind === 'radar' || kind === 'sarh') && s === 'locked');
    let track = false;
    let launch = false;
    let incoming = false;
    for (const r of this.board.list) {
      if (r.kind === 'track') track = true;
      else if (r.kind === 'launch') launch = true;
      else if (r.kind === 'missile') {
        launch = true;
        const tti = r.closure > 1 ? r.trueRange / r.closure : Infinity;
        if (r.trueRange <= INCOMING_RANGE_M || tti < INCOMING_TTI_SEC) incoming = true;
      }
    }
    t.set(audio, 'missile_incoming', incoming);
    t.set(audio, 'missile_launch', launch && !incoming);
    t.set(audio, 'rwr_lock', track && !launch);
    t.set(audio, 'rwr_search', this.now - this.board.newEmitterAt <= RWR_NEW_PING_SEC);
  }

  // ------------------------------------------------------------ 정리

  private shutdown(sim: Sim): void {
    if (this.isShutdown) return;
    this.isShutdown = true;
    this.tones.silence(sim.services.audio);
    this.owner.emission = null;
    this.file.clear();
    this.board.clear();
    this.los.clear();
    this._missileWarning = false;
    this.radarMissileWarning = false;
    this.lockProgress = 0;
    this.lockOut.status = 'none';
    this.lockOut.progress = 0;
    this.lockOut.target = null;
    if (this.designated) {
      this.designated = null;
      if (this.owner.isPlayer) sim.events.emit('targetChanged', { entity: null });
    }
  }

  /** 미션 종료 등으로 기체를 버릴 때: 경고음 끄기, 이벤트 구독 해제, 디코이 제거 */
  dispose(): void {
    this.shutdown(this.sim);
    this.offDestroyed?.();
    this.offDestroyed = null;
    if (this.decoy) this.decoy.removed = true;
    this.decoy = null;
  }
}
