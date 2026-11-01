// 캠페인 등장인물. 무전 자막의 화자 이름(radioName)과 기체 콜사인(callsign)은 영문 그대로 쓴다.
// 줄거리와 인물 설정 전체는 docs/story.md.
import type { RadioMessage } from '../core/services';
import type { Faction } from '../core/types';

export type CastId =
  | 'player'
  | 'magpie'
  | 'tarot'
  | 'puck'
  | 'lantern'
  | 'citadel'
  | 'lindqvist'
  | 'sceptre'
  | 'orb'
  | 'spur'
  | 'ring'
  | 'chancery'
  | 'kordon'
  | 'baobab'
  | 'kifaru'
  | 'cha';

/** 전투 무전(chatter) 말투 */
export type ChatterStyle = 'calm' | 'joker' | 'rookie' | 'awacs';

export interface CastMember {
  id: CastId;
  /** 한국어 표기 (계급 포함) */
  name: string;
  /** 원어 표기 */
  fullName: string;
  /** 무전 자막 화자 표시 (TAC 네임 또는 관제 콜사인) */
  radioName: string;
  /** 기체 콜사인 (조종사만) */
  callsign?: string;
  /** 역할 (한국어) */
  role: string;
  faction: Faction;
  side: NonNullable<RadioMessage['side']>;
  nationality: string;
  /** 주로 타는 기체 (AircraftDef.id) */
  aircraftId?: string;
  personality: string;
  bio: string;
  chatterStyle?: ChatterStyle;
}

/** 플레이어 편대 */
export const SQUADRON = {
  wing: '제1 연합 선봉 비행단',
  wingEn: '1st Allied Vanguard Wing',
  name: '할버드 편대',
  nameEn: 'Halberd Squadron',
  unit: '제101 선봉 전투비행대',
  callsignBase: 'Halberd',
  playerCallsign: 'Halberd 1',
  defaultTacName: 'Lodestar',
} as const;

