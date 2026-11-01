// M02 "침묵의 우산" — 진자 비행장 SEAD/타격. 조기경보 레이더 → SA-10 알파 → (숨어 있던) SA-10 브라보 → 격납고.
// 비행장을 빠져나가는 수송대와 레갈리아 3번기 Spur 가 나타나고, "AMPULLA" 컨테이너의 존재가 처음 드러난다.
import type { MissionContext, MissionDef } from '../missionTypes';
import { airfield, convoy, samSite } from '../compose';

const FIELD = { x: 8000, z: -22000 };
const EW = { x: -17000, z: -6000 };
const SAM_A = { x: 2000, z: 1500 };
const SAM_B = { x: 15000, z: -31000 };
const ROUTE_END = { x: -22000, z: -62000 };
const TANKER = { x: -4000, z: 52000, alt: 5500 };

function script(ctx: MissionContext): void {
  ctx.setAutoComplete(false);

  // ---- 방공망
  ctx.spawnGround({ unitId: 'ew_radar', faction: 'PAX', at: EW, tags: ['ew'], target: true, name: '조기경보 레이더' });
  ctx.spawnGroup({ unitId: 'zsu234', faction: 'PAX', at: EW, count: 2, pattern: 'ring', radius: 500, tags: ['ew_aaa'] });
  samSite(ctx, { at: SAM_A, faction: 'PAX', system: 'sa10', coreTags: ['sam_a'], target: true, aaa: 2 });
  ctx.spawnGroup({ unitId: 'zsu234', faction: 'PAX', at: FIELD, count: 4, pattern: 'ring', radius: 1100, tags: ['field_aaa'] });
  ctx.spawnGroup({ unitId: 'rapier', faction: 'PAX', at: { x: FIELD.x - 1500, z: FIELD.z + 900 }, count: 2, pattern: 'line', spacing: 900, heading: 120, tags: ['field_sam'] });
  const field = airfield(ctx, { at: FIELD, heading: 120, faction: 'PAX', hangars: 4, fuelTanks: 3, targetHangars: true, tags: ['jinja'] });
  for (const h of field.hangars) h.tags.add('hangar_target');

  // ---- 공중
  ctx.spawnGroup({
    aircraftId: 'typhoon', faction: 'PAX', count: 2, at: { x: -2000, z: -36000, alt: 6500 }, heading: 180,
    skill: ['regular', 'rookie'], role: 'cap', callsign: 'Warden', tags: ['pax_air'], presetId: 'air',
    patrol: { at: { x: 2000, z: -26000, alt: 6500 }, radius: 10000 },
  });

  ctx.rearmZone(TANKER, 4500, { label: '공중급유기 Pelican 보급 구역' });

  const ew = ctx.objective('ew', '조기경보 레이더 파괴', { destroy: 'ew' });
  const samA = ctx.objective('sam_a', 'SA-10 알파 진지 무력화 (레이더·발사대)', { destroy: 'sam_a' });
  const samB = ctx.objective('sam_b', 'SA-10 브라보 진지 무력화', { destroy: 'sam_b', hidden: true });
  const hangars = ctx.objective('hangar', '진자 비행장 강화 격납고 파괴', { destroy: 'hangar_target' });

  ctx.dialogue(
    [
      ['lantern', '할버드, 빅토리아 호 상공 진입 확인. 진자까지 북쪽으로 70 km. SA-10 탐색 레이더가 돌고 있다.'],
      ['lantern', '호수 수면 가까이 붙어라. 레이더 수평선 아래로 들어가면 놈들 눈에 안 보인다.'],
      ['magpie', '전파 방사원부터. AGM-88 은 켜져 있는 레이더로 날아갑니다. Magnum 은 레이더가 꺼지기 전에.'],
      ['tarot', '어젯밤 카드는 "은둔자" 였어. 숨어 있는 놈이 하나 더 있다는 뜻이지. 믿거나 말거나.'],
      ['lindqvist', '정보장교다. 그 SA-10 들은 작년에 WON 이 바르샤바에서 사들인 물건이다. 팍스가 진자를 점령하면서 통째로 빼앗았지.'],
    ],
    { delay: 2 },
  );

  // 조기경보 레이더가 죽으면 비행장에서 긴급 발진
  ew.onComplete(() => {
    ctx.dialogue([
      ['lantern', '조기경보 레이더 침묵. 비행장에서 엔진 시동 열원 다수… 긴급 발진이다.'],
      ['Warden 1', '진자 관제, 눈이 멀었다! 비상 발진 요청한다!', { side: 'enemy' }],
    ]);
    ctx.after(10, () =>
      ctx.spawnGroup({
        aircraftId: 'typhoon', faction: 'PAX', count: 2, at: { x: FIELD.x, z: FIELD.z, alt: 900 }, heading: 210, speed: 190,
        skill: { veteran: 1, regular: 1 }, role: 'interceptor', callsign: 'Spearhead', tags: ['pax_scramble'], presetId: 'air',
      }),
    );
  });

  // 알파가 무너지면 숨어 있던 브라보 진지가 레이더를 켠다
  samA.onComplete(() => {
    samSite(ctx, { at: SAM_B, faction: 'PAX', system: 'sa10', coreTags: ['sam_b'], target: true, aaa: 2, launchers: 3 });
    samB.show();
    ctx.dialogue([
      ['magpie', '알파 진지 침묵 확인.'],
      ['lantern', '경고! 새 방사원, 비행장 북쪽 9 km. SA-10 하나 더 — 지금까지 레이더를 끄고 숨어 있었다. 브라보 진지로 지정한다.'],
      ['tarot', '봤지? "은둔자". 이제 내 카드 믿을 거지?'],
    ]);
  });

  // 격납고 절반이 무너지면 수송대가 북쪽으로 도주
  let convoySpawned = false;
  const spawnConvoy = (): void => {
    if (convoySpawned) return;
    convoySpawned = true;
    convoy(ctx, {
      units: ['mbt_pax', 'truck', 'truck', 'truck', 'truck', 'mbt_pax'],
      faction: 'PAX',
      at: { x: FIELD.x - 1200, z: FIELD.z - 800 },
      heading: 320,
      route: [{ x: FIELD.x - 6000, z: FIELD.z - 9000 }, { x: -9000, z: -46000 }, ROUTE_END],
      tags: ['convoy'],
      target: true,
    });
    const cv = ctx.objective('convoy', '비행장을 빠져나가는 수송대 저지', { destroy: 'convoy', primary: false, score: 600 });
    ctx.areaTrigger(ROUTE_END, 2500, () => cv.fail(), { who: { tag: 'convoy' } });
    ctx.dialogue([
      ['puck', '비행장 북문에서 차량 종대가 나가요! 트럭 넷, 전차 둘!'],
      ['lantern', '수송대 확인. 트럭 컨테이너에 표기… "AMPULLA". 의미 불명이다. 놓치지 마라.'],
    ]);
    ctx.after(20, spurAppears);
  };
  ctx.onDestroyed('hangar_target', () => {
    if (ctx.countAlive('hangar_target') <= 2) spawnConvoy();
  });
  ctx.after(330, spawnConvoy);

  // ---- 레갈리아 3번기 Spur: 수송대 엄호 후 이탈
  let spurDone = false;
  function spurAppears(): void {
    if (spurDone) return;
    spurDone = true;
    ctx.spawnAir({
      aircraftId: 'su27_imperial', faction: 'PAX', at: { x: -12000, z: -60000, alt: 7000 }, heading: 160, speed: 380, skill: 'ace', role: 'escort',
      callsign: 'Regalia 3', name: 'Su-27 (레갈리아)', tags: ['regalia'], escortTag: 'convoy', presetId: 'air',
    });
    ctx.dialogue([
      ['lantern', '북쪽에서 고속 접근, 단기. Su-27 파생형… 꼬리에 왕관 문장. 대지구대의 그 편대다.'],
      ['spur', '여기는 Spur. NATO 꼬마들이 내 짐을 건드리고 있군. 장난감 같은 기체로 여기까지 오다니, 재밌어.'],
      ['magpie', '1번기, 저건 에이스입니다. 정면으로 붙지 말고 둘이서 협공해요.'],
    ]);
    let left = false;
    const leave = (hurt: boolean): void => {
      if (left || ctx.countAlive('regalia') === 0) return;
      left = true;
      ctx.dialogue([
        hurt ? ['spur', '젠장, 맞았다! …좋아, 기억해 두지, 할버드.'] : ['spur', '흥, 시간이 다 됐군.'],
        ['sceptre', 'Spur, 그만. 화물은 어젯밤에 이미 떠났다. 그 트럭들에 목숨 걸 가치는 없다.'],
        ['spur', '…알았다, Sceptre. 철수한다.'],
      ]);
      ctx.withdraw('regalia', { maxTime: 20 });
      if (hurt) ctx.addScore(800, '레갈리아 3번기 격퇴');
    };
    const hp = ctx.every(0.5, (h) => {
      const spur = ctx.alive('regalia')[0];
      if (!spur) return h.cancel();
      if (spur.hp < spur.maxHp * 0.55) {
        h.cancel();
        ctx.setInvulnerable(spur, true);
        leave(true);
      }
    });
    ctx.after(100, () => {
      hp.cancel();
      leave(false);
    });
  }

  // ---- 완료
  ctx.when(
    () => [ew, samA, samB, hangars].every((o) => o.status === 'complete'),
    () =>
      ctx.dialogue(
        [
          ['lantern', '진자 방공망 소멸, 격납고 전파 확인. 팍스의 동아프리카 Typhoon 전력은 당분간 땅에 묶였다.'],
          ['lindqvist', '좋은 소식과 나쁜 소식. 좋은 소식: 비행장은 끝났다. 나쁜 소식: 수송대 잔해의 컨테이너는 비어 있었다.'],
          ['lindqvist', '방사선 반응은 없다. 그런데 컨테이너 내벽이 영하 190도까지 냉각된 흔적이 있다. 뭘 옮겼는지 모르겠군.'],
          ['citadel', '진자 남쪽, 오언 폭포 댐 옆의 그 "수력 연구소" 도 사진을 찍어 둬라. 할버드, 귀환하라.'],
        ],
        { delay: 3, then: () => ctx.end(true, '진자 방공망 및 비행장 무력화') },
      ),
    { interval: 0.5 },
  );
}

