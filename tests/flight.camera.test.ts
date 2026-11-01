import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../src/data/index', async () => {
  const f = await import('../src/flight/fixtures');
  return { computeStats: () => f.FIXTURE_F16_STATS };
});

import { Aircraft } from '../src/flight/aircraft';
import { CameraRig } from '../src/flight/cameraRig';
import { InputManager } from '../src/flight/input';
import { FIXTURE_F16_DEF, FIXTURE_F16_LOADOUT, FIXTURE_F16_STATS } from '../src/flight/fixtures';
import { createSim, type Sim } from '../src/core/sim';
import type { Avionics, Stores, Track } from '../src/core/contracts';

const DT = 1 / 60;

function setup(): { sim: Sim; ac: Aircraft; rig: CameraRig; camera: THREE.PerspectiveCamera; input: InputManager; listener: THREE.Vector3[]; avionics: { target: Track | null } } {
  const sim = createSim({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), db: { aircraft: {}, weapons: {}, modules: {}, units: {} } });
  const listener: THREE.Vector3[] = [];
  sim.services.audio = { play() {}, loop: () => ({ set() {}, stop() {} }), setTone() {}, setListener: (p) => listener.push(p.clone()) };
  const avionics = {
    radarMode: 'rws',
    tracks: [],
    target: null as Track | null,
    threats: [],
    missileWarning: false,
    jammerActive: false,
    update() {},
    setRadarMode() {},
    cycleTarget() {},
    targetNearestToBoresight() {},
    designate() {},
    lockState: () => ({ status: 'none', progress: 0, target: null }),
    isTracked: () => false,
  };
  const stores = {
    gun: null,
    groups: [],
    selected: -1,
    chaff: 0,
    flares: 0,
    massKg: 0,
    dragArea: 0,
    rcsAdd: 0,
    externalFuelKg: 0,
    update() {},
    selectNext() {},
    selectedDef: () => null,
    setGunTrigger() {},
    fire: () => null,
    dropFlare() {},
    dropChaff() {},
    jettison() {},
    launchZone: () => null,
  };
  sim.services.weapons = {
    launch: () => null,
    fireGun() {},
    dropDecoy: () => null,
    createAvionics: () => avionics as unknown as Avionics,
    createStores: () => stores as unknown as Stores,
    applyBlast() {},
  };
  const ac = new Aircraft({ def: FIXTURE_F16_DEF, loadout: FIXTURE_F16_LOADOUT, faction: 'NATO', sim, stats: FIXTURE_F16_STATS });
  ac.placeAt(new THREE.Vector3(0, 5000, 0), 90, 250);
  sim.world.add(ac, sim);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 400_000);
  const input = new InputManager({ gamepads: () => [] });
  const rig = new CameraRig(camera, input);
  rig.setTarget(ac);
  return { sim, ac, rig, camera, input, listener, avionics };
}

function frames(s: ReturnType<typeof setup>, secs: number): void {
  for (let i = 0; i < Math.round(secs / DT); i++) {
    s.sim.time += DT;
    s.sim.world.step(DT, s.sim);
    s.rig.update(DT, s.sim);
  }
}

describe('CameraRig', () => {
  it('추적 시점: 기체 뒤/위, 기체를 화면 안에 두고, 리스너 갱신', () => {
    const s = setup();
    frames(s, 1);
    const { camera, ac } = s;
    const toCam = camera.position.clone().sub(ac.position);
    const fwd = ac.getForward(new THREE.Vector3());
    expect(toCam.dot(fwd)).toBeLessThan(-10); // 뒤
    expect(toCam.y).toBeGreaterThan(1); // 위
    expect(toCam.length()).toBeLessThan(60);
    // 기체가 시야 안 (화면 아래쪽)
    const ndc = ac.position.clone().project(camera);
    expect(Math.abs(ndc.x)).toBeLessThan(0.2);
    expect(ndc.y).toBeLessThan(0);
    expect(ndc.y).toBeGreaterThan(-0.6);
    expect(s.listener.length).toBe(60);
    expect(s.listener.at(-1)!.distanceTo(camera.position)).toBeLessThan(1e-6);
  });

  it('속도/애프터버너에 따라 FOV 가 넓어진다', () => {
    const s = setup();
    frames(s, 2);
    const fovSlow = s.camera.fov;
    s.ac.placeAt(s.ac.position, 90, 600, { throttle: 1 });
    s.ac.controls.afterburner = true;
    s.ac.controller = { update: (a) => ((a.controls.throttle = 1), (a.controls.afterburner = true)) };
    frames(s, 3);
    expect(s.camera.fov).toBeGreaterThan(fovSlow + 4);
  });

  it('시점 전환(uiAction view): 조종석에서는 자기 기체를 숨긴다', () => {
    const s = setup();
    frames(s, 0.2);
    s.sim.events.emit('uiAction', { action: 'view' });
    frames(s, 0.1);
    expect(s.rig.state).toBe('cockpit');
    expect(s.ac.object3d.visible).toBe(false);
    const cockpit = s.ac.getCockpitWorldPosition(new THREE.Vector3());
    expect(s.camera.position.distanceTo(cockpit)).toBeLessThan(0.5);
    s.sim.events.emit('uiAction', { action: 'view' });
    frames(s, 0.1);
    expect(s.rig.state).toBe('chase');
    expect(s.ac.object3d.visible).toBe(true);
  });

  it('둘러보기: 우클릭 드래그로 공전, 놓으면 돌아온다', () => {
    const s = setup();
    frames(s, 0.5);
    const base = s.camera.position.clone().sub(s.ac.position).normalize();
    s.input.handleMouseButton(2, true);
    s.input.handleMouseMove(400, 0);
    frames(s, 0.1);
    const looked = s.camera.position.clone().sub(s.ac.position).normalize();
    expect(base.angleTo(looked)).toBeGreaterThan(0.8);
    s.input.handleMouseButton(2, false);
    frames(s, 3);
    const back = s.camera.position.clone().sub(s.ac.position).normalize();
    expect(base.angleTo(back)).toBeLessThan(0.1);
  });

  it('표적 시점: 자기 기체 뒤에서 표적 쪽을 본다', () => {
    const s = setup();
    frames(s, 0.5);
    const tgtPos = s.ac.position.clone().add(new THREE.Vector3(0, 0, -8000)); // 북쪽 (기체는 동쪽을 향함)
    s.avionics.target = { position: tgtPos } as unknown as Track;
    s.sim.events.emit('uiAction', { action: 'targetView' });
    frames(s, 1);
    expect(s.rig.state).toBe('target');
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.camera.quaternion);
    const toTgt = tgtPos.clone().sub(s.camera.position).normalize();
    expect(camFwd.angleTo(toTgt)).toBeLessThan(0.1);
    const ndc = s.ac.position.clone().project(s.camera);
    expect(Math.abs(ndc.x)).toBeLessThan(0.5);
    expect(Math.abs(ndc.y)).toBeLessThan(0.8);
    s.sim.events.emit('uiAction', { action: 'targetViewEnd' });
    frames(s, 0.5);
    expect(s.rig.state).toBe('chase');
  });

  it('격추 시점: 잔해를 공전하며 바라본다', () => {
    const s = setup();
    frames(s, 0.5);
    s.ac.applyDamage({ amount: 999, kind: 'blast', source: null, weaponId: null }, s.sim);
    frames(s, 1);
    expect(s.rig.state).toBe('death');
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.camera.quaternion);
    const toWreck = s.ac.position.clone().sub(s.camera.position).normalize();
    expect(camFwd.angleTo(toWreck)).toBeLessThan(0.15);
  });
});
