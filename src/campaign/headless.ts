// 헤드리스 미션 실행 도구: 렌더링/비행/전투 모듈 없이 미션 스크립트를 돌려 본다.
// 테스트, 샌드박스, 통합 전 점검(스폰 id 수집, 스크립트 완주 여부)에 쓴다. 엔티티는 움직이지 않는다.
//
//   const run = dryRunMission(getMission('m01')!, { db: DB });
//   run.result.success; run.spawns.aircraft; run.radio.length;
import * as THREE from 'three';
import type { AircraftLike, FlightTelemetry } from '../core/contracts';
import { Entity } from '../core/entity';
import type { AircraftSpawn, GroundSpawn, LaunchRequest, RadioMessage } from '../core/services';
import { createSim, type Sim } from '../core/sim';
import type { AISkill, EntityKind, TargetClass } from '../core/types';
import type { AircraftDef, GameDatabase } from '../data/schema';
import type { CampaignAircraftSpawn, MissionDef, MissionResult } from './missionTypes';
import { MissionRunner, type MissionRunnerOptions } from './missionRunner';

export const EMPTY_DB: GameDatabase = { aircraft: {}, weapons: {}, modules: {}, units: {} };

function makeTelemetry(): FlightTelemetry {
  return {
    speed: 250,
    ias: 220,
    mach: 0.75,
    altitude: 5000,
    agl: 5000,
    verticalSpeed: 0,
    aoaDeg: 3,
    sideslipDeg: 0,
    gLoad: 1,
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    throttle: 0.8,
    afterburner: false,
    fuelKg: 5000,
    fuelFraction: 1,
    thrustN: 0,
    dragN: 0,
    specificExcessPower: 0,
    stalled: false,
    overG: false,
    sweepDeg: null,
  };
}

export class HeadlessAircraft extends Entity {
  readonly kind = 'aircraft' as const;
  readonly telemetry = makeTelemetry();
  readonly avionics = { missileWarning: false };
  controller = null;
  skill: AISkill | null;
  constructor(
    readonly def: AircraftDef | undefined,
    readonly request: CampaignAircraftSpawn,
  ) {
    super(request.faction, def?.name ?? request.defId);
    this.skill = request.controller === 'player' ? null : (request.skill ?? 'regular');
    this.position.copy(request.position);
    this.callsign = request.callsign ?? null;
    for (const t of request.tags ?? []) this.tags.add(t);
    this.targetClass = 'air';
  }
  update(): void {}
}

export class HeadlessUnit extends Entity {
  readonly kind: EntityKind;
  constructor(readonly request: GroundSpawn, kind: EntityKind, targetClass: TargetClass, name: string) {
    super(request.faction, name);
    this.kind = kind;
    this.targetClass = targetClass;
    this.position.copy(request.position);
    this.callsign = request.callsign ?? null;
    for (const t of request.tags ?? []) this.tags.add(t);
  }
  update(): void {}
}

export class HeadlessMissile extends Entity {
  readonly kind = 'missile' as const;
  constructor(
    readonly weaponId: string,
    readonly shooter: Entity | null,
    public target: Entity | null,
  ) {
    super(shooter?.faction ?? 'NEUTRAL', weaponId);
    this.targetClass = 'weapon';
  }
  update(): void {}
}

export interface HeadlessRecorder {
  aircraft: CampaignAircraftSpawn[];
  ground: GroundSpawn[];
  launches: LaunchRequest[];
  radio: RadioMessage[];
}

/** core Sim + 기록용 스폰/무장/무전 서비스 */
export function createHeadlessSim(opts: { db?: GameDatabase | null; seed?: number } = {}): { sim: Sim; rec: HeadlessRecorder } {
  const db = opts.db ?? EMPTY_DB;
  const sim = createSim({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), db, seed: opts.seed ?? 7 });
  const rec: HeadlessRecorder = { aircraft: [], ground: [], launches: [], radio: [] };
  sim.services.spawn = {
    aircraft(req: AircraftSpawn): AircraftLike {
      rec.aircraft.push(req as CampaignAircraftSpawn);
      const ac = new HeadlessAircraft(db.aircraft[req.defId], req as CampaignAircraftSpawn);
      sim.world.add(ac, sim);
      if (req.controller === 'player') {
        ac.isPlayer = true;
        sim.world.player = ac as unknown as AircraftLike;
      }
      return ac as unknown as AircraftLike;
    },
    ground(req: GroundSpawn): Entity {
      rec.ground.push(req);
      const def = db.units[req.unitId];
      const naval = def?.kind === 'ship' || /ship|frigate|destroyer|cruiser|carrier/.test(req.unitId);
      const structure = def?.kind === 'structure' || /hangar|building|factory|fuel_tank|bunker|comm_tower/.test(req.unitId);
      const e = new HeadlessUnit(req, naval ? 'ship' : structure ? 'structure' : 'ground', naval ? 'sea' : structure ? 'structure' : 'ground', def?.name ?? req.unitId);
      if (def) {
        e.maxHp = e.hp = def.hp;
        e.radius = def.radius;
      }
      sim.world.add(e, sim);
      return e;
    },
  };
  sim.services.weapons = {
    ...sim.services.weapons,
    launch(req: LaunchRequest): Entity | null {
      rec.launches.push(req);
      const m = new HeadlessMissile(req.weaponId, req.shooter, req.target);
      m.position.copy(req.position);
      m.velocity.copy(req.velocity);
      sim.world.add(m, sim);
      sim.events.emit('weaponLaunched', { weapon: m, shooter: req.shooter, target: req.target, weaponId: req.weaponId });
      return m;
    },
  };
  sim.events.on('radio', (m) => rec.radio.push(m));
  return { sim, rec };
}

