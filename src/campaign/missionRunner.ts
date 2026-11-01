// 미션 실행기: 플레이어/윙맨 스폰, 미션 스크립트 실행, 목표·실패 판정, 전투 통계와 점수 계산.
//
//   const runner = new MissionRunner(def, sim, { playerLoadout, rearm: (ac) => ..., chatter });
//   game.addSystem(runner);  // fixedUpdate 로 진행
//   runner.start();          // sim.services.mission = runner, def.script(ctx) 실행
//   sim.events.on('missionEnded', () => showDebrief(runner.result()));
import * as THREE from 'three';
import { isAircraft, isMissile, type AircraftLike } from '../core/contracts';
import type { Entity } from '../core/entity';
import type { System } from '../core/game';
import { headingToDir } from '../core/math';
import type { Rng } from '../core/rng';
import type { AircraftSpawn, GroundSpawn, MissionService, MissionState, ObjectiveState, RadioMessage } from '../core/services';
import { DIFFICULTY_TABLE } from '../core/settings';
import type { GameEvents, Sim } from '../core/sim';
import type { AISkill, Faction } from '../core/types';
import type { Loadout } from '../data/schema';
import { CAST, findCast, type CastMember } from './cast';
import type {
  AIOrders,
  AirGroupSpec,
  AirPos,
  AirSpawnSpec,
  AreaTriggerOptions,
  CampaignAircraftSpawn,
  DialogueLine,
  Formation,
  GroundGroupSpec,
  GroundPattern,
  GroundPos,
  GroundSpawnSpec,
  KillEntry,
  LaunchSpec,
  LiveMarker,
  MapMarker,
  MissionContext,
  MissionDef,
  MissionResult,
  ObjectiveHandle,
  ObjectiveOptions,
  RadioLineOpts,
  RearmZoneOptions,
  ScoreLine,
  SkillMix,
  Speaker,
  TimerHandle,
  TriggerWho,
  WithdrawOptions,
} from './missionTypes';
import { emptyLoadout, pickWeapon, resolvePresetId, weaponDef } from './presets';
import {
  OBJECTIVE_SCORE,
  NEUTRAL_KILL_PENALTY,
  accuracyBonus,
  computeCredits,
  computeRank,
  damagePenalty,
  killScore,
  timeBonus,
} from './scoring';

export interface MissionRunnerOptions {
  /** 격납고에서 고른 플레이어 로드아웃 */
  playerLoadout?: Loadout;
  /** playerLoadout 이 없을 때 기체 (기본: def.player.allowedAircraft[0] → 'f15ex') */
  playerAircraftId?: string;
  playerCallsign?: string;
  /** 플레이어 스폰 여부. 기본: sim.world.player 가 없으면 스폰 */
  spawnPlayer?: boolean;
  /** 윙맨 스폰 (기본 true) */
  spawnWingmen?: boolean;
  /** 윙맨별 로드아웃 (콜사인 → Loadout) */
  wingmanLoadouts?: Record<string, Loadout>;
  /** 보급 구역 재무장/재급유 훅 (통합 쪽에서 Stores/연료를 채운다) */
  rearm?: (aircraft: AircraftLike) => void;
  /** ctx.setChatter() 가 켜고 끈다 */
  chatter?: { enabled: boolean } | null;
  /** 플레이어 격추 후 실패 확정까지 (s, 기본 3) */
  playerDeathDelay?: number;
  /** 작전 구역 이탈 허용 시간 (s, 기본 15) */
  outOfBoundsTime?: number;
  /** sim.services.mission 에 등록 (기본 true) */
  registerService?: boolean;
}

// ---------------------------------------------------------------- 내부 구조

class Handle implements TimerHandle {
  active = true;
  constructor(private readonly onCancel?: () => void) {}
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.onCancel?.();
  }
}

interface Timer {
  handle: Handle;
  at: number;
  interval: number;
  remaining: number;
  fn: () => void;
}

interface Watch {
  handle: Handle;
  cond: () => boolean;
  fn: () => void;
  interval: number;
  next: number;
  deadline: number;
  onTimeout?: () => void;
}

interface DestroyHook {
  handle: Handle;
  tag: string | null;
  entity: Entity | null;
  fn: (e: Entity, by: Entity | null) => void;
}

interface AreaTrigger {
  handle: Handle;
  center: THREE.Vector3;
  radius: number;
  fn: (e: Entity) => void;
  opts: AreaTriggerOptions;
  inside: Set<number>;
  markerId: number | null;
}

interface RearmZone {
  handle: Handle;
  center: THREE.Vector3;
  radius: number;
  opts: Required<Pick<RearmZoneOptions, 'cooldown' | 'dwell' | 'wingmen'>> & RearmZoneOptions;
  enteredAt: Map<number, number>;
  lastRearm: Map<number, number>;
  markerId: number;
}

interface Withdrawal {
  entity: Entity;
  start: number;
  opts: Required<WithdrawOptions>;
}

interface ObjectiveRec {
  state: ObjectiveState;
  opts: ObjectiveOptions;
  handle: ObjectiveHandle;
  completeFns: Array<() => void>;
  failFns: Array<() => void>;
}

interface TrackedWeapon {
  entity: Entity;
  weaponId: string;
  hit: boolean;
  at: number;
}

const SCAN_INTERVAL = 0.1;
const DEFAULT_STORY_PRIORITY = 5;
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const NOSE = new THREE.Vector3(0, 0, -1);

/** 무전 자막 표시 시간 추정 (s) — 대사 연쇄 재생 간격에도 쓴다 */
export function radioDuration(text: string): number {
  return Math.min(9, Math.max(2.4, 1.6 + text.length * 0.075));
}

const SKILL_ORDER: readonly AISkill[] = ['ace', 'veteran', 'regular', 'rookie'];

/** 편대 숙련도 배정 */
export function expandSkillMix(mix: SkillMix | undefined, count: number): AISkill[] {
  if (!mix) return new Array<AISkill>(count).fill('regular');
  if (typeof mix === 'string') return new Array<AISkill>(count).fill(mix);
  if (Array.isArray(mix)) {
    const last = mix[mix.length - 1] ?? 'regular';
    return Array.from({ length: count }, (_, i) => mix[i] ?? last);
  }
  const out: AISkill[] = [];
  for (const s of SKILL_ORDER) for (let i = 0; i < (mix[s] ?? 0); i++) out.push(s);
  const last = out[out.length - 1] ?? 'regular';
  while (out.length < count) out.push(last);
  return out.slice(0, count);
}

