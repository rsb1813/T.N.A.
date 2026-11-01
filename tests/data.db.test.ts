// 데이터 무결성: id·모델 목록(docs/architecture.md 7장), 스테이션 표(6장), 참조 무결성, 해금 규칙.
import { describe, expect, it } from 'vitest';
import { DB, MODULE_SLOTS, PLAYER_AIRCRAFT_IDS, motorTotalImpulse, type AircraftDef } from '../src/data/index';

const MODEL_IDS = {
  aircraft: ['f15ex', 'f22d', 'fa18i', 'f16p', 'f14ex', 'flanker', 'mig29', 'mig31', 'su47', 'typhoon', 'tornado', 'pax_x1', 'mirage_f1', 'mig21', 'tu22m3', 'a50'],
  weapons: ['aim120', 'aim9x', 'aim7', 'aim54', 'agm88', 'agm65', 'agm158', 'agm84', 'gbu31', 'gbu12', 'gbu39', 'mk82', 'b61', 'fueltank', 'pod_targeting', 'pod_irst', 'r77', 'r73', 'r27', 'r33', 'meteor', 'asraam', 'sam_large', 'sam_medium', 'sam_small'],
  units: ['sa10_tel', 'sa10_radar', 'sa11', 'sa15', 'zsu234', 'ew_radar', 't80', 'bmp2', 'truck', 'scud', 'rapier', 'mbt_pax', 'sa2_launcher', 'sa2_radar', 'zu23', 'technical', 'frigate_pax', 'destroyer_pax', 'cruiser_warsaw', 'frigate_warsaw', 'carrier_nato', 'cargo_ship'],
  buildings: ['hangar_has', 'hangar_big', 'building_block', 'building_tower', 'factory', 'fuel_tank', 'bunker', 'comm_tower'],
};

const ENEMY_MODELS: Record<string, string> = {
  su27s: 'flanker',
  su30mkk: 'flanker',
  j11: 'flanker',
  su35s: 'flanker',
  mig29s: 'mig29',
  mig31bm: 'mig31',
  su47: 'su47',
  tu22m3: 'tu22m3',
  a50: 'a50',
  typhoon: 'typhoon',
  tornado_f3: 'tornado',
  tornado_ids: 'tornado',
  su27_imperial: 'flanker',
  xf1: 'pax_x1',
  mirage_f1: 'mirage_f1',
  mig21: 'mig21',
};

// docs/architecture.md 6장 (좌측 좌표, 우측은 x 반전)
const STATION_TABLE: Record<string, Array<[string, string | null, [number, number, number]]>> = {
  f15ex: [
    ['L1', 'R1', [-5.0, -0.5, 1.6]],
    ['L2', 'R2', [-3.0, -0.8, 1.0]],
    ['L2A', 'R2A', [-3.3, -0.9, 1.0]],
    ['L2B', 'R2B', [-2.7, -0.9, 1.0]],
    ['CFT_LF', 'CFT_RF', [-1.6, -0.9, -1.5]],
    ['CFT_LR', 'CFT_RR', [-1.6, -0.9, 1.8]],
    ['C', null, [0, -1.3, 0.5]],
  ],
  f22d: [
    ['BAY_C', null, [0, -0.7, 0.5]],
    ['BAY_SL', 'BAY_SR', [-1.2, -0.3, -1.0]],
    ['L1', 'R1', [-4.2, -0.4, 2.0]],
    ['L2', 'R2', [-2.6, -0.5, 1.5]],
  ],
  fa18i: [
    ['L1', 'R1', [-6.7, 0, 2.2]],
    ['L2', 'R2', [-4.9, -0.5, 1.5]],
    ['L3', 'R3', [-3.6, -0.6, 1.0]],
    ['L4', 'R4', [-2.3, -0.7, 0.6]],
    ['FL', 'FR', [-0.9, -0.9, 0.0]],
    ['C', null, [0, -1.1, 0.4]],
  ],
  f16p: [
    ['L1', 'R1', [-4.9, 0, 1.6]],
    ['L2', 'R2', [-4.0, -0.4, 1.4]],
    ['L3', 'R3', [-3.0, -0.5, 1.0]],
    ['L4', 'R4', [-1.9, -0.6, 0.6]],
    ['C', null, [0, -1.1, 0.4]],
    ['CHIN_L', 'CHIN_R', [-0.5, -1.2, -2.6]],
  ],
  f14ex: [
    ['GLOVE_L', 'GLOVE_R', [-2.6, -0.9, -0.5]],
    ['GLOVE_L_RAIL', 'GLOVE_R_RAIL', [-3.0, -0.9, -0.5]],
    ['TUNNEL_1', null, [0, -1.1, -2.0]],
    ['TUNNEL_2', null, [0, -1.1, -0.3]],
    ['TUNNEL_3', null, [0, -1.1, 1.4]],
    ['TUNNEL_4', null, [0, -1.1, 3.1]],
    ['NAC_L', 'NAC_R', [-1.8, -1.1, 1.0]],
  ],
};

