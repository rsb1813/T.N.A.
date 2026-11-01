import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// data 모듈과 독립적으로 테스트한다 (고정 데이터 사용)
vi.mock('../src/data/index', async () => {
  const f = await import('../src/flight/fixtures');
  return { computeStats: () => f.FIXTURE_F16_STATS };
});

import { Aircraft } from '../src/flight/aircraft';
import { PlayerController } from '../src/flight/playerController';
import { InputManager } from '../src/flight/input';
import { FIXTURE_F14_STATS, FIXTURE_F16_DEF, FIXTURE_F16_LOADOUT, FIXTURE_F16_STATS } from '../src/flight/fixtures';
import { createSim, type Sim } from '../src/core/sim';
import type { Avionics, LaunchZone, Stores, StoreGroup, Track } from '../src/core/contracts';
import type { FxService, ToneId } from '../src/core/services';
import type { AircraftDef, GameDatabase, ModuleDef, WeaponDef } from '../src/data/schema';
import { angleBetween, DEG } from '../src/core/math';

const DT = 1 / 60;

interface Harness {
  sim: Sim;
  calls: string[];
  tones: Map<ToneId, boolean>;
  fx: { explosions: Array<{ kind?: string }>; trails: string[]; afterburner: number; vapor: number };
  stores: Stores & { fired: number; flaresDropped: number; chaffDrops: number; jettisoned: number; gunOn: boolean };
  avionics: Avionics & { cycled: number; boresight: number };
}

function makeHarness(opts: { water?: boolean; ground?: number; db?: Partial<GameDatabase> } = {}): Harness {
  const db: GameDatabase = { aircraft: {}, weapons: {}, modules: {}, units: {}, ...opts.db };
  const sim = createSim({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), db, seed: 7 });
  const calls: string[] = [];
  const tones = new Map<ToneId, boolean>();
  const fxRec = { explosions: [] as Array<{ kind?: string }>, trails: [] as string[], afterburner: 0, vapor: 0 };
  const handle = { stop() {} };
  const fx: FxService = {
    explosion: (_p, o) => fxRec.explosions.push({ kind: o?.kind }),
    missileTrail: () => handle,
    damageTrail: (_e, kind) => {
      fxRec.trails.push(kind);
      return handle;
    },
    tracer() {},
    decoy: () => handle,
    hit() {},
    afterburner: () => {
      fxRec.afterburner++;
      return handle;
    },
    vapor: () => {
      fxRec.vapor++;
      return handle;
    },
    shake() {},
    shakeAmount: 0,
  };
  sim.services.fx = fx;
  sim.services.audio = { play() {}, loop: () => ({ set() {}, stop() {} }), setTone: (id, on) => tones.set(id, on), setListener() {} };
  sim.services.terrain = {
    heightAt: () => opts.ground ?? 0,
    isWater: () => opts.water ?? false,
    normalAt: (_x, _z, out) => out.set(0, 1, 0),
    lineOfSight: () => true,
    mapRadius: 100_000,
  };
  const gunDef = { id: 'M61A2' } as WeaponDef;
  const aamDef = { id: 'AIM-9X', category: 'aam_ir' } as WeaponDef;
  const stores = {
    gun: { def: gunDef, rounds: 510, firing: false },
    groups: [{ weaponId: 'AIM-9X', def: aamDef, count: 2, stations: ['L1', 'R1'] }] as StoreGroup[],
    selected: 0,
    chaff: 60,
    flares: 60,
    massKg: 170,
    dragArea: 0.05,
    rcsAdd: 0.2,
    externalFuelKg: 0,
    fired: 0,
    flaresDropped: 0,
    chaffDrops: 0,
    jettisoned: 0,
    gunOn: false,
    update: () => calls.push('stores'),
    selectNext() {},
    selectedDef: () => aamDef,
    setGunTrigger(on: boolean) {
      stores.gunOn = on;
    },
    fire: () => {
      stores.fired++;
      return null;
    },
    dropFlare: () => {
      stores.flaresDropped++;
    },
    dropChaff: () => {
      stores.chaffDrops++;
    },
    jettison: () => {
      stores.jettisoned++;
    },
    launchZone: (): LaunchZone | null => null,
  };
  const avionics = {
    radarMode: 'rws' as const,
    tracks: [] as Track[],
    target: null as Track | null,
    threats: [],
    missileWarning: false,
    jammerActive: false,
    cycled: 0,
    boresight: 0,
    update: () => calls.push('avionics'),
    setRadarMode() {},
    cycleTarget: () => {
      avionics.cycled++;
    },
    targetNearestToBoresight: () => {
      avionics.boresight++;
    },
    designate() {},
    lockState: () => ({ status: 'none' as const, progress: 0, target: null }),
    isTracked: () => false,
  };
  sim.services.weapons = {
    launch: () => null,
    fireGun() {},
    dropDecoy: () => null,
    createAvionics: () => avionics as unknown as Avionics,
    createStores: () => stores as unknown as Stores,
    applyBlast() {},
  };
  return {
    sim,
    calls,
    tones,
    fx: fxRec,
    stores: stores as unknown as Harness['stores'],
    avionics: avionics as unknown as Harness['avionics'],
  };
}

