// M01 "균열의 계곡" — 대지구대 제공권. 팍스 폭격대 저지 → 위장 폭격(가짜 NATO 공습)으로 WON 이 적대화
// → 위장 폭격기 격추로 오해를 풀고 → 레갈리아 편대 첫 등장.
import * as THREE from 'three';
import type { MissionContext, MissionDef } from '../missionTypes';

const NAKURU = { x: 2000, z: -8000 };
const GILGIL = { x: -14000, z: 6000 };

function script(ctx: MissionContext): void {
  ctx.setAutoComplete(false);
  let wonKillsByPlayer = 0;
  let phase = 1;

  // ---- 지상: WON 나쿠루 시가지 (보호 대상)
  ctx.spawnGroup({ unitId: 'technical', faction: 'WON', at: NAKURU, count: 4, pattern: 'scatter', radius: 900, tags: ['nakuru'] });
  ctx.spawnGroup({ unitId: 'truck', faction: 'WON', at: { x: NAKURU.x + 600, z: NAKURU.z + 400 }, count: 3, pattern: 'column', heading: 40, spacing: 40, tags: ['nakuru'] });
  ctx.spawnGround({ unitId: 'comm_tower', faction: 'WON', at: { x: NAKURU.x - 300, z: NAKURU.z - 200 }, tags: ['nakuru'], name: '나쿠루 통신탑' });
  ctx.spawnGroup({ unitId: 'zu23', faction: 'WON', at: NAKURU, count: 2, pattern: 'ring', radius: 1400, tags: ['won_ground'] });
  ctx.spawnGroup({ unitId: 'building_block', faction: 'WON', at: GILGIL, count: 4, pattern: 'grid', spacing: 120, tags: ['gilgil'], invulnerable: true });

  // ---- 팍스 1파: 초계 + 폭격대
  ctx.spawnGroup({
    aircraftId: 'typhoon', faction: 'PAX', count: 2, at: { x: -14000, z: -22000, alt: 7500 }, heading: 150,
    skill: { veteran: 1, regular: 1 }, role: 'cap', callsign: 'Lancet', tags: ['pax_cap'], presetId: 'air',
    patrol: { at: { x: -6000, z: -12000, alt: 7500 }, radius: 12000 },
  });
  ctx.spawnGroup({
    aircraftId: 'tornado_f3', faction: 'PAX', count: 2, at: { x: 17000, z: -26000, alt: 6800 }, heading: 200,
    skill: ['regular', 'rookie'], role: 'cap', callsign: 'Brigand', tags: ['pax_cap'], presetId: 'air',
  });
  ctx.spawnGroup({
    aircraftId: 'tornado_ids', faction: 'PAX', count: 4, at: { x: -36000, z: -40000, alt: 1500 }, heading: 135, formation: 'box', spacing: 350,
    skill: { regular: 2, rookie: 2 }, role: 'strike', callsign: 'Gauntlet', tags: ['pax_strike'], target: true, presetId: 'strike',
    targetTag: 'nakuru', waypoints: [{ x: -16000, z: -24000, alt: 900 }, { x: NAKURU.x, z: NAKURU.z, alt: 800 }],
  });

  const strike = ctx.objective('strike', '팍스 폭격 편대 Gauntlet 격추', { destroy: 'pax_strike' });
  const cap = ctx.objective('cap', '팍스 초계 전투기 격추', { destroy: 'pax_cap' });
  ctx.objective('nakuru', '나쿠루 시가지 보호', { protect: 'nakuru', maxLosses: 4 });

  // 폭격기가 시가지 상공에 도달하면 (AI 가 직접 폭격하지 않아도) 피해 발생
  const bombed = new Set<number>();
  ctx.areaTrigger(
    { x: NAKURU.x, z: NAKURU.z },
    3200,
    (bomber) => {
      if (bombed.has(bomber.id) || !bomber.alive) return;
      bombed.add(bomber.id);
      const victims = ctx.alive('nakuru').slice(0, 2);
      for (const v of victims) v.kill(ctx.sim, { amount: 9999, kind: 'blast', source: bomber, weaponId: null });
      ctx.sim.services.fx.explosion(bomber.position.clone().setY(ctx.sim.services.terrain.heightAt(NAKURU.x, NAKURU.z)), { size: 40, kind: 'ground' });
      ctx.say('baobab', '나쿠루 피폭! 시가지에 폭탄이 떨어지고 있다!', { priority: 6 });
    },
    { who: { tag: 'pax_strike' }, once: false, maxAlt: 4000 },
  );

  ctx.dialogue(
    [
      ['lantern', '할버드 편대, Lantern 이다. 대지구대 상공 진입 확인. 북서쪽에서 팍스 폭격 편대가 나쿠루로 향하고 있다.'],
      ['citadel', '교전 규칙 확인. 팍스 기는 전부 적성. WON 기는 중립이다 — 먼저 쏘지 마라.'],
      ['tarot', '오늘 아침 카드는 "탑" 이었어. 무너지는 탑. 누구 탑이 무너질지는 모르겠지만.'],
      ['puck', 'Halberd 4, 준비 완료! 첫 실전이에요… 퍽을 골대에 넣듯이, 맞죠?'],
      ['magpie', '수다는 착륙하고. 폭격기 우선입니다, 1번기.'],
    ],
    { delay: 2 },
  );

  ctx.when(
    () => ctx.time > 25 && ctx.countAlive('pax_cap') > 0,
    () => ctx.say('Lancet 1', 'NATO 가 왜 여기 있지? …상관없다. 계약서에 적힌 대로 한다. 요격하라!', { side: 'enemy' }),
  );

  // ---- 2파: 폭격대 섬멸 또는 4분 경과 → WON 출격 + 위장 폭격
  let phase2Started = false;
  const startPhase2 = (): void => {
    if (phase2Started) return;
    phase2Started = true;
    phase = 2;
    ctx.spawnAir({
      aircraftId: 'mirage_f1', faction: 'WON', at: { x: -46000, z: 4000, alt: 5000 }, heading: 80, skill: 'ace', role: 'sweep',
      callsign: 'Kifaru 1', tags: ['won_air', 'kifaru'], presetId: 'air', invulnerable: true,
    });
    ctx.spawnAir({
      aircraftId: 'mirage_f1', faction: 'WON', at: { x: -46500, z: 4600, alt: 5000 }, heading: 80, skill: 'regular', role: 'sweep',
      callsign: 'Kifaru 2', tags: ['won_air'], presetId: 'air',
    });
    ctx.spawnGroup({
      aircraftId: 'mig21', faction: 'WON', count: 2, at: { x: -44000, z: 9000, alt: 4200 }, heading: 70,
      skill: 'rookie', role: 'sweep', callsign: 'Nyati', tags: ['won_air', 'won_mig'],
    });
    ctx.spawnAir({
      aircraftId: 'tornado_ids', faction: 'PAX', at: { x: -25000, z: 14000, alt: 700 }, heading: 55, skill: 'veteran', role: 'bomber',
      callsign: 'Unknown', name: '미확인 기체', tags: ['falseflag'], target: true, score: 400,
      waypoints: [{ x: GILGIL.x, z: GILGIL.z, alt: 600 }, { x: 10000, z: 30000, alt: 600 }],
    });
    ctx.spawnGroup({
      aircraftId: 'tornado_f3', faction: 'PAX', count: 2, at: { x: 30000, z: -34000, alt: 8000 }, heading: 220,
      skill: 'regular', role: 'sweep', callsign: 'Brigand', tags: ['pax_wave2'], presetId: 'air',
    });
    ctx.objective('wave2', '팍스 증원 편대 격추', { destroy: 'pax_wave2', primary: false });
    ctx.dialogue([
      ['lantern', '서쪽에서 다수 접촉. WON 공군 Mirage F1, MiG-21… 키수무에서 긴급 발진했다.'],
      ['Kifaru 1', '여기는 WON Kifaru 1. NATO 편대, 우리 영공이다. 팍스 놈들은 우리가 처리한다. 물러나라.'],
      ['lantern', '저고도에 미확인 기체 하나. IFF 응답 없음… 길길 마을로 향하고 있다.'],
    ]);
    ctx.areaTrigger(GILGIL, 2500, () => falseFlagStrike(), { who: { tag: 'falseflag' } });
    ctx.after(60, falseFlagStrike);
  };
  strike.onComplete(() => {
    ctx.say('magpie', 'Gauntlet 편대 전멸 확인. 나쿠루는 무사합니다.');
    ctx.after(6, startPhase2);
  });
  ctx.after(240, startPhase2);

  // 위장 폭격: 미확인 기체가 길길에 폭탄을 떨어뜨리고, WON 은 NATO 의 소행으로 믿는다
  let falseFlagDone = false;
  // 폭격 전에 격추하면: WON 과의 충돌 없이 증거 확보
  ctx.onDestroyed('falseflag', () => {
    if (falseFlagDone) return;
    falseFlagDone = true;
    ctx.objective('falseflag', '미확인 폭격기 격추', { score: 1000 }).complete();
    ctx.dialogue(
      [
        ['lantern', '미확인 기체 추락. 잔해 영상… 동체에 NATO 표식을 덧칠한 흔적, 엔진은 팍스 정비창 각인이다.'],
        ['magpie', '길길에 닿기 전에 떨어뜨렸어요. 저게 마을에 폭탄을 떨궜다면 누구 짓이 됐을지…'],
        ['baobab', '…Baobab 이다. 영상 받았다. 감사는 하지 않겠다, NATO. 하지만 기억은 하겠다.'],
      ],
      { delay: 1, then: () => ((phase = 3), ctx.after(8, regaliaTeaser)) },
    );
  });
  function falseFlagStrike(): void {
    if (falseFlagDone || ctx.countAlive('falseflag') === 0) return;
    falseFlagDone = true;
    const g = ctx.sim.services.terrain.heightAt(GILGIL.x, GILGIL.z);
    for (let i = 0; i < 3; i++) {
      ctx.after(i * 0.6, () => ctx.sim.services.fx.explosion(new THREE.Vector3(GILGIL.x + i * 120 - 120, g, GILGIL.z + i * 80), { size: 35, kind: 'ground' }));
    }
    ctx.setRelations('NATO', 'WON', true);
    const ff = ctx.objective('falseflag', '미확인 폭격기를 격추해 증거를 확보하라', { destroy: 'falseflag', score: 800 });
    ctx.objective('won_spare', 'WON 기 격추 2기 이하', { primary: false, score: 600 });
    ctx.dialogue([
      ['baobab', '길길 피폭! 여기는 Baobab, WON 동아프리카 항공통제. 방금 그 폭격기는 NATO 기 표식을 달고 있었다!'],
      ['baobab', '전 WON 기, NATO 편대를 적으로 간주한다. 교전하라!'],
      ['tarot', '잠깐, 뭐? 우리 아니야! 우린 저 동네 근처도 안 갔다고!'],
      ['citadel', '할버드, 미확인 폭격기를 떨어뜨려라. 잔해가 증거다. WON 기는 가능한 한 쏘지 마라 — 피할 수 없을 때만.'],
    ]);
    ff.onComplete(() => {
      ctx.dialogue(
        [
          ['lantern', '미확인 기체 추락. 잔해 영상 전송 중… 엔진 일련번호, 팍스 임페리알리스 정비창 각인이다.'],
          ['citadel', 'Baobab, 여기는 NATO 비행단장 렌윅 대령. 영상을 그쪽 주파수로 보냈다. 폭격기는 팍스 것이다.'],
          ['baobab', '…확인했다. 전 WON 기, 교전 중지. NATO 편대는 적이 아니다. 팍스 기만 쫓아라.'],
          ['Kifaru 1', '…빚을 졌군, NATO. 기억해 두겠다.'],
        ],
        {
          delay: 1,
          then: () => {
            ctx.setRelations('NATO', 'WON', false);
            ctx.setInvulnerable('kifaru', false);
            const spare = ctx.getObjective('won_spare');
            if (spare && spare.status === 'active') spare.complete();
            phase = 3;
            ctx.after(8, regaliaTeaser);
          },
        },
      );
    });
  }

  ctx.onDestroyed('won_air', (_e, by) => {
    if (by !== ctx.player) return;
    wonKillsByPlayer++;
    if (wonKillsByPlayer === 1) ctx.say('magpie', 'WON 기 격추… 어쩔 수 없었다는 건 압니다. 하지만 그들도 속은 거예요.', { priority: 5 });
    if (wonKillsByPlayer > 2) ctx.getObjective('won_spare')?.fail();
  });

  // ---- 3파: 레갈리아 편대 첫 등장 (교전 불가 — 원거리 사격 후 이탈)
  let teaserDone = false;
  function regaliaTeaser(): void {
    if (teaserDone) return;
    teaserDone = true;
    const orb = ctx.spawnAir({
      aircraftId: 'typhoon', faction: 'PAX', at: { x: -42000, z: -48000, alt: 10500 }, heading: 135, speed: 420, skill: 'ace', role: 'sweep',
      callsign: 'Regalia 2', name: 'Typhoon (레갈리아)', tags: ['regalia'], presetId: 'air', invulnerable: true, holdFire: true,
    });
    ctx.spawnAir({
      aircraftId: 'su27_imperial', faction: 'PAX', at: { x: -43000, z: -47000, alt: 10800 }, heading: 135, speed: 420, skill: 'ace', role: 'sweep',
      callsign: 'Regalia 3', name: 'Su-27 (레갈리아)', tags: ['regalia'], presetId: 'air', invulnerable: true, holdFire: true,
    });
    ctx.dialogue([
      ['lantern', '새 접촉. 북서쪽 70 km, 고도 1만, 마하 1.6. 두 기… 아니, 레이더에 잡히는 건 두 기다.'],
      ['spur', '저게 NATO 의 새 장난감인가? 생각보다 작군.'],
      ['orb', 'Regalia 2, 원거리 사격. WON 기 하나. 계약 조건대로 현지 항공 전력을 줄인다.'],
    ]);
    ctx.after(9, () => {
      const victim = ctx.alive('won_mig')[0] ?? ctx.alive('won_air').find((e) => !e.tags.has('kifaru'));
      if (victim) {
        ctx.launch({ weapon: ['Meteor', 'AIM-120D'], from: orb, target: victim });
        ctx.say('orb', 'Regalia 2, Fox Three.', { side: 'enemy' });
      }
    });
    ctx.after(16, () => {
      ctx.dialogue(
        [
          ['Kifaru 1', '어디서 쏜 거야?! 레이더에 아무것도… 저 문장, 왕관이다! 팍스의 왕관 편대!'],
          ['sceptre', '할버드 편대라고 했나. 대지구대까지 날아온 수고는 인정하지. 오늘 일은 계약 범위 밖이다.'],
          ['sceptre', 'Regalia, 귀환한다. 다음엔 정식으로 인사하지.'],
          ['lantern', '…세 번째 목소리는 레이더에 없었다. 스텔스기다. 저 문장 — "레갈리아" 편대. 팍스 최정예다.'],
          ['citadel', '…데스먼드.'],
          ['magpie', '대령님? 아는 사람입니까?'],
          ['citadel', '나중에. 할버드, 남은 팍스 기를 정리하고 귀환하라.'],
        ],
        {
          then: () => {
            ctx.withdraw('regalia', { maxTime: 25 });
            ctx.when(
              () => ctx.countAlive('pax_cap') + ctx.countAlive('pax_wave2') + ctx.countAlive('pax_strike') === 0,
              () =>
                ctx.dialogue(
                  [
                    ['lantern', '공역 클리어. 대지구대 상공에 남은 팍스 기는 없다.'],
                    ['tarot', '무너진 탑은 팍스 쪽이었군. 오늘 카드는 맞았어.'],
                    ['citadel', '임무 완료. 할버드 편대, 귀환하라. …잘했다.'],
                  ],
                  { delay: 2, then: () => ctx.end(true, '대지구대 제공권 확보') },
                ),
              { interval: 0.5 },
            );
          },
        },
      );
    });
  }

  // 페이즈 1 잔존 초계기가 남은 채 3파로 넘어가지 않도록 (초계 전멸은 별도 목표)
  cap.onComplete(() => {
    if (phase === 1) ctx.say('lantern', '팍스 초계기 전멸. 남은 건 폭격대다.');
  });
}