export const CAST: Readonly<Record<CastId, CastMember>> = {
  player: {
    id: 'player',
    name: '할버드 1번기 (플레이어)',
    fullName: 'Halberd 1',
    radioName: 'Halberd 1',
    callsign: 'Halberd 1',
    role: '할버드 편대장',
    faction: 'NATO',
    side: 'friendly',
    nationality: '비공개',
    personality: '말이 없다. 무전으로는 짧은 브레비티 코드만 남긴다.',
    bio: '동남아 폐허 상공 초계 임무에서 기록적인 생존 비행을 남긴 뒤 선봉 비행단으로 차출된 신임 편대장. TAC 네임 "Lodestar" 는 3번기 Tarot 이 첫 출격 전날 밤 뽑은 카드("별")에서 나왔다.',
  },
  magpie: {
    id: 'magpie',
    name: '한서윤 대위',
    fullName: 'Capt. Han Seo-yun (ROKAF)',
    radioName: 'Magpie',
    callsign: 'Halberd 2',
    role: '할버드 2번기 / 부편대장',
    faction: 'NATO',
    side: 'friendly',
    nationality: '대한민국',
    aircraftId: 'f15ex',
    personality: '정확하고 침착하다. 칭찬에 인색하지만 한 번 믿으면 끝까지 등을 맡긴다.',
    bio: '대한민국 공군 교환 조종사. 신임 편대장이 오기 전까지 편대장 대리였다. 할아버지가 1950년 북진 때 압록강까지 갔다가 완충지대가 그어지는 것을 본 사람이라, 완충지대와 구 북한 정권에 대해 복잡한 감정을 품고 있다.',
    chatterStyle: 'calm',
  },
  tarot: {
    id: 'tarot',
    name: '마르코 페란테 대위',
    fullName: 'Capt. Marco Ferrante (Marina Militare)',
    radioName: 'Tarot',
    callsign: 'Halberd 3',
    role: '할버드 3번기',
    faction: 'NATO',
    side: 'friendly',
    nationality: '이탈리아',
    aircraftId: 'fa18i',
    personality: '농담과 미신을 달고 사는 수다쟁이. 출격 전마다 타로 카드를 한 장 뽑는다. 위기일수록 말이 많아진다.',
    bio: '이탈리아 해군 항모 조종사 출신. 수에즈 위기 이후 지중해에서 팍스 함대와 숨바꼭질을 해 온 베테랑으로, 편대의 분위기 메이커다.',
    chatterStyle: 'joker',
  },
  puck: {
    id: 'puck',
    name: '노아 휘트컴 중위',
    fullName: '1st Lt. Noah Whitcombe (RCAF)',
    radioName: 'Puck',
    callsign: 'Halberd 4',
    role: '할버드 4번기',
    faction: 'NATO',
    side: 'friendly',
    nationality: '캐나다',
    aircraftId: 'f16p',
    personality: '의욕 넘치는 신참. 긴장하면 말을 더듬고, 하키 비유를 쓴다.',
    bio: '훈련 성적 수석으로 선봉 비행단에 들어온 최연소 조종사. 홍해에서 격추되어 팍스의 포로가 되고, 하르츠 수용소에서 구출된다.',
    chatterStyle: 'rookie',
  },
  lantern: {
    id: 'lantern',
    name: '미렐라 요네스쿠 소령',
    fullName: 'Maj. Mirela Ionescu',
    radioName: 'Lantern',
    role: '조기경보통제기(AWACS) 관제관',
    faction: 'NATO',
    side: 'command',
    nationality: '루마니아',
    personality: '건조한 유머의 냉정한 관제관. 위급할수록 목소리가 느려진다.',
    bio: 'E-3 "Lantern" 의 수석 관제관. 1989년 공존 선언 직전 루마니아에서 바르샤바 측 방공 통제관이었다가 망명했다. 소련 쪽 교신 습관을 누구보다 잘 안다.',
    chatterStyle: 'awacs',
  },
  citadel: {
    id: 'citadel',
    name: '오거스타 렌윅 대령',
    fullName: 'Col. Augusta "Gus" Renwick (USAF)',
    radioName: 'Citadel',
    role: '제1 연합 선봉 비행단장',
    faction: 'NATO',
    side: 'command',
    nationality: '미국',
    personality: '엄격하고 실용적이다. 조종사를 소모품으로 쓰라는 상부 명령에는 끝까지 버틴다.',
    bio: '1980년대 영국 공군과의 교환 근무 시절 데스먼드 헤일(현 Sceptre)의 편대장이었다. 대영제국 선포 이후 그가 팍스로 간 것을 개인적인 실패로 여긴다.',
  },
  lindqvist: {
    id: 'lindqvist',
    name: '요나스 린드크비스트 소령',
    fullName: 'Maj. Jonas Lindqvist (Danish Defence Intelligence)',
    radioName: 'Lindqvist',
    role: '비행단 정보장교',
    faction: 'NATO',
    side: 'command',
    nationality: '덴마크',
    personality: '커피와 냉소로 움직이는 분석가. 브리핑마다 "좋은 소식과 나쁜 소식" 을 나눠 말한다.',
    bio: '구 북한 정권을 통한 NATO-바르샤바 비밀 연락선 "도자기 회선" 의 존재를 아는 몇 안 되는 장교.',
  },
  sceptre: {
    id: 'sceptre',
    name: '데스먼드 헤일 경',
    fullName: 'Sir Desmond Hale, Regalia Leader',
    radioName: 'Sceptre',
    callsign: 'Regalia 1',
    role: '팍스 임페리알리스 에이스 편대 "레갈리아" 대장',
    faction: 'PAX',
    side: 'enemy',
    nationality: '대영제국',
    aircraftId: 'xf1',
    personality: '정중하고 오만하다. 상대를 존중하는 듯 말하면서 결코 물러서지 않는다.',
    bio: '전 영국 공군 토네이도 조종사. "핵의 시대는 아무도 쓰지 못하는 무기를 가진 자만이 끝낼 수 있다" 고 믿는다. MOUK 를 실전에서 "합법" 으로 만들어 미소의 핵을 무력화하는 것이 그의 대관식이다.',
  },
  orb: {
    id: 'orb',
    name: '일제 폰 할덴베르크 백작',
    fullName: 'Gräfin Ilse von Haldenberg, Regalia 2',
    radioName: 'Orb',
    callsign: 'Regalia 2',
    role: '레갈리아 2번기',
    faction: 'PAX',
    side: 'enemy',
    nationality: '독일제국',
    aircraftId: 'typhoon',
    personality: '말수가 적고 계산적이다. 계약 조건과 교전 규칙을 철저히 따진다.',
    bio: '독일제국 귀족 가문 출신 시험비행 조종사. 팍스 이사회가 MOUK 를 민간인 위에 쓰려 한다는 것을 알게 된 뒤 흔들린다.',
  },
  spur: {
    id: 'spur',
    name: '표트르 갈리친 공',
    fullName: 'Prince Pyotr Galitzine, Regalia 3',
    radioName: 'Spur',
    callsign: 'Regalia 3',
    role: '레갈리아 3번기',
    faction: 'PAX',
    side: 'enemy',
    nationality: '러시아 제국',
    aircraftId: 'su27_imperial',
    personality: '무모하고 거칠다. 소련 조종사를 "반역자의 후손" 이라 부른다.',
    bio: '러시아 제국 황족의 먼 방계. 소련과의 최전선에서 자라 증오를 연료로 난다.',
  },
  ring: {
    id: 'ring',
    name: '신원 미상',
    fullName: 'Regalia 4 (identity classified)',
    radioName: 'Ring',
    callsign: 'Regalia 4',
    role: '레갈리아 4번기 / XF-1 2호기',
    faction: 'PAX',
    side: 'enemy',
    nationality: '불명',
    aircraftId: 'xf1',
    personality: '무전으로 거의 말하지 않는다.',
    bio: 'XF-1 Lampyris 2호기의 시험 조종사. MOUK 운반 개조기 "Ampulla" 의 조종사로 지목된다.',
  },
  chancery: {
    id: 'chancery',
    name: '세실리 마치뱅크스',
    fullName: 'Director Cecily Marchbanks',
    radioName: 'Chancery',
    role: '팍스 임페리알리스 작전이사',
    faction: 'PAX',
    side: 'enemy',
    nationality: '대영제국',
    personality: '차갑고 사무적이다. 전쟁을 계약서와 대차대조표로 말한다.',
    bio: '팍스 이사회의 작전 담당 이사. "대관식 작전" 의 입안자.',
  },
  kordon: {
    id: 'kordon',
    name: '아르카디 체르니코프 소령',
    fullName: 'Maj. Arkady Chernikov (VVS)',
    radioName: 'Kordon',
    callsign: 'Kordon 1',
    role: '소련 공군 시험비행 편대장',
    faction: 'WARSAW',
    side: 'enemy',
    nationality: '소련',
    aircraftId: 'su47',
    personality: '과묵하고 지쳐 있다. 적에게도 예의를 지키며, 빚은 반드시 갚는다.',
    bio: '아버지가 동남아 핵전쟁에서 전사했다. Su-47 시험 편대를 이끌고 중동과 완충지대, 엘베 전선에서 플레이어와 적으로, 또 동료로 마주친다.',
  },
  baobab: {
    id: 'baobab',
    name: '에스터 완지루 대령',
    fullName: 'Col. Esther Wanjiru (WON East Africa Air Command)',
    radioName: 'Baobab',
    role: 'WON 동아프리카 항공통제사령관',
    faction: 'WON',
    side: 'neutral',
    nationality: 'WON (케냐)',
    personality: '실리적이고 단호하다. NATO 를 믿지 않지만 팍스를 더 미워한다.',
    bio: 'WON 군사화 논쟁의 한가운데 있는 지휘관. 바르샤바제 무기를 사들이는 강경파와 중립파 사이에서 줄을 탄다.',
  },
  kifaru: {
    id: 'kifaru',
    name: '요셉 오티에노 대위',
    fullName: 'Capt. Joseph Otieno (WON)',
    radioName: 'Kifaru',
    callsign: 'Kifaru 1',
    role: 'WON Mirage F1 편대장',
    faction: 'WON',
    side: 'neutral',
    nationality: 'WON (케냐)',
    aircraftId: 'mirage_f1',
    personality: '다혈질이지만 정직하다. 오해가 풀리면 누구보다 먼저 손을 내민다.',
    bio: '낡은 Mirage F1 을 직접 고쳐 가며 나는 WON 의 에이스. 대지구대에서 할버드 편대에 총구를 겨눴다가 이후 가장 믿음직한 현지 동맹이 된다.',
  },
  cha: {
    id: 'cha',
    name: '차경문 위원장',
    fullName: 'Chairman Cha Gyeong-mun',
    radioName: 'Cha',
    role: '완충지대 행정위원회 위원장 (구 북한 정권)',
    faction: 'NEUTRAL',
    side: 'neutral',
    nationality: '완충지대',
    personality: '느리고 구수한 말투 뒤에 노회한 계산을 숨긴다.',
    bio: '1953년부터 압록강 완충지대에 주둔해 온 구 정권의 마지막 세대. NATO 와 바르샤바 사이의 비밀 연락선 "도자기 회선" 을 수십 년간 지켜 왔다.',
  },
};

/** 화자 해석용: CastId 또는 radioName/콜사인으로 등장인물 찾기 */
export function findCast(key: string): CastMember | null {
  if (key in CAST) return CAST[key as CastId];
  for (const id in CAST) {
    const m = CAST[id as CastId];
    if (m.radioName === key || m.callsign === key) return m;
  }
  return null;
}

/** 할버드 편대 윙맨 (콜사인 → 등장인물) */
export const HALBERD_WINGMEN: ReadonlyArray<CastMember> = [CAST.magpie, CAST.tarot, CAST.puck];
