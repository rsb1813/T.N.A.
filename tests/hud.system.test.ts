// Hud 시스템 통합 테스트 (node): 가짜 DOM/캔버스 컨텍스트로 이벤트 구독·sim 교체·dispose·모든 그리기 경로를 돌린다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AircraftDamageState, AircraftLike, Avionics, FlightTelemetry, LockState, StoreGroup, Stores, Threat, Track } from '../src/core/contracts';
import { Entity } from '../src/core/entity';
import { createSim, type Sim } from '../src/core/sim';
import type { MissionState } from '../src/core/services';
import type { EntityKind, Faction, TargetClass } from '../src/core/types';
import type { DerivedStats, GameDatabase, WeaponDef } from '../src/data/schema';
import { Hud } from '../src/ui/hud';

// ---------------------------------------------------------------- 가짜 DOM

interface FakeCtxLog {
  texts: string[];
}

function fakeContext(log: FakeCtxLog): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillText: (t: string) => {
      log.texts.push(t);
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    getLineDash: () => [],
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

interface FakeEl {
  style: Record<string, string>;
  children: FakeEl[];
  parent: FakeEl | null;
  width: number;
  height: number;
  className: string;
  ownerDocument: FakeDoc;
  append(...els: FakeEl[]): void;
  appendChild(el: FakeEl): FakeEl;
  remove(): void;
  getBoundingClientRect(): { width: number; height: number };
  getContext(kind: string): CanvasRenderingContext2D | null;
}

interface FakeDoc {
  body: FakeEl;
  defaultView: {
    devicePixelRatio: number;
    innerWidth: number;
    innerHeight: number;
    getComputedStyle(el: FakeEl): { position: string };
    addEventListener(t: string, fn: () => void): void;
    removeEventListener(t: string, fn: () => void): void;
    listeners: number;
  };
  createElement(tag: string): FakeEl;
  log: FakeCtxLog;
}

function fakeDocument(): FakeDoc {
  const log: FakeCtxLog = { texts: [] };
  const doc = {} as FakeDoc;
  const make = (tag: string): FakeEl => {
    const el: FakeEl = {
      style: {},
      children: [],
      parent: null,
      width: 0,
      height: 0,
      className: '',
      ownerDocument: doc,
      append(...els) {
        for (const e of els) this.appendChild(e);
      },
      appendChild(e) {
        e.parent = this;
        this.children.push(e);
        return e;
      },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
      },
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
      getContext: () => (tag === 'canvas' ? fakeContext(log) : null),
    };
    return el;
  };
  doc.log = log;
  doc.createElement = make;
  doc.body = make('body');
  doc.defaultView = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    getComputedStyle: () => ({ position: 'fixed' }),
    listeners: 0,
    addEventListener() {
      this.listeners++;
    },
    removeEventListener() {
      this.listeners--;
    },
  };
  return doc;
}

// ---------------------------------------------------------------- 가짜 시뮬레이션 객체

const db: GameDatabase = { aircraft: {}, weapons: {}, modules: {}, units: {} };

function weapon(id: string, over: Partial<WeaponDef> & Pick<WeaponDef, 'category'>): WeaponDef {
  return { id, name: id, description: '', users: ['NATO'], massKg: 100, dragArea: 0.02, rcsAdd: 0.05, unlock: { cost: 0 }, ...over };
}
const GUN = weapon('M61A2', { category: 'gun', gun: { caliberMm: 20, rpm: 6000, muzzleVelocity: 1030, damage: 8, dispersionMil: 5, rangeM: 1800 } });
const AIM120 = weapon('AIM-120D', { category: 'aam_radar', envelope: { rMinKm: 1.2, rMaxKm: 62, rNezKm: 22 } });
const MK82 = weapon('Mk 82', { category: 'bomb_dumb', massKg: 241, body: { diameterM: 0.273, lengthM: 2.2, cd0: 0.25, maxG: 0 } });

class Dummy extends Entity {
  readonly kind: EntityKind;
  constructor(kind: EntityKind, faction: Faction, name: string, tc: TargetClass) {
    super(faction, name);
    this.kind = kind;
    this.targetClass = tc;
  }
  update(): void {}
}

