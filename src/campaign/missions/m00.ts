// M00 튜토리얼 "첫 날개" — 비행 기초 → 에너지 → 기관포 → 미사일 → 표적 전환 → 미사일 회피.
// 모든 표적은 무장이 없고, 플레이어는 미션 내내 무적이다.
import type { Entity } from '../../core/entity';
import { KT } from '../../core/math';
import type { AirPos, MissionContext, MissionDef } from '../missionTypes';

const DRONE = 'mig21';
const AGGRESSOR = 'f16p';
const TRAINING_MISSILE = ['AIM-9M', 'AIM-9X', 'R-73M'] as const;

const WAYPOINTS: AirPos[] = [
  { x: 0, z: 14000, alt: 3000 },
  { x: 7000, z: 6000, alt: 3600 },
  { x: 1500, z: -3000, alt: 4200 },
];

/** 플레이어 전방 dist m 지점 (고도 offset) */
function ahead(ctx: MissionContext, dist: number, lateral = 0, altOffset = 0): AirPos {
  const p = ctx.player;
  if (!p) return { x: 0, z: -dist, alt: 3500 + altOffset };
  const f = p.getForward();
  f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  return {
    x: p.position.x + f.x * dist - f.z * lateral,
    z: p.position.z + f.z * dist + f.x * lateral,
    alt: Math.max(1500, p.position.y + altOffset),
  };
}

function playerHeading(ctx: MissionContext): number {
  const p = ctx.player;
  if (!p) return 0;
  const f = p.getForward();
  return ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
}

function spawnDrone(ctx: MissionContext, at: AirPos, heading: number, tags: string[], opts: { target?: boolean; speed?: number } = {}): Entity {
  return ctx.spawnAir({
    aircraftId: DRONE,
    faction: 'NEUTRAL',
    at,
    heading,
    speed: opts.speed ?? 170,
    skill: 'rookie',
    role: 'drone',
    unarmed: true,
    name: '표적기',
    callsign: undefined,
    tags: ['drone', ...tags],
    target: opts.target,
    score: 50,
  });
}

