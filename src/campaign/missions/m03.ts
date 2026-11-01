// M03 "킬린디니 호송단" — 몸바사 앞바다 호송/대함. 팍스 함대와 대함 공격대로부터 화물선단을 지킨다.
// 반전: 호송 중인 Kilindini Star 는 WON 행 소련제 S-300 부품을 싣고 있다. 레갈리아 2·3번기가 실제로 교전 후 이탈하고,
// Sceptre 가 렌윅 대령에게 개인 무전을 건다.
import type { Entity } from '../../core/entity';
import { fleet, nearestAlive } from '../compose';
import type { MissionContext, MissionDef } from '../missionTypes';

const CONVOY_START = { x: -18000, z: 26000 };
const CONVOY_ROUTE = [
  { x: 4000, z: 4000 },
  { x: 30000, z: -24000 },
];
const CARRIER = { x: -30000, z: 56000 };
const MOMBASA = { x: -60000, z: 34000 };
const PAX_FLEET = { x: 30000, z: 22000 };
/** 팍스는 전용 대함 미사일 대신 Storm Shadow 를 쓴다 (Sea Eagle 이 DB 에 생기면 우선) */
const ASM = ['Sea Eagle', 'Storm Shadow', 'AGM-84'] as const;
const SHIP_NAMES = ['Kilindini Star', 'Tana River', 'Lamu Pride'];