const REQUIRED_WEAPONS = [
  'M61A2', 'AIM-120C-7', 'AIM-120D', 'AIM-9M', 'AIM-9X', 'AIM-7M', 'AIM-54C', 'AGM-88E', 'AGM-65K', 'AGM-158', 'AGM-84', 'GBU-31', 'GBU-32', 'GBU-38', 'GBU-39', 'GBU-12', 'GBU-24', 'Mk 82', 'Mk 84', 'CBU-97', 'B61',
  'TANK-610', 'TANK-370', 'TANK-480', 'TANK-267', 'AN/AAQ-33', 'AN/AAQ-28', 'AN/ASQ-228',
  'GSh-30-1', 'R-77', 'R-77-1', 'R-73M', 'R-27ER', 'R-27ET', 'R-33S', 'R-37', 'Kh-31P', 'Kh-29T', 'KAB-500L', 'FAB-500', 'Kh-22',
  'BK-27', 'Meteor', 'ASRAAM', 'IRIS-T', 'Skyflash', 'ALARM', 'Storm Shadow', 'Brimstone',
  'GSh-23L', 'R-60M', 'R-13M', 'R530', 'Magic 2',
  '5V55R', '48N6E', '9M38M1', '9M330', 'V-750', 'Rapier Mk2', 'Sea Dart', 'Sea Wolf', '2A7', 'ZU-23', 'AK-630', 'Goalkeeper',
];

const REQUIRED_MODULES = [
  'AN/APG-63(V)3', 'AN/APG-82(V)1', 'AN/APG-79(V)4', 'AN/APG-83', 'AN/APG-77(V)1', 'AN/APG-71', 'AN/APG-68(V)9',
  'AN/AAS-42', 'IRST21-LEGION', 'IRST21-TANK', 'AN/ALR-56M', 'AN/ALR-67(V)3', 'AN/ALR-94', 'AN/ALR-69A',
  'AN/AAR-56', 'AN/AAR-57', 'AN/AAQ-37', 'AN/AAR-47', 'AN/ALQ-135M', 'AN/ALQ-250', 'AN/ALQ-214', 'AN/ALQ-254', 'AN/ALQ-165',
  'MIDS-LVT', 'IFDL', 'MADL', 'JHMCS', 'JHMCS II', 'Scorpion',
  'F110-GE-129', 'F110-GE-132', 'F100-PW-229 EEP', 'F414-GE-400', 'F414 EPE', 'F119-PW-100', 'F119 EPE', 'F110-GE-400',
  'N001', 'N011M', 'N035', 'Zaslon-M', 'Zhuk-ME', 'CAPTOR-M', 'AI.24', 'Cyrano IV', 'RP-22', 'OLS-27', 'OLS-35', 'PIRATE', 'SPO-15LM',
];

const aircraft = Object.values(DB.aircraft);
const allModelIds = new Set([...MODEL_IDS.aircraft, ...MODEL_IDS.weapons, ...MODEL_IDS.units, ...MODEL_IDS.buildings]);

