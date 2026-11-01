// 적 기체 (바르샤바 / 팍스 임페리알리스 / WON). id·모델은 docs/architecture.md 7장 "데이터 id 목록" 과 일치.
// 스테이션 명명: 날개끝부터 안쪽으로 L1, L2... / R1, R2..., 중앙 C (여럿이면 C1, C2), 동체 측면/흡입구 하부 FL/FR, 내부창 BAY_*.
// 엔진은 기체 고정(엔진 모듈 없음) — 초음속 순항형(EJ200/EJ230)만 엔진 모듈로 둔다.
import { FREE, both, engineFrom, ld, moduleTable, pair, station } from './aircraft-common';
import type { AircraftDef, StationDef } from './schema';

const AAM = ['aam_ir', 'aam_radar'];
const AAM_ALL = ['aam_ir', 'aam_radar', 'aam_sarh'];
const BOMBS = ['bomb_dumb', 'bomb_laser', 'bomb_gps'];

// ---------------------------------------------------------------- Flanker 계열 스테이션

/** Su-27S / J-11 / 제국 Su-27: 10 개 */
function flanker10(): StationDef[] {
  return [
    ...pair('L1', 'R1', '날개끝', [-7.3, 0, 2.0], { maxMassKg: 150, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '외측 날개', [-5.6, -0.3, 1.5], { maxMassKg: 250, allowed: AAM }),
    ...pair('L3', 'R3', '내측 날개', [-4.0, -0.4, 1.0], { maxMassKg: 600, allowed: [...AAM_ALL, 'bomb_dumb'] }),
    ...pair('FL', 'FR', '흡입구 하부', [-1.3, -1.2, 0.5], { maxMassKg: 600, allowed: [...AAM_ALL, 'bomb_dumb'] }),
    station('C1', '동체 터널 전방', [0, -1.1, -1.5], { maxMassKg: 600, allowed: ['aam_sarh', 'aam_radar', 'bomb_dumb'] }),
    station('C2', '동체 터널 후방', [0, -1.1, 2.5], { maxMassKg: 600, allowed: ['aam_sarh', 'aam_radar', 'bomb_dumb'] }),
  ];
}

/** Su-30MKK / Su-35S: 12 개 (내측 중무장 스테이션 추가) */
function flanker12(longRangeIntakes: boolean): StationDef[] {
  return [
    ...pair('L1', 'R1', '날개끝', [-7.3, 0, 2.0], { maxMassKg: 150, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '외측 날개', [-5.8, -0.3, 1.6], { maxMassKg: 250, allowed: AAM }),
    ...pair('L3', 'R3', '중간 날개', [-4.4, -0.4, 1.2], { maxMassKg: 1500, allowed: [...AAM_ALL, 'agm', 'arm', ...BOMBS] }),
    ...pair('L4', 'R4', '내측 날개', [-3.0, -0.5, 0.8], { maxMassKg: 2000, allowed: [...AAM_ALL, 'agm', 'arm', 'tank', ...BOMBS] }),
    ...pair('FL', 'FR', '흡입구 하부', [-1.3, -1.2, 0.5], {
      maxMassKg: longRangeIntakes ? 700 : 600,
      allowed: longRangeIntakes ? [...AAM_ALL, 'aam_long', 'R-37'] : [...AAM_ALL, 'bomb_dumb'],
    }),
    station('C1', '동체 터널 전방', [0, -1.1, -1.5], { maxMassKg: 1500, allowed: ['aam_sarh', 'aam_radar', 'pod', 'agm', 'arm', ...BOMBS] }),
    station('C2', '동체 터널 후방', [0, -1.1, 2.5], { maxMassKg: 1500, allowed: ['aam_sarh', 'aam_radar', 'agm', 'arm', ...BOMBS] }),
  ];
}

const FLANKER_MODULES = {
  irst: ['OLS-27'] as [string],
  maw: [null] as [null],
  ew: ['L005'] as [string],
  cms: ['APP-50'] as [string],
  datalink: ['TKS-2'] as [string],
  helmet: ['Shchel-3UM'] as [string],
};

const FLANKER_AIR = {
  ...both('L1', 'R1', ld('R-73M')),
  ...both('L2', 'R2', ld('R-73M')),
  ...both('L3', 'R3', ld('R-27ER')),
  FL: ld('R-27ET'),
  FR: ld('R-27ER'),
  C1: ld('R-27ER'),
  C2: ld('R-27ER'),
};

const FLANKER_R77 = {
  ...both('L1', 'R1', ld('R-73M')),
  ...both('L2', 'R2', ld('R-77')),
  ...both('L3', 'R3', ld('R-77')),
  ...both('FL', 'FR', ld('R-27ER')),
  C1: ld('R-77'),
  C2: ld('R-77'),
};

const FLANKER_BOMB = {
  ...both('L1', 'R1', ld('R-73M')),
  ...both('L2', 'R2', ld('R-73M')),
  ...both('L3', 'R3', ld('FAB-500')),
  ...both('FL', 'FR', ld('R-27ER')),
  C1: ld('FAB-500'),
  C2: ld('FAB-500'),
};

// ============================================================ 바르샤바

const su27s: AircraftDef = {
  id: 'su27s',
  name: 'Su-27S Flanker-B',
  faction: 'WARSAW',
  playable: false,
  role: 'air_superiority',
  description: '바르샤바의 주력 제공 전투기. 거대한 내부 연료와 뛰어난 기동성, R-27/R-73 다수 탑재.',
  model: 'flanker',
  crew: 1,
  dimensions: { length: 21.94, span: 14.7, height: 5.92 },
  mass: { empty: 16380, internalFuel: 9400, maxTakeoff: 30450 },
  aero: { wingArea: 62, cd0: 0.0171, k: 0.13, clAlpha: 3.5, clMax: 1.6, aoaMaxDeg: 30, waveDragRise: 0.0222 },
  engine: { name: 'AL-31F', count: 2, dryThrustKN: 74.5, abThrustKN: 122.6, tsfcDry: 76, tsfcAB: 196, spoolTime: 4.0 },
  limits: { gMax: 9, gMin: -3, maxMach: 2.35, rollRateDeg: 270, pitchRateDeg: 30, yawRateDeg: 18, cornerSpeed: 250, maxIas: 389 },
  signature: { rcs: 15, ir: 1.3 },
  gun: { weaponId: 'GSh-30-1', rounds: 150 },
  stations: flanker10(),
  modules: moduleTable({ radar: ['N001'], rwr: ['SPO-15LM'], ...FLANKER_MODULES }),
  presets: [
    { id: 'air', name: '제공 (R-27)', description: 'R-27ER/ET 6 발 + R-73M 4 발.', modules: {}, stations: FLANKER_AIR },
    { id: 'r77', name: '제공 (R-77)', description: 'R-77 6 발 + R-27ER 2 발 + R-73M 2 발.', modules: {}, stations: FLANKER_R77 },
    { id: 'bomb', name: '폭격', description: 'FAB-500 4 발, 자위용 R-27ER·R-73M.', modules: {}, stations: FLANKER_BOMB },
  ],
  unlock: FREE,
};

const j11: AircraftDef = {
  ...su27s,
  id: 'j11',
  name: 'J-11A Flanker',
  description: '중국 면허생산 Su-27SK. 개량 레이더로 R-77 운용 능력이 낫다.',
  mass: { empty: 16500, internalFuel: 9400, maxTakeoff: 33000 },
  aero: { wingArea: 62, cd0: 0.0171, k: 0.128, clAlpha: 3.5, clMax: 1.6, aoaMaxDeg: 30, waveDragRise: 0.0222 },
  stations: flanker10(),
  modules: moduleTable({ radar: ['N001VE'], rwr: ['SPO-15LM'], ...FLANKER_MODULES }),
  presets: [
    { id: 'r77', name: '제공 (R-77)', description: 'R-77 6 발 + R-27ER 2 발 + R-73M 2 발.', modules: {}, stations: FLANKER_R77 },
    { id: 'air', name: '제공 (R-27)', description: 'R-27ER/ET 6 발 + R-73M 4 발.', modules: {}, stations: FLANKER_AIR },
  ],
};

const su30mkk: AircraftDef = {
  id: 'su30mkk',
  name: 'Su-30MKK Flanker-G',
  faction: 'WARSAW',
  playable: false,
  role: 'multirole',
  description: '중국 복좌 다목적 Flanker. Kh-31P·Kh-29T·KAB-500L 로 지상·대함 공격, 12 개 스테이션.',
  model: 'flanker',
  crew: 2,
  dimensions: { length: 21.9, span: 14.7, height: 6.36 },
  mass: { empty: 17700, internalFuel: 9640, maxTakeoff: 34500 },
  aero: { wingArea: 62, cd0: 0.0185, k: 0.128, clAlpha: 3.5, clMax: 1.6, aoaMaxDeg: 30, waveDragRise: 0.0297 },
  engine: { name: 'AL-31F', count: 2, dryThrustKN: 74.5, abThrustKN: 122.6, tsfcDry: 76, tsfcAB: 196, spoolTime: 4.0 },
  limits: { gMax: 9, gMin: -3, maxMach: 2.0, rollRateDeg: 240, pitchRateDeg: 28, yawRateDeg: 16, cornerSpeed: 250, maxIas: 389 },
  signature: { rcs: 15, ir: 1.3 },
  gun: { weaponId: 'GSh-30-1', rounds: 150 },
  stations: flanker12(false),
  modules: moduleTable({ radar: ['N001VE'], rwr: ['L150'], ...FLANKER_MODULES }),
  presets: [
    {
      id: 'air',
      name: '제공',
      description: 'R-77 6 발 + R-27ER 2 발 + R-73M 4 발.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-73M')), ...both('L3', 'R3', ld('R-77')), ...both('L4', 'R4', ld('R-77')), ...both('FL', 'FR', ld('R-27ER')), C1: ld('R-77'), C2: ld('R-77') },
    },
    {
      id: 'strike',
      name: '지상 공격',
      description: 'Kh-29T 2 발 + KAB-500L 2 발, Sapsan-E 표적 포드.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-77')), ...both('L3', 'R3', ld('Kh-29T')), ...both('L4', 'R4', ld('KAB-500L')), C1: ld('Sapsan-E') },
    },
    {
      id: 'sead',
      name: 'SEAD',
      description: 'Kh-31P 4 발로 NATO 방공 레이더 제압.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-77')), ...both('L3', 'R3', ld('Kh-31P')), ...both('L4', 'R4', ld('Kh-31P')), ...both('FL', 'FR', ld('R-27ER')) },
    },
  ],
  unlock: FREE,
};