function script(ctx: MissionContext): void {
  ctx.setAutoComplete(false);
  ctx.setRelations('NATO', 'NEUTRAL', true); // 표적기를 적성 표적으로 취급
  if (ctx.player) ctx.setInvulnerable(ctx.player, true);
  const tele = () => ctx.player?.telemetry;

  ctx.dialogue(
    [
      ['lantern', 'Halberd 1, 여기는 Lantern. 타주라 훈련 공역에 온 것을 환영한다. 오늘 이 하늘은 전부 당신 것이다.'],
      ['magpie', 'Halberd 2, Magpie 입니다. 신임 편대장 평가 비행은 제가 맡습니다. 계급장은 지상에 두고 오셨길 바라요.'],
      ['magpie', '먼저 기본부터. W/S 로 기수를 올리고 내리고, A/D 로 롤. 롤로 기울인 뒤 당겨서 선회합니다.'],
    ],
    { delay: 1.5, then: stepFlight },
  );

  // ---- 1. 비행 기초: 웨이포인트
  function stepFlight(): void {
    const obj = ctx.objective('wp', '웨이포인트 통과', { total: WAYPOINTS.length });
    const next = (i: number): void => {
      if (i >= WAYPOINTS.length) {
        obj.complete();
        ctx.say('magpie', '좋아요, 조종은 합격선. 이제 이 기체가 왜 에너지로 싸우는지 보여 드리죠.');
        ctx.after(4, stepEnergy);
        return;
      }
      const wp = WAYPOINTS[i];
      ctx.areaTrigger(
        wp,
        900,
        () => {
          obj.progress(i + 1);
          ctx.say('lantern', `웨이포인트 ${i + 1} 통과 확인.`, { priority: 3 });
          next(i + 1);
        },
        { minAlt: wp.alt - 700, maxAlt: wp.alt + 700, marker: { label: `WP${i + 1}`, kind: 'objective' } },
      );
      if (i === 1) ctx.say('magpie', 'Q/E 는 러더. 마커에 기수를 미세하게 맞출 때 쓰세요. V 로 시점도 바꿀 수 있어요.');
      if (i === 2) ctx.say('magpie', '마지막은 조금 높아요. 상승할 땐 속도가 줄어드는 걸 계기에서 확인하세요.');
    };
    next(0);
  }

  // ---- 2. 에너지: 애프터버너 → 에어브레이크
  function stepEnergy(): void {
    const ab = ctx.objective('ab', '애프터버너로 마하 0.9 돌파 (Shift)');
    ctx.say('magpie', 'Shift 를 끝까지 — 애프터버너. 가속은 확실하지만 연료를 몇 배로 먹습니다. 마하 0.9 까지.');
    ctx.when(
      () => (tele()?.mach ?? 0) >= 0.9,
      () => {
        ab.complete();
        const brake = ctx.objective('brake', '에어브레이크로 감속 — 350 kt 이하 (Ctrl)');
        ctx.say('magpie', '좋아요. 이제 Ctrl 로 스로틀을 줄이고 에어브레이크. 350 노트 아래로.');
        ctx.when(
          () => (tele()?.ias ?? Infinity) <= 350 * KT,
          () => {
            brake.complete();
            ctx.dialogue(
              [
                ['magpie', '기억하세요. 급선회를 오래 끌면 속도가 깎이고, 느려진 전투기는 표적일 뿐이에요.'],
                ['magpie', '고도는 저금통입니다. 내려가면서 속도로 바꾸고, 여유가 있을 때 다시 채우세요.'],
              ],
              { delay: 1, then: stepGun },
            );
          },
          { interval: 0.2, timeout: 120, onTimeout: () => (brake.complete(), stepGun()) },
        );
      },
      { interval: 0.2, timeout: 150, onTimeout: () => (ab.complete(), stepGun()) },
    );
  }

  // ---- 3. 기관포
  function stepGun(): void {
    const h = playerHeading(ctx);
    spawnDrone(ctx, ahead(ctx, 2200, 0, 0), h, ['drone_gun'], { speed: 150 });
    ctx.objective('gun', '전방 표적기를 기관포로 격추 (마우스 왼쪽 / F)', { destroy: 'drone_gun' }).onComplete(() => {
      ctx.after(2.5, stepIr);
    });
    ctx.say('magpie', '전방 2 km, 표적기 하나. 기관포는 마우스 왼쪽 또는 F. HUD 의 리드 조준점에 표적을 겹치고 짧게 끊어 쏘세요.');
    ctx.onDestroyed('drone_gun', (_e, by) => {
      if (by === ctx.player) ctx.say('magpie', '깔끔하네요. 탄은 아껴 쓰세요 — M61 은 몇 초면 바닥납니다.', { priority: 4 });
    });
  }

  // ---- 4. 미사일: Fox Two → Fox Three
  function stepIr(): void {
    const h = playerHeading(ctx);
    spawnDrone(ctx, ahead(ctx, 6000, -900, 300), h + 15, ['drone_ir']);
    spawnDrone(ctx, ahead(ctx, 6500, 900, 300), h - 15, ['drone_ir']);
    ctx.objective('ir', '적외선 미사일(Fox Two)로 표적기 격추', { destroy: 'drone_ir' }).onComplete(() => ctx.after(3, stepRadar));
    ctx.dialogue([
      ['magpie', 'R 로 무장을 바꿉니다. AIM-9 은 열추적 — 시커가 열원을 물면 톤이 높아져요. 락 박스가 붉어지면 Space.'],
      ['magpie', '적외선 미사일은 쏘고 잊어도 됩니다. 대신 상대 RWR 에는 아무 경고도 안 뜨죠. 우리도 마찬가지고요.'],
    ]);
  }

  function stepRadar(): void {
    const h = playerHeading(ctx);
    spawnDrone(ctx, ahead(ctx, 32000, 0, 1500), (h + 180) % 360, ['drone_radar'], { speed: 220 });
    ctx.objective('radar', '중거리 레이더 미사일(Fox Three)로 원거리 표적기 격추', { destroy: 'drone_radar' }).onComplete(() => ctx.after(3, stepSwitch));
    ctx.dialogue([
      ['lantern', '정면 32 km, 고속 표적기 하나 접근. 레이더 범위 안이다.'],
      ['magpie', 'AIM-120 은 데이터링크로 중간 유도되고, 가까워지면 자체 레이더를 켭니다. HUD 의 DLZ 막대 — 사거리 안쪽에서 쏘세요.'],
      ['magpie', '발사 후에도 레이더가 표적을 잡고 있어야 정확해요. 고도와 속도가 높을수록 멀리 날아갑니다.'],
    ]);
  }

  // ---- 5. 표적 전환
  function stepSwitch(): void {
    const h = playerHeading(ctx);
    let switches = 0;
    const off = ctx.sim.events.on('targetChanged', () => {
      switches++;
    });
    spawnDrone(ctx, ahead(ctx, 11000, -2500, 0), h, ['drone_decoy']);
    spawnDrone(ctx, ahead(ctx, 11500, 0, 400), h, ['drone_tgt'], { target: true });
    spawnDrone(ctx, ahead(ctx, 11000, 2500, 0), h, ['drone_decoy']);
    const obj = ctx.objective('switch', 'Tab 으로 표적 전환 — TGT 표시 표적기만 격추', { destroy: 'drone_tgt' });
    ctx.dialogue([
      ['magpie', '표적기 셋. 그중 HUD 에 TGT 가 붙은 하나만 격추합니다. Tab 짧게 = 다음 표적, 길게 = 기수 정면 표적.'],
      ['magpie', '실전에선 TGT 가 아닌 쪽이 민항기일 수도 있어요. 쏘기 전에 확인하는 습관을.'],
    ]);
    ctx.onDestroyed('drone_decoy', (_e, by) => {
      if (by !== ctx.player || obj.status !== 'active') return;
      ctx.addScore(-100, '훈련 표적 오인 사격');
      ctx.say('magpie', '그건 TGT 가 아니에요. 실전이었다면 군사재판감입니다.', { priority: 6 });
    });
    obj.onComplete(() => {
      off();
      ctx.say('magpie', switches > 0 ? '정확합니다. 표적 전환이 손에 익었네요.' : '맞추긴 했지만 Tab 은 한 번도 안 눌렀죠? 다음엔 습관을 들이세요.');
      for (const d of ctx.alive('drone_decoy')) ctx.despawn(d);
      ctx.after(4, stepEvade);
    });
  }

  // ---- 6. 미사일 회피
  function stepEvade(): void {
    const obj = ctx.objective('evade', '접근하는 훈련 미사일 회피 — 급선회 + 플레어(C)');
    const p = ctx.player;
    const h = playerHeading(ctx);
    const behind = ahead(ctx, -6500, 0, 600);
    const aggressor = ctx.spawnAir({
      aircraftId: AGGRESSOR,
      faction: 'NEUTRAL',
      at: behind,
      heading: h,
      speed: 230,
      skill: 'regular',
      role: 'drone',
      unarmed: true,
      callsign: 'Aggressor 1',
      name: '가상 적기',
      invulnerable: true,
    });
    let attempts = 0;
    let watch: { cancel(): void } | null = null;

    const pass = (text: string): void => {
      watch?.cancel();
      if (obj.status !== 'active') return;
      obj.complete();
      ctx.say('magpie', text, { priority: 6 });
      ctx.despawn(aggressor);
      ctx.after(4, finale);
    };

    const fire = (): void => {
      if (obj.status !== 'active') return;
      ctx.say('Aggressor 1', 'Aggressor 1, Fox Two. 훈련탄 발사.', { side: 'enemy', priority: 6 });
      const m = p ? ctx.launch({ weapon: TRAINING_MISSILE, from: aggressor, target: p, speed: 260 }) : null;
      if (!m) {
        pass('훈련탄 발사 장치 이상. 이 단계는 생략하죠 — 실전에서 배우게 될 겁니다.');
        return;
      }
      const t0 = ctx.time;
      let minD = Infinity;
      watch = ctx.every(1 / 30, (h2) => {
        const pl = ctx.player;
        if (!pl) return h2.cancel();
        const d = m.position.distanceTo(pl.position);
        minD = Math.min(minD, d);
        if (!m.alive || m.removed) {
          h2.cancel();
          pass('회피 성공. 미사일은 에너지가 다하면 그냥 쇳덩이예요. 잘했습니다.');
        } else if (d < 150) {
          // 실제 명중 대신 훈련 판정
          h2.cancel();
          m.removed = true;
          attempts++;
          if (attempts >= 3) pass('세 번 다 맞았지만… 훈련탄이라 다행이네요. 실전에선 한 번이면 끝입니다. 평가는 통과로 하죠.');
          else {
            ctx.say('magpie', '명중 판정. 미사일을 3시나 9시에 두고 꺾으면서 플레어. 한 번 더 갑니다.', { priority: 6 });
            ctx.after(7, fire);
          }
        } else if (ctx.time - t0 > 6 && d > minD + 400) {
          h2.cancel();
          m.removed = true;
          pass('미사일이 지나쳤어요. 회피 성공!');
        } else if (ctx.time - t0 > 40) {
          h2.cancel();
          m.removed = true;
          pass('미사일 연료 소진. 회피 성공.');
        }
      });
    };

    ctx.dialogue(
      [
        ['magpie', '마지막. 뒤에 붙은 가상 적기가 훈련용 적외선 미사일을 쏩니다. 명중해도 기체는 멀쩡해요.'],
        ['magpie', 'MAW 가 미사일 모터 화염을 잡으면 경보가 뜹니다. 미사일을 옆에 두고 급선회, 그리고 C 로 플레어.'],
      ],
      { then: fire },
    );
  }

  function finale(): void {
    ctx.dialogue(
      [
        ['magpie', '평가 끝. …솔직히 말하면, 기대 이상이었어요. 할버드 편대, 1번기 자리를 넘겨 드리죠.'],
        ['lantern', 'Lantern 이 기록했다. 할버드 편대, 귀환하라. 내일부터는 훈련탄이 아니다.'],
        ['citadel', '여기는 Citadel. 비행단장 렌윅이다. 환영한다, Halberd 1. 브리핑실에서 보지.'],
      ],
      { delay: 1, then: () => ctx.end(true, '훈련 과정 수료', 3) },
    );
  }
}