export interface DryRunOptions {
  db?: GameDatabase | null;
  seed?: number;
  /** 최대 시뮬레이션 시간 (s, 기본 1800) */
  maxSeconds?: number;
  /** 고정 스텝 (s, 기본 0.1 — 스크립트 타이머 해상도 검증에는 충분) */
  step?: number;
  /** 적 제거 간격 (s, 기본 5). 0 이면 제거하지 않음 */
  killInterval?: number;
  /** 이 엔티티를 플레이어가 격추시킬지 (기본: 플레이어에 적대적인 전부) */
  killFilter?: (e: Entity, sim: Sim) => boolean;
  runner?: MissionRunnerOptions;
  /** 매 스텝 runner.fixedUpdate 직후 호출 */
  onStep?: (runner: MissionRunner, sim: Sim) => void;
}

export interface DryRunResult {
  runner: MissionRunner;
  sim: Sim;
  result: MissionResult;
  finished: boolean;
  spawns: { aircraft: string[]; units: string[] };
  radio: RadioMessage[];
  launches: string[];
  /** 전체 스폰/발사/무전 기록 */
  recorder: HeadlessRecorder;
}

/**
 * 미션을 처음부터 끝까지 헤드리스로 돌린다: 플레이어를 다음 웨이포인트 마커로 옮기고,
 * 비행 계기를 튜토리얼 조건이 만족되는 값으로 두고, 주기적으로 적성 엔티티를 플레이어 전과로 격추한다.
 */
export function dryRunMission(def: MissionDef, opts: DryRunOptions = {}): DryRunResult {
  const { sim, rec } = createHeadlessSim({ db: opts.db, seed: opts.seed });
  const runner = new MissionRunner(def, sim, { rearm: () => {}, ...opts.runner });
  runner.start();
  const step = opts.step ?? 0.1;
  const maxSeconds = opts.maxSeconds ?? 1800;
  const killInterval = opts.killInterval ?? 5;
  let killAcc = 0;
  for (let t = 0; t < maxSeconds && !runner.finished; t += step) {
    sim.time += step;
    sim.frame++;
    const player = runner.player as unknown as HeadlessAircraft | null;
    if (player && player.alive) {
      player.telemetry.mach = 0.95;
      player.telemetry.ias = 150;
      const wp = runner.markers.find((m) => m.kind === 'objective' && m.alt != null);
      if (wp) player.position.set(wp.x, wp.alt!, wp.z);
    }
    killAcc += step;
    if (killInterval > 0 && killAcc >= killInterval && player?.alive) {
      killAcc = 0;
      for (const e of sim.world.entities.slice()) {
        if (!e.alive || e.removed || e === player) continue;
        if (!sim.relations.isHostile(player.faction, e.faction)) continue;
        if (e.kind === 'decoy' || e.kind === 'bomb') continue;
        if (opts.killFilter && !opts.killFilter(e, sim)) continue;
        e.applyDamage({ amount: 1e6, kind: 'blast', source: player, weaponId: 'AIM-120D' }, sim);
      }
    }
    runner.fixedUpdate(step, sim);
    opts.onStep?.(runner, sim);
    sim.world.step(0, sim);
  }
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    runner,
    sim,
    result: runner.result(),
    finished: runner.finished,
    spawns: { aircraft: uniq(rec.aircraft.map((r) => r.defId)), units: uniq(rec.ground.map((r) => r.unitId)) },
    radio: rec.radio,
    launches: rec.launches.map((l) => l.weaponId),
    recorder: rec,
  };
}