describe('id·모델 목록', () => {
  it('플레이어/적 기체 id 와 모델이 아키텍처 목록과 정확히 일치', () => {
    expect([...PLAYER_AIRCRAFT_IDS].sort()).toEqual(['f14ex', 'f15ex', 'f16p', 'f22d', 'fa18i']);
    for (const id of PLAYER_AIRCRAFT_IDS) {
      expect(DB.aircraft[id].model).toBe(id);
      expect(DB.aircraft[id].playable).toBe(true);
      expect(DB.aircraft[id].faction).toBe('NATO');
    }
    const enemies = aircraft.filter((a) => !a.playable);
    expect(enemies.map((a) => a.id).sort()).toEqual(Object.keys(ENEMY_MODELS).sort());
    for (const a of enemies) expect(a.model, a.id).toBe(ENEMY_MODELS[a.id]);
  });

  it('모든 모델 id 가 아키텍처 모델 목록 안에 있다', () => {
    for (const a of aircraft) expect(MODEL_IDS.aircraft, a.id).toContain(a.model);
    for (const w of Object.values(DB.weapons)) if (w.model) expect(MODEL_IDS.weapons, w.id).toContain(w.model);
    for (const u of Object.values(DB.units)) expect(allModelIds.has(u.model), u.id).toBe(true);
  });

  it('지상/해상 유닛·건물 id = 모델 id, 목록 전부 존재', () => {
    const ids = Object.keys(DB.units).sort();
    expect(ids).toEqual([...MODEL_IDS.units, ...MODEL_IDS.buildings].sort());
    for (const u of Object.values(DB.units)) expect(u.model).toBe(u.id);
  });

  it('필수 무장·모듈 존재, 레코드 키 = id', () => {
    for (const id of REQUIRED_WEAPONS) expect(DB.weapons[id], id).toBeDefined();
    for (const id of REQUIRED_MODULES) expect(DB.modules[id], id).toBeDefined();
    for (const [k, v] of Object.entries(DB.weapons)) expect(v.id).toBe(k);
    for (const [k, v] of Object.entries(DB.modules)) expect(v.id).toBe(k);
    for (const [k, v] of Object.entries(DB.aircraft)) expect(v.id).toBe(k);
  });
});