export const M01: MissionDef = {
  id: 'm01',
  act: 1,
  index: 1,
  title: '균열의 계곡',
  subtitle: '대지구대 제공권 장악',
  date: '2000-03-11',
  location: '케냐, 대지구대 나쿠루 상공',
  available: true,
  kinds: ['air_superiority'],
  briefing: {
    paragraphs: [
      '좋은 소식과 나쁜 소식이 있다. 좋은 소식: 동아프리카 WON 회원국들이 NATO 의 대지구대 "보호 회랑" 설정에 반대하지 않았다. 나쁜 소식: 그 이유는 팍스 임페리알리스가 이미 매일 그 하늘을 폭격하고 있기 때문이다.',
      '팍스는 대영제국의 옛 식민지 "보호 계약" 을 근거로 1999년부터 케냐 일대에 투입됐다. 오늘 아침 Tornado IDS 폭격 편대 Gauntlet 이 Typhoon·Tornado F3 의 엄호를 받으며 WON 도시 나쿠루로 향하고 있다.',
      '할버드 편대는 폭격대를 격추하고 대지구대 상공의 팍스 초계 전투기를 정리한다. WON 은 중립이다. 그들의 Mirage F1 과 MiG-21 이 출격하더라도 먼저 쏘지 마라.',
      '정보 메모: 팍스 측 교신에서 "왕관" 이라는 단어가 반복해서 잡히고 있다. 무엇을 뜻하는지는 아직 모른다. — 정보장교 린드크비스트',
    ],
    objectivesText: ['팍스 폭격 편대 Gauntlet (Tornado IDS x4) 격추', '팍스 초계 전투기 격추', '나쿠루 시가지 보호', '(보조) WON 기와의 충돌 최소화'],
    mapMarkers: [
      { x: NAKURU.x, z: NAKURU.z, label: '나쿠루 (WON)', kind: 'objective', radius: 3200 },
      { x: GILGIL.x, z: GILGIL.z, label: '길길 마을', kind: 'friendly' },
      { x: -36000, z: -40000, label: 'Gauntlet 폭격대', kind: 'target' },
      { x: -14000, z: -22000, label: 'Lancet (Typhoon)', kind: 'enemy' },
      { x: 17000, z: -26000, label: 'Brigand (Tornado F3)', kind: 'enemy' },
      { x: -46000, z: 4000, label: 'WON 키수무 방면', kind: 'friendly' },
      { x: 0, z: 45000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['Typhoon (Meteor/ASRAAM)', 'Tornado F3 (Skyflash)', 'Tornado IDS', 'WON 지상 대공포 ZU-23'],
    recommendation: '공대공. AIM-120D 와 AIM-9X 를 넉넉히.',
  },
  environment: {
    biome: 'savanna',
    seed: 2011,
    timeOfDay: 16.8,
    weather: 'scattered',
    mapRadius: 100_000,
    relief: 1.6,
    flatten: [
      { x: NAKURU.x, z: NAKURU.z, radius: 3500 },
      { x: GILGIL.x, z: GILGIL.z, radius: 1200 },
    ],
    cities: [
      { x: NAKURU.x, z: NAKURU.z, radius: 2600, density: 0.7 },
      { x: GILGIL.x, z: GILGIL.z, radius: 900, density: 0.4 },
    ],
  },
  player: { position: { x: 0, z: 45000, alt: 5500 }, heading: 350, speed: 260, recommendedPreset: 'air' },
  wingmen: [
    { callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'air', skill: 'ace' },
    { callsign: 'Halberd 3', aircraftId: 'fa18i', presetId: 'air', skill: 'veteran' },
    { callsign: 'Halberd 4', aircraftId: 'f16p', presetId: 'air', skill: 'regular' },
  ],
  parTime: 720,
  rankThresholds: { S: 5200, A: 4200, B: 3000, C: 1800 },
  reward: 8000,
  roster: {
    aircraft: ['typhoon', 'tornado_f3', 'tornado_ids', 'mirage_f1', 'mig21', 'su27_imperial'],
    units: ['technical', 'truck', 'comm_tower', 'zu23', 'building_block'],
  },
  script,
};