function stats(): DerivedStats {
  return {
    radar: { type: 'AESA', rangeKm: 150, azimuthDeg: 60, maxTracks: 20, maxGuided: 6, lpi: 0.5, eccm: 0.5, groundModes: true },
    rwr: { bearingErrorDeg: 3, identify: true, launchWarning: true, lpiDetect: 0.5 },
    maw: null,
    ew: { jamPower: 0.5, coverageDeg: 60, towedDecoys: 0 },
    cornerSpeed: 180,
    aoaMaxDeg: 25,
    gun: { weaponId: 'M61A2', rounds: 940 },
  } as DerivedStats;
}

function makePlayer(): AircraftLike & { av: Avionics & { lock: LockState; tracksArr: Track[]; threatsArr: Threat[]; tgt: Track | null }; st: Stores & { groupsArr: StoreGroup[] } } {
  const p = new Dummy('aircraft', 'NATO', 'F-15EX Eagle II', 'air') as unknown as AircraftLike & Record<string, unknown>;
  p.isPlayer = true;
  p.position.set(0, 6000, 0);
  p.velocity.set(0, 0, -250);
  const tel: FlightTelemetry = {
    speed: 250,
    ias: 180,
    mach: 0.8,
    altitude: 6000,
    agl: 6000,
    verticalSpeed: 0,
    aoaDeg: 4,
    sideslipDeg: 0,
    gLoad: 1.2,
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 75,
    throttle: 1,
    afterburner: true,
    fuelKg: 500,
    fuelFraction: 0.1,
    thrustN: 0,
    dragN: 0,
    specificExcessPower: 0,
    stalled: true,
    overG: true,
    sweepDeg: 40,
  };
  const av = {
    radarMode: 'tws',
    tracksArr: [] as Track[],
    threatsArr: [] as Threat[],
    tgt: null as Track | null,
    get tracks() {
      return this.tracksArr;
    },
    get target() {
      return this.tgt;
    },
    get threats() {
      return this.threatsArr;
    },
    missileWarning: true,
    jammerActive: true,
    lock: { status: 'locked', progress: 1, target: null } as LockState,
    update() {},
    setRadarMode() {},
    cycleTarget() {},
    targetNearestToBoresight() {},
    designate() {},
    lockState() {
      return this.lock;
    },
    isTracked: () => true,
  };
  const st = {
    gun: { def: GUN, rounds: 50, firing: true },
    groupsArr: [] as StoreGroup[],
    get groups() {
      return this.groupsArr;
    },
    selected: 0,
    chaff: 0,
    flares: 3,
    massKg: 0,
    dragArea: 0,
    rcsAdd: 0,
    externalFuelKg: 0,
    update() {},
    selectNext() {},
    selectedDef() {
      return this.groupsArr[this.selected]?.def ?? null;
    },
    setGunTrigger() {},
    fire: () => null,
    dropFlare() {},
    dropChaff() {},
    jettison() {},
    launchZone(target: Entity | null) {
      if (!target) return null;
      const range = p.position.distanceTo(target.position);
      return { rMin: 1200, rMax: 62_000, rNez: 22_000, range, inRange: range < 62_000, inNez: range < 22_000 };
    },
  };
  const damage: AircraftDamageState = { engine: 0.5, wings: 0.8, control: 0.1, fuelLeak: true, onFire: true };
  Object.assign(p, {
    kind: 'aircraft',
    telemetry: tel,
    avionics: av,
    stores: st,
    stats: stats(),
    damageState: damage,
    controller: { update() {}, aimDirection: new THREE.Vector3(0.1, 0, -1).normalize() },
    skill: null,
    av,
    st,
    getGunWorldPosition: (out: THREE.Vector3) => out.copy(p.position),
    getStationWorldPosition: (_id: string, out: THREE.Vector3) => out.copy(p.position),
  });
  p.maxHp = 100;
  p.hp = 40;
  return p as never;
}

function track(e: Entity, over: Partial<Track> = {}): Track {
  return {
    entity: e,
    id: e.id,
    position: e.position.clone(),
    velocity: e.velocity.clone(),
    source: 'radar',
    lastUpdate: 0,
    quality: 1,
    identified: true,
    hostile: true,
    rangeM: 0,
    ...over,
  };
}

function newSim(): Sim {
  const sim = createSim({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 400_000), db });
  sim.camera.aspect = 1280 / 720;
  sim.camera.updateProjectionMatrix();
  return sim;
}

function mission(): MissionState {
  return {
    id: 'm01',
    title: '시험 임무',
    elapsed: 10,
    timeLeft: 30,
    score: 100,
    kills: 0,
    objectives: [
      { id: 'a', text: '표적 파괴', status: 'active', primary: true, progress: { current: 0, total: 2 } },
      { id: 'b', text: '보조 목표', status: 'active', primary: false },
    ],
    result: null,
  };
}

