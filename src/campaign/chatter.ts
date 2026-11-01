// 전투 상황 무전 (chatter): 발사 브레비티, 격추 확인, 피격/미사일 경보, 윙맨 명령 응답, 적 교신.
//
//   const chatter = createChatter(sim);      // 기본 할버드 편대 + Lantern
//   game.addSystem(chatter);                 // fixedUpdate 에서 경보 감시/예약 대사 처리
//   chatter.enabled = false;                 // 튜토리얼 등에서 끄기 (MissionRunnerOptions.chatter 로 넘기면 ctx.setChatter 가 제어)
import { isAircraft, isMissile, type AircraftLike } from '../core/contracts';
import type { Entity } from '../core/entity';
import type { System } from '../core/game';
import type { RadioMessage } from '../core/services';
import type { GameEvents, Sim } from '../core/sim';
import type { Faction } from '../core/types';
import type { GameDatabase } from '../data/schema';
import { CAST, HALBERD_WINGMEN, type ChatterStyle } from './cast';
import { radioDuration } from './missionRunner';

export interface ChatterVoice {
  /** 무전 자막 화자 표시 */
  speaker: string;
  style: ChatterStyle;
}

export interface ChatterCast {
  /** 기체 콜사인 → 목소리 */
  wingmen: Record<string, ChatterVoice>;
  awacs: ChatterVoice;
  /** 플레이어 자신의 발사 콜 화자 (기본: 플레이어 콜사인) */
  playerSpeaker?: string;
}

export const DEFAULT_CHATTER_CAST: ChatterCast = {
  wingmen: Object.fromEntries(HALBERD_WINGMEN.map((m) => [m.callsign!, { speaker: m.radioName, style: m.chatterStyle ?? 'calm' }])),
  awacs: { speaker: CAST.lantern.radioName, style: 'awacs' },
};

export interface ChatterSystem extends System {
  enabled: boolean;
  dispose(): void;
}

export type Brevity = 'Fox One' | 'Fox Two' | 'Fox Three' | 'Magnum' | 'Pickle' | 'Rifle' | null;

/** 무장 → 발사 브레비티 코드 */
export function brevityFor(weaponId: string, db: GameDatabase | null | undefined): Brevity {
  const w = db?.weapons?.[weaponId];
  if (w) {
    switch (w.category) {
      case 'aam_ir':
        return 'Fox Two';
      case 'aam_radar':
        return 'Fox Three';
      case 'aam_sarh':
        return 'Fox One';
      case 'aam_long':
        return w.guidance?.type === 'sarh' ? 'Fox One' : 'Fox Three';
      case 'arm':
        return 'Magnum';
      case 'agm':
      case 'ashm':
        return 'Rifle';
      case 'bomb_gps':
      case 'bomb_laser':
      case 'bomb_dumb':
      case 'bomb_cluster':
      case 'nuke':
        return 'Pickle';
      default:
        return null;
    }
  }
  const id = weaponId.toUpperCase();
  if (/AGM-88|ALARM|KH-31P|AARGM/.test(id)) return 'Magnum';
  if (/AIM-9|R-73|R-60|ASRAAM|IRIS-T|MAGIC|PL-8/.test(id)) return 'Fox Two';
  if (/AIM-7|R-27R|SKY ?FLASH|AIM-54A/.test(id)) return 'Fox One';
  if (/AIM-120|AIM-54|R-77|METEOR|R-37|R-33|PL-12/.test(id)) return 'Fox Three';
  if (/GBU|MK ?8|B61|CBU|JDAM|SDB/.test(id)) return 'Pickle';
  if (/AGM|JASSM|HARPOON|STORM|SEA EAGLE|KH-/.test(id)) return 'Rifle';
  return null;
}

// ---------------------------------------------------------------- 대사 묶음

type Lines = readonly string[];

const KILL_PRAISE: Record<ChatterStyle, Lines> = {
  calm: ['Splash one. 깔끔합니다, {p}.', '격추 확인. 다음 표적으로.', 'Splash. 좋은 사격이었어요.', '적기 추락 확인. 계속 갑니다.', '{p}, 격추 확인. 시야 유지하세요.'],
  joker: ['Splash one! 오늘 카드 운이 좋은데?', '와우, 저건 액자에 걸어 둬야겠어!', 'Splash! 저 친구 보험은 들었겠지?', '하나 추가! 이 속도면 저녁은 내가 산다.', '깨끗하게 떨어졌다! 브라보, {p}!'],
  rookie: ['Splash! 대, 대단해요!', '격추 확인! 와, 진짜 맞췄다!', 'Splash one! 저도 저렇게 쏠 수 있으면…', '골인! 아니, 격추 확인!', '{p}, 굉장해요! 하나 더!'],
  awacs: ['{p}, 격추 확인.', 'Splash one, 확인했다.', '표적 소멸. 잘했다, {p}.'],
};