function spawn(h: Harness, opts: { alt?: number; speed?: number; heading?: number; def?: AircraftDef; model?: THREE.Object3D; stats?: typeof FIXTURE_F16_STATS } = {}): Aircraft {
  const ac = new Aircraft({ def: opts.def ?? FIXTURE_F16_DEF, loadout: FIXTURE_F16_LOADOUT, faction: 'NATO', sim: h.sim, callsign: 'Lancer 1', model: opts.model, stats: opts.stats });
  ac.placeAt(new THREE.Vector3(0, opts.alt ?? 5000, 0), opts.heading ?? 0, opts.speed ?? 250);
  h.sim.world.add(ac, h.sim);
  return ac;
}

function stepWorld(h: Harness, secs: number, each?: () => void): void {
  for (let i = 0; i < Math.round(secs / DT); i++) {
    h.sim.time += DT;
    h.sim.frame++;
    h.sim.world.step(DT, h.sim);
    each?.();
  }
}

describe('Aircraft 생성', () => {
  it('성능/연료/RCS/효과 연결', () => {
    const h = makeHarness();
    const ac = spawn(h);
    expect(ac.kind).toBe('aircraft');
    expect(ac.callsign).toBe('Lancer 1');
    expect(ac.stats).toBe(FIXTURE_F16_STATS);
    expect(ac.flight.internalFuelKg).toBeCloseTo(FIXTURE_F16_STATS.fuelCapacityKg, 6);
    expect(ac.telemetry.headingDeg).toBeCloseTo(0, 3);
    expect(ac.telemetry.speed).toBeCloseTo(250, 3);
    expect(h.fx.afterburner).toBe(1);
    expect(h.fx.vapor).toBe(1);
    expect(ac.hp).toBe(ac.maxHp);
    stepWorld(h, 0.1);
    // stats.rcs 는 외부 무장 포함 → 기체 고유분 + 현재 무장분
    expect(ac.rcs).toBeCloseTo(FIXTURE_F16_STATS.rcs, 6);
    (h.stores as { rcsAdd: number }).rcsAdd = 0;
    stepWorld(h, DT);
    expect(ac.rcs).toBeCloseTo(FIXTURE_F16_STATS.rcs - 0.2, 6);
  });

  it('스텝 순서: controller → avionics → 비행모델 → stores', () => {
    const h = makeHarness();
    const ac = spawn(h);
    ac.controller = {
      update: (a) => {
        h.calls.push('controller');
        a.controls.pitch = 0.3;
      },
    };
    const y0 = ac.position.clone();
    stepWorld(h, DT);
    expect(h.calls).toEqual(['controller', 'avionics', 'stores']);
    expect(ac.position.distanceTo(y0)).toBeGreaterThan(3);
  });

  it('세력 도장 + opt_* 노드 + 모델 empty', () => {
    const paint = new THREE.MeshStandardMaterial({ name: 'paint', color: 0xffffff });
    const dark = new THREE.MeshStandardMaterial({ name: 'paint_dark', color: 0xffffff });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 10), paint));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 2), dark));
    const cft = new THREE.Group();
    cft.name = 'opt_cft';
    const irst = new THREE.Group();
    irst.name = 'opt_irst';
    const station = new THREE.Object3D();
    station.name = 'station_L1';
    station.position.set(-4, -0.2, 1.5);
    const nozzle = new THREE.Object3D();
    nozzle.name = 'nozzle';
    nozzle.position.set(0, 0.1, 7.4);
    const cockpit = new THREE.Object3D();
    cockpit.name = 'cockpit';
    cockpit.position.set(0, 1, -4);
    const aileron = new THREE.Object3D();
    aileron.name = 'aileron_L';
    root.add(cft, irst, station, nozzle, cockpit, aileron);
    const moduleDef = { id: 'cft_test', slot: 'wing', name: 'CFT', description: '', massKg: 0, unlock: { cost: 0 }, visual: { show: ['opt_cft'] } } as ModuleDef;
    const def: AircraftDef = { ...FIXTURE_F16_DEF, modules: { ...FIXTURE_F16_DEF.modules, wing: { default: 'cft_test', allowed: ['cft_test'] } } };
    const h = makeHarness({ db: { modules: { cft_test: moduleDef } } });
    const ac = spawn(h, { def, model: root });
    expect(paint.color.getHexString()).toBe('ffffff'); // 원본 머티리얼은 그대로 (복제 후 도장)
    const meshes: THREE.Mesh[] = [];
    ac.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect((meshes[0].material as THREE.MeshStandardMaterial).color.getHexString()).toBe('8e98a3');
    expect((meshes[1].material as THREE.MeshStandardMaterial).color.getHexString()).toBe('6c7783');
    expect(cft.visible).toBe(true);
    expect(irst.visible).toBe(false);
    expect(ac.nozzleLocals.map((v) => v.toArray())).toEqual([[0, 0.1, 7.4]]);
    expect(ac.cockpitLocal.toArray()).toEqual([0, 1, -4]);
    // 스테이션: 모델 empty 우선, 없으면 StationDef.position
    const out = new THREE.Vector3();
    ac.getStationLocalPosition('L1', out);
    expect(out.toArray()).toEqual([-4, -0.2, 1.5]);
    ac.getStationLocalPosition('R1', out);
    expect(out.toArray()).toEqual([4.9, 0, 1.6]);
    // 에일러론: 오른쪽 롤 → 왼쪽 에일러론 뒷전 내림 (+X 회전)
    ac.controls.roll = 1;
    for (let i = 0; i < 30; i++) ac.update(DT, h.sim);
    const e = new THREE.Euler().setFromQuaternion(aileron.quaternion);
    expect(e.x).toBeGreaterThan(10 * DEG);
  });

  it('스테이션/총구 월드 좌표는 자세를 따른다', () => {
    const h = makeHarness();
    const ac = spawn(h, { heading: 90 });
    const p = ac.getStationWorldPosition('L1', new THREE.Vector3());
    // 동쪽을 향하면 왼쪽 날개 = 북쪽(-Z)
    expect(p.z - ac.position.z).toBeLessThan(-4);
    const g = ac.getGunWorldPosition(new THREE.Vector3());
    expect(g.x - ac.position.x).toBeGreaterThan(1); // 총구는 기수 쪽
  });
});