describe('참조 무결성', () => {
  it('스테이션 허용 목록·프리셋·기관포·유닛 무장의 무장 id 가 모두 존재', () => {
    const categories = new Set(['gun', 'aam_ir', 'aam_radar', 'aam_sarh', 'aam_long', 'agm', 'arm', 'ashm', 'bomb_gps', 'bomb_laser', 'bomb_dumb', 'bomb_cluster', 'nuke', 'pod', 'tank', 'sam', 'aaa']);
    for (const a of aircraft) {
      if (a.gun) expect(DB.weapons[a.gun.weaponId]?.category, `${a.id} gun`).toBe('gun');
      for (const st of a.stations) {
        for (const x of st.allowed) expect(categories.has(x) || !!DB.weapons[x], `${a.id}.${st.id} allowed '${x}'`).toBe(true);
        for (const x of Object.keys(st.limits ?? {})) expect(categories.has(x) || !!DB.weapons[x], `${a.id}.${st.id} limit '${x}'`).toBe(true);
        if (st.mirror) expect(a.stations.find((s) => s.id === st.mirror)?.mirror, `${a.id}.${st.id} mirror`).toBe(st.id);
        expect(st.position, `${a.id}.${st.id} position`).toBeDefined();
      }
      for (const p of a.presets) {
        for (const [sid, load] of Object.entries(p.stations)) {
          if (load) expect(DB.weapons[load.weaponId], `${a.id}/${p.id}/${sid}`).toBeDefined();
        }
        for (const m of Object.values(p.modules)) if (m) expect(DB.modules[m], `${a.id}/${p.id} module ${m}`).toBeDefined();
      }
    }
    for (const u of Object.values(DB.units)) {
      for (const w of u.weapons ?? []) {
        const def = DB.weapons[w.weaponId];
        expect(def, `${u.id} → ${w.weaponId}`).toBeDefined();
        expect(['sam', 'aaa'], `${u.id} → ${w.weaponId}`).toContain(def.category);
        expect(w.count).toBeGreaterThan(0);
        expect(w.reloadSec).toBeGreaterThan(0);
      }
    }
  });

  it('모든 기체가 10 슬롯 모듈 표를 갖고, 기본값은 허용 목록 안·슬롯 일치·무료', () => {
    for (const a of aircraft) {
      for (const slot of MODULE_SLOTS) {
        const spec = a.modules[slot];
        expect(spec, `${a.id}.${slot}`).toBeDefined();
        if (spec.default !== null) expect(spec.allowed, `${a.id}.${slot}`).toContain(spec.default);
        for (const id of spec.allowed) {
          const m = DB.modules[id];
          expect(m, `${a.id}.${slot} → ${id}`).toBeDefined();
          expect(m.slot, `${a.id}.${slot} → ${id}`).toBe(slot);
        }
        if (spec.default) expect(DB.modules[spec.default].unlock.cost, `${a.id}.${slot} 기본 모듈 무료`).toBe(0);
        if (spec.allowed.length === 0) expect(spec.default).toBeNull();
      }
    }
  });

  it('모듈: 한국어 설명, 질량, 해금 정보, 슬롯별 성능 블록', () => {
    const statKey: Record<string, string | null> = { radar: 'radar', irst: 'irst', rwr: 'rwr', maw: 'maw', ew: 'ew', cms: 'cms', datalink: 'datalink', helmet: 'helmet', engine: 'engine', wing: null };
    for (const m of Object.values(DB.modules)) {
      expect(m.description, m.id).toMatch(/[가-힣]/);
      expect(Number.isFinite(m.massKg), m.id).toBe(true);
      expect(m.unlock.cost, m.id).toBeGreaterThanOrEqual(0);
      const key = statKey[m.slot];
      if (key) expect((m as unknown as Record<string, unknown>)[key], `${m.id} ${key}`).toBeDefined();
    }
  });

  it('무장: 분류별 필수 블록과 물리적으로 그럴듯한 모터', () => {
    for (const w of Object.values(DB.weapons)) {
      expect(w.description, w.id).toMatch(/[가-힣]/);
      expect(w.massKg, w.id).toBeGreaterThan(0);
      if (w.category === 'gun' || w.category === 'aaa') expect(w.gun, w.id).toBeDefined();
      if (w.category === 'tank') expect(w.tank?.fuelKg, w.id).toBeGreaterThan(0);
      if (w.category === 'pod') expect(w.pod, w.id).toBeDefined();
      if (w.category === 'nuke') expect(w.warhead?.yieldKt, w.id).toBeGreaterThan(0);
      if (w.category !== 'gun' && w.category !== 'aaa') expect(w.model, `${w.id} model`).toBeDefined();
      if (w.motor) {
        const prop = w.motor.propellantKg ?? 0;
        expect(prop, w.id).toBeGreaterThan(0);
        expect(prop / w.massKg, `${w.id} 추진제 비율`).toBeLessThan(0.65);
        expect(w.body, w.id).toBeDefined();
        expect(w.guidance, w.id).toBeDefined();
        const cruise = w.motor.sustainSec > 300;
        if (!w.motor.ramjet && !cruise) {
          const isp = motorTotalImpulse(w) / (prop * 9.80665);
          expect(isp, `${w.id} 비추력`).toBeGreaterThan(200);
          expect(isp, `${w.id} 비추력`).toBeLessThan(300);
        }
      }
      if (['aam_ir', 'aam_radar', 'aam_sarh', 'aam_long', 'sam'].includes(w.category)) {
        expect(w.motor && w.body && w.guidance && w.warhead && w.envelope, w.id).toBeTruthy();
        expect(w.guidance!.maxTimeSec ?? 240, w.id).toBeGreaterThan(5);
      }
    }
  });

  it('전술핵은 프리셋에 없고, 스테이션 허용은 nuke 분류로만', () => {
    const nukes = Object.values(DB.weapons).filter((w) => w.category === 'nuke').map((w) => w.id);
    expect(nukes).toContain('B61');
    for (const a of aircraft) {
      for (const st of a.stations) for (const n of nukes) expect(st.allowed, `${a.id}.${st.id}`).not.toContain(n);
      for (const p of a.presets) for (const load of Object.values(p.stations)) if (load) expect(nukes, `${a.id}/${p.id}`).not.toContain(load.weaponId);
    }
    expect(aircraft.filter((a) => a.stations.some((s) => s.allowed.includes('nuke'))).map((a) => a.id)).toEqual(expect.arrayContaining(['f15ex', 'f16p', 'fa18i', 'f14ex', 'tu22m3']));
  });
});