function script(ctx: MissionContext): void {
  ctx.setAutoComplete(false);
  let armsRevealed = false;
  let asmLaunched = 0;

  // ---- 아군
  ctx.spawnGround({ unitId: 'carrier_nato', faction: 'NATO', at: CARRIER, heading: 45, name: 'CVN 항모', tags: ['carrier'], invulnerable: true });
  ctx.rearmZone({ x: CARRIER.x, z: CARRIER.z, alt: 1500 }, 3500, { label: '항모 보급 구역', maxAlt: 3000 });
  const ships: Entity[] = SHIP_NAMES.map((name, i) =>
    ctx.spawnGround({
      unitId: 'cargo_ship',
      faction: 'NATO',
      at: { x: CONVOY_START.x - i * 1200, z: CONVOY_START.z + i * 1200 },
      heading: 45,
      name,
      tags: i === 0 ? ['convoy', 'arms_ship'] : ['convoy'],
      waypoints: CONVOY_ROUTE.map((w) => ({ x: w.x - i * 1200, z: w.z + i * 1200 })),
    }),
  );

  // ---- 팍스 함대
  fleet(ctx, { ships: ['destroyer_pax', 'frigate_pax', 'frigate_pax'], faction: 'PAX', at: PAX_FLEET, heading: 300, spacing: 1100, tags: ['pax_fleet'], target: true,
    route: [{ x: 12000, z: 8000 }] });

  // ---- 1파 대함 공격대
  ctx.spawnGroup({
    aircraftId: 'tornado_ids', faction: 'PAX', count: 4, at: { x: -12000, z: -46000, alt: 800 }, heading: 170, formation: 'box', spacing: 400,
    skill: { veteran: 1, regular: 2, rookie: 1 }, role: 'strike', callsign: 'Hammer', tags: ['pax_strike'], target: true, presetId: 'antiship',
    targetTag: 'convoy',
  });
  ctx.spawnGroup({
    aircraftId: 'typhoon', faction: 'PAX', count: 2, at: { x: -6000, z: -50000, alt: 7000 }, heading: 170,
    skill: 'regular', role: 'escort', escortTag: 'pax_strike', callsign: 'Lancet', tags: ['pax_air'], presetId: 'air',
  });

  ctx.objective('convoy', '화물선단 보호 (2척 이상 생존)', { protect: 'convoy', maxLosses: 1 });
  const fleetObj = ctx.objective('fleet', '팍스 함대 격침', { destroy: 'pax_fleet' });
  const strike1 = ctx.objective('strike', '대함 공격대 Hammer 격추', { destroy: 'pax_strike' });
  const strike2 = ctx.objective('strike2', '대함 공격대 Anvil 격추', { destroy: 'pax_strike2', hidden: true });
  const intercept = ctx.objective('intercept', '대함 미사일 요격', { primary: false, total: 6, score: 500 });

  ctx.dialogue(
    [
      ['lantern', '할버드, 몸바사 앞바다다. 화물선 세 척이 북동쪽으로 공해를 향하고 있다. 선단 호위가 오늘 임무다.'],
      ['lantern', '남동쪽에 팍스 수상 전투단 — 구축함 하나, 프리깃 둘. 북쪽 육지에서 Tornado IDS 편대가 내려온다.'],
      ['tarot', '오늘 카드는 "전차". 앞으로 밀고 나가라는 뜻이지. 배를 지키기엔 좀 공격적인 카드지만.'],
      ['magpie', '팍스는 대함 미사일 대신 Storm Shadow 를 씁니다. 느린 순항 미사일이에요. 쏘면 떨어뜨릴 수 있어요.'],
    ],
    { delay: 2 },
  );

  // ---- 스크립트 대함 사격
  const pickShip = (): Entity | null => {
    if (armsRevealed) {
      const arms = ctx.alive('arms_ship')[0];
      if (arms && ctx.rng.chance(0.7)) return arms;
    }
    const alive = ctx.alive('convoy');
    return alive.length ? ctx.rng.pick(alive) : null;
  };
  const fireAsm = (from: Entity): void => {
    const target = pickShip();
    if (!target || !from.alive) return;
    const m = ctx.launch({ weapon: ASM, from, target, targetPoint: target.position.clone(), speed: 220 });
    if (!m) return;
    m.tags.add('asm');
    asmLaunched++;
    if (asmLaunched === 1) {
      ctx.dialogue([
        ['lantern', '대함 미사일 발사 감지! 저고도 순항, 선단으로 향한다. 요격하라!'],
        ['puck', '미사일을 쏘라고요? 미사일로? …해 볼게요!'],
      ]);
    }
  };
  // 함정: 75 초마다 살아있는 함정이 한 발씩
  ctx.every(
    75,
    () => {
      for (const s of ctx.alive('pax_fleet')) {
        if (ctx.distanceToPlayer(s) < 160_000) fireAsm(s);
      }
    },
    { immediate: false },
  );
  ctx.after(50, () => ctx.alive('pax_fleet').slice(0, 1).forEach(fireAsm));
  // 공격기: 선단 35 km 안에 들어오면 한 발씩
  const fired = new Set<number>();
  ctx.every(1, () => {
    for (const tag of ['pax_strike', 'pax_strike2']) {
      for (const a of ctx.alive(tag)) {
        if (fired.has(a.id)) continue;
        const ship = nearestAlive(ships, a.position);
        if (ship && a.position.distanceTo(ship.position) < 35_000) {
          fired.add(a.id);
          fireAsm(a);
        }
      }
    }
  });

  ctx.onDestroyed('asm', (m, by) => {
    if (m.kind !== 'missile' || !by || by === m) return;
    if (by.faction === 'NATO' && intercept.status === 'active') {
      intercept.increment();
      if (intercept.status === 'active') ctx.say('lantern', '대함 미사일 요격 확인.', { priority: 3 });
    }
  });
  ctx.onDestroyed('convoy', (ship) => {
    ctx.say('lantern', `${ship.name} 피격, 침몰 중! 선단 손실 발생!`, { priority: 7 });
    if (ship.tags.has('arms_ship')) ctx.say('Hammer 1', '목표 격침. 계약 이행 완료다.', { side: 'enemy', priority: 6 });
  });

  // ---- 반전: 무기 수송선
  const reveal = (): void => {
    if (armsRevealed) return;
    armsRevealed = true;
    ctx.dialogue([
      ['lantern', '팍스 교신 감청. "Hammer 리더, 표적은 Kilindini Star 하나다. 나머지는 무시해도 좋다."'],
      ['magpie', '…왜 그 배만?'],
      ['citadel', '방금 항만청 화물 목록을 받았다. Kilindini Star 의 화물은 소련제 S-300 부품이다. 행선지는 WON.'],
      ['tarot', '그러니까 우리가 지금 모스크바 택배를 지키고 있다는 거야? 이거 계약서에 있던 내용이야?'],
      ['citadel', '명령은 바뀌지 않는다. 전 선박 보호. 공해에서 민간 선박이 침몰하는 걸 보고만 있을 수는 없다.'],
    ]);
  };
  ctx.after(140, reveal);

  // ---- 2파 + 레갈리아
  let wave2 = false;
  const startWave2 = (): void => {
    if (wave2) return;
    wave2 = true;
    reveal();
    ctx.spawnGroup({
      aircraftId: 'tornado_ids', faction: 'PAX', count: 4, at: { x: 50000, z: -14000, alt: 700 }, heading: 250, formation: 'box', spacing: 400,
      skill: { veteran: 2, regular: 2 }, role: 'strike', callsign: 'Anvil', tags: ['pax_strike2'], target: true, presetId: 'antiship',
      targetTag: 'arms_ship',
    });
    ctx.spawnGroup({
      aircraftId: 'tornado_f3', faction: 'PAX', count: 2, at: { x: 52000, z: -18000, alt: 7500 }, heading: 250,
      skill: 'regular', role: 'escort', escortTag: 'pax_strike2', callsign: 'Brigand', tags: ['pax_air'], presetId: 'air',
    });
    strike2.show();
    ctx.say('lantern', '동쪽에서 2파. Tornado IDS 넷, F3 둘. 콜사인 Anvil. Kilindini Star 쪽으로 직행한다.');
    ctx.after(40, regalia);
  };
  strike1.onComplete(() => ctx.after(8, startWave2));
  ctx.after(320, startWave2);

  let regaliaIn = false;
  function regalia(): void {
    if (regaliaIn) return;
    regaliaIn = true;
    ctx.spawnAir({
      aircraftId: 'typhoon', faction: 'PAX', at: { x: 46000, z: -40000, alt: 9500 }, heading: 230, speed: 400, skill: 'ace', role: 'sweep',
      callsign: 'Regalia 2', name: 'Typhoon (레갈리아)', tags: ['regalia'], presetId: 'air',
    });
    ctx.spawnAir({
      aircraftId: 'su27_imperial', faction: 'PAX', at: { x: 47000, z: -39000, alt: 9000 }, heading: 230, speed: 400, skill: 'ace', role: 'sweep',
      callsign: 'Regalia 3', name: 'Su-27 (레갈리아)', tags: ['regalia'], presetId: 'air',
    });
    const regObj = ctx.objective('regalia', '레갈리아 편대 격퇴', { primary: false, score: 1200 });
    ctx.dialogue([
      ['lantern', '북동쪽 고고도, 두 기 고속 접근. 왕관 문장. 레갈리아다.'],
      ['orb', 'Regalia 2. 이번엔 계약 범위 안이다, 할버드. 비켜 주면 쫓지 않겠다.'],
      ['spur', '진자에서 못다 한 얘기를 마저 하자고, NATO!'],
      ['magpie', '1번기, 이번엔 진짜로 덤빕니다. 둘이 한 기씩 — 등 맡길게요.'],
    ]);
    let left = false;
    const leave = (forced: boolean): void => {
      if (left) return;
      left = true;
      watch.cancel();
      ctx.setInvulnerable('regalia', true);
      if (forced) regObj.complete();
      ctx.dialogue(
        [
          forced ? ['orb', '피해가 계약 한도를 넘었다. Regalia 2, 3, 이탈한다.'] : ['orb', '시간이다. Regalia 2, 3, 이탈.'],
          ['sceptre', '렌윅 대령. 이 주파수는 아직 기억하고 있겠지.'],
          ['sceptre', '거스, 이제는 모스크바의 총을 호위하나? 우리가 함께 날던 시절의 당신이라면 웃었을 텐데.'],
          ['citadel', '…데스먼드. 변한 건 내가 아니야. 그 왕관 문장을 달고 마을을 폭격하는 건 당신 쪽이지.'],
          ['sceptre', '평화에는 왕관을 쓸 누군가가 필요하다. 언젠가 당신도 이해할 거다. 좋은 비행이었다, 할버드.'],
        ],
        { delay: 1 },
      );
      ctx.withdraw('regalia', { maxTime: 30 });
    };
    const watch = ctx.every(0.5, () => {
      const r = ctx.alive('regalia');
      if (r.some((e) => e.hp < e.maxHp * 0.5)) leave(true);
    });
    ctx.after(130, () => leave(false));
  }

  // ---- 완료
  ctx.when(
    () => fleetObj.status === 'complete' && strike1.status === 'complete' && strike2.status === 'complete',
    () => {
      ctx.dialogue(
        [
          ['lantern', '팍스 수상 전투단 전멸, 공격대 전멸. 선단은 공해에 진입했다.'],
          ['puck', '배들이 손을 흔들어요! …아니, 저건 깃발인가?'],
          ['citadel', '할버드, 잘했다. 귀환하라. …그리고 Kilindini Star 의 일은 아무에게도 말하지 마라.'],
        ],
        { delay: 3, then: () => ctx.end(true, '선단 호위 성공') },
      );
    },
    { interval: 0.5 },
  );
}