const su35s: AircraftDef = {
  id: 'su35s',
  name: 'Su-35S Flanker-E',
  faction: 'WARSAW',
  playable: false,
  role: 'air_superiority',
  description: '카나드·추력편향의 초기동 Flanker. Irbis-E 레이더와 Khibiny 재머, R-37 까지 운용하는 바르샤바 최강 제공기.',
  model: 'flanker',
  crew: 1,
  dimensions: { length: 21.9, span: 15.3, height: 5.9 },
  mass: { empty: 18400, internalFuel: 11500, maxTakeoff: 34500 },
  aero: { wingArea: 62, cd0: 0.0199, k: 0.09, clAlpha: 3.5, clMax: 1.7, aoaMaxDeg: 40, waveDragRise: 0.0258 },
  engine: { name: 'AL-41F1S', count: 2, dryThrustKN: 86.3, abThrustKN: 142.2, tsfcDry: 72, tsfcAB: 190, spoolTime: 3.6 },
  limits: { gMax: 9, gMin: -3, maxMach: 2.25, rollRateDeg: 280, pitchRateDeg: 35, yawRateDeg: 25, cornerSpeed: 240, maxIas: 389 },
  signature: { rcs: 3, ir: 1.3 },
  gun: { weaponId: 'GSh-30-1', rounds: 150 },
  stations: flanker12(true),
  modules: moduleTable({
    wing: ['SU35-CANARD'],
    radar: ['N035'],
    irst: ['OLS-35'],
    rwr: ['L150'],
    maw: ['Mak-UFM'],
    ew: ['L175V'],
    cms: ['UV-30MK'],
    datalink: ['TKS-2'],
    helmet: ['Sura-K'],
  }),
  presets: [
    {
      id: 'air',
      name: '제공',
      description: 'R-77-1 6 발 + R-27ER 2 발 + R-73M 4 발.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-73M')), ...both('L3', 'R3', ld('R-77-1')), ...both('L4', 'R4', ld('R-77-1')), ...both('FL', 'FR', ld('R-27ER')), C1: ld('R-77-1'), C2: ld('R-77-1') },
    },
    {
      id: 'hunter',
      name: '고가치 표적 사냥',
      description: 'R-37 2 발로 AWACS·급유기를 노린다. R-77-1 4 발 + R-73M 2 발, 연료탱크.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L3', 'R3', ld('R-77-1')), ...both('L4', 'R4', ld('PTB-2000')), ...both('FL', 'FR', ld('R-37')), C1: ld('R-77-1'), C2: ld('R-77-1') },
    },
    {
      id: 'sead',
      name: 'SEAD',
      description: 'Kh-31P 4 발 + R-77-1 2 발 + R-73M 2 발.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-77-1')), ...both('L3', 'R3', ld('Kh-31P')), ...both('L4', 'R4', ld('Kh-31P')) },
    },
  ],
  unlock: FREE,
};