const KILL_STREAK: Record<ChatterStyle, Lines> = {
  calm: ['Splash {n}. 페이스 좋네요.', '{n}기째. 무리하지 마세요.'],
  joker: ['Splash {n}! 이거 신기록 아냐?', '{n}기! 나도 좀 남겨 줘!'],
  rookie: ['벌써 {n}기째예요!', 'Splash {n}! 해트트릭 넘었어요!'],
  awacs: ['Splash {n}. 계속하라, {p}.', '{p}, {n}기 격추 확인.'],
};

const GROUND_PRAISE: Record<ChatterStyle, Lines> = {
  calm: ['표적 파괴 확인.', '명중. 지상 표적 소멸.'],
  joker: ['쾅! 저기 부동산 시세 떨어지겠는데.', '명중! 불꽃놀이 좋다!'],
  rookie: ['명중이에요! 연기가 올라와요!', '표적 파괴 확인했어요!'],
  awacs: ['지상 표적 파괴 확인.', '표적 제거 확인했다.'],
};

const WINGMAN_KILL: Record<ChatterStyle, Lines> = {
  calm: ['{me}, Splash one.', '{me}, 적기 격추.', '{me}, 표적 제거.'],
  joker: ['{me}, Splash! 봤어? 봤지?', '{me}, 하나 잡았다! 카드가 말했지!', '{me}, 격추! 이건 내 몫이야.'],
  rookie: ['{me}, Splash one! 제가 잡았어요!', '{me}, 격추! 맞았어요, 맞았어!', '{me}, 표적 격추… 휴.'],
  awacs: [],
};

const PLAYER_DAMAGED: Record<ChatterStyle, Lines> = {
  calm: ['{p}, 피격당했어요. 상태는?', '{p}, 기체에서 연기가 납니다. 고도 확보하세요.', '{p}, 맞았어요! 엄호합니다.'],
  joker: ['{p}, 방금 그거 아팠겠는데! 괜찮아?', '{p}, 연기 나! 바비큐는 착륙하고 하자고.', '어이, {p}! 그 기체 아직 할부 남았잖아!'],
  rookie: ['{p}! 피, 피격당했어요! 괜찮아요?', '{p}, 연기가 나요! 엄호할게요!', '{p}, 꼬리에 맞았어요!'],
  awacs: ['{p}, 피해 감지. 상태를 보고하라.', '{p}, 피격 확인. 무리하지 마라.'],
};

const MISSILE_WARNING: Record<ChatterStyle, Lines> = {
  calm: ['{p}, 미사일! 브레이크, 브레이크!', '{p}, 미사일 접근 중! 회피하세요!', '{p}, 6시 방향 미사일! 플레어!'],
  joker: ['{p}, 미사일! 춤출 시간이야!', '{p}, 손님 온다! 미사일이야, 피해!', '{p}, 미사일! 지금 당장 꺾어!'],
  rookie: ['{p}! 미, 미사일이에요! 피하세요!', '{p}, 미사일 접근! 브레이크!', '{p}, 미사일! 미사일!'],
  awacs: ['{p}, 미사일 경보. 즉시 회피하라.', '{p}, 미사일 접근. 브레이크.', '{p}, 위협 감지. 미사일이다, 회피하라.'],
};

const WINGMAN_DOWN: Record<ChatterStyle, Lines> = {
  calm: ['{me}, 피격! 조종 불능… 탈출합니다!'],
  joker: ['{me}, 맞았다! 이번 카드는 "탑"이었나… 탈출한다!'],
  rookie: ['{me}, 피격! 피격! 탈출합니다!'],
  awacs: [],
};