describe('Aircraft 피해/격추', () => {
  it('플레이어 받는 피해 = 난이도 배율, 부위 피해, 연기/화염', () => {
    const h = makeHarness();
    const ac = spawn(h);
    ac.isPlayer = true;
    h.sim.settings.difficulty = 'normal';
    const hp0 = ac.hp;
    ac.applyDamage({ amount: 40, kind: 'kinetic', source: null, weaponId: 'GSh-30-1' }, h.sim);
    expect(hp0 - ac.hp).toBeCloseTo(40 * 0.6, 6);
    const ds = ac.damageState;
    expect(ds.engine + ds.wings + ds.control).toBeGreaterThan(0);
    ac.applyDamage({ amount: 50, kind: 'blast', source: null, weaponId: 'R-73' }, h.sim);
    expect(ac.hp / ac.maxHp).toBeLessThan(0.5);
    expect(h.fx.trails).toContain('smoke');
    ac.applyDamage({ amount: 40, kind: 'blast', source: null, weaponId: 'R-73' }, h.sim);
    expect(ac.hp / ac.maxHp).toBeLessThan(0.25);
    expect(h.fx.trails).toContain('fire');
    expect(ac.damageState.onFire).toBe(true);
    expect(ac.alive).toBe(true);
  });

  it('격추: 화염 나선 추락 후 최대 ~6 s 안에 폭발/제거', () => {
    const h = makeHarness();
    const ac = spawn(h, { alt: 8000 });
    const destroyed: string[] = [];
    h.sim.events.on('destroyed', (e) => destroyed.push(e.cause));
    ac.applyDamage({ amount: 500, kind: 'blast', source: null, weaponId: 'R-77' }, h.sim);
    expect(ac.alive).toBe(false);
    expect(destroyed).toEqual(['blast']);
    expect(h.fx.trails).toContain('fire');
    const roll0 = ac.telemetry.rollDeg;
    let maxRollChange = 0;
    stepWorld(h, 7, () => {
      if (!ac.removed) maxRollChange = Math.max(maxRollChange, Math.abs(ac.telemetry.rollDeg - roll0));
    });
    expect(maxRollChange).toBeGreaterThan(30); // 통제 불능 롤
    expect(ac.removed).toBe(true);
    expect(h.fx.explosions.length).toBeGreaterThan(0);
    expect(h.sim.world.entities).not.toContain(ac);
  });

  it('지형 충돌: 폭발 + crash 처리 + 제거 (바다면 물보라)', () => {
    for (const water of [false, true]) {
      const h = makeHarness({ water });
      const ac = spawn(h, { alt: 300, speed: 250 });
      ac.placeAt(new THREE.Vector3(0, 300, 0), 0, 250, { pathDeg: -45 });
      const causes: string[] = [];
      h.sim.events.on('destroyed', (e) => causes.push(e.cause));
      stepWorld(h, 3);
      expect(ac.removed).toBe(true);
      expect(causes).toEqual(['crash']);
      expect(h.fx.explosions.some((e) => e.kind === (water ? 'water' : 'ground'))).toBe(true);
    }
  });

  it('리미터를 끈 플레이어의 과G 는 날개 손상으로 누적', () => {
    const h = makeHarness();
    h.sim.settings.assists.flightLimiter = false;
    const ac = spawn(h, { alt: 1000, speed: 350 });
    ac.isPlayer = true;
    ac.controller = { update: (a) => ((a.controls.pitch = 1), (a.controls.throttle = 1)) };
    stepWorld(h, 1.5);
    expect(ac.damageState.wings).toBeGreaterThan(0.1);
    expect(ac.hp).toBeLessThan(ac.maxHp);
    expect(h.tones.get('overg')).toBe(true);
  });
});