const mig29s: AircraftDef = {
  id: 'mig29s',
  name: 'MiG-29S Fulcrum-C',
  faction: 'WARSAW',
  playable: false,
  role: 'air_superiority',
  description: '경량 전선 전투기. 근접전 기동과 R-73M + 헬멧 조준기가 위협적이지만 항속이 짧다.',
  model: 'mig29',
  crew: 1,
  dimensions: { length: 17.32, span: 11.36, height: 4.73 },
  mass: { empty: 11000, internalFuel: 3800, maxTakeoff: 19700 },
  aero: { wingArea: 38, cd0: 0.0193, k: 0.132, clAlpha: 3.6, clMax: 1.6, aoaMaxDeg: 28, waveDragRise: 0.0231 },
  engine: { name: 'RD-33', count: 2, dryThrustKN: 49.4, abThrustKN: 81.4, tsfcDry: 79, tsfcAB: 209, spoolTime: 3.5 },
  limits: { gMax: 9, gMin: -3, maxMach: 2.25, rollRateDeg: 260, pitchRateDeg: 32, yawRateDeg: 20, cornerSpeed: 230, maxIas: 417 },
  signature: { rcs: 5, ir: 1.1 },
  gun: { weaponId: 'GSh-30-1', rounds: 150 },
  stations: [
    ...pair('L1', 'R1', '외측 날개', [-4.6, -0.3, 1.2], { maxMassKg: 150, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '중간 날개', [-3.5, -0.4, 0.9], { maxMassKg: 600, allowed: [...AAM_ALL, 'bomb_dumb'] }),
    ...pair('L3', 'R3', '내측 날개', [-2.4, -0.5, 0.6], { maxMassKg: 1500, allowed: [...AAM_ALL, 'bomb_dumb', 'tank'] }),
    station('C', '동체 중앙', [0, -1.2, 0.5], { maxMassKg: 1500, allowed: ['tank'] }),
  ],
  modules: moduleTable({ radar: ['Zhuk-ME'], irst: ['OEPS-29'], rwr: ['SPO-15LM'], ew: ['Gardeniya'], cms: ['BVP-30-26M'], datalink: ['TKS-2'], helmet: ['Shchel-3UM'] }),
  presets: [
    { id: 'air', name: '제공', description: 'R-77 2 발 + R-27ER 2 발 + R-73M 2 발, 중앙 탱크.', modules: {}, stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-77')), ...both('L3', 'R3', ld('R-27ER')), C: ld('PTB-1500') } },
    { id: 'dogfight', name: '근접전', description: 'R-73M 4 발 + R-77 2 발. 가볍게 근접전.', modules: {}, stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-73M')), ...both('L3', 'R3', ld('R-77')) } },
    { id: 'bomb', name: '폭격', description: 'FAB-500 2 발 + R-73M 2 발, 중앙 탱크.', modules: {}, stations: { ...both('L1', 'R1', ld('R-73M')), ...both('L3', 'R3', ld('FAB-500')), C: ld('PTB-1500') } },
  ],
  unlock: FREE,
};

const mig31bm: AircraftDef = {
  id: 'mig31bm',
  name: 'MiG-31BM Foxhound',
  faction: 'WARSAW',
  playable: false,
  role: 'interceptor',
  description: '마하 2.8 장거리 요격기. Zaslon-M 과 R-33S/R-37 로 초원거리에서 공격하지만 기동성은 낮다.',
  model: 'mig31',
  crew: 2,
  dimensions: { length: 22.69, span: 13.46, height: 6.15 },
  mass: { empty: 21820, internalFuel: 16350, maxTakeoff: 46200 },
  aero: { wingArea: 61.6, cd0: 0.0165, k: 0.134, clAlpha: 3.2, clMax: 1.4, aoaMaxDeg: 20, waveDragRise: 0.0165 },
  engine: { name: 'D-30F6', count: 2, dryThrustKN: 93, abThrustKN: 152, tsfcDry: 73, tsfcAB: 192, spoolTime: 5.0 },
  limits: { gMax: 5.6, gMin: -2, maxMach: 2.83, rollRateDeg: 120, pitchRateDeg: 18, yawRateDeg: 10, cornerSpeed: 280, maxIas: 417 },
  signature: { rcs: 20, ir: 2.0 },
  gun: { weaponId: 'GSh-6-23', rounds: 260 },
  stations: [
    ...pair('L1', 'R1', '외측 날개', [-4.5, -0.4, 1.4], { maxMassKg: 150, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '내측 날개', [-3.0, -0.5, 1.0], { maxMassKg: 2300, allowed: ['aam_radar', 'aam_long', 'tank'] }),
    station('C1', '동체 좌전방', [-0.9, -1.4, -2.0], { maxMassKg: 650, allowed: ['aam_long'] }),
    station('C2', '동체 우전방', [0.9, -1.4, -2.0], { maxMassKg: 650, allowed: ['aam_long'] }),
    station('C3', '동체 좌후방', [-0.9, -1.4, 2.0], { maxMassKg: 650, allowed: ['aam_long'] }),
    station('C4', '동체 우후방', [0.9, -1.4, 2.0], { maxMassKg: 650, allowed: ['aam_long'] }),
  ],
  modules: moduleTable({ radar: ['Zaslon-M'], irst: ['8TK'], rwr: ['L150'], cms: ['BVP-30-26M'], datalink: ['APD-518'] }),
  presets: [
    {
      id: 'intercept',
      name: '요격 (R-33S)',
      description: 'R-33S 4 발 + R-73M 2 발, 날개 탱크.',
      modules: {},
      stations: { C1: ld('R-33S'), C2: ld('R-33S'), C3: ld('R-33S'), C4: ld('R-33S'), ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('PTB-2500')) },
    },
    {
      id: 'r37',
      name: '요격 (R-37)',
      description: 'R-37 4 발 + R-77-1 2 발 + R-73M 2 발. AWACS 사냥.',
      modules: {},
      stations: { C1: ld('R-37'), C2: ld('R-37'), C3: ld('R-37'), C4: ld('R-37'), ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-77-1')) },
    },
  ],
  unlock: FREE,
};

const su47: AircraftDef = {
  id: 'su47',
  name: 'Su-47 Berkut',
  faction: 'WARSAW',
  playable: false,
  role: 'experimental',
  description: '전진익 실험 전투기. 내부 무장창과 극단적인 저속 기동성, 실전 배치된 소수 기체는 에이스 부대가 탄다.',
  model: 'su47',
  crew: 1,
  dimensions: { length: 22.6, span: 16.7, height: 6.3 },
  mass: { empty: 16375, internalFuel: 11000, maxTakeoff: 35000 },
  aero: { wingArea: 61.87, cd0: 0.0215, k: 0.122, clAlpha: 3.8, clMax: 1.8, aoaMaxDeg: 45, waveDragRise: 0.0257 },
  engine: { name: 'D-30F11', count: 2, dryThrustKN: 83.4, abThrustKN: 142.2, tsfcDry: 74, tsfcAB: 195, spoolTime: 4.0 },
  limits: { gMax: 9, gMin: -3, maxMach: 2.2, rollRateDeg: 260, pitchRateDeg: 40, yawRateDeg: 25, cornerSpeed: 220, maxIas: 389 },
  signature: { rcs: 1.5, ir: 1.2 },
  gun: { weaponId: 'GSh-30-1', rounds: 150 },
  stations: [
    station('BAY_C', '주 무장창', [0, -0.6, 0.5], { internal: true, maxMassKg: 1200, allowed: AAM, limits: { aam_radar: 6, aam_ir: 4 } }),
    ...pair('L1', 'R1', '날개끝', [-8.2, 0, 2.5], { maxMassKg: 150, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '외측 날개', [-6.0, -0.4, 1.5], { maxMassKg: 400, allowed: AAM }),
    ...pair('L3', 'R3', '내측 날개', [-4.0, -0.5, 1.0], { maxMassKg: 700, allowed: [...AAM_ALL, 'aam_long', 'bomb_dumb'] }),
  ],
  modules: moduleTable({ radar: ['N011M'], irst: ['OLS-35'], rwr: ['L150'], maw: ['Mak-UFM'], ew: ['L175V'], cms: ['UV-30MK'], datalink: ['TKS-2'], helmet: ['Sura-K'] }),
  presets: [
    { id: 'clean', name: '내부 무장', description: '무장창에 R-77-1 6 발 + 날개끝 R-73M 2 발.', modules: {}, stations: { BAY_C: ld('R-77-1', 6), ...both('L1', 'R1', ld('R-73M')) } },
    { id: 'heavy', name: '중무장', description: '무장창 R-77-1 6 발 + R-73M 4 발 + R-27ER 2 발.', modules: {}, stations: { BAY_C: ld('R-77-1', 6), ...both('L1', 'R1', ld('R-73M')), ...both('L2', 'R2', ld('R-73M')), ...both('L3', 'R3', ld('R-27ER')) } },
  ],
  unlock: FREE,
};

const tu22m3: AircraftDef = {
  id: 'tu22m3',
  name: 'Tu-22M3 Backfire-C',
  faction: 'WARSAW',
  playable: false,
  role: 'bomber',
  description: '가변익 초음속 폭격기. Kh-22 3 발로 항모전단을 노리거나 FAB-500 24 발을 투하한다. 핵 탑재 가능.',
  model: 'tu22m3',
  crew: 2,
  dimensions: { length: 42.46, span: 34.28, height: 11.05 },
  mass: { empty: 58000, internalFuel: 53550, maxTakeoff: 126400 },
  aero: { wingArea: 183.6, cd0: 0.0141, k: 0.07, clAlpha: 4.5, clMax: 1.4, aoaMaxDeg: 18, waveDragRise: 0.0211 },
  engine: { name: 'NK-25', count: 2, dryThrustKN: 147, abThrustKN: 245, tsfcDry: 76, tsfcAB: 210, spoolTime: 6.0 },
  limits: { gMax: 2.5, gMin: -1, maxMach: 1.88, rollRateDeg: 40, pitchRateDeg: 8, yawRateDeg: 5, cornerSpeed: 300, maxIas: 292 },
  signature: { rcs: 50, ir: 4.0 },
  gun: { weaponId: 'GSh-23L', rounds: 750 },
  stations: [
    station('BAY_C', '폭탄창', [0, -1.6, 0], { internal: true, maxMassKg: 12000, allowed: ['ashm', 'bomb_dumb', 'nuke'], limits: { 'Kh-22': 1, 'FAB-500': 24 } }),
    ...pair('L1', 'R1', '날개 뿌리 파일런', [-5.5, -1.0, -2.0], { maxMassKg: 6000, allowed: ['ashm'] }),
  ],
  modules: moduleTable({ radar: ['PN-A'], rwr: ['L150'], maw: ['Mak-UFM'], ew: ['Ocean'], cms: ['APP-50'], datalink: ['TKS-2'] }),
  presets: [
    { id: 'antiship', name: '대함 (Kh-22)', description: 'Kh-22 3 발.', modules: {}, stations: { BAY_C: ld('Kh-22'), ...both('L1', 'R1', ld('Kh-22')) } },
    { id: 'bomb', name: '융단 폭격', description: 'FAB-500 24 발.', modules: {}, stations: { BAY_C: ld('FAB-500', 24) } },
  ],
  variableSweep: { minDeg: 20, maxDeg: 65 },
  unlock: FREE,
};

const a50: AircraftDef = {
  id: 'a50',
  name: 'A-50 Mainstay',
  faction: 'WARSAW',
  playable: false,
  role: 'awacs',
  description: '조기경보통제기. 300 km 밖까지 전방위로 보고 아군 전투기에 표적을 넘긴다 — 최우선 표적.',
  model: 'a50',
  crew: 2,
  dimensions: { length: 49.59, span: 50.5, height: 14.76 },
  mass: { empty: 75000, internalFuel: 64000, maxTakeoff: 190000 },
  aero: { wingArea: 300, cd0: 0.025, k: 0.05, clAlpha: 5.0, clMax: 1.4, aoaMaxDeg: 15, waveDragRise: 0.03 },
  // 애프터버너 없음: abThrustKN = dryThrustKN
  engine: { name: 'D-30KP', count: 4, dryThrustKN: 117.7, abThrustKN: 117.7, tsfcDry: 70, tsfcAB: 70, spoolTime: 7.0 },
  limits: { gMax: 2.5, gMin: -1, maxMach: 0.8, rollRateDeg: 30, pitchRateDeg: 6, yawRateDeg: 4, cornerSpeed: 200, maxIas: 167 },
  signature: { rcs: 100, ir: 3.0 },
  gun: null,
  stations: [],
  modules: moduleTable({ radar: ['Shmel-M'], rwr: ['SPO-15LM'], cms: ['APP-50'], datalink: ['TKS-2'] }),
  presets: [{ id: 'awacs', name: '조기경보', description: '무장 없음.', modules: {}, stations: {} }],
  unlock: FREE,
};

// ============================================================ 팍스 임페리알리스

const typhoon: AircraftDef = {
  id: 'typhoon',
  name: 'Eurofighter Typhoon',
  faction: 'PAX',
  playable: false,
  role: 'air_superiority',
  description: '팍스 정예 부대의 주력기. 카나드 델타의 높은 추력비·초음속 순항, Meteor 와 DASS 로 무장한 위험한 상대.',
  model: 'typhoon',
  crew: 1,
  dimensions: { length: 15.96, span: 10.95, height: 5.28 },
  mass: { empty: 11000, internalFuel: 4996, maxTakeoff: 23500 },
  aero: { wingArea: 51.2, cd0: 0.0281, k: 0.15, clAlpha: 3.5, clMax: 1.6, aoaMaxDeg: 30, waveDragRise: 0.0098 },
  engine: engineFrom('EJ200', 2),
  limits: { gMax: 9, gMin: -3, maxMach: 2.0, rollRateDeg: 280, pitchRateDeg: 35, yawRateDeg: 20, cornerSpeed: 230, maxIas: 386 },
  signature: { rcs: 0.5, ir: 0.9 },
  gun: { weaponId: 'BK-27', rounds: 150 },
  stations: [
    ...pair('L1', 'R1', '외측 날개', [-5.0, -0.3, 1.6], { maxMassKg: 150, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '중간 외측 날개', [-4.1, -0.4, 1.3], { maxMassKg: 400, allowed: [...AAM, 'agm'], limits: { Brimstone: 3 } }),
    ...pair('L3', 'R3', '중간 내측 날개', [-3.1, -0.5, 1.0], { maxMassKg: 1500, allowed: ['aam_radar', 'agm', 'arm', 'tank', ...BOMBS], limits: { Brimstone: 3 } }),
    ...pair('L4', 'R4', '내측 날개', [-2.1, -0.6, 0.8], { maxMassKg: 1500, allowed: ['aam_radar', 'agm', 'arm', 'tank', ...BOMBS] }),
    ...pair('FL1', 'FR1', '동체 전방 반매립', [-0.9, -1.0, -0.5], { maxMassKg: 200, allowed: ['aam_radar'] }),
    ...pair('FL2', 'FR2', '동체 후방 반매립', [-0.9, -1.0, 2.5], { maxMassKg: 200, allowed: ['aam_radar'] }),
    station('C', '동체 중앙', [0, -1.1, 0.8], { maxMassKg: 1000, allowed: ['tank', 'pod', ...BOMBS] }),
  ],
  modules: moduleTable({
    engine: ['EJ200'],
    radar: ['CAPTOR-M'],
    irst: ['PIRATE'],
    rwr: ['DASS-ESM'],
    maw: ['DASS-MAW'],
    ew: ['DASS-ECM'],
    cms: ['DASS-CMS'],
    datalink: ['MIDS-LVT'],
    helmet: ['Striker'],
  }),
  presets: [
    {
      id: 'air',
      name: '제공',
      description: 'Meteor 4 발 + ASRAAM 2 발 + IRIS-T 2 발, 중앙 탱크.',
      modules: {},
      stations: { ...both('FL1', 'FR1', ld('Meteor')), ...both('FL2', 'FR2', ld('Meteor')), ...both('L1', 'R1', ld('ASRAAM')), ...both('L2', 'R2', ld('IRIS-T')), C: ld('TANK-1000L') },
    },
    {
      id: 'swing',
      name: '스윙 롤',
      description: 'Meteor 4 발 + ASRAAM 2 발, Brimstone 6 발, 날개 탱크.',
      modules: {},
      stations: { ...both('FL1', 'FR1', ld('Meteor')), ...both('FL2', 'FR2', ld('Meteor')), ...both('L1', 'R1', ld('ASRAAM')), ...both('L3', 'R3', ld('Brimstone', 3)), ...both('L4', 'R4', ld('TANK-1000L')) },
    },
    {
      id: 'strike',
      name: '장거리 타격',
      description: 'Storm Shadow 2 발 + Meteor 4 발 + ASRAAM 2 발.',
      modules: {},
      stations: { ...both('FL1', 'FR1', ld('Meteor')), ...both('FL2', 'FR2', ld('Meteor')), ...both('L1', 'R1', ld('ASRAAM')), ...both('L3', 'R3', ld('Storm Shadow')), ...both('L4', 'R4', ld('TANK-1000L')) },
    },
  ],
  unlock: FREE,
};

const tornadoBase = {
  model: 'tornado',
  crew: 2 as const,
  dimensions: { length: 18.68, span: 13.91, height: 5.95 },
  variableSweep: { minDeg: 25, maxDeg: 67 },
  unlock: FREE,
};

const tornado_f3: AircraftDef = {
  ...tornadoBase,
  id: 'tornado_f3',
  name: 'Tornado F3',
  faction: 'PAX',
  playable: false,
  role: 'interceptor',
  description: '대영제국 방공 요격기. 저공 고속 돌진과 Skyflash 4 발, 대신 선회전은 약하다.',
  mass: { empty: 14500, internalFuel: 5800, maxTakeoff: 27986 },
  aero: { wingArea: 26.6, cd0: 0.0257, k: 0.074, clAlpha: 4.5, clMax: 1.8, aoaMaxDeg: 25, waveDragRise: 0.0308 },
  engine: { name: 'RB199 Mk104', count: 2, dryThrustKN: 40.5, abThrustKN: 73.5, tsfcDry: 65, tsfcAB: 220, spoolTime: 3.5 },
  limits: { gMax: 7.5, gMin: -3, maxMach: 2.2, rollRateDeg: 180, pitchRateDeg: 25, yawRateDeg: 15, cornerSpeed: 260, maxIas: 412 },
  signature: { rcs: 8, ir: 1.1 },
  gun: { weaponId: 'BK-27', rounds: 180 },
  stations: [
    ...pair('L1', 'R1', '날개 파일런 숄더 레일', [-2.9, -0.7, 0.5], { maxMassKg: 250, allowed: ['aam_ir'], limits: { aam_ir: 2 } }),
    ...pair('L2', 'R2', '날개 파일런', [-2.6, -0.8, 0.6], { maxMassKg: 2100, allowed: ['tank'] }),
    ...pair('FL1', 'FR1', '동체 전방 반매립', [-0.8, -1.2, -1.0], { maxMassKg: 200, allowed: ['aam_sarh', 'aam_radar'] }),
    ...pair('FL2', 'FR2', '동체 후방 반매립', [-0.8, -1.2, 2.0], { maxMassKg: 200, allowed: ['aam_sarh', 'aam_radar'] }),
  ],
  modules: moduleTable({ radar: ['AI.24'], rwr: ['ARI 18241'], cms: ['BOL'], datalink: ['MIDS-LVT'] }),
  presets: [
    { id: 'cap', name: '방공 초계', description: 'Skyflash 4 발 + ASRAAM 4 발, 날개 탱크.', modules: {}, stations: { ...both('FL1', 'FR1', ld('Skyflash')), ...both('FL2', 'FR2', ld('Skyflash')), ...both('L1', 'R1', ld('ASRAAM', 2)), ...both('L2', 'R2', ld('TANK-2250L')) } },
    { id: 'qra', name: '긴급 요격', description: 'Skyflash 4 발 + ASRAAM 4 발, 탱크 없음.', modules: {}, stations: { ...both('FL1', 'FR1', ld('Skyflash')), ...both('FL2', 'FR2', ld('Skyflash')), ...both('L1', 'R1', ld('ASRAAM', 2)) } },
  ],
};

const tornado_ids: AircraftDef = {
  ...tornadoBase,
  id: 'tornado_ids',
  name: 'Tornado IDS',
  faction: 'PAX',
  playable: false,
  role: 'strike',
  description: '저공 침투 공격기. 지형추적 레이더로 낮게 날아 Storm Shadow·ALARM·Brimstone 을 쏜다.',
  dimensions: { length: 16.72, span: 13.91, height: 5.95 },
  mass: { empty: 13890, internalFuel: 5090, maxTakeoff: 28000 },
  aero: { wingArea: 26.6, cd0: 0.027, k: 0.093, clAlpha: 4.5, clMax: 1.8, aoaMaxDeg: 25, waveDragRise: 0.0378 },
  engine: { name: 'RB199 Mk103', count: 2, dryThrustKN: 40.5, abThrustKN: 71.5, tsfcDry: 65, tsfcAB: 220, spoolTime: 3.5 },
  limits: { gMax: 7.5, gMin: -3, maxMach: 2.2, rollRateDeg: 180, pitchRateDeg: 25, yawRateDeg: 15, cornerSpeed: 260, maxIas: 412 },
  signature: { rcs: 8, ir: 1.1 },
  gun: { weaponId: 'BK-27', rounds: 360 },
  stations: [
    ...pair('L1', 'R1', '외측 날개 파일런', [-3.6, -0.6, 0.8], { maxMassKg: 600, allowed: ['arm', 'pod'] }),
    ...pair('L2', 'R2', '내측 날개 파일런', [-2.4, -0.8, 0.6], { maxMassKg: 2100, allowed: ['tank', 'arm', 'agm', ...BOMBS], limits: { Brimstone: 3 } }),
    ...pair('L3', 'R3', '파일런 숄더 레일', [-2.1, -0.7, 0.6], { maxMassKg: 100, allowed: ['aam_ir'] }),
    ...pair('FL', 'FR', '동체 숄더', [-0.8, -1.2, 0.0], { maxMassKg: 1500, allowed: ['agm', 'arm', 'tank', ...BOMBS], limits: { Brimstone: 3 } }),
    station('C', '동체 중앙', [0, -1.3, 0.0], { maxMassKg: 1000, allowed: BOMBS }),
  ],
  modules: moduleTable({ radar: ['GMR'], rwr: ['ARI 18241'], ew: ['Sky Shadow'], cms: ['BOL'], datalink: ['MIDS-LVT'] }),
  presets: [
    { id: 'strike', name: '장거리 타격', description: 'Storm Shadow 2 발, 날개 탱크, ASRAAM 2 발.', modules: {}, stations: { ...both('FL', 'FR', ld('Storm Shadow')), ...both('L2', 'R2', ld('TANK-2250L')), ...both('L3', 'R3', ld('ASRAAM')) } },
    { id: 'sead', name: 'SEAD', description: 'ALARM 3 발로 방공망 제압.', modules: {}, stations: { ...both('FL', 'FR', ld('ALARM')), R1: ld('ALARM'), ...both('L2', 'R2', ld('TANK-2250L')), ...both('L3', 'R3', ld('ASRAAM')) } },
    { id: 'cas', name: '대기갑', description: 'Brimstone 6 발로 기갑 부대 공격.', modules: {}, stations: { ...both('FL', 'FR', ld('Brimstone', 3)), ...both('L2', 'R2', ld('TANK-2250L')), ...both('L3', 'R3', ld('ASRAAM')) } },
  ],
};

const su27_imperial: AircraftDef = {
  ...su27s,
  id: 'su27_imperial',
  name: 'Su-27SM-I Flanker (제국)',
  faction: 'PAX',
  description: '러시아 제국 공군의 Su-27 개수형. 독일제 신호처리기·MIDS 와 IRIS-T 를 섞어 쓰는 팍스의 동부 전선 전력.',
  mass: { empty: 16900, internalFuel: 9400, maxTakeoff: 31000 },
  aero: { wingArea: 62, cd0: 0.0175, k: 0.126, clAlpha: 3.5, clMax: 1.6, aoaMaxDeg: 30, waveDragRise: 0.0228 },
  engine: { name: 'AL-31F-M1', count: 2, dryThrustKN: 76.2, abThrustKN: 125.5, tsfcDry: 75, tsfcAB: 194, spoolTime: 4.0 },
  stations: flanker10(),
  modules: moduleTable({ radar: ['N001VEP'], rwr: ['ARI 18241'], irst: ['OLS-27'], ew: ['L005'], cms: ['APP-50'], datalink: ['MIDS-LVT'], helmet: ['Shchel-3UM'] }),
  presets: [
    {
      id: 'air',
      name: '제공',
      description: 'R-77 4 발 + R-27ER 4 발 + IRIS-T 2 발.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('IRIS-T')), ...both('L2', 'R2', ld('R-77')), ...both('L3', 'R3', ld('R-77')), ...both('FL', 'FR', ld('R-27ER')), C1: ld('R-27ER'), C2: ld('R-27ER') },
    },
    {
      id: 'dogfight',
      name: '근접전',
      description: 'IRIS-T 2 발 + R-73M 2 발 + R-27ER 2 발.',
      modules: {},
      stations: { ...both('L1', 'R1', ld('IRIS-T')), ...both('L2', 'R2', ld('R-73M')), ...both('L3', 'R3', ld('R-27ER')) },
    },
  ],
};

const xf1: AircraftDef = {
  id: 'xf1',
  name: 'XF-1 Lampyris',
  faction: 'PAX',
  playable: false,
  role: 'experimental',
  description: '팍스 실험 스텔스 전투기. 독일 Lampyridae 계열 다면체 기체에 영국 스텔스 연구를 더했다 — 내부창 Meteor·ASRAAM, 최상급 센서, 초음속 순항.',
  model: 'pax_x1',
  crew: 1,
  dimensions: { length: 17.6, span: 12.4, height: 4.3 },
  mass: { empty: 15500, internalFuel: 7400, maxTakeoff: 30000 },
  aero: { wingArea: 58, cd0: 0.029, k: 0.098, clAlpha: 3.4, clMax: 1.7, aoaMaxDeg: 40, waveDragRise: 0.0101 },
  engine: engineFrom('EJ230', 2),
  limits: { gMax: 9, gMin: -3, maxMach: 2.0, rollRateDeg: 260, pitchRateDeg: 35, yawRateDeg: 20, cornerSpeed: 230, maxIas: 386 },
  signature: { rcs: 0.01, ir: 0.7 },
  gun: { weaponId: 'BK-27', rounds: 150 },
  stations: [
    station('BAY_C', '주 무장창', [0, -0.6, 0.5], { internal: true, maxMassKg: 900, allowed: ['aam_radar'], limits: { aam_radar: 4 } }),
    ...pair('BAY_SL', 'BAY_SR', '측면 무장창', [-1.1, -0.3, -0.8], { internal: true, maxMassKg: 100, allowed: ['aam_ir'] }),
    ...pair('L1', 'R1', '날개 파일런', [-4.5, -0.4, 1.5], { maxMassKg: 1200, allowed: [...AAM, 'tank'], limits: { aam_radar: 2, aam_ir: 2 } }),
  ],
  modules: moduleTable({
    engine: ['EJ230'],
    radar: ['CAPTOR-E'],
    irst: ['PIRATE'],
    rwr: ['DASS-ESM'],
    maw: ['DASS-MAW'],
    ew: ['DASS-ECM'],
    cms: ['DASS-CMS'],
    datalink: ['MIDS-LVT'],
    helmet: ['Striker'],
  }),
  presets: [
    { id: 'stealth', name: '스텔스 제공', description: '무장창에 Meteor 4 발 + ASRAAM 2 발.', modules: {}, stations: { BAY_C: ld('Meteor', 4), ...both('BAY_SL', 'BAY_SR', ld('ASRAAM')) } },
    { id: 'heavy', name: '중무장', description: '외부 파일런에 Meteor 4 발 추가 (스텔스 상실).', modules: {}, stations: { BAY_C: ld('Meteor', 4), ...both('BAY_SL', 'BAY_SR', ld('ASRAAM')), ...both('L1', 'R1', ld('Meteor', 2)) } },
  ],
  unlock: FREE,
};

// ============================================================ WON

const mirage_f1: AircraftDef = {
  id: 'mirage_f1',
  name: 'Mirage F1EQ',
  faction: 'WON',
  playable: false,
  role: 'multirole',
  description: 'WON 의 중고 프랑스제 전투기. 빠르지만 레이더와 미사일이 구식이다.',
  model: 'mirage_f1',
  crew: 1,
  dimensions: { length: 15.3, span: 8.4, height: 4.5 },
  mass: { empty: 7400, internalFuel: 3440, maxTakeoff: 16200 },
  aero: { wingArea: 25, cd0: 0.0126, k: 0.113, clAlpha: 3.5, clMax: 1.5, aoaMaxDeg: 25, waveDragRise: 0.0164 },
  engine: { name: 'Atar 9K-50', count: 1, dryThrustKN: 49.2, abThrustKN: 70.6, tsfcDry: 98, tsfcAB: 200, spoolTime: 4.5 },
  limits: { gMax: 7.5, gMin: -3, maxMach: 2.2, rollRateDeg: 200, pitchRateDeg: 28, yawRateDeg: 15, cornerSpeed: 240, maxIas: 408 },
  signature: { rcs: 4, ir: 1.0 },
  gun: { weaponId: 'DEFA 553', rounds: 270 },
  stations: [
    ...pair('L1', 'R1', '날개끝', [-4.2, 0, 1.2], { maxMassKg: 100, allowed: ['aam_ir'] }),
    ...pair('L2', 'R2', '외측 날개', [-3.0, -0.4, 0.9], { maxMassKg: 300, allowed: ['aam_ir', 'aam_sarh', 'bomb_dumb'] }),
    ...pair('L3', 'R3', '내측 날개', [-2.0, -0.5, 0.6], { maxMassKg: 1200, allowed: ['aam_sarh', 'bomb_dumb', 'tank'] }),
    station('C', '동체 중앙', [0, -1.0, 0.3], { maxMassKg: 1200, allowed: ['tank', 'bomb_dumb'] }),
  ],
  modules: moduleTable({ radar: ['Cyrano IV'], rwr: ['Serval'], ew: ['Barax'], cms: ['Phimat'] }),
  presets: [
    { id: 'air', name: '제공', description: 'R530 2 발 + Magic 2 2 발, 중앙 탱크.', modules: {}, stations: { ...both('L1', 'R1', ld('Magic 2')), ...both('L2', 'R2', ld('R530')), C: ld('TANK-1200L') } },
    { id: 'strike', name: '폭격', description: 'FAB-500 2 발 + Magic 2 2 발, 중앙 탱크.', modules: {}, stations: { ...both('L1', 'R1', ld('Magic 2')), ...both('L3', 'R3', ld('FAB-500')), C: ld('TANK-1200L') } },
  ],
  unlock: FREE,
};

const mig21: AircraftDef = {
  id: 'mig21',
  name: 'MiG-21bis Fishbed (WON 개량)',
  faction: 'WON',
  playable: false,
  role: 'multirole',
  description: '싸고 많은 구형 요격기. 빠르고 작아 보기 어렵지만 선회 지속력과 센서가 빈약하다.',
  model: 'mig21',
  crew: 1,
  dimensions: { length: 14.5, span: 7.15, height: 4.12 },
  mass: { empty: 5350, internalFuel: 2280, maxTakeoff: 10400 },
  aero: { wingArea: 23, cd0: 0.0152, k: 0.199, clAlpha: 3.0, clMax: 1.3, aoaMaxDeg: 25, waveDragRise: 0.0198 },
  engine: { name: 'R-25-300', count: 1, dryThrustKN: 40.2, abThrustKN: 69.6, tsfcDry: 95, tsfcAB: 220, spoolTime: 4.0 },
  limits: { gMax: 8.5, gMin: -3, maxMach: 2.05, rollRateDeg: 180, pitchRateDeg: 25, yawRateDeg: 12, cornerSpeed: 260, maxIas: 361 },
  signature: { rcs: 3, ir: 0.9 },
  gun: { weaponId: 'GSh-23L', rounds: 200 },
  stations: [
    ...pair('L1', 'R1', '외측 날개', [-2.6, -0.3, 0.8], { maxMassKg: 150, allowed: ['aam_ir'], limits: { 'R-60M': 2 } }),
    ...pair('L2', 'R2', '내측 날개', [-1.8, -0.4, 0.5], { maxMassKg: 600, allowed: ['aam_ir', 'bomb_dumb'], limits: { 'R-60M': 2 } }),
    station('C', '동체 중앙', [0, -0.9, 0.3], { maxMassKg: 800, allowed: ['tank'] }),
  ],
  modules: moduleTable({ radar: ['RP-22'], rwr: ['SPO-10'], cms: ['ASO-2V'] }),
  presets: [
    { id: 'air', name: '요격', description: 'R-13M 2 발 + R-60M 4 발, 중앙 탱크.', modules: {}, stations: { ...both('L1', 'R1', ld('R-13M')), ...both('L2', 'R2', ld('R-60M', 2)), C: ld('PTB-800') } },
    { id: 'strike', name: '폭격', description: 'FAB-500 2 발 + R-60M 4 발, 중앙 탱크.', modules: {}, stations: { ...both('L1', 'R1', ld('R-60M', 2)), ...both('L2', 'R2', ld('FAB-500')), C: ld('PTB-800') } },
  ],
  unlock: FREE,
};

export const ENEMY_AIRCRAFT: AircraftDef[] = [su27s, su30mkk, j11, su35s, mig29s, mig31bm, su47, tu22m3, a50, typhoon, tornado_f3, tornado_ids, su27_imperial, xf1, mirage_f1, mig21];