export const M02: MissionDef = {
  id: 'm02',
  act: 1,
  index: 2,
  title: '침묵의 우산',
  subtitle: '진자 방공망 제압 및 비행장 타격',
  date: '2000-03-19',
  location: '우간다, 진자 비행장 (빅토리아 호 북안)',
  available: true,
  kinds: ['sead', 'strike'],
  briefing: {
    paragraphs: [
      '대지구대 사건 이후 팍스는 동아프리카 항공 작전을 우간다 진자 비행장으로 집중했다. 진자는 빅토리아 호에서 나일 강이 흘러나가는 바로 그 자리다.',
      '비행장은 S-300(SA-10) 방공망이 덮고 있다. 원래 WON 이 작년에 바르샤바에서 사들인 장비지만, 팍스가 비행장을 점령하며 통째로 빼앗았다. 탐색 레이더의 우산 아래에서 Typhoon 들이 마음껏 출격한다.',
      '할버드 편대는 호수 쪽에서 저공으로 침투해 조기경보 레이더를 먼저 끄고, SA-10 진지를 무력화한 뒤 강화 격납고를 파괴한다. 호수 남쪽 상공에 공중급유기 Pelican 의 보급 구역이 있다.',
      '정찰 사진에 비행장 남쪽 오언 폭포 댐 옆의 "수력 연구소" 가 찍혔다. 팍스가 점령 직후 가장 먼저 경비를 세운 곳이다. 이번 작전의 표적은 아니다. — 정보장교 린드크비스트',
    ],
    objectivesText: ['조기경보 레이더 파괴', 'SA-10 알파 진지 무력화', '진자 비행장 강화 격납고 파괴', '(보조) 수송대 저지'],
    mapMarkers: [
      { x: EW.x, z: EW.z, label: '조기경보 레이더', kind: 'target' },
      { x: SAM_A.x, z: SAM_A.z, label: 'SA-10 알파', kind: 'enemy', radius: 40000 },
      { x: FIELD.x, z: FIELD.z, label: '진자 비행장', kind: 'target', radius: 2500 },
      { x: TANKER.x, z: TANKER.z, label: '보급 구역 (Pelican)', kind: 'friendly', radius: 4500 },
      { x: 9500, z: -12000, label: '오언 폭포 댐 / 연구소', kind: 'objective' },
      { x: -5000, z: 70000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['SA-10 (5V55R)', 'Rapier Mk2', 'ZSU-23-4', 'Typhoon'],
    recommendation: 'SEAD. AGM-88E 와 GPS 폭탄, 자위용 AIM-120. 저공 침투 시 지형에 주의.',
  },
  environment: {
    biome: 'jungle',
    seed: 2019,
    timeOfDay: 6.4,
    weather: 'clear',
    mapRadius: 100_000,
    relief: 0.8,
    coast: { side: 'south', distanceM: 20_000 },
    airbases: [{ x: FIELD.x, z: FIELD.z, heading: 120, faction: 'PAX', name: 'Jinja' }],
    flatten: [
      { x: FIELD.x, z: FIELD.z, radius: 3000 },
      { x: SAM_A.x, z: SAM_A.z, radius: 900 },
      { x: SAM_B.x, z: SAM_B.z, radius: 900 },
      { x: EW.x, z: EW.z, radius: 600, height: 180 },
    ],
    cities: [
      { x: 13000, z: -15000, radius: 2400, density: 0.6 },
      { x: -8000, z: -30000, radius: 1200, density: 0.3 },
    ],
  },
  player: { position: { x: -5000, z: 70000, alt: 700 }, heading: 355, speed: 240, recommendedPreset: 'sead' },
  wingmen: [
    { callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'strike', skill: 'ace' },
    { callsign: 'Halberd 3', aircraftId: 'fa18i', presetId: 'sead', skill: 'veteran' },
    { callsign: 'Halberd 4', aircraftId: 'f16p', presetId: 'sead', skill: 'regular' },
  ],
  parTime: 900,
  rankThresholds: { S: 6400, A: 5200, B: 3900, C: 2400 },
  reward: 10000,
  roster: {
    aircraft: ['typhoon', 'su27_imperial'],
    units: ['ew_radar', 'zsu234', 'sa10_radar', 'sa10_tel', 'rapier', 'hangar_has', 'fuel_tank', 'comm_tower', 'mbt_pax', 'truck'],
  },
  script,
};