describe('Aircraft 경고음 (플레이어)', () => {
  it('실속 / 지면 접근 / 연료 부족', () => {
    const h = makeHarness();
    const ac = spawn(h, { alt: 3000, speed: 60 });
    ac.isPlayer = true;
    ac.controller = { update: (a) => (a.controls.throttle = 0) };
    stepWorld(h, 0.5);
    expect(h.tones.get('stall')).toBe(true);

    const h2 = makeHarness();
    const ac2 = spawn(h2, { alt: 600 });
    ac2.placeAt(new THREE.Vector3(0, 600, 0), 0, 250, { pathDeg: -40 });
    ac2.isPlayer = true;
    stepWorld(h2, 0.3);
    expect(h2.tones.get('pull_up')).toBe(true);

    const h3 = makeHarness();
    const ac3 = spawn(h3);
    ac3.isPlayer = true;
    ac3.flight.internalFuelKg = FIXTURE_F16_STATS.fuelCapacityKg * 0.1;
    stepWorld(h3, 0.2);
    expect(h3.tones.get('low_fuel')).toBe(true);
    expect(h3.tones.get('pull_up') ?? false).toBe(false);
    // 격추되면 모두 꺼진다
    ac3.applyDamage({ amount: 999, kind: 'blast', source: null, weaponId: null }, h3.sim);
    expect(h3.tones.get('low_fuel')).toBe(false);
  });
});

describe('가변익 시각', () => {
  it('wing_L / wing_R 가 후퇴각만큼 회전', () => {
    const root = new THREE.Group();
    const wl = new THREE.Object3D();
    wl.name = 'wing_L';
    const wr = new THREE.Object3D();
    wr.name = 'wing_R';
    root.add(wl, wr);
    const def: AircraftDef = { ...FIXTURE_F16_DEF, variableSweep: { minDeg: 20, maxDeg: 68 } };
    const h = makeHarness();
    const ac = spawn(h, { def, model: root, stats: FIXTURE_F14_STATS, speed: 450, alt: 9000 });
    stepWorld(h, 0.1);
    const sweep = ac.telemetry.sweepDeg!;
    expect(sweep).toBeGreaterThan(50);
    const yl = new THREE.Euler().setFromQuaternion(wl.quaternion, 'YXZ').y;
    const yr = new THREE.Euler().setFromQuaternion(wr.quaternion, 'YXZ').y;
    expect(yl / DEG).toBeCloseTo(sweep - 20, 0);
    expect(yr / DEG).toBeCloseTo(-(sweep - 20), 0);
  });
});

