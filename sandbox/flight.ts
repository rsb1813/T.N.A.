// 비행 모듈 단독 테스트 페이지.
//   기본: 스크립트 기동(상승 → 롤 → 급선회 → 반대 롤)을 ?t= 초(기본 10) 만큼 고정 스텝으로 돌리고 렌더 → window.__ready
//   ?model=f16p|f15ex|fa18i|f22d|f14ex  모델/고정 데이터 선택 (src/data 가 있으면 실제 데이터 사용)
//   ?view=chase|cockpit|target|overview 카메라 시점 (overview = 고정 외부 카메라로 전체 궤적)
//   ?play=1                             직접 조종 (키보드/마우스/게임패드, ?aim=1 이면 마우스 에임)
import * as THREE from 'three';
import { preloadModels } from '../src/core/assets';
import type { AircraftController, AircraftLike, Avionics, LaunchZone, Stores, Track } from '../src/core/contracts';
import { Game, FIXED_DT } from '../src/core/game';
import { quatFromHeadingPitch } from '../src/core/math';
import type { FxHandle, FxService } from '../src/core/services';
import { createSim, type Sim } from '../src/core/sim';
import type { AircraftDef, DerivedStats, GameDatabase, Loadout } from '../src/data/schema';
import { Aircraft, CameraRig, InputManager, PlayerController } from '../src/flight';
import { FIXTURE_F14_STATS, FIXTURE_F14_SWEEP, FIXTURE_F15_STATS, FIXTURE_F16_DEF, FIXTURE_F16_LOADOUT, FIXTURE_F16_STATS } from '../src/flight/fixtures';

declare global {
  interface Window {
    __ready?: boolean;
    __report?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const MODEL = params.get('model') ?? 'f16p';
const SIM_SECONDS = Number(params.get('t') ?? 10);
const VIEW = params.get('view') ?? 'chase';
const PLAY = params.get('play') === '1';

// ---------------------------------------------------------------- 데이터 (src/data 가 있으면 사용)

interface DataModule {
  DB?: GameDatabase;
  presetLoadout?: (aircraftId: string, presetId?: string) => Loadout;
  computeStats?: (loadout: Loadout, db?: GameDatabase) => DerivedStats;
}
const dataModules = import.meta.glob<DataModule>('../src/data/index.ts');

async function resolveAircraft(): Promise<{ def: AircraftDef; loadout: Loadout; stats?: DerivedStats; db: GameDatabase; source: string }> {
  const empty: GameDatabase = { aircraft: {}, weapons: {}, modules: {}, units: {} };
  const loader = dataModules['../src/data/index.ts'];
  if (loader) {
    try {
      const mod = await loader();
      const def = mod.DB?.aircraft?.[MODEL];
      if (mod.DB && def && mod.presetLoadout) return { def, loadout: mod.presetLoadout(MODEL), db: mod.DB, source: 'src/data' };
    } catch (err) {
      console.warn('[sandbox] src/data 로드 실패 — 고정 데이터 사용', err);
    }
  }
  const stats = MODEL === 'f15ex' ? FIXTURE_F15_STATS : MODEL === 'f14ex' ? FIXTURE_F14_STATS : FIXTURE_F16_STATS;
  const dims: Record<string, AircraftDef['dimensions']> = {
    f15ex: { length: 19.4, span: 13.05, height: 5.6 },
    f22d: { length: 18.9, span: 13.6, height: 5.1 },
    fa18i: { length: 18.3, span: 13.6, height: 4.9 },
    f14ex: { length: 19.1, span: 19.5, height: 4.9 },
  };
  const def: AircraftDef = {
    ...FIXTURE_F16_DEF,
    name: `${MODEL} (고정 데이터)`,
    model: MODEL,
    dimensions: dims[MODEL] ?? FIXTURE_F16_DEF.dimensions,
    engine: { ...FIXTURE_F16_DEF.engine, count: MODEL === 'f16p' ? 1 : 2 },
    variableSweep: MODEL === 'f14ex' ? { ...FIXTURE_F14_SWEEP } : undefined,
  };
  return { def, loadout: FIXTURE_F16_LOADOUT, stats, db: empty, source: 'fixture' };
}

// ---------------------------------------------------------------- 장면

function buildScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x8db3dc);
  scene.fog = new THREE.Fog(0xa7c2de, 4000, 45000);
  scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x46523a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-0.4, 1, 0.3).multiplyScalar(1000);
  scene.add(sun);

  // 지면: 들판 체커 텍스처 + 1 km 격자
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  const cols = ['#5d7442', '#6b7f48', '#7a8a52', '#566b3d'];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = cols[(x * 3 + y * 5 + ((x * y) % 3)) % cols.length];
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120_000, 120_000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
  scene.add(ground);
  const grid = new THREE.GridHelper(60_000, 60, 0x2e3a25, 0x3b4a2f);
  grid.position.y = 1;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  scene.add(grid);
}