let doc: FakeDoc;
const g = globalThis as unknown as { performance?: Performance };

beforeEach(() => {
  doc = fakeDocument();
  if (!g.performance) g.performance = { now: () => Date.now() } as Performance;
});

afterEach(() => {
  doc.log.texts.length = 0;
});

function mount(): Hud {
  return new Hud(doc.body as unknown as HTMLElement);
}

describe('Hud system', () => {
  it('mounts two full-screen canvases and sizes them DPR-aware on first update', () => {
    const hud = mount();
    expect(doc.body.children.length).toBe(1);
    const root = doc.body.children[0];
    expect(root.children.length).toBe(2);
    expect(root.style.pointerEvents).toBe('none');
    doc.defaultView.devicePixelRatio = 2;
    hud.update(1 / 60, newSim());
    const [glow, main] = root.children;
    expect(main.width).toBe(2560);
    expect(main.height).toBe(1440);
    expect(glow.width).toBe(640);
    hud.dispose();
  });

  it('draws only radio/mission info without a player and re-subscribes on sim change', () => {
    const hud = mount();
    const sim1 = newSim();
    sim1.services.mission = { state: mission() };
    hud.update(0.016, sim1);
    sim1.events.emit('radio', { speaker: 'AWACS Bellwether', text: '교전을 허가한다.', side: 'command', priority: 1 });
    doc.log.texts.length = 0;
    hud.update(0.5, sim1);
    expect(doc.log.texts).toContain('AWACS Bellwether');
    expect(doc.log.texts).toContain('시험 임무');
    expect(doc.log.texts).not.toContain('GUN');

    const sim2 = newSim();
    hud.update(0.016, sim2); // 교체: 대기열 초기화 + sim1 구독 해제
    sim1.events.emit('radio', { speaker: 'Old Sim', text: '무시되어야 한다.' });
    sim2.events.emit('radio', { speaker: 'Halberd 2', text: '알겠다.', side: 'friendly' });
    doc.log.texts.length = 0;
    hud.update(0.5, sim2);
    expect(doc.log.texts).toContain('Halberd 2');
    expect(doc.log.texts).not.toContain('Old Sim');
    expect(doc.log.texts).not.toContain('AWACS Bellwether');
    hud.dispose();
  });

  it('renders the full player HUD with lock, threats, warnings and events', () => {
    const hud = mount();
    const sim = newSim();
    sim.services.mission = { state: mission() };
    const p = makePlayer();
    sim.world.add(p, sim);
    sim.world.player = p;
    sim.settings.controlMode = 'mouseAim';
    sim.camera.position.set(0, 6007, 34);
    sim.camera.updateMatrixWorld();

    const tgt = new Dummy('aircraft', 'WARSAW', 'Su-35S', 'air');
    tgt.position.set(500, 6100, -15_000);
    tgt.velocity.set(0, 0, 250);
    tgt.tags.add('target');
    sim.world.add(tgt, sim);
    const close = new Dummy('aircraft', 'WARSAW', 'MiG-29S', 'air');
    close.position.set(-40, 6010, -800);
    sim.world.add(close, sim);
    const sam = new Dummy('ground', 'WARSAW', 'SA-10 TEL', 'ground');
    sam.position.set(2000, 0, -9000);
    sim.world.add(sam, sim);
    const wing = new Dummy('aircraft', 'NATO', 'F-15EX Eagle II', 'air');
    wing.callsign = 'Halberd 2';
    wing.position.set(150, 6000, -400);
    sim.world.add(wing, sim);
    const behind = new Dummy('aircraft', 'WARSAW', 'Su-27S', 'air');
    behind.position.set(0, 6000, 20_000);
    sim.world.add(behind, sim);

    const t = track(tgt);
    p.av.tracksArr.push(t, track(close, { identified: false }), track(sam), track(behind, { source: 'datalink' }));
    p.av.tgt = t;
    p.av.lock.target = tgt;
    p.st.groupsArr.push({ weaponId: 'AIM-120D', def: AIM120, count: 4, stations: [] }, { weaponId: 'Mk 82', def: MK82, count: 0, stations: [] });
    p.av.threatsArr.push(
      { kind: 'missile', source: tgt, bearingDeg: 150, elevationDeg: 20, rangeM: 3000, timeToImpact: 2.5, detectedBy: 'maw', label: 'MSL' },
      { kind: 'launch', source: tgt, bearingDeg: 3, elevationDeg: 0, rangeM: null, timeToImpact: null, detectedBy: 'rwr', label: 'Su-35' },
      { kind: 'track', source: sam, bearingDeg: 20, elevationDeg: -30, rangeM: null, timeToImpact: null, detectedBy: 'rwr', label: 'SA-10' },
      { kind: 'search', source: sam, bearingDeg: -90, elevationDeg: 0, rangeM: null, timeToImpact: null, detectedBy: 'rwr', label: 'EWR' },
    );

    hud.update(0.016, sim);
    // 이벤트: 내 미사일 발사 → 빗나감, 명중, 격파(+점수), 피격, 목표 변경, 임무 종료
    const msl = new Dummy('missile', 'NATO', 'AIM-120D', 'weapon');
    sim.world.add(msl, sim);
    sim.events.emit('weaponLaunched', { weapon: msl, shooter: p, target: tgt, weaponId: 'AIM-120D' });
    sim.events.emit('weaponMissed', { weapon: msl, target: tgt });
    sim.events.emit('damaged', { entity: sam, info: { amount: 5, kind: 'kinetic', source: p, weaponId: 'M61A2' } });
    sim.events.emit('damaged', { entity: close, info: { amount: 50, kind: 'blast', source: p, weaponId: 'AIM-9X' } });
    sim.events.emit('destroyed', { entity: close, by: p, weaponId: 'AIM-9X', cause: 'blast' });
    sim.events.emit('damaged', { entity: p, info: { amount: 5, kind: 'blast', source: tgt, weaponId: 'R-77' } });
    sim.services.mission.state!.score += 900;
    sim.services.mission.state!.objectives[0].status = 'complete';
    sim.events.emit('objectiveChanged', { id: 'a' });
    sim.events.emit('missionEnded', { result: 'failure', reason: '시간 초과' });

    doc.log.texts.length = 0;
    // 깜빡임 '켜짐' 위상까지 진행
    hud.update(0.034, sim);
    const T = doc.log.texts;
    const missing: string[] = [];
    for (const s of ['MISSILE', 'LOCK', 'TGT', 'Su-35S', 'UNK', 'Halberd 2', 'AIM-120D', '×4', 'GUN', 'MISSED', '격파', 'DESTROYED', 'STALL', 'OVER-G', 'BINGO FUEL', '목표 달성', '임무 실패', '시간 초과', '+900', 'RWR', 'MAW 없음', 'JAM ON']) {
      if (!T.includes(s)) missing.push(s);
    }
    expect(missing).toEqual([]);
    expect(T.some((x) => x.startsWith('Vc '))).toBe(true);
    expect(T.some((x) => x.startsWith('ASP '))).toBe(true);
    expect(T.some((x) => x === '2.5')).toBe(true); // MAW 충돌시간

    // 무유도 폭탄 선택 → CCIP 경로, 단위 metric
    p.st.selected = 1;
    sim.settings.units = 'metric';
    p.telemetry.agl = 200;
    p.telemetry.verticalSpeed = -80;
    expect(() => hud.update(0.016, sim)).not.toThrow();
    expect(doc.log.texts).toContain('PULL UP');
    expect(hud.lastFrameMs).toBeGreaterThanOrEqual(0);
    hud.dispose();
  });

  it('hides without drawing and cleans up on dispose', () => {
    const hud = mount();
    const sim = newSim();
    hud.update(0.016, sim);
    hud.setVisible(false);
    expect(doc.body.children[0].style.display).toBe('none');
    sim.events.emit('radio', { speaker: 'Hidden', text: '숨김 중 수신' });
    doc.log.texts.length = 0;
    hud.update(0.3, sim);
    expect(doc.log.texts.length).toBe(0);
    hud.setVisible(true);
    hud.update(0.3, sim);
    expect(doc.log.texts).toContain('Hidden'); // 숨김 중에도 대기열은 유지

    const listenersBefore = doc.defaultView.listeners;
    hud.dispose();
    expect(doc.body.children.length).toBe(0);
    expect(doc.defaultView.listeners).toBe(listenersBefore - 1);
    expect(() => sim.events.emit('radio', { speaker: 'After', text: 'x' })).not.toThrow();
    doc.log.texts.length = 0;
    hud.update(0.1, sim);
    expect(doc.log.texts.length).toBe(0);
    hud.dispose();
  });
});