export const M00: MissionDef = {
  id: 'm00',
  act: 1,
  index: 0,
  title: '첫 날개',
  subtitle: '신임 편대장 평가 비행',
  date: '2000-03-02',
  location: '지부티, 타주라 만 훈련 공역',
  available: true,
  kinds: ['tutorial'],
  briefing: {
    paragraphs: [
      '제1 연합 선봉 비행단에 온 것을 환영한다. 귀관은 오늘부터 제101 선봉 전투비행대 "할버드" 의 편대장, Halberd 1 이다.',
      '실전 투입 전에 편대장 대리였던 Halberd 2, 한서윤 대위가 평가 비행을 진행한다. 공역은 지부티 타주라 만 상공, NATO 전진기지 캠프 타주라 인근이다.',
      '평가 항목은 기본 비행, 에너지 관리, 기관포, 적외선·레이더 미사일, 표적 전환, 미사일 회피다. 모든 표적기는 비무장이며 훈련 미사일은 실제 피해를 주지 않는다.',
      '이 비행단은 NATO 가 제3국 전장에 가장 먼저 보내는 창끝이다. 내일부터 상대는 표적기가 아니다.',
    ],
    objectivesText: ['웨이포인트 3곳 통과', '애프터버너 가속 / 에어브레이크 감속', '표적기 격추 (기관포, 적외선 미사일, 레이더 미사일)', 'TGT 표적만 골라 격추', '훈련 미사일 회피'],
    mapMarkers: [
      { x: -9000, z: 22000, label: '캠프 타주라', kind: 'friendly' },
      { x: 0, z: 14000, label: 'WP1', kind: 'objective' },
      { x: 7000, z: 6000, label: 'WP2', kind: 'objective' },
      { x: 1500, z: -3000, label: 'WP3', kind: 'objective' },
      { x: 0, z: -20000, label: '사격 구역', kind: 'target', radius: 15000 },
    ],
    threats: ['없음 (훈련)'],
    recommendation: '어떤 기체든 좋다. 공대공 프리셋 권장.',
  },
  environment: {
    biome: 'desert',
    seed: 1002,
    timeOfDay: 9.5,
    weather: 'clear',
    mapRadius: 60_000,
    relief: 0.7,
    coast: { side: 'east', distanceM: 14_000 },
    airbases: [{ x: -9000, z: 22000, heading: 90, faction: 'NATO', name: 'Camp Tadjoura' }],
    flatten: [{ x: -9000, z: 22000, radius: 2500 }],
    cities: [{ x: -16000, z: 30000, radius: 2200, density: 0.5 }],
  },
  player: { position: { x: 0, z: 26000, alt: 2500 }, heading: 0, speed: 210, recommendedPreset: 'air' },
  wingmen: [{ callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'air', skill: 'ace' }],
  parTime: 600,
  rankThresholds: { S: 2400, A: 1900, B: 1400, C: 800 },
  reward: 5000,
  chatter: true,
  roster: { aircraft: ['mig21', 'f16p'], units: [] },
  script,
};