/** 편대 위치 (기체 로컬: right m, back m, up m) */
export function formationOffset(formation: Formation, i: number, spacing: number): [number, number, number] {
  if (i === 0) return [0, 0, 0];
  switch (formation) {
    case 'wedge': {
      const k = Math.ceil(i / 2);
      return [(i % 2 === 1 ? 1 : -1) * k * spacing, k * spacing * 0.8, 0];
    }
    case 'line': {
      const k = Math.ceil(i / 2);
      return [(i % 2 === 1 ? 1 : -1) * k * spacing, 0, 0];
    }
    case 'spread': {
      const k = Math.ceil(i / 2);
      return [(i % 2 === 1 ? 1 : -1) * k * spacing * 2.5, 0, (i % 2) * 150];
    }
    case 'echelon':
      return [i * spacing, i * spacing * 0.7, -i * 20];
    case 'trail':
      return [0, i * spacing, i * 60];
    case 'box': {
      const row = Math.floor(i / 2);
      return [(i % 2) * spacing, row * spacing, -row * 40];
    }
  }
}

function groundOffset(pattern: GroundPattern, i: number, count: number, spacing: number, radius: number, rng: Rng): [number, number] {
  switch (pattern) {
    case 'ring': {
      const a = (i / count) * Math.PI * 2;
      return [Math.sin(a) * radius, -Math.cos(a) * radius];
    }
    case 'line':
      return [(i - (count - 1) / 2) * spacing, 0];
    case 'column':
      return [0, i * spacing];
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count));
      return [((i % cols) - (cols - 1) / 2) * spacing, Math.floor(i / cols) * spacing];
    }
    case 'scatter': {
      const a = rng.range(0, Math.PI * 2);
      const r = radius * Math.sqrt(rng.next());
      return [Math.sin(a) * r, -Math.cos(a) * r];
    }
  }
}

/** 방위(heading) 기준 로컬 오프셋 → 월드 x/z */
function rotateOffset(heading: number, right: number, back: number, out: { x: number; z: number }): void {
  headingToDir(heading, _fwd);
  // right 벡터 = (-fwd.z, fwd.x), back = -fwd
  out.x = -_fwd.z * right - _fwd.x * back;
  out.z = _fwd.x * right - _fwd.z * back;
}

function isAirPos(p: AirPos | GroundPos): p is AirPos {
  return (p as AirPos).alt !== undefined;
}

const COUNTABLE_KINDS = new Set(['aircraft', 'ground', 'ship', 'structure', 'missile']);

// ---------------------------------------------------------------- MissionRunner

export class MissionRunner implements MissionService, System {
  readonly name = 'mission';
  readonly state: MissionState;
  /** 런타임 지도/HUD 마커 (보급 구역, 트리거 지점, 스크립트 마커) */
  readonly markers: LiveMarker[] = [];
  /** 미션 스크립트 예외 (있으면 기록) */
  scriptError: unknown = null;

  private readonly opts: MissionRunnerOptions;
  private readonly ctx: MissionContext;
  private started = false;
  private finishedFlag = false;
  private decided = false;
  private decidedAt = 0;
  private endAt = Infinity;
  private clock = 0;
  private scanAcc = 0;
  private pruneAcc = 0;
  private autoComplete = true;
  private timeUpFn: (() => void) | null = null;
  private timeUpFired = false;
  private timeWarned = new Set<number>();
  private oobTime = 0;
  private oobWarnAt = 0;
  private playerDeadAt: number | null = null;
  private nextMarkerId = 1;
  private cachedResult: MissionResult | null = null;

  private playerRef: AircraftLike | null = null;
  private readonly wingmenList: AircraftLike[] = [];
  private readonly vars: Record<string, unknown> = {};

  private readonly timers: Timer[] = [];
  private readonly watches: Watch[] = [];
  private readonly destroyHooks: DestroyHook[] = [];
  private readonly areaTriggers: AreaTrigger[] = [];
  private readonly rearmZones: RearmZone[] = [];
  private readonly withdrawals: Withdrawal[] = [];
  private readonly objectives: ObjectiveRec[] = [];
  private readonly tagSets = new Map<string, Set<Entity>>();
  private readonly invulnerable = new Set<Entity>();
  private readonly unitIds = new WeakMap<Entity, string>();
  private readonly scoreOverride = new WeakMap<Entity, number>();
  private readonly offs: Array<() => void> = [];

  // 통계
  private readonly killMap = new Map<string, KillEntry>();
  private totalKills = 0;
  private killScoreSum = 0;
  private objectiveScore = 0;
  private readonly extraScore = new Map<string, number>();
  private neutralKills = 0;
  private wingmanKills = 0;
  private friendlyLosses = 0;
  private shotsFired = 0;
  private hits = 0;
  private gunHits = 0;
  private gunBursts = 0;
  private damageTakenHp = 0;
  private readonly tracked: TrackedWeapon[] = [];
  private readonly gunIds = new Set<string>();

  constructor(
    readonly def: MissionDef,
    readonly sim: Sim,
    opts: MissionRunnerOptions = {},
  ) {
    this.opts = opts;
    this.state = {
      id: def.id,
      title: def.title,
      elapsed: 0,
      timeLeft: def.timeLimit ?? null,
      score: 0,
      kills: 0,
      objectives: [],
      result: null,
    };
    this.ctx = this.createContext();
  }

  get player(): AircraftLike | null {
    return this.playerRef;
  }
  get wingmen(): readonly AircraftLike[] {
    return this.wingmenList;
  }
  /** missionEnded 발행 완료 */
  get finished(): boolean {
    return this.finishedFlag;
  }
  /** 결과(성공/실패) 확정 여부 — 확정 후 종료 연출(delay) 동안도 true */
  get resolved(): boolean {
    return this.decided;
  }
  get context(): MissionContext {
    return this.ctx;
  }
  get elapsed(): number {
    return this.decided ? this.decidedAt : this.clock;
  }

  // ------------------------------------------------------------ 수명주기

  start(): void {
    if (this.started) return;
    this.started = true;
    const ev = this.sim.events;
    this.offs.push(
      ev.on('destroyed', (p) => this.onDestroyedEvent(p)),
      ev.on('damaged', (p) => this.onDamagedEvent(p)),
      ev.on('weaponLaunched', (p) => this.onWeaponLaunched(p)),
      ev.on('gunFired', (p) => {
        if (p.shooter === this.playerRef) {
          this.gunIds.add(p.weaponId);
          this.gunBursts++;
        }
      }),
    );
    if (this.opts.registerService ?? true) this.sim.services.mission = this;
    this.spawnFriendlies();
    try {
      this.def.script(this.ctx);
    } catch (err) {
      this.scriptError = err;
      console.error(`[campaign] 미션 ${this.def.id} 스크립트 오류`, err);
    }
  }