describe('PlayerController', () => {
  function playerSetup(alt = 5000, speed = 250) {
    const h = makeHarness();
    const ac = spawn(h, { alt, speed });
    ac.isPlayer = true;
    const input = new InputManager({ gamepads: () => [] });
    const pc = new PlayerController(input, h.sim);
    ac.controller = pc;
    return { h, ac, input, pc };
  }

  it('표준 모드: 피치 키, 반전 설정, 에이스컴뱃식 스로틀', () => {
    const { h, ac, input } = playerSetup();
    stepWorld(h, DT);
    expect(ac.controls.throttle).toBe(0.75);
    expect(ac.controls.afterburner).toBe(false);
    input.handleKey('KeyS', true);
    stepWorld(h, 0.5);
    expect(ac.controls.pitch).toBeGreaterThan(0.9);
    h.sim.settings.invertPitch = true;
    stepWorld(h, DT);
    expect(ac.controls.pitch).toBeLessThan(-0.9);
    input.handleKey('KeyS', false);
    h.sim.settings.invertPitch = false;
    input.handleKey('ShiftLeft', true);
    stepWorld(h, DT);
    expect(ac.controls.throttle).toBe(1);
    expect(ac.controls.afterburner).toBe(true);
    input.handleKey('ShiftLeft', false);
    input.handleKey('ControlLeft', true);
    stepWorld(h, DT);
    expect(ac.controls.throttle).toBe(0);
    expect(ac.controls.airbrake).toBe(true);
  });

  it('무장/표적/디코이/UI 동작', () => {
    const { h, input } = playerSetup();
    const ui: string[] = [];
    const wing: string[] = [];
    h.sim.events.on('uiAction', (e) => ui.push(e.action));
    h.sim.events.on('wingmanCommand', (e) => wing.push(e.command));
    input.handleKey('Space', true);
    stepWorld(h, 0.2);
    input.handleKey('Space', false);
    expect(h.stores.fired).toBe(1);
    input.handleMouseButton(0, true);
    stepWorld(h, DT);
    expect(h.stores.gunOn).toBe(true);
    input.handleMouseButton(0, false);
    stepWorld(h, DT);
    expect(h.stores.gunOn).toBe(false);
    // Tab 짧게 = 순환, 길게 = 정면 표적
    input.handleKey('Tab', true);
    stepWorld(h, 0.1);
    input.handleKey('Tab', false);
    stepWorld(h, DT);
    expect(h.avionics.cycled).toBe(1);
    input.handleKey('Tab', true);
    stepWorld(h, 0.6);
    input.handleKey('Tab', false);
    stepWorld(h, DT);
    expect(h.avionics.boresight).toBe(1);
    expect(h.avionics.cycled).toBe(1);
    // C = 플레어 + 채프
    input.handleKey('KeyC', true);
    stepWorld(h, DT);
    input.handleKey('KeyC', false);
    expect(h.stores.flaresDropped).toBe(1);
    expect(h.stores.chaffDrops).toBe(1);
    for (const k of ['Digit1', 'Digit4', 'KeyV', 'KeyM', 'Escape', 'KeyT']) {
      input.handleKey(k, true);
      stepWorld(h, DT);
      input.handleKey(k, false);
      stepWorld(h, DT);
    }
    expect(wing).toEqual(['attack', 'engage_free']);
    expect(ui).toEqual(['view', 'map', 'pause', 'targetView', 'targetViewEnd']);
  });

  it('마우스 에임: 교관이 기수를 조준 방향으로 돌린다', () => {
    const cases: Array<[string, THREE.Vector3]> = [
      ['오른쪽 90°', new THREE.Vector3(1, 0, 0)],
      ['위 30°', new THREE.Vector3(0, Math.sin(30 * DEG), -Math.cos(30 * DEG))],
      ['왼쪽 아래 20°', new THREE.Vector3(-Math.sin(20 * DEG), -0.15, -Math.cos(20 * DEG)).normalize()],
    ];
    for (const [name, aim] of cases) {
      const { h, ac, pc } = playerSetup(6000, 230);
      h.sim.settings.controlMode = 'mouseAim';
      stepWorld(h, DT);
      pc.aimDirection.copy(aim);
      let best = Infinity;
      stepWorld(h, 9, () => {
        best = Math.min(best, angleBetween(ac.getForward(new THREE.Vector3()), aim) / DEG);
      });
      const final = angleBetween(ac.getForward(new THREE.Vector3()), aim) / DEG;
      expect(best, name).toBeLessThan(3);
      expect(final, name).toBeLessThan(4);
      expect(pc.mouseAimActive).toBe(true);
    }
  });

  it('마우스 이동이 조준 방향을 돌린다 (반전 포함)', () => {
    const { h, input, pc } = playerSetup();
    h.sim.settings.controlMode = 'mouseAim';
    stepWorld(h, DT);
    input.handleMouseMove(200, 0);
    stepWorld(h, DT);
    expect(pc.aimDirection.x).toBeGreaterThan(0.2); // 오른쪽으로
    input.handleMouseMove(0, -150);
    const y0 = pc.aimDirection.y;
    stepWorld(h, DT);
    expect(pc.aimDirection.y).toBeGreaterThan(y0 + 0.1); // 마우스 위 = 조준 위
  });
});