// ---------------------------------------------------------------- 로컬 서비스 스텁 (combat/world 없이 실행)

function stubWeapons(sim: Sim): void {
  const makeAvionics = (): Avionics => ({
    radarMode: 'rws',
    tracks: [] as Track[],
    target: null,
    threats: [],
    missileWarning: false,
    jammerActive: false,
    update() {},
    setRadarMode(mode) {
      this.radarMode = mode;
    },
    cycleTarget() {},
    targetNearestToBoresight() {},
    designate() {},
    lockState: () => ({ status: 'none', progress: 0, target: null }),
    isTracked: () => false,
  });
  const makeStores = (): Stores => ({
    gun: null,
    groups: [],
    selected: -1,
    chaff: 60,
    flares: 60,
    massKg: 170,
    dragArea: 0.05,
    rcsAdd: 0.2,
    externalFuelKg: 0,
    update() {},
    selectNext() {},
    selectedDef: () => null,
    setGunTrigger() {},
    fire: () => null,
    dropFlare() {},
    dropChaff() {},
    jettison() {},
    launchZone: (): LaunchZone | null => null,
  });
  sim.services.weapons = {
    ...sim.services.weapons,
    createAvionics: () => makeAvionics(),
    createStores: () => makeStores(),
  };
}

/** 노즐 화염(가산 원뿔)만 그리는 최소 fx */
function stubFx(sim: Sim): void {
  const handles: Array<() => void> = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xaad0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const cone = new THREE.ConeGeometry(0.42, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const fx: FxService = {
    ...sim.services.fx,
    afterburner(target, nozzles, level): FxHandle {
      const flames = nozzles.map((n) => {
        const g = new THREE.Group();
        const outer = new THREE.Mesh(cone, flameMat);
        const inner = new THREE.Mesh(cone, coreMat);
        inner.scale.set(0.55, 0.55, 0.6);
        g.add(outer, inner);
        g.position.copy(n);
        target.add(g);
        return g;
      });
      const tick = () => {
        const l = level();
        const ab = Math.max(0, l - 1);
        for (const f of flames) {
          f.visible = l > 0.05;
          f.scale.set(0.8 + 0.4 * ab, 0.8 + 0.4 * ab, 0.6 + 5.5 * ab + 1.2 * Math.min(1, l));
        }
      };
      handles.push(tick);
      return { stop: () => flames.forEach((f) => f.removeFromParent()) };
    },
  };
  sim.services.fx = fx;
  (sim as Sim & { __fxTick?: () => void }).__fxTick = () => handles.forEach((h) => h());
}

// ---------------------------------------------------------------- 스크립트 기동

interface Phase {
  until: number;
  pitch?: number;
  roll?: number;
  yaw?: number;
  throttle?: number;
  ab?: boolean;
  label: string;
}

const SCRIPT: Phase[] = [
  { until: 2.5, pitch: 0.45, throttle: 1, ab: true, label: '상승' },
  { until: 2.9, roll: 1, throttle: 1, ab: true, label: '오른쪽 롤' },
  { until: 7.0, pitch: 0.9, throttle: 1, ab: true, label: '급선회 (오른쪽)' },
  { until: 7.55, roll: -1, throttle: 1, label: '반대 롤' },
  { until: 99, pitch: 0.35, roll: 0, throttle: 1, ab: true, label: '왼쪽 선회' },
];

class ScriptedController implements AircraftController {
  time = 0;
  phase = SCRIPT[0];
  update(ac: AircraftLike, dt: number): void {
    this.time += dt;
    this.phase = SCRIPT.find((p) => this.time < p.until) ?? SCRIPT[SCRIPT.length - 1];
    const c = ac.controls;
    c.pitch = this.phase.pitch ?? 0;
    c.roll = this.phase.roll ?? 0;
    c.yaw = this.phase.yaw ?? 0;
    c.throttle = this.phase.throttle ?? 0.75;
    c.afterburner = !!this.phase.ab;
    c.airbrake = false;
  }
}

// ---------------------------------------------------------------- 실행

function hudText(ac: Aircraft, extra: string): string {
  const t = ac.telemetry;
  return [
    `${ac.def.name}  [${extra}]`,
    `속도 ${(t.speed / 0.514444).toFixed(0)} kt  M${t.mach.toFixed(2)}  IAS ${(t.ias / 0.514444).toFixed(0)} kt`,
    `고도 ${(t.altitude / 0.3048).toFixed(0)} ft  VS ${t.verticalSpeed.toFixed(0)} m/s`,
    `G ${t.gLoad.toFixed(1)}  AoA ${t.aoaDeg.toFixed(1)}°  β ${t.sideslipDeg.toFixed(1)}°`,
    `방위 ${t.headingDeg.toFixed(0)}°  피치 ${t.pitchDeg.toFixed(0)}°  롤 ${t.rollDeg.toFixed(0)}°`,
    `추력 ${(t.thrustN / 1000).toFixed(0)} kN ${t.afterburner ? 'AB' : ''}  Ps ${t.specificExcessPower.toFixed(0)} m/s`,
    `연료 ${t.fuelKg.toFixed(0)} kg${t.sweepDeg !== null ? `  후퇴각 ${t.sweepDeg.toFixed(0)}°` : ''}${t.stalled ? '  STALL' : ''}${t.overG ? '  OVER-G' : ''}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const help = document.getElementById('help')!;
  const game = new Game(canvas);
  game.renderer.setPixelRatio(1);
  buildScene(game.scene);

  const { def, loadout, stats, db, source } = await resolveAircraft();
  await preloadModels([def.model]);
  const sim = createSim({ scene: game.scene, camera: game.camera, db, seed: 3 });
  stubWeapons(sim);
  stubFx(sim);
  const fxTick = (sim as Sim & { __fxTick?: () => void }).__fxTick!;
  game.setSim(sim);

  const ac = new Aircraft({ def, loadout, faction: 'NATO', sim, callsign: 'Vanguard 1', stats });
  ac.placeAt(new THREE.Vector3(0, 1800, 0), 0, 230, { throttle: 0.9 });
  sim.world.add(ac, sim);

  const input = new InputManager();
  input.attach(canvas);
  const rig = new CameraRig(game.camera, input);
  rig.setTarget(ac);
  if (VIEW === 'cockpit') rig.view = 'cockpit';

  // 비행 궤적
  const MAX_TRAIL = 4000;
  const trailPos = new Float32Array(MAX_TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  game.scene.add(trail);
  let trailCount = 0;
  const pushTrail = () => {
    if (trailCount >= MAX_TRAIL) return;
    ac.getStationWorldPosition('L1', _tmp); // 날개끝 쪽 궤적이 롤을 보여준다
    trailPos.set([_tmp.x, _tmp.y, _tmp.z], trailCount * 3);
    trailCount++;
    trailGeo.setDrawRange(0, trailCount);
    trailGeo.attributes.position.needsUpdate = true;
  };
  const _tmp = new THREE.Vector3();

  // 표적 시점 시험용 가상 표적
  if (VIEW === 'target') {
    const dummy = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    dummy.position.set(4000, 2600, -3000);
    game.scene.add(dummy);
    (ac.avionics as { target: Track | null }).target = { position: dummy.position } as Track;
  }

  if (PLAY) {
    // 직접 조종
    sim.settings.controlMode = params.get('aim') === '1' ? 'mouseAim' : 'standard';
    input.pointerLockOnClick = sim.settings.controlMode === 'mouseAim';
    ac.isPlayer = true;
    sim.world.player = ac;
    ac.controller = new PlayerController(input, sim);
    game.addSystem(rig);
    game.addSystem({
      name: 'sandboxHud',
      update: () => {
        fxTick();
        if (sim.frame % 6 === 0) pushTrail();
        hud.textContent = hudText(ac, `${sim.settings.controlMode} / ${rig.state}`);
      },
    });
    help.textContent = 'W/S 피치  A/D 롤  Q/E 요  Shift 가속(AB)  Ctrl 감속\nV 시점  우클릭 드래그 둘러보기  (?aim=1 마우스 에임)';
    game.start();
    window.__ready = true;
    return;
  }

  // 스크립트 기동: 고정 스텝 + 카메라를 같은 간격으로 진행 후 렌더
  const script = new ScriptedController();
  ac.controller = script;
  const steps = Math.round(SIM_SECONDS / FIXED_DT);
  let maxG = -Infinity;
  let minG = Infinity;
  let maxAlt = -Infinity;
  let maxAoa = 0;
  const hdg0 = ac.telemetry.headingDeg;
  for (let i = 0; i < steps; i++) {
    game.stepFixed(1);
    sim.world.syncObjects();
    rig.update(FIXED_DT, sim);
    // 리그는 첫 update 에서 이벤트를 구독한다
    if (i === 0 && VIEW === 'target') sim.events.emit('uiAction', { action: 'targetView' });
    fxTick();
    if (i % 6 === 0) pushTrail();
    const t = ac.telemetry;
    maxG = Math.max(maxG, t.gLoad);
    minG = Math.min(minG, t.gLoad);
    maxAlt = Math.max(maxAlt, t.altitude);
    maxAoa = Math.max(maxAoa, t.aoaDeg);
  }
  game.paused = true;
  if (VIEW === 'overview') {
    // 궤적 전체를 비스듬히 내려다보는 고정 카메라
    const box = new THREE.Box3();
    for (let i = 0; i < trailCount; i++) box.expandByPoint(_tmp.fromArray(trailPos, i * 3));
    const bs = box.getBoundingSphere(new THREE.Sphere());
    const cam = game.camera;
    cam.position.copy(bs.center).add(new THREE.Vector3(-0.9, 0.55, 0.9).normalize().multiplyScalar(bs.radius * 2.2 + 300));
    cam.lookAt(bs.center);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    ac.object3d.scale.setScalar(Math.max(1, bs.radius / 120));
    trail.material.linewidth = 2;
  }
  game.frame(performance.now());
  hud.textContent = hudText(ac, `${script.phase.label} / ${rig.state} / ${source}`);
  help.textContent = `t = ${SIM_SECONDS.toFixed(1)} s  ·  흰 선 = 왼쪽 날개끝 궤적`;
  game.frame(performance.now());

  const t = ac.telemetry;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  window.__report = {
    source,
    model: def.model,
    modelLoaded: !ac.model.userData.fallback,
    simSeconds: SIM_SECONDS,
    phase: script.phase.label,
    camera: { state: rig.state, fov: r1(game.camera.fov), distance: r1(game.camera.position.distanceTo(ac.position)) },
    telemetry: {
      speedKt: Math.round(t.speed / 0.514444),
      mach: Math.round(t.mach * 100) / 100,
      altitudeM: Math.round(t.altitude),
      gLoad: r1(t.gLoad),
      aoaDeg: r1(t.aoaDeg),
      headingDeg: r1(t.headingDeg),
      pitchDeg: r1(t.pitchDeg),
      rollDeg: r1(t.rollDeg),
      thrustKN: Math.round(t.thrustN / 1000),
      afterburner: t.afterburner,
      fuelKg: Math.round(t.fuelKg),
      sweepDeg: t.sweepDeg,
      stalled: t.stalled,
    },
    envelope: { maxG: r1(maxG), minG: r1(minG), maxAltitudeM: Math.round(maxAlt), maxAoaDeg: r1(maxAoa), headingChangeDeg: r1(((t.headingDeg - hdg0 + 540) % 360) - 180) },
    nozzles: ac.nozzleLocals.length,
    animatedParts: ac.model.children.filter((c) => /^(aileron|elevator|rudder|flap|canard|airbrake|wing_)/.test(c.name)).map((c) => c.name),
    attitudeCheck: ac.quaternion.angleTo(quatFromHeadingPitch(t.headingDeg, t.pitchDeg, t.rollDeg)) < 1e-3,
  };
  window.__ready = true;
}

main().catch((err) => {
  console.error('[sandbox/flight] 실패', err);
  window.__report = { error: String(err?.stack ?? err) };
  window.__ready = true;
});