const COMMAND_ACK: Record<GameEvents['wingmanCommand']['command'], Record<ChatterStyle, Lines>> = {
  attack: {
    calm: ['{me}, 교전 개시.', '{me}, 표적 공격합니다.'],
    joker: ['{me}, 사냥 시간이다!', '{me}, 알았어, 물어뜯으러 간다!'],
    rookie: ['{me}, 공격합니다!', '{me}, 알겠습니다, 공격 개시!'],
    awacs: [],
  },
  cover: {
    calm: ['{me}, 엄호합니다. 등은 맡기세요.', '{me}, 엄호 위치.'],
    joker: ['{me}, 엄호한다. 뒤는 걱정 마.', '{me}, 경호원 모드 돌입!'],
    rookie: ['{me}, 엄호할게요!', '{me}, 뒤를 지키겠습니다!'],
    awacs: [],
  },
  formation: {
    calm: ['{me}, 편대 복귀.', '{me}, 편대 위치로.'],
    joker: ['{me}, 줄 맞춰 간다.', '{me}, 다시 붙는다.'],
    rookie: ['{me}, 편대 복귀합니다!', '{me}, 따라갈게요!'],
    awacs: [],
  },
  engage_free: {
    calm: ['{me}, 자유 교전. 알겠습니다.', '{me}, 각자 판단으로 교전합니다.'],
    joker: ['{me}, 목줄 풀렸다!', '{me}, 자유 교전! 이제 재밌어지겠군.'],
    rookie: ['{me}, 자유 교전, 알겠습니다!', '{me}, 표적 찾으러 갑니다!'],
    awacs: [],
  },
};

const ENEMY_LOSS: Record<Faction, Lines> = {
  PAX: ['젠장, 한 기 잃었다! 계약서에 이런 건 없었어!', '아군기 추락! 저 NATO 편대, 보통이 아니다!', '편대 재정렬! 저놈들 정규군 실력이 아니야!', '손실 발생. 본부, 추가 수당 청구한다!'],
  WARSAW: ['동지가 당했다! 복수한다!', '편대장, 2번기 추락! 낙하산 확인 못 했다!', '젠장, NATO 놈들! 산개하라!', '아군기 손실! 지상 관제, 지원을 요청한다!'],
  WON: ['형제를 잃었다! 저놈들을 놓치지 마!', '한 기 추락! 이건 우리 하늘이다!', '물러서지 마라! 우리 땅이다!'],
  NATO: [],
  NEUTRAL: [],
};

const ENEMY_THREATENED: Record<Faction, Lines> = {
  PAX: ['미사일 경보! 회피한다!', '추적당하고 있다! 누가 좀 떼어 줘!', '락온 경보! 채프, 채프!'],
  WARSAW: ['미사일이다! 회피 기동!', '레이더 경보! 꼬리를 잡혔다!', '피격 경보! 지원 바란다!'],
  WON: ['미사일이 온다! 피해!', '경보가 울린다! 어디서 쏜 거야!'],
  NATO: [],
  NEUTRAL: [],
};

const ENEMY_NAMES: Record<Faction, string> = {
  PAX: '팍스 조종사',
  WARSAW: '바르샤바 조종사',
  WON: 'WON 조종사',
  NATO: 'NATO',
  NEUTRAL: '미확인',
};

// ---------------------------------------------------------------- 시스템

type Category = 'launch' | 'kill' | 'wingkill' | 'damage' | 'warning' | 'ack' | 'enemy' | 'down';

const COOLDOWN: Record<Category, number> = {
  launch: 2.5,
  kill: 1.2,
  wingkill: 3,
  damage: 7,
  warning: 5,
  ack: 1,
  enemy: 9,
  down: 0,
};

/** 카테고리별 우선순위 (스토리 대사 기본 5 보다 낮게) */
const PRIORITY: Record<Category, number> = {
  launch: 1,
  kill: 3,
  wingkill: 2,
  damage: 3,
  warning: 4,
  ack: 2,
  enemy: 1,
  down: 4,
};

/** 스토리 대사가 나오는 동안에도 허용하는 카테고리 (명령 응답은 플레이어 입력에 대한 피드백이라 항상 허용) */
const DURING_STORY = new Set<Category>(['warning', 'down', 'kill', 'ack']);

const WARNING_POLL = 0.1;

interface Pending {
  at: number;
  msg: RadioMessage;
}