describe('플레이어 기체 스테이션 표', () => {
  for (const [id, rows] of Object.entries(STATION_TABLE)) {
    it(`${id}: id·좌표·대칭이 표와 일치`, () => {
      const def: AircraftDef = DB.aircraft[id];
      const expected: Record<string, [number, number, number]> = {};
      for (const [l, r, [x, y, z]] of rows) {
        expected[l] = [x, y, z];
        if (r) expected[r] = [-x, y, z];
      }
      expect(def.stations.map((s) => s.id).sort()).toEqual(Object.keys(expected).sort());
      for (const st of def.stations) {
        const p = expected[st.id];
        expect(st.position![0], `${id}.${st.id}.x`).toBeCloseTo(p[0] === 0 ? 0 : p[0], 6);
        expect(st.position![1], `${id}.${st.id}.y`).toBeCloseTo(p[1], 6);
        expect(st.position![2], `${id}.${st.id}.z`).toBeCloseTo(p[2], 6);
        expect(st.label).toMatch(/[가-힣]/);
      }
      for (const [l, r] of rows) {
        if (!r) continue;
        expect(def.stations.find((s) => s.id === l)!.mirror).toBe(r);
      }
    });
  }

  it('F-22D 무장창은 내부, 외부 파일런은 외부', () => {
    const st = Object.fromEntries(DB.aircraft.f22d.stations.map((s) => [s.id, s]));
    for (const id of ['BAY_C', 'BAY_SL', 'BAY_SR']) expect(st[id].internal).toBe(true);
    for (const id of ['L1', 'R1', 'L2', 'R2']) expect(st[id].internal).toBe(false);
    expect(DB.aircraft.f22d.signature.rcs).toBeCloseTo(0.0002, 6);
  });

  it('기관포 M61A2 실제 탄수, F-14EX 가변익 20~68°', () => {
    const rounds = Object.fromEntries(PLAYER_AIRCRAFT_IDS.map((id) => [id, DB.aircraft[id].gun]));
    expect(rounds).toEqual({
      f15ex: { weaponId: 'M61A2', rounds: 510 },
      f22d: { weaponId: 'M61A2', rounds: 480 },
      fa18i: { weaponId: 'M61A2', rounds: 412 },
      f16p: { weaponId: 'M61A2', rounds: 511 },
      f14ex: { weaponId: 'M61A2', rounds: 675 },
    });
    expect(DB.aircraft.f14ex.variableSweep).toEqual({ minDeg: 20, maxDeg: 68 });
  });
});

describe('프리셋 수·해금', () => {
  it('플레이어 4~6 프리셋, 적 2~3 (A-50 은 무장 없음)', () => {
    for (const a of aircraft) {
      if (a.playable) {
        expect(a.presets.length, a.id).toBeGreaterThanOrEqual(4);
        expect(a.presets.length, a.id).toBeLessThanOrEqual(6);
      } else if (a.stations.length > 0) {
        expect(a.presets.length, a.id).toBeGreaterThanOrEqual(2);
        expect(a.presets.length, a.id).toBeLessThanOrEqual(4);
      } else {
        expect(a.presets.length, a.id).toBeGreaterThanOrEqual(1);
      }
      for (const p of a.presets) expect(p.name + p.description, `${a.id}/${p.id}`).toMatch(/[가-힣]/);
      expect(new Set(a.presets.map((p) => p.id)).size, a.id).toBe(a.presets.length);
    }
  });

  it('해금 규칙', () => {
    for (const id of ['f15ex', 'f16p', 'fa18i']) expect(DB.aircraft[id].unlock).toEqual({ cost: 0 });
    expect(DB.aircraft.f14ex.unlock).toEqual({ cost: 30000, afterMission: 'm02' });
    expect(DB.aircraft.f22d.unlock).toEqual({ cost: 60000, afterMission: 'm03' });
    for (const a of aircraft.filter((x) => !x.playable)) expect(a.unlock.cost, a.id).toBe(0);
    for (const id of ['AIM-120C-7', 'AIM-9M', 'AIM-7M', 'Mk 82', 'GBU-12', 'AGM-65K', 'M61A2', 'TANK-610', 'TANK-370', 'TANK-480', 'TANK-267', 'TANK-300']) {
      expect(DB.weapons[id].unlock.cost, id).toBe(0);
    }
    for (const id of ['AIM-120D', 'AIM-9X', 'AIM-54C', 'AGM-88E', 'AGM-158', 'GBU-39']) expect(DB.weapons[id].unlock.cost, id).toBeGreaterThan(0);
  });
});