  fixedUpdate(dt: number, _sim?: Sim): void {
    if (!this.started || this.finishedFlag) return;
    this.clock += dt;
    this.runTimers();
    this.runWatches();
    this.scanAcc += dt;
    if (this.scanAcc >= SCAN_INTERVAL) {
      const step = this.scanAcc;
      this.scanAcc = 0;
      this.scanAreaTriggers();
      this.scanRearmZones();
      this.scanWithdrawals();
      if (!this.decided) this.checkBounds(step);
    }
    this.pruneAcc += dt;
    if (this.pruneAcc >= 1) {
      this.pruneAcc = 0;
      this.pruneTracked();
    }
    if (!this.decided) this.checkTimeLimit();
    this.refreshState();
    if (this.decided && this.clock >= this.endAt) this.finish();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.sim.services.mission === this) this.sim.services.mission = { state: null };
  }

  // ------------------------------------------------------------ 결과

  result(): MissionResult {
    if (this.decided && this.cachedResult) return this.cachedResult;
    return this.computeResult();
  }

  private computeResult(): MissionResult {
    const success = this.state.result === 'success';
    const t = this.elapsed;
    const par = this.def.parTime ?? this.def.timeLimit ?? 900;
    const maxHp = this.playerRef?.maxHp || 100;
    const damagePct = Math.min(100, (this.damageTakenHp / maxHp) * 100);
    const objectiveScore = this.objectiveScore;
    const extra = [...this.extraScore.entries()];
    const extraSum = extra.reduce((s, [, v]) => s + v, 0);
    const tb = success ? timeBonus(t, par) : 0;
    const ab = success ? accuracyBonus(this.hits, this.shotsFired) : 0;
    const dp = damagePenalty(damagePct);
    const np = this.neutralKills * NEUTRAL_KILL_PENALTY;
    const raw = this.killScoreSum + objectiveScore + extraSum + tb + ab - dp - np;
    const mult = DIFFICULTY_TABLE[this.sim.settings.difficulty]?.scoreMult ?? 1;
    const score = Math.max(0, Math.round(raw * mult));

    const breakdown: ScoreLine[] = [{ label: '격추', value: this.killScoreSum }];
    if (objectiveScore) breakdown.push({ label: '목표 달성', value: objectiveScore });
    for (const [label, v] of extra) breakdown.push({ label, value: v });
    if (tb) breakdown.push({ label: '시간 보너스', value: tb });
    if (ab) breakdown.push({ label: '명중률 보너스', value: ab });
    if (dp) breakdown.push({ label: '피해 감점', value: -dp });
    if (np) breakdown.push({ label: '비적대 세력 격추 감점', value: -np });
    if (mult !== 1) breakdown.push({ label: `난이도 보정 (x${mult})`, value: score - Math.max(0, Math.round(raw)) });

    const rank = computeRank(score, this.def.rankThresholds, success);
    const creditsEarned = computeCredits({ success, reward: this.def.reward, score, killScore: this.killScoreSum, rank });
    return {
      missionId: this.def.id,
      title: this.def.title,
      success,
      reason: this.state.failReason,
      rank,
      score,
      timeSec: t,
      kills: [...this.killMap.values()].sort((a, b) => b.score - a.score),
      totalKills: this.totalKills,
      shotsFired: this.shotsFired,
      hits: this.hits,
      accuracy: this.shotsFired > 0 ? Math.min(1, this.hits / this.shotsFired) : 0,
      gunHits: this.gunHits,
      damageTaken: Math.round(damagePct * 10) / 10,
      creditsEarned,
      breakdown,
      objectives: this.state.objectives.map((o) => ({ ...o, progress: o.progress ? { ...o.progress } : undefined })),
      wingmanKills: this.wingmanKills,
      friendlyLosses: this.friendlyLosses,
    };
  }

  private refreshState(): void {
    const s = this.state;
    s.elapsed = this.elapsed;
    s.timeLeft = this.def.timeLimit != null ? Math.max(0, this.def.timeLimit - s.elapsed) : null;
    s.kills = this.totalKills;
    if (!this.decided) {
      const extra = [...this.extraScore.values()].reduce((a, b) => a + b, 0);
      s.score = Math.max(0, this.killScoreSum + this.objectiveScore + extra - this.neutralKills * NEUTRAL_KILL_PENALTY);
    }
  }

  end(success: boolean, reason?: string, delay?: number): void {
    if (this.decided) return;
    this.decided = true;
    this.decidedAt = this.clock;
    this.state.result = success ? 'success' : 'failure';
    if (reason) this.state.failReason = reason;
    for (const o of this.objectives) {
      if (o.state.status !== 'active') continue;
      if (success && o.opts.protect) this.setObjectiveStatus(o, 'complete');
    }
    this.cachedResult = this.computeResult();
    this.state.score = this.cachedResult.score;
    this.state.elapsed = this.decidedAt;
    this.endAt = this.clock + (delay ?? (success ? 5 : 2.5));
    try {
      this.sim.services.audio.play(success ? 'mission_complete' : 'mission_failed');
    } catch {
      /* 오디오 미연결 */
    }
  }

  private finish(): void {
    if (this.finishedFlag) return;
    this.finishedFlag = true;
    this.sim.events.emit('missionEnded', { result: this.state.result ?? 'failure', reason: this.state.failReason });
  }

  // ------------------------------------------------------------ 스폰

  private spawnFriendlies(): void {
    const p = this.def.player;
    let player = this.sim.world.player;
    const shouldSpawn = this.opts.spawnPlayer ?? !player;
    if (shouldSpawn) {
      const aircraftId = this.opts.playerLoadout?.aircraftId ?? this.opts.playerAircraftId ?? p.allowedAircraft?.[0] ?? 'f15ex';
      const req: AircraftSpawn = {
        defId: aircraftId,
        faction: 'NATO',
        position: new THREE.Vector3(p.position.x, p.position.alt, p.position.z),
        heading: p.heading,
        speed: p.speed,
        loadout: this.opts.playerLoadout ?? 'default',
        presetId: this.opts.playerLoadout ? undefined : resolvePresetId(this.sim.db, aircraftId, p.recommendedPreset),
        controller: 'player',
        callsign: this.opts.playerCallsign ?? CAST.player.callsign,
        tags: ['player'],
      };
      try {
        player = this.sim.services.spawn.aircraft(req);
        player.isPlayer = true;
        if (!this.sim.world.player) this.sim.world.player = player;
      } catch (err) {
        console.error('[campaign] 플레이어 스폰 실패', err);
      }
    }
    this.playerRef = player ?? null;
    if (!this.playerRef || !(this.opts.spawnWingmen ?? true)) return;

    const lead = this.playerRef;
    const off = { x: 0, z: 0 };
    this.def.wingmen.forEach((w, i) => {
      const [r, b] = formationOffset('wedge', i + 1, 140);
      rotateOffset(p.heading, r, b, off);
      const loadout = this.opts.wingmanLoadouts?.[w.callsign];
      const req: AircraftSpawn = {
        defId: w.aircraftId,
        faction: lead.faction,
        position: new THREE.Vector3(lead.position.x + off.x, lead.position.y - 20 * (i + 1), lead.position.z + off.z),
        heading: p.heading,
        speed: p.speed,
        loadout: loadout ?? 'default',
        presetId: loadout ? undefined : resolvePresetId(this.sim.db, w.aircraftId, w.presetId),
        controller: 'wingman',
        skill: w.skill ?? 'veteran',
        callsign: w.callsign,
        tags: ['wingman'],
        leader: lead,
        formationSlot: i + 1,
      };
      try {
        const ac = this.sim.services.spawn.aircraft(req);
        if (!ac.callsign) ac.callsign = w.callsign;
        this.registerEntity(ac, ['wingman']);
        this.wingmenList.push(ac);
      } catch (err) {
        console.error(`[campaign] 윙맨 ${w.callsign} 스폰 실패`, err);
      }
    });
  }

  private buildOrders(spec: AirSpawnSpec): AIOrders | undefined {
    const o: AIOrders = {};
    let any = false;
    if (spec.waypoints?.length) {
      o.waypoints = spec.waypoints.map((w) => new THREE.Vector3(w.x, w.alt, w.z));
      o.loop = spec.loop;
      any = true;
    }
    if (spec.targetTag) (o.targetTag = spec.targetTag), (any = true);
    if (spec.escortTag) (o.escortTag = spec.escortTag), (any = true);
    if (spec.patrol) {
      o.patrol = { center: new THREE.Vector3(spec.patrol.at.x, spec.patrol.at.alt, spec.patrol.at.z), radius: spec.patrol.radius };
      any = true;
    }
    if (spec.holdFire || spec.role === 'drone') (o.holdFire = true), (any = true);
    return any ? o : undefined;
  }

  spawnAir(spec: AirSpawnSpec): AircraftLike {
    const tags = new Set(spec.tags ?? []);
    if (spec.target) tags.add('target');
    if (spec.role) tags.add(`role:${spec.role}`);
    if (spec.holdFire || spec.role === 'drone') tags.add('holdfire');
    const req: CampaignAircraftSpawn = {
      defId: spec.aircraftId,
      faction: spec.faction,
      position: new THREE.Vector3(spec.at.x, spec.at.alt, spec.at.z),
      heading: spec.heading,
      speed: spec.speed ?? 230,
      loadout: spec.unarmed ? emptyLoadout(spec.aircraftId) : (spec.loadout ?? 'default'),
      presetId: spec.unarmed || spec.loadout ? undefined : resolvePresetId(this.sim.db, spec.aircraftId, spec.presetId),
      controller: spec.controller ?? 'ai',
      skill: spec.skill ?? 'regular',
      callsign: spec.callsign,
      tags: [...tags],
      role: spec.role,
      orders: this.buildOrders(spec),
    };
    const ac = this.sim.services.spawn.aircraft(req);
    this.registerEntity(ac, tags, spec);
    return ac;
  }

  spawnGround(spec: GroundSpawnSpec): Entity {
    const tags = new Set(spec.tags ?? []);
    if (spec.target) tags.add('target');
    const req: GroundSpawn = {
      unitId: spec.unitId,
      faction: spec.faction,
      position: new THREE.Vector3(spec.at.x, this.sim.services.terrain.heightAt(spec.at.x, spec.at.z), spec.at.z),
      heading: spec.heading ?? 0,
      tags: [...tags],
      callsign: spec.callsign,
      waypoints: spec.waypoints?.map((w) => new THREE.Vector3(w.x, 0, w.z)),
    };
    const e = this.sim.services.spawn.ground(req);
    this.unitIds.set(e, spec.unitId);
    this.registerEntity(e, tags, spec);
    return e;
  }

  spawnGroup(spec: AirGroupSpec): AircraftLike[];
  spawnGroup(spec: GroundGroupSpec): Entity[];
  spawnGroup(spec: AirGroupSpec | GroundGroupSpec): Entity[] {
    const out: Entity[] = [];
    const off = { x: 0, z: 0 };
    if ('aircraftId' in spec) {
      const skills = expandSkillMix(spec.skill, spec.count);
      const formation = spec.formation ?? 'wedge';
      const spacing = spec.spacing ?? 400;
      for (let i = 0; i < spec.count; i++) {
        const [r, b, u] = formationOffset(formation, i, spacing);
        rotateOffset(spec.heading, r, b, off);
        out.push(
          this.spawnAir({
            ...spec,
            at: { x: spec.at.x + off.x, z: spec.at.z + off.z, alt: spec.at.alt + u },
            skill: skills[i],
            callsign: spec.callsign ? `${spec.callsign} ${i + 1}` : undefined,
          }),
        );
      }
      return out;
    }
    const pattern = spec.pattern ?? 'scatter';
    const heading = spec.heading ?? 0;
    for (let i = 0; i < spec.count; i++) {
      const [r, b] = groundOffset(pattern, i, spec.count, spec.spacing ?? 60, spec.radius ?? 200, this.sim.rng);
      if (pattern === 'ring' || pattern === 'scatter') {
        off.x = r;
        off.z = b;
      } else rotateOffset(heading, r, b, off);
      out.push(
        this.spawnGround({
          ...spec,
          at: { x: spec.at.x + off.x, z: spec.at.z + off.z },
          heading: pattern === 'ring' ? (Math.atan2(off.x, -off.z) * 180) / Math.PI : heading,
          callsign: spec.callsign ? `${spec.callsign} ${i + 1}` : undefined,
        }),
      );
    }
    return out;
  }

  private registerEntity(e: Entity, tags: Iterable<string>, spec?: { name?: string; callsign?: string; score?: number; invulnerable?: boolean }): void {
    for (const t of tags) {
      e.tags.add(t);
      let set = this.tagSets.get(t);
      if (!set) this.tagSets.set(t, (set = new Set()));
      set.add(e);
    }
    if (spec?.name) e.name = spec.name;
    if (spec?.callsign && !e.callsign) e.callsign = spec.callsign;
    if (spec?.score != null) this.scoreOverride.set(e, spec.score);
    if (spec?.invulnerable) this.invulnerable.add(e);
    for (const o of this.objectives) {
      const t = o.opts.destroy ?? o.opts.protect;
      if (t && e.tags.has(t)) this.updateTrackedObjective(o);
    }
  }

  /** 태그 엔티티 전부 (스폰 기록 + 월드에 있는 것) */
  private tagged(tag: string): Set<Entity> {
    let set = this.tagSets.get(tag);
    if (!set) this.tagSets.set(tag, (set = new Set()));
    for (const e of this.sim.world.entities) if (e.tags.has(tag)) set.add(e);
    return set;
  }

  // ------------------------------------------------------------ 이벤트

  private shooterOf(e: Entity | null): Entity | null {
    if (!e) return null;
    return isMissile(e) ? (e.shooter ?? null) : e;
  }

  private isHostileToPlayer(e: Entity): boolean {
    const pf = this.playerRef?.faction ?? 'NATO';
    return this.sim.relations.isHostile(pf, e.faction);
  }

  private onDestroyedEvent({ entity, by }: GameEvents['destroyed']): void {
    const shooter = this.shooterOf(by);
    const player = this.playerRef;
    if (entity === player) this.onPlayerDestroyed();

    if (player && entity !== player && COUNTABLE_KINDS.has(entity.kind) && !this.decided) {
      const pf = player.faction;
      const hostile = this.isHostileToPlayer(entity);
      if (shooter === player) {
        if (hostile) this.registerKill(entity);
        else if (entity.faction !== pf && entity.kind !== 'missile') this.neutralKills++;
      } else if (shooter && hostile && this.wingmenList.includes(shooter as AircraftLike)) {
        this.wingmanKills++;
      }
      if (entity.faction === pf && entity.kind !== 'missile') this.friendlyLosses++;
    }

    for (const o of this.objectives) {
      const t = o.opts.destroy ?? o.opts.protect;
      if (t && entity.tags.has(t)) this.updateTrackedObjective(o);
    }
    for (const h of this.destroyHooks.slice()) {
      if (!h.handle.active) continue;
      if ((h.entity && h.entity === entity) || (h.tag && entity.tags.has(h.tag))) this.safe(() => h.fn(entity, shooter));
    }
  }

  private registerKill(e: Entity): void {
    const pts = killScore(e, this.sim.db, this.unitIds.get(e), this.scoreOverride.get(e));
    const name = e.name || e.kind;
    const k = this.killMap.get(name);
    if (k) {
      k.count++;
      k.score += pts;
    } else this.killMap.set(name, { name, count: 1, score: pts });
    this.killScoreSum += pts;
    if (e.kind !== 'missile') this.totalKills++;
  }

  private onPlayerDestroyed(): void {
    if (this.playerDeadAt != null || this.decided) return;
    this.playerDeadAt = this.clock;
    const cs = this.playerRef?.callsign ?? 'Halberd 1';
    this.say('lantern', `${cs} 신호 소실! ${cs}, 응답하라!`, { priority: 9 });
    this.after(this.opts.playerDeathDelay ?? 3, () => this.end(false, '플레이어 기체 손실'));
  }

  private onDamagedEvent({ entity, info }: GameEvents['damaged']): void {
    if (this.invulnerable.has(entity)) entity.hp = Math.min(entity.maxHp, entity.hp + info.amount);
    else if (entity === this.playerRef && !this.decided) this.damageTakenHp += info.amount;
    const src = this.shooterOf(info.source);
    if (!src || src !== this.playerRef || entity === src || !this.isHostileToPlayer(entity)) return;
    const wid = info.weaponId;
    if (!wid || this.gunIds.has(wid) || weaponDef(this.sim.db, wid)?.category === 'gun') {
      this.gunHits++;
      return;
    }
    const p = info.point ?? entity.position;
    let best: TrackedWeapon | null = null;
    let bestD = Infinity;
    for (const t of this.tracked) {
      if (t.weaponId !== wid) continue;
      const d = t.entity.position.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best && !best.hit) {
      best.hit = true;
      this.hits++;
    }
  }

  private onWeaponLaunched({ weapon, shooter, weaponId }: GameEvents['weaponLaunched']): void {
    if (!shooter || shooter !== this.playerRef || this.decided) return;
    const cat = weaponDef(this.sim.db, weaponId)?.category;
    if (cat === 'tank' || cat === 'pod' || cat === 'gun') return;
    this.shotsFired++;
    this.tracked.push({ entity: weapon, weaponId, hit: false, at: this.clock });
  }

  private pruneTracked(): void {
    let w = 0;
    for (const t of this.tracked) {
      const gone = t.entity.removed || !t.entity.alive;
      if (!(gone && this.clock - t.at > 20)) this.tracked[w++] = t;
    }
    this.tracked.length = w;
  }

  // ------------------------------------------------------------ 목표

  objective(id: string, text: string, opts: ObjectiveOptions = {}): ObjectiveHandle {
    const existing = this.objectives.find((o) => o.state.id === id);
    if (existing) {
      existing.state.text = text;
      this.sim.events.emit('objectiveChanged', { id });
      return existing.handle;
    }
    const primary = opts.primary ?? true;
    const state: ObjectiveState = { id, text, status: opts.hidden ? 'hidden' : 'active', primary };
    if (opts.total != null) state.progress = { current: 0, total: opts.total };
    const rec: ObjectiveRec = { state, opts, handle: null as unknown as ObjectiveHandle, completeFns: [], failFns: [] };
    if (opts.onComplete) rec.completeFns.push(opts.onComplete);
    if (opts.onFail) rec.failFns.push(opts.onFail);
    const self = this;
    const handle: ObjectiveHandle = {
      id,
      primary,
      get status() {
        return rec.state.status;
      },
      progress(current, total) {
        if (rec.state.status === 'complete' || rec.state.status === 'failed') return handle;
        const tot = total ?? rec.state.progress?.total ?? current;
        rec.state.progress = { current, total: tot };
        self.sim.events.emit('objectiveChanged', { id });
        if (tot > 0 && current >= tot) self.setObjectiveStatus(rec, 'complete');
        return handle;
      },
      increment(n = 1) {
        return handle.progress((rec.state.progress?.current ?? 0) + n);
      },
      complete() {
        self.setObjectiveStatus(rec, 'complete');
      },
      fail(reason) {
        self.setObjectiveStatus(rec, 'failed', reason);
      },
      show() {
        if (rec.state.status !== 'hidden') return;
        rec.state.status = 'active';
        self.sim.events.emit('objectiveChanged', { id });
        if (rec.opts.destroy || rec.opts.protect) self.updateTrackedObjective(rec);
      },
      setText(t) {
        rec.state.text = t;
        self.sim.events.emit('objectiveChanged', { id });
      },
      onComplete(fn) {
        rec.completeFns.push(fn);
        return handle;
      },
      onFail(fn) {
        rec.failFns.push(fn);
        return handle;
      },
    };
    rec.handle = handle;
    this.objectives.push(rec);
    this.state.objectives.push(state);
    this.sim.events.emit('objectiveChanged', { id });
    if (opts.destroy || opts.protect) {
      this.tagged((opts.destroy ?? opts.protect)!);
      // 생성 직후 체인으로 onComplete 를 붙일 수 있도록 판정은 다음 스텝에
      this.updateTrackedObjective(rec, true);
      this.after(0, () => this.updateTrackedObjective(rec));
    }
    return handle;
  }

  private updateTrackedObjective(o: ObjectiveRec, progressOnly = false): void {
    const s = o.state;
    if (s.status === 'complete' || s.status === 'failed') return;
    if (o.opts.destroy) {
      const set = this.tagged(o.opts.destroy);
      let dead = 0;
      for (const e of set) if (!e.alive) dead++;
      const total = o.opts.required ?? set.size;
      s.progress = { current: Math.min(dead, total), total };
      this.sim.events.emit('objectiveChanged', { id: s.id });
      if (!progressOnly && s.status === 'active' && total > 0 && dead >= total) this.setObjectiveStatus(o, 'complete');
    } else if (o.opts.protect) {
      const set = this.tagged(o.opts.protect);
      let dead = 0;
      for (const e of set) if (!e.alive) dead++;
      s.progress = { current: set.size - dead, total: set.size };
      this.sim.events.emit('objectiveChanged', { id: s.id });
      if (!progressOnly && s.status === 'active' && dead > (o.opts.maxLosses ?? 0)) this.setObjectiveStatus(o, 'failed');
    }
  }

  private setObjectiveStatus(o: ObjectiveRec, status: 'complete' | 'failed', reason?: string): void {
    const s = o.state;
    if (s.status === 'complete' || s.status === 'failed') return;
    if (this.decided && status === 'failed') return;
    s.status = status;
    this.sim.events.emit('objectiveChanged', { id: s.id });
    if (status === 'complete') {
      if (!this.decided) this.objectiveScore += o.opts.score ?? (s.primary ? OBJECTIVE_SCORE.primary : OBJECTIVE_SCORE.secondary);
      for (const fn of o.completeFns) this.safe(fn);
      if (s.primary) this.after(2, () => this.checkAutoComplete());
    } else {
      for (const fn of o.failFns) this.safe(fn);
      if (s.primary) this.end(false, reason ?? `목표 실패: ${s.text}`);
    }
  }

  private checkAutoComplete(): void {
    if (!this.autoComplete || this.decided) return;
    const prim = this.objectives.filter((o) => o.state.primary && o.state.status !== 'hidden');
    if (!prim.some((o) => o.state.status === 'complete')) return;
    if (prim.some((o) => o.state.status === 'failed' || (o.state.status === 'active' && !o.opts.protect))) return;
    this.end(true, '모든 주목표 달성');
  }

  // ------------------------------------------------------------ 타이머/조건

  after(seconds: number, fn: () => void): TimerHandle {
    const handle = new Handle();
    this.timers.push({ handle, at: this.clock + Math.max(0, seconds), interval: 0, remaining: 1, fn });
    return handle;
  }

  every(seconds: number, fn: (h: TimerHandle) => void, opts: { immediate?: boolean; times?: number } = {}): TimerHandle {
    const handle = new Handle();
    const interval = Math.max(1 / 60, seconds);
    this.timers.push({
      handle,
      at: this.clock + (opts.immediate ? 0 : interval),
      interval,
      remaining: opts.times ?? Infinity,
      fn: () => fn(handle),
    });
    return handle;
  }

  when(cond: () => boolean, fn: () => void, opts: { interval?: number; timeout?: number; onTimeout?: () => void } = {}): TimerHandle {
    const handle = new Handle();
    this.watches.push({
      handle,
      cond,
      fn,
      interval: opts.interval ?? 0,
      next: this.clock,
      deadline: opts.timeout != null ? this.clock + opts.timeout : Infinity,
      onTimeout: opts.onTimeout,
    });
    return handle;
  }

  private runTimers(): void {
    if (this.timers.length === 0) return;
    const due = this.timers.filter((t) => t.handle.active && t.at <= this.clock + 1e-9);
    due.sort((a, b) => a.at - b.at);
    for (const t of due) {
      if (!t.handle.active) continue;
      t.remaining--;
      if (t.interval > 0 && t.remaining > 0) t.at += t.interval;
      else t.handle.active = false;
      this.safe(t.fn);
    }
    let w = 0;
    for (const t of this.timers) if (t.handle.active) this.timers[w++] = t;
    this.timers.length = w;
  }

  private runWatches(): void {
    if (this.watches.length === 0) return;
    for (const w of this.watches.slice()) {
      if (!w.handle.active || this.clock < w.next) continue;
      w.next = this.clock + w.interval;
      let ok = false;
      try {
        ok = w.cond();
      } catch (err) {
        console.error('[campaign] when() 조건 오류', err);
        w.handle.active = false;
        continue;
      }
      if (ok) {
        w.handle.active = false;
        this.safe(w.fn);
      } else if (this.clock >= w.deadline) {
        w.handle.active = false;
        if (w.onTimeout) this.safe(w.onTimeout);
      }
    }
    let n = 0;
    for (const w of this.watches) if (w.handle.active) this.watches[n++] = w;
    this.watches.length = n;
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.scriptError ??= err;
      console.error(`[campaign] 미션 ${this.def.id} 스크립트 콜백 오류`, err);
    }
  }

  // ------------------------------------------------------------ 질의/트리거

  countAlive(tag: string): number {
    let n = 0;
    for (const e of this.tagged(tag)) if (e.alive && !e.removed) n++;
    return n;
  }

  alive(tag: string): Entity[] {
    const out: Entity[] = [];
    for (const e of this.tagged(tag)) if (e.alive && !e.removed) out.push(e);
    return out;
  }

  onDestroyed(target: string | Entity, fn: (e: Entity, by: Entity | null) => void): TimerHandle {
    const handle = new Handle();
    this.destroyHooks.push({ handle, tag: typeof target === 'string' ? target : null, entity: typeof target === 'string' ? null : target, fn });
    return handle;
  }

  onAllDestroyed(tag: string, fn: () => void): TimerHandle {
    const handle = new Handle();
    const check = () => {
      if (!handle.active) return;
      if (this.tagged(tag).size > 0 && this.countAlive(tag) === 0) {
        handle.cancel();
        fn();
      }
    };
    const hook = this.onDestroyed(tag, check);
    const orig = handle.cancel.bind(handle);
    handle.cancel = () => {
      hook.cancel();
      orig();
    };
    return handle;
  }

  private candidates(who: TriggerWho): Entity[] {
    const pf = this.playerRef?.faction ?? 'NATO';
    if (who === 'player') return this.playerRef && this.playerRef.alive ? [this.playerRef] : [];
    if (who === 'friendly') return this.sim.world.query({ kinds: ['aircraft', 'ground', 'ship'], faction: pf });
    if (who === 'hostile') return this.sim.world.query({ kinds: ['aircraft', 'ground', 'ship', 'missile'], hostileTo: pf });
    if (who === 'any') return this.sim.world.query({ kinds: ['aircraft', 'ground', 'ship'] });
    return this.alive(who.tag);
  }

  areaTrigger(center: AirPos | GroundPos, radius: number, fn: (e: Entity) => void, opts: AreaTriggerOptions = {}): TimerHandle {
    const c = new THREE.Vector3(center.x, isAirPos(center) ? center.alt : 0, center.z);
    let markerId: number | null = null;
    if (opts.marker) {
      markerId = this.addMarker({
        x: center.x,
        z: center.z,
        alt: isAirPos(center) ? center.alt : undefined,
        radius,
        label: opts.marker.label,
        kind: opts.marker.kind ?? 'objective',
      });
    }
    const handle = new Handle(() => {
      if (markerId != null) this.removeMarker(markerId);
    });
    this.areaTriggers.push({ handle, center: c, radius, fn, opts, inside: new Set(), markerId });
    return handle;
  }

  private inZone(e: Entity, center: THREE.Vector3, radius: number, minAlt?: number, maxAlt?: number): boolean {
    const dx = e.position.x - center.x;
    const dz = e.position.z - center.z;
    if (dx * dx + dz * dz > radius * radius) return false;
    if (minAlt != null && e.position.y < minAlt) return false;
    if (maxAlt != null && e.position.y > maxAlt) return false;
    return true;
  }

  private scanAreaTriggers(): void {
    for (const t of this.areaTriggers) {
      if (!t.handle.active) continue;
      const list = this.candidates(t.opts.who ?? 'player');
      const exit = t.opts.on === 'exit';
      const nowInside = new Set<number>();
      for (const e of list) {
        if (!this.inZone(e, t.center, t.radius, t.opts.minAlt, t.opts.maxAlt)) continue;
        nowInside.add(e.id);
        if (!exit && !t.inside.has(e.id)) {
          this.safe(() => t.fn(e));
          if (t.opts.once ?? true) {
            t.handle.cancel();
            break;
          }
        }
      }
      if (exit && t.handle.active) {
        for (const e of list) {
          if (t.inside.has(e.id) && !nowInside.has(e.id)) {
            this.safe(() => t.fn(e));
            if (t.opts.once ?? true) {
              t.handle.cancel();
              break;
            }
          }
        }
      }
      t.inside = nowInside;
    }
    let w = 0;
    for (const t of this.areaTriggers) if (t.handle.active) this.areaTriggers[w++] = t;
    this.areaTriggers.length = w;
  }

  rearmZone(center: AirPos | GroundPos, radius: number, opts: RearmZoneOptions = {}): TimerHandle {
    const c = new THREE.Vector3(center.x, isAirPos(center) ? center.alt : 0, center.z);
    const markerId = this.addMarker({ x: center.x, z: center.z, radius, label: opts.label ?? '보급 구역', kind: 'friendly' });
    const handle = new Handle(() => this.removeMarker(markerId));
    this.rearmZones.push({
      handle,
      center: c,
      radius,
      opts: { cooldown: 45, dwell: 2, wingmen: true, ...opts },
      enteredAt: new Map(),
      lastRearm: new Map(),
      markerId,
    });
    if (!this.opts.rearm) console.warn(`[campaign] 미션 ${this.def.id}: 보급 구역이 있지만 MissionRunnerOptions.rearm 훅이 없다`);
    return handle;
  }

  private scanRearmZones(): void {
    for (const z of this.rearmZones) {
      if (!z.handle.active) continue;
      const list: AircraftLike[] = [];
      if (this.playerRef?.alive) list.push(this.playerRef);
      if (z.opts.wingmen) for (const w of this.wingmenList) if (w.alive) list.push(w);
      for (const ac of list) {
        if (!this.inZone(ac, z.center, z.radius, undefined, z.opts.maxAlt)) {
          z.enteredAt.delete(ac.id);
          continue;
        }
        const entered = z.enteredAt.get(ac.id);
        if (entered == null) {
          z.enteredAt.set(ac.id, this.clock);
          continue;
        }
        const last = z.lastRearm.get(ac.id) ?? -Infinity;
        if (this.clock - entered < z.opts.dwell || this.clock - last < z.opts.cooldown) continue;
        z.lastRearm.set(ac.id, this.clock);
        if (this.opts.rearm) {
          this.safe(() => this.opts.rearm!(ac));
          if (ac === this.playerRef) this.say('lantern', `${ac.callsign ?? 'Halberd 1'}, 재무장·재급유 완료. 전선으로 복귀하라.`, { priority: 3 });
        }
      }
    }
    let w = 0;
    for (const z of this.rearmZones) if (z.handle.active) this.rearmZones[w++] = z;
    this.rearmZones.length = w;
  }

  // ------------------------------------------------------------ 엔티티 제어

  private resolveTargets(target: Entity | string): Entity[] {
    return typeof target === 'string' ? this.alive(target) : [target];
  }

  setInvulnerable(target: Entity | string, on: boolean): void {
    for (const e of this.resolveTargets(target)) {
      if (on) this.invulnerable.add(e);
      else this.invulnerable.delete(e);
    }
  }

  despawn(e: Entity): void {
    this.invulnerable.delete(e);
    e.removed = true;
  }

  withdraw(target: Entity | string, opts: WithdrawOptions = {}): void {
    for (const e of this.resolveTargets(target)) {
      if (e.tags.has('withdraw')) continue;
      e.tags.add('withdraw');
      this.invulnerable.add(e);
      e.faction = 'NEUTRAL';
      this.withdrawals.push({ entity: e, start: this.clock, opts: { removeDistance: 9000, maxTime: 35, ...opts } });
    }
  }

  private scanWithdrawals(): void {
    let w = 0;
    for (const wd of this.withdrawals) {
      const e = wd.entity;
      if (e.removed) continue;
      const far = this.playerRef ? e.position.distanceTo(this.playerRef.position) > wd.opts.removeDistance : true;
      if (far || this.clock - wd.start > wd.opts.maxTime) {
        this.despawn(e);
        continue;
      }
      this.withdrawals[w++] = wd;
    }
    this.withdrawals.length = w;
  }

  launch(spec: LaunchSpec): Entity | null {
    const weaponId = pickWeapon(this.sim.db, spec.weapon);
    if (!weaponId) {
      console.warn(`[campaign] 발사할 무장 없음: ${String(spec.weapon)}`);
      return null;
    }
    const from = spec.from;
    const pos = new THREE.Vector3().copy(from.position);
    if (spec.offset) pos.add(spec.offset);
    else if (from.kind !== 'aircraft') pos.y += 6;
    const dir = new THREE.Vector3();
    if (spec.vertical) dir.set(0, 1, 0);
    else if (spec.target) dir.subVectors(spec.target.position, pos);
    else if (spec.targetPoint) dir.subVectors(spec.targetPoint, pos);
    else from.getForward(dir);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const speed = spec.speed ?? (spec.vertical ? 40 : Math.max(250, from.speed));
    const vel = new THREE.Vector3().copy(from.velocity).addScaledVector(dir, speed);
    if (from.kind !== 'aircraft') vel.copy(dir).multiplyScalar(speed);
    _q.setFromUnitVectors(NOSE, dir);
    return this.sim.services.weapons.launch(
      { weaponId, shooter: from, target: spec.target, targetPoint: spec.targetPoint, position: pos, velocity: vel, quaternion: _q.clone() },
      this.sim,
    );
  }

  distanceToPlayer(target: Entity | AirPos | GroundPos): number {
    const p = this.playerRef;
    if (!p) return Infinity;
    if ('position' in target) return target.position.distanceTo(p.position);
    if (isAirPos(target)) return _v.set(target.x, target.alt, target.z).distanceTo(p.position);
    return Math.hypot(target.x - p.position.x, target.z - p.position.z);
  }

  // ------------------------------------------------------------ 무전/마커/점수

  private resolveSpeaker(speaker: Speaker): { name: string; side: RadioMessage['side'] } {
    if (typeof speaker !== 'string') return { name: speaker.radioName, side: speaker.side };
    const m: CastMember | null = findCast(speaker);
    if (m) return { name: m.radioName, side: m.side };
    const ac = this.sim.world.entities.find((e) => e.callsign === speaker);
    if (ac) return { name: speaker, side: this.isHostileToPlayer(ac) ? 'enemy' : ac.faction === (this.playerRef?.faction ?? 'NATO') ? 'friendly' : 'neutral' };
    return { name: speaker, side: 'neutral' };
  }

  say(speaker: Speaker, text: string, opts: RadioLineOpts = {}): number {
    const s = this.resolveSpeaker(speaker);
    const duration = opts.duration ?? radioDuration(text);
    this.sim.services.radio.say({ speaker: s.name, text, side: opts.side ?? s.side, duration, priority: opts.priority ?? DEFAULT_STORY_PRIORITY });
    return duration;
  }

  dialogue(lines: readonly DialogueLine[], opts: { delay?: number; gap?: number; then?: () => void } = {}): TimerHandle {
    const gap = opts.gap ?? 0.4;
    const subs: TimerHandle[] = [];
    const handle = new Handle(() => subs.forEach((h) => h.cancel()));
    let t = opts.delay ?? 0;
    for (const line of lines) {
      const [who, text, lo] = line;
      subs.push(this.after(t, () => this.say(who, text, lo)));
      t += (lo?.duration ?? radioDuration(text)) + gap;
    }
    subs.push(
      this.after(t, () => {
        handle.active = false;
        opts.then?.();
      }),
    );
    return handle;
  }

  addMarker(marker: MapMarker): number {
    const id = this.nextMarkerId++;
    this.markers.push({ ...marker, id });
    return id;
  }

  removeMarker(id: number): void {
    const i = this.markers.findIndex((m) => m.id === id);
    if (i >= 0) this.markers.splice(i, 1);
  }

  addScore(points: number, label: string): void {
    if (this.decided) return;
    this.extraScore.set(label, (this.extraScore.get(label) ?? 0) + points);
  }

  // ------------------------------------------------------------ 실패 판정

  private checkTimeLimit(): void {
    const limit = this.def.timeLimit;
    if (limit == null) return;
    const left = limit - this.clock;
    for (const mark of [60, 30]) {
      if (left <= mark && left > 0 && !this.timeWarned.has(mark) && limit > mark * 2) {
        this.timeWarned.add(mark);
        this.say('lantern', `작전 제한 시간 ${mark}초 남았다.`, { priority: 4 });
      }
    }
    if (left > 0 || this.timeUpFired) return;
    this.timeUpFired = true;
    if (this.timeUpFn) this.safe(this.timeUpFn);
    else {
      this.say('citadel', '제한 시간 초과. 작전을 중지한다. 전 기 귀환하라.', { priority: 8 });
      this.end(false, '제한 시간 초과');
    }
  }

  private checkBounds(step: number): void {
    const p = this.playerRef;
    if (!p || !p.alive) return;
    const r = this.sim.services.terrain.mapRadius || this.def.environment.mapRadius || 100_000;
    const d = Math.hypot(p.position.x, p.position.z);
    if (d <= r) {
      this.oobTime = 0;
      this.oobWarnAt = 0;
      return;
    }
    const limit = this.opts.outOfBoundsTime ?? 15;
    this.oobTime += step;
    if (this.oobTime >= this.oobWarnAt) {
      const left = Math.max(0, Math.ceil(limit - this.oobTime));
      this.say('lantern', `${p.callsign ?? 'Halberd 1'}, 작전 구역을 벗어났다. ${left}초 안에 복귀하라.`, { priority: 7 });
      this.oobWarnAt = this.oobTime + 5;
    }
    if (this.oobTime >= limit) this.end(false, '작전 구역 이탈');
  }

  // ------------------------------------------------------------ 컨텍스트

  private createContext(): MissionContext {
    const r = this;
    const ctx: MissionContext = {
      get sim() {
        return r.sim;
      },
      get def() {
        return r.def;
      },
      get rng() {
        return r.sim.rng;
      },
      get time() {
        return r.clock;
      },
      get player() {
        return r.playerRef;
      },
      get wingmen() {
        return r.wingmenList;
      },
      get vars() {
        return r.vars;
      },
      spawnAir: (s) => r.spawnAir(s),
      spawnGround: (s) => r.spawnGround(s),
      spawnGroup: ((s: AirGroupSpec | GroundGroupSpec) => r.spawnGroup(s as AirGroupSpec)) as MissionContext['spawnGroup'],
      despawn: (e) => r.despawn(e),
      withdraw: (t, o) => r.withdraw(t, o),
      setInvulnerable: (t, on) => r.setInvulnerable(t, on),
      say: (who, text, o) => r.say(who, text, o),
      dialogue: (lines, o) => r.dialogue(lines, o),
      objective: (id, text, o) => r.objective(id, text, o),
      getObjective: (id) => r.objectives.find((o) => o.state.id === id)?.handle ?? null,
      after: (s, fn) => r.after(s, fn),
      every: (s, fn, o) => r.every(s, fn, o),
      when: (c, fn, o) => r.when(c, fn, o),
      countAlive: (t) => r.countAlive(t),
      alive: (t) => r.alive(t),
      onDestroyed: (t, fn) => r.onDestroyed(t, fn),
      onAllDestroyed: (t, fn) => r.onAllDestroyed(t, fn),
      areaTrigger: (c, rad, fn, o) => r.areaTrigger(c, rad, fn, o),
      setRelations: (a: Faction, b: Faction, hostile: boolean) => r.sim.relations.set(a, b, hostile),
      rearmZone: (c, rad, o) => r.rearmZone(c, rad, o),
      launch: (s) => r.launch(s),
      distanceToPlayer: (t) => r.distanceToPlayer(t),
      addScore: (p, l) => r.addScore(p, l),
      addMarker: (m) => r.addMarker(m),
      removeMarker: (id) => r.removeMarker(id),
      setChatter: (on) => {
        if (r.opts.chatter) r.opts.chatter.enabled = on;
      },
      setAutoComplete: (on) => {
        r.autoComplete = on;
      },
      onTimeUp: (fn) => {
        r.timeUpFn = fn;
      },
      end: (success, reason, delay) => r.end(success, reason, delay),
    };
    return ctx;
  }
}