export function createChatter(sim: Sim, cast: ChatterCast = DEFAULT_CHATTER_CAST): ChatterSystem {
  const rng = sim.rng;
  const lastCat = new Map<string, number>();
  const pending: Pending[] = [];
  const own = new WeakSet<RadioMessage>();
  let lastLineAt = -Infinity;
  let storyBusyUntil = -Infinity;
  let warningWas = false;
  let warnPoll = 0;
  let killStreak = 0;
  let lastKillAt = -Infinity;
  let lastHpFrac = 1;

  const playerName = (): string => sim.world.player?.callsign ?? CAST.player.callsign!;
  const fill = (text: string, me?: string, n?: number): string =>
    text.replaceAll('{p}', playerName()).replaceAll('{me}', me ?? '').replaceAll('{n}', String(n ?? ''));

  const aliveWingmen = (): Array<{ entity: AircraftLike; voice: ChatterVoice }> => {
    const out: Array<{ entity: AircraftLike; voice: ChatterVoice }> = [];
    const player = sim.world.player;
    for (const e of sim.world.entities) {
      if (!e.alive || e.removed || !isAircraft(e) || e === player || !e.callsign) continue;
      const voice = cast.wingmen[e.callsign];
      if (voice && (!player || e.faction === player.faction)) out.push({ entity: e, voice });
    }
    return out;
  };

  const wingVoiceOf = (e: Entity | null): ChatterVoice | null => {
    if (!e || !e.callsign || e === sim.world.player) return null;
    return cast.wingmen[e.callsign] ?? null;
  };

  const canSpeak = (cat: Category, key: string = cat): boolean => {
    if (!system.enabled) return false;
    const now = sim.time;
    if (now < storyBusyUntil && !DURING_STORY.has(cat)) return false;
    if (cat !== 'warning' && cat !== 'down' && now - lastLineAt < 1.2) return false;
    return now - (lastCat.get(key) ?? -Infinity) >= COOLDOWN[cat];
  };

  const emit = (cat: Category, speaker: string, text: string, side: RadioMessage['side'], delay = 0, key: string = cat): void => {
    const now = sim.time;
    lastCat.set(key, now);
    lastLineAt = now + delay;
    const msg: RadioMessage = { speaker, text, side, duration: radioDuration(text), priority: PRIORITY[cat] };
    own.add(msg);
    if (delay <= 0) sim.services.radio.say(msg);
    else pending.push({ at: now + delay, msg });
  };

  const pickLine = (bank: Lines): string | null => (bank.length ? rng.pick(bank) : null);

  // --- 이벤트 처리

  const onRadio = (msg: RadioMessage): void => {
    if (own.has(msg)) return;
    if ((msg.priority ?? 5) >= 4) storyBusyUntil = Math.max(storyBusyUntil, sim.time + (msg.duration ?? radioDuration(msg.text)));
  };

  const onLaunch = ({ shooter, target, weaponId }: GameEvents['weaponLaunched']): void => {
    const player = sim.world.player;
    if (!shooter) return;
    const code = brevityFor(weaponId, sim.db);
    if (code) {
      if (shooter === player) {
        if (canSpeak('launch', 'launch:player') && rng.chance(0.7)) emit('launch', cast.playerSpeaker ?? playerName(), `${code}.`, 'friendly', 0, 'launch:player');
      } else {
        const v = wingVoiceOf(shooter);
        if (v && canSpeak('launch', `launch:${shooter.callsign}`) && rng.chance(0.75)) {
          const extra = v.style === 'joker' && rng.chance(0.4) ? ' 행운을 빌어.' : v.style === 'rookie' && rng.chance(0.4) ? ' …맞아라!' : '';
          emit('launch', v.speaker, `${shooter.callsign}, ${code}!${extra}`, 'friendly', 0, `launch:${shooter.callsign}`);
        }
      }
    }
    // 노려진 적 조종사의 비명
    if (player && target && isAircraft(target) && sim.relations.isHostile(player.faction, target.faction) && (shooter === player || wingVoiceOf(shooter))) {
      if (canSpeak('enemy') && rng.chance(0.25)) {
        const line = pickLine(ENEMY_THREATENED[target.faction]);
        if (line) emit('enemy', target.callsign ?? ENEMY_NAMES[target.faction], line, 'enemy', 0.6);
      }
    }
  };

  const onDestroyed = ({ entity, by }: GameEvents['destroyed']): void => {
    const player = sim.world.player;
    const shooter = by && isMissile(by) ? by.shooter : by;
    if (!player) return;

    const downVoice = wingVoiceOf(entity);
    if (downVoice && isAircraft(entity)) {
      const line = pickLine(WINGMAN_DOWN[downVoice.style]);
      if (line && system.enabled) emit('down', downVoice.speaker, fill(line, entity.callsign ?? ''), 'friendly');
      if (system.enabled) emit('down', cast.awacs.speaker, `${entity.callsign} 피격. 탈출 확인, 구조 요청하겠다.`, 'command', 3.5, 'down:awacs');
      return;
    }

    const hostile = sim.relations.isHostile(player.faction, entity.faction);
    if (!hostile || entity.kind === 'missile' || entity.kind === 'decoy' || entity.kind === 'bomb') return;

    if (shooter === player) {
      const now = sim.time;
      killStreak = now - lastKillAt < 25 ? killStreak + 1 : 1;
      lastKillAt = now;
      if (canSpeak('kill')) {
        const wings = aliveWingmen();
        const useAwacs = wings.length === 0 || rng.chance(0.25);
        const voice = useAwacs ? cast.awacs : rng.pick(wings).voice;
        const air = isAircraft(entity);
        const bank = !air ? GROUND_PRAISE[voice.style] : killStreak >= 3 && rng.chance(0.6) ? KILL_STREAK[voice.style] : KILL_PRAISE[voice.style];
        const line = pickLine(bank);
        if (line) emit('kill', voice.speaker, fill(line, undefined, killStreak), useAwacs ? 'command' : 'friendly', 0.4);
      }
    } else {
      const v = wingVoiceOf(shooter);
      if (v && isAircraft(entity) && canSpeak('wingkill')) {
        const line = pickLine(WINGMAN_KILL[v.style]);
        if (line) emit('wingkill', v.speaker, fill(line, shooter!.callsign ?? ''), 'friendly', 0.3);
      }
    }

    // 동료를 잃은 적 편대의 교신
    if (isAircraft(entity) && canSpeak('enemy') && rng.chance(0.35)) {
      const mate = sim.world.nearest(entity.position, {
        kinds: ['aircraft'],
        faction: entity.faction,
        exclude: entity,
        within: { center: entity.position, radius: 40_000 },
      });
      const line = pickLine(ENEMY_LOSS[entity.faction]);
      if (mate && line) emit('enemy', mate.callsign ?? ENEMY_NAMES[entity.faction], line, 'enemy', 1.2);
    }
  };

  const onDamaged = ({ entity }: GameEvents['damaged']): void => {
    const player = sim.world.player;
    if (!player || entity !== player || !player.alive) return;
    const frac = player.maxHp > 0 ? player.hp / player.maxHp : 1;
    const crossed = [0.75, 0.5, 0.25].some((th) => lastHpFrac > th && frac <= th);
    lastHpFrac = frac;
    if (!crossed || !canSpeak('damage')) return;
    const wings = aliveWingmen();
    const voice = wings.length && rng.chance(0.75) ? rng.pick(wings).voice : cast.awacs;
    const line = pickLine(PLAYER_DAMAGED[voice.style]);
    if (line) emit('damage', voice.speaker, fill(line), voice === cast.awacs ? 'command' : 'friendly', 0.3);
  };

  const onCommand = ({ command }: GameEvents['wingmanCommand']): void => {
    if (!system.enabled) return;
    let delay = 0.5;
    for (const { entity, voice } of aliveWingmen()) {
      const key = `ack:${entity.callsign}`;
      if (sim.time - (lastCat.get(key) ?? -Infinity) < COOLDOWN.ack) continue;
      const line = pickLine(COMMAND_ACK[command][voice.style]);
      if (!line) continue;
      emit('ack', voice.speaker, fill(line, entity.callsign ?? ''), 'friendly', delay, key);
      delay += 1.1;
    }
  };

  const offs = [
    sim.events.on('radio', onRadio),
    sim.events.on('weaponLaunched', onLaunch),
    sim.events.on('destroyed', onDestroyed),
    sim.events.on('damaged', onDamaged),
    sim.events.on('wingmanCommand', onCommand),
  ];

  const system: ChatterSystem = {
    name: 'chatter',
    enabled: true,
    fixedUpdate(dt: number) {
      if (pending.length) {
        const now = sim.time;
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i].at <= now) {
            const { msg } = pending[i];
            pending.splice(i, 1);
            if (system.enabled) sim.services.radio.say(msg);
          }
        }
      }
      warnPoll += dt;
      if (warnPoll < WARNING_POLL) return;
      warnPoll = 0;
      const player = sim.world.player;
      const warning = !!(player && player.alive && player.avionics?.missileWarning);
      if (warning && !warningWas && canSpeak('warning')) {
        const wings = aliveWingmen();
        const voice = wings.length && rng.chance(0.6) ? rng.pick(wings).voice : cast.awacs;
        const line = pickLine(MISSILE_WARNING[voice.style]);
        if (line) emit('warning', voice.speaker, fill(line), voice === cast.awacs ? 'command' : 'friendly');
      }
      warningWas = warning;
      if (player && player.alive) {
        const frac = player.maxHp > 0 ? player.hp / player.maxHp : 1;
        if (frac > lastHpFrac) lastHpFrac = frac; // 재보급/수리 후 경보 재무장
      }
    },
    dispose() {
      for (const off of offs) off();
      pending.length = 0;
    },
  };
  return system;
}