export const M03: MissionDef = {
  id: 'm03',
  act: 1,
  index: 3,
  title: '킬린디니 호송단',
  subtitle: '몸바사 앞바다 선단 호위',
  date: '2000-03-27',
  location: '케냐, 몸바사 앞바다 (인도양)',
  available: true,
  kinds: ['escort', 'anti_ship'],
  briefing: {
    paragraphs: [
      '진자 비행장이 마비되자 팍스는 바다로 눈을 돌렸다. 몸바사 킬린디니 항을 떠나는 선박은 "제국 해상 보호 구역" 을 지나려면 팍스 함대의 검문을 받아야 한다고 선언했다.',
      'NATO 는 이를 인정하지 않는다. 오늘 화물선 세 척 — Kilindini Star, Tana River, Lamu Pride — 이 검문 없이 공해로 나간다. 할버드 편대가 상공을 지킨다.',
      '남동쪽에 팍스 구축함 1척과 프리깃 2척이 있고, 북쪽 육지에서 Tornado IDS 대함 공격대가 출격할 것이다. 팍스는 Storm Shadow 순항 미사일을 대함 용도로 쓴다. 느리고 낮게 날아오므로 요격할 수 있다.',
      '항모가 서쪽 해역에 있다. 항모 상공 저고도가 보급 구역이다. 선단이 2척 이상 살아남아야 임무 성공이다.',
    ],
    objectivesText: ['화물선단 보호 (2척 이상 생존)', '팍스 수상 전투단 격침', '대함 공격대 격추', '(보조) 대함 미사일 요격'],
    mapMarkers: [
      { x: CONVOY_START.x, z: CONVOY_START.z, label: '화물선단', kind: 'friendly' },
      { x: CONVOY_ROUTE[1].x, z: CONVOY_ROUTE[1].z, label: '공해 진입점', kind: 'objective' },
      { x: CARRIER.x, z: CARRIER.z, label: '항모 (보급 구역)', kind: 'friendly', radius: 3500 },
      { x: MOMBASA.x, z: MOMBASA.z, label: '몸바사 킬린디니 항', kind: 'friendly' },
      { x: PAX_FLEET.x, z: PAX_FLEET.z, label: '팍스 수상 전투단', kind: 'target', radius: 30000 },
      { x: -12000, z: -46000, label: 'Hammer 공격대', kind: 'enemy' },
      { x: -30000, z: 38000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['Type 42 구축함 (Sea Dart)', 'Type 23 프리깃 (Sea Wolf)', 'Tornado IDS', 'Typhoon / Tornado F3'],
    recommendation: '대함. AGM-84 와 자위용 AIM-120D. 순항 미사일 요격에는 기관포와 AIM-9X 가 유용하다.',
  },
  environment: {
    biome: 'savanna',
    seed: 2027,
    timeOfDay: 11.5,
    weather: 'scattered',
    mapRadius: 100_000,
    relief: 0.6,
    coast: { side: 'east', distanceM: -48_000 },
    cities: [{ x: MOMBASA.x, z: MOMBASA.z, radius: 4000, density: 0.8 }],
    airbases: [{ x: MOMBASA.x - 6000, z: MOMBASA.z + 9000, heading: 30, faction: 'WON', name: 'Moi' }],
  },
  player: { position: { x: -30000, z: 38000, alt: 4000 }, heading: 45, speed: 240, recommendedPreset: 'antiship' },
  wingmen: [
    { callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'air', skill: 'ace' },
    { callsign: 'Halberd 3', aircraftId: 'fa18i', presetId: 'antiship', skill: 'veteran' },
    { callsign: 'Halberd 4', aircraftId: 'f16p', presetId: 'antiship', skill: 'regular' },
  ],
  parTime: 900,
  rankThresholds: { S: 7000, A: 5600, B: 4200, C: 2600 },
  reward: 12000,
  roster: {
    aircraft: ['tornado_ids', 'typhoon', 'tornado_f3', 'su27_imperial'],
    units: ['carrier_nato', 'cargo_ship', 'destroyer_pax', 'frigate_pax'],
  },
  script,
};
