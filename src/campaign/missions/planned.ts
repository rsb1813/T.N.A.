// M04 ~ M20: 브리핑과 메타데이터는 확정, 스크립트는 개발 중 (available: false).
// 줄거리 전체는 docs/story.md.
import type { MissionContext, MissionDef, WingmanDef } from '../missionTypes';

const inDevelopment = (ctx: MissionContext): void => ctx.end(false, '개발 중인 미션입니다', 0);

function planned(def: Omit<MissionDef, 'available' | 'script'>): MissionDef {
  return { ...def, available: false, script: inDevelopment };
}

const MAGPIE: WingmanDef = { callsign: 'Halberd 2', aircraftId: 'f15ex', presetId: 'air', skill: 'ace' };
const TAROT: WingmanDef = { callsign: 'Halberd 3', aircraftId: 'fa18i', presetId: 'air', skill: 'veteran' };
const PUCK: WingmanDef = { callsign: 'Halberd 4', aircraftId: 'f16p', presetId: 'air', skill: 'regular' };
const PUCK_VET: WingmanDef = { ...PUCK, skill: 'veteran' };
const withPreset = (w: WingmanDef, presetId: string): WingmanDef => ({ ...w, presetId });

// ================================================================ 1막 (계속)

export const M04 = planned({
  id: 'm04',
  act: 1,
  index: 4,
  title: '키수무의 밤',
  subtitle: 'WON 과의 첫 공동 방어',
  date: '2000-04-06',
  location: '케냐, 키수무 (빅토리아 호 동안)',
  kinds: ['defense', 'air_superiority'],
  briefing: {
    paragraphs: [
      '진자를 잃은 팍스가 보복에 나섰다. 오늘 밤 Tornado IDS 야간 공습대가 WON Kifaru 비행대의 모기지 키수무 공항과, 대지구대에서 피난 온 사람들이 모인 호숫가 난민촌을 노린다.',
      'WON 동아프리카 항공통제 Baobab 이 처음으로 NATO 에 공식 지원을 요청했다. 오늘만큼은 Kifaru 1 의 Mirage F1 편대가 아군이다. WON 기를 오인 사격하지 않도록 IFF 를 확인하라.',
      '공습은 세 파로 나뉘어 호수 쪽 저공에서 들어올 것으로 예상된다. 키수무 공항 상공이 보급 구역이다.',
      '정보 메모: WON 이 대지구대에서 팍스 조종사 한 명을 생포했다. 심문에서 "오언 폭포" 와 "앰풀라" 라는 단어가 나왔다고 한다. — 린드크비스트',
    ],
    objectivesText: ['키수무 공항 방어', '팍스 야간 공습대 3파 저지', '호숫가 난민촌 보호', '(보조) Kifaru 편대 생존'],
    mapMarkers: [
      { x: 0, z: 0, label: '키수무 공항 (보급 구역)', kind: 'friendly', radius: 4000 },
      { x: -6000, z: 5000, label: '난민촌', kind: 'objective' },
      { x: -45000, z: 10000, label: '팍스 접근로 (호수)', kind: 'enemy' },
      { x: -30000, z: -35000, label: '팍스 접근로 (북서)', kind: 'enemy' },
    ],
    threats: ['Tornado IDS (야간 저공)', 'Typhoon', 'Tornado F3'],
    recommendation: '공대공. 야간이므로 IRST 와 레이더 모드를 적극 활용할 것.',
  },
  environment: {
    biome: 'savanna',
    seed: 2040,
    timeOfDay: 22.5,
    weather: 'scattered',
    relief: 0.9,
    coast: { side: 'west', distanceM: 12_000 },
    airbases: [{ x: 0, z: 0, heading: 70, faction: 'WON', name: 'Kisumu' }],
    cities: [{ x: 3000, z: -3000, radius: 3500, density: 0.7 }],
    flatten: [{ x: 0, z: 0, radius: 3000 }],
  },
  player: { position: { x: 20000, z: 30000, alt: 4500 }, heading: 300, speed: 240, recommendedPreset: 'air' },
  wingmen: [MAGPIE, TAROT, PUCK],
  parTime: 900,
  rankThresholds: { S: 7200, A: 5800, B: 4300, C: 2800 },
  reward: 13000,
});

export const M05 = planned({
  id: 'm05',
  act: 1,
  index: 5,
  title: '나일의 근원',
  subtitle: '핵 타격 전 정밀 타격',
  date: '2000-04-15',
  location: '우간다, 오언 폭포 댐 "수력 연구소"',
  kinds: ['precision', 'strike', 'ace'],
  briefing: {
    paragraphs: [
      '오언 폭포 댐 옆의 "수력 연구소" 는 연구소가 아니었다. 팍스는 댐의 전력으로 MOUK 의 원료 물질을 만들고 있었다. 생포 조종사의 증언, 진자 수송대의 극저온 컨테이너, 그리고 정찰 위성의 열영상이 모두 같은 곳을 가리킨다.',
      'NATO 유럽 사령부는 제한 핵사용 협정에 따라 B61 을 실은 B-1B 편대 Gavel 을 출격시켰다. 우간다는 제3국이다. 법적으로는 아무 문제가 없다. 그러나 댐이 무너지면 나일 강 하류 수백만 명이 물에 잠긴다.',
      '렌윅 대령이 사령부와 담판을 지었다. Gavel 이 투하 지점에 도착하기 전 10분. 그 안에 할버드 편대가 재래식 정밀 타격으로 시설을 파괴하면 핵 타격은 취소된다. 댐 구조물에는 절대 피해를 주지 마라.',
      '레갈리아 편대 전원이 진자 상공에 있다. 스텔스기 Sceptre 도 반드시 나온다. — 비행단장 렌윅',
    ],
    objectivesText: ['10분 안에 연구소 핵심 시설 파괴 (GPS·레이저 정밀 유도)', '댐 구조물 보호', '레갈리아 편대 격퇴', '(보조) 방공망 제압'],
    mapMarkers: [
      { x: 0, z: 0, label: '수력 연구소', kind: 'target', radius: 1200 },
      { x: 900, z: -400, label: '오언 폭포 댐 (공격 금지)', kind: 'objective' },
      { x: -8000, z: -14000, label: '진자 (잔존 방공망)', kind: 'enemy', radius: 15000 },
      { x: 0, z: 60000, label: 'Gavel 투하 진입로', kind: 'friendly' },
    ],
    threats: ['Rapier Mk2', 'SA-15 (노획)', 'ZSU-23-4', '레갈리아 편대 (XF-1, Typhoon, Su-27)'],
    recommendation: '정밀 타격. GBU-39/GBU-31 과 표적 포드, 자위용 AIM-120D/AIM-9X.',
  },
  environment: {
    biome: 'jungle',
    seed: 2051,
    timeOfDay: 15,
    weather: 'scattered',
    relief: 0.9,
    coast: { side: 'south', distanceM: 14_000 },
    flatten: [{ x: 0, z: 0, radius: 1800 }],
    cities: [{ x: -6000, z: -9000, radius: 2400, density: 0.5 }],
  },
  player: { position: { x: 0, z: 60000, alt: 6000 }, heading: 0, speed: 260, recommendedPreset: 'strike' },
  wingmen: [MAGPIE, withPreset(TAROT, 'strike'), PUCK],
  timeLimit: 600,
  parTime: 480,
  rankThresholds: { S: 7600, A: 6200, B: 4600, C: 3000 },
  reward: 16000,
});

// ================================================================ 2막 — 모래 위의 휴전 (중동)

export const M06 = planned({
  id: 'm06',
  act: 2,
  index: 1,
  title: '수에즈의 기억',
  subtitle: '세 세력의 운하 상공',
  date: '2000-06-04',
  location: '이집트, 수에즈 운하 그레이트 비터 호',
  kinds: ['air_superiority', 'anti_ship'],
  briefing: {
    paragraphs: [
      '1956년 수에즈에서 굴욕적으로 물러났던 영국이, 44년 뒤 팍스의 이름으로 돌아왔다. "작전명 귀환하는 사자" — 팍스 공수부대가 이스마일리아를 점령했고, 팍스 함정들이 그레이트 비터 호에 닻을 내렸다.',
      '중동은 친NATO 와 친바르샤바로 갈라져 있지만, 영국에 대한 기억만은 같다. 오늘 운하 상공에는 NATO, 팍스, 그리고 시리아 기지에서 날아오는 바르샤바 "의용" 비행대가 동시에 있을 것이다.',
      '할버드는 비터 호의 팍스 함정을 격침하고 운하 상공의 팍스 전투기를 몰아낸다. 바르샤바 기는 적성이다. 하지만 그들도 팍스를 쏘고 있다는 걸 잊지 마라.',
      '진자 이후 사라졌던 MOUK 원료가 홍해를 거쳐 북쪽으로 옮겨지고 있다는 첩보가 있다. 팍스가 하필 지금 수에즈를 원한 이유일지도 모른다. — 린드크비스트',
    ],
    objectivesText: ['그레이트 비터 호의 팍스 함정 격침', '운하 상공 팍스 전투기 격추', '바르샤바 비행대에 대응', '(보조) 이스마일리아 상공 제공권'],
    mapMarkers: [
      { x: 0, z: 0, label: '그레이트 비터 호', kind: 'target', radius: 6000 },
      { x: -2000, z: -30000, label: '이스마일리아 (팍스 점령)', kind: 'enemy' },
      { x: 50000, z: -50000, label: '바르샤바 접근로 (시나이)', kind: 'enemy' },
      { x: -40000, z: 50000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['Type 23 / Type 42 (Sea Wolf, Sea Dart)', 'Typhoon', 'Su-27S / MiG-29S (바르샤바)', 'Su-47 "Kordon"'],
    recommendation: '다목적. 대함 무장 2발과 공대공 무장 혼합.',
  },
  environment: {
    biome: 'desert',
    seed: 3006,
    timeOfDay: 10,
    weather: 'clear',
    relief: 0.6,
    coast: { side: 'south', distanceM: 45_000 },
    cities: [{ x: -2000, z: -30000, radius: 3500, density: 0.7 }],
  },
  player: { position: { x: -40000, z: 50000, alt: 5000 }, heading: 30, speed: 250, recommendedPreset: 'antiship' },
  wingmen: [MAGPIE, withPreset(TAROT, 'antiship'), PUCK],
  parTime: 900,
  rankThresholds: { S: 8000, A: 6500, B: 4800, C: 3200 },
  reward: 15000,
});

export const M07 = planned({
  id: 'm07',
  act: 2,
  index: 2,
  title: '모래폭풍 회랑',
  subtitle: '미틀라 고개 방공망 제압',
  date: '2000-06-17',
  location: '시나이 반도 중부, 미틀라 고개',
  kinds: ['sead', 'strike'],
  briefing: {
    paragraphs: [
      '수에즈를 빼앗긴 팍스는 시나이를 가로지르는 육로로 "앰풀라" 화물을 옮기기 시작했다. 미틀라 고개를 지나는 수송로를 Rapier 와 노획한 SA-11 이 지키고 있다.',
      '모래폭풍이 시나이 중부를 덮었다. 시계는 2 km 미만, IR 센서는 먼지에 둔해진다. 레이더와 데이터링크가 생명줄이다.',
      '바르샤바도 같은 수송로를 노린다. 고고도에 Tu-22M3 폭격 편대가 들어올 것이다. 그들을 쏘지는 마라 — 하지만 지켜 줄 의무도 없다. 어떻게 할지는 현장 판단에 맡긴다.',
      '진자에서 본 극저온 컨테이너가 이번에도 나올지 모른다. 파괴 전에 영상을 남겨라.',
    ],
    objectivesText: ['수송로 방공망 (Rapier, SA-11) 제압', '팍스 수송대 파괴', '(보조) 바르샤바 Tu-22M3 의 생존'],
    mapMarkers: [
      { x: 0, z: 0, label: '미틀라 고개', kind: 'target', radius: 8000 },
      { x: -12000, z: 6000, label: 'SA-11 진지', kind: 'enemy', radius: 30000 },
      { x: 25000, z: -60000, label: 'Tu-22M3 접근로', kind: 'enemy' },
      { x: -50000, z: 40000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['SA-11 Buk (9M38M1)', 'Rapier Mk2', 'Typhoon', '모래폭풍 (시계 불량)'],
    recommendation: 'SEAD. AGM-88E, GPS 폭탄. 시계가 나쁘므로 레이더 SAR 모드 지원 기체 권장.',
  },
  environment: { biome: 'desert', seed: 3017, timeOfDay: 14, weather: 'storm', relief: 1.4, flatten: [{ x: 0, z: 0, radius: 1500 }] },
  player: { position: { x: -50000, z: 40000, alt: 3000 }, heading: 60, speed: 240, recommendedPreset: 'sead' },
  wingmen: [withPreset(MAGPIE, 'strike'), withPreset(TAROT, 'sead'), withPreset(PUCK, 'sead')],
  parTime: 900,
  rankThresholds: { S: 7800, A: 6300, B: 4700, C: 3100 },
  reward: 15000,
});

export const M08 = planned({
  id: 'm08',
  act: 2,
  index: 3,
  title: '적의 적',
  subtitle: '48시간 휴전, 바르샤바 폭격대 호위',
  date: '2000-06-28',
  location: '홍해 북부, 아카바 만 ~ 라스 바나스',
  kinds: ['escort', 'ace'],
  briefing: {
    paragraphs: [
      '미틀라의 화물도 비어 있었다. 진짜 앰풀라는 바다로 갔다. 팍스 해군 기지 라스 바나스에 화물선이 정박해 있고, 그 위에 팍스 함대가 우산을 펴고 있다.',
      'NATO 와 바르샤바가 홍해 북부에 한해 48시간 휴전에 합의했다. 바르샤바 Tu-22M3 편대가 Kh-22 로 함대를 친다. 할버드는 그 폭격기들을 호위한다. 바르샤바 기체를 지키라는 명령은 이 비행단 역사상 처음이다.',
      '바르샤바 측 호위 편대장은 Su-47 을 타는 체르니코프 소령, 콜사인 Kordon. 수에즈에서 우리를 쏘지 않았던 그 조종사다.',
      '레갈리아의 두 번째 스텔스기에 대한 첩보가 있다. 레이더에 의존하지 마라. — 린드크비스트',
    ],
    objectivesText: ['Tu-22M3 폭격 편대 호위 (3기 이상 생존)', '라스 바나스 팍스 함대 타격 지원', '레갈리아 4번기 Ring 격퇴', '(보조) Kordon 생존'],
    mapMarkers: [
      { x: 0, z: -40000, label: '라스 바나스 (팍스 함대)', kind: 'target', radius: 25000 },
      { x: 30000, z: 50000, label: 'Tu-22M3 합류점', kind: 'friendly' },
      { x: -20000, z: 30000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['XF-1 Lampyris (스텔스)', 'Typhoon', 'Type 42 (Sea Dart)'],
    recommendation: '공대공. IRST 와 데이터링크 모듈이 스텔스기 대응에 유리하다.',
  },
  environment: { biome: 'desert', seed: 3028, timeOfDay: 17.5, weather: 'clear', relief: 1.1, coast: { side: 'east', distanceM: -10_000 } },
  player: { position: { x: -20000, z: 30000, alt: 7000 }, heading: 160, speed: 260, recommendedPreset: 'air' },
  wingmen: [MAGPIE, TAROT, PUCK],
  parTime: 900,
  rankThresholds: { S: 8200, A: 6700, B: 5000, C: 3300 },
  reward: 17000,
});

export const M09 = planned({
  id: 'm09',
  act: 2,
  index: 4,
  title: '검은 금요일',
  subtitle: '무와파크 살티 기지 방어',
  date: '2000-07-07',
  location: '요르단, 무와파크 살티 공군기지',
  kinds: ['defense', 'intercept'],
  briefing: {
    paragraphs: [
      '라스 바나스 타격에 대한 보복으로 팍스가 할버드의 중동 전진기지, 무와파크 살티를 노린다. 대규모 Storm Shadow 일제사격과 Tornado IDS 공습이 예상된다.',
      '긴급 발진이다. 기지 상공이 보급 구역이며, 활주로가 살아 있는 동안 재무장할 수 있다. 순항 미사일은 저공으로 들어온다. 한 발이라도 격납고에 떨어지면 정비 인력이 죽는다.',
      'Tarot, 어제 카드는 뭐였나? — "운명의 수레바퀴". 좋다, 오늘은 그 바퀴를 우리가 돌린다.',
      '감청 메모: 팍스 작전이사 Chancery 의 암호 교신에서 "Imperial Grace" 라는 선박명이 반복된다. — 린드크비스트',
    ],
    objectivesText: ['기지 시설 보호', 'Storm Shadow 순항 미사일 요격', '팍스 공습대 격추', '(보조) 피해 시설 3곳 이하'],
    mapMarkers: [
      { x: 0, z: 0, label: '무와파크 살티 (보급 구역)', kind: 'friendly', radius: 3500 },
      { x: -60000, z: 20000, label: '순항 미사일 접근로', kind: 'enemy' },
      { x: -40000, z: -50000, label: '팍스 공습대', kind: 'enemy' },
    ],
    threats: ['Storm Shadow 다수', 'Tornado IDS', 'Typhoon'],
    recommendation: '요격. AIM-9X 다수와 AIM-120D. 기관포 탄수가 많은 기체가 유리하다.',
  },
  environment: {
    biome: 'desert',
    seed: 3039,
    timeOfDay: 5.8,
    weather: 'clear',
    relief: 0.9,
    airbases: [{ x: 0, z: 0, heading: 130, faction: 'NATO', name: 'Muwaffaq Salti' }],
    flatten: [{ x: 0, z: 0, radius: 3500 }],
  },
  player: { position: { x: 1500, z: 3000, alt: 1200 }, heading: 270, speed: 200, recommendedPreset: 'air' },
  wingmen: [MAGPIE, TAROT, PUCK],
  parTime: 900,
  rankThresholds: { S: 8400, A: 6800, B: 5100, C: 3400 },
  reward: 17000,
});

export const M10 = planned({
  id: 'm10',
  act: 2,
  index: 5,
  title: '홍해의 왕관',
  subtitle: '밥엘만데브 야간 해상 차단',
  date: '2000-07-21',
  location: '홍해 남부, 밥엘만데브 해협',
  kinds: ['anti_ship', 'ace'],
  briefing: {
    paragraphs: [
      '"Imperial Grace" 를 찾았다. 앰풀라 원료를 실은 팍스 수송선이 구축함 2척, 프리깃 2척의 호위를 받으며 오늘 밤 밥엘만데브 해협을 빠져나간다. 아덴만으로 나가면 놓친다.',
      '레갈리아 편대 전원이 호위에 붙는다. Sceptre 와 Ring 의 XF-1 두 기, Orb 의 Typhoon, Spur 의 Su-27. 지금까지 그들이 한 번에 모인 적은 없다.',
      '할버드는 호위함을 무력화하고 수송선의 기관을 멈춰야 한다. 배를 침몰시키면 원료가 바다에 흩어진다. 화물이 무엇인지 아무도 모르는 이상, 그건 최후의 수단이다.',
      '야간이다. 레갈리아의 스텔스기는 IRST 로만 보인다. 서로를 놓치지 마라. — 렌윅',
    ],
    objectivesText: ['호위함 무력화', 'Imperial Grace 기관 정지 (선체 피해 50% 이상)', '레갈리아 편대 교전'],
    mapMarkers: [
      { x: 0, z: 0, label: 'Imperial Grace', kind: 'target' },
      { x: 30000, z: 30000, label: '아덴만 출구', kind: 'objective' },
      { x: -30000, z: -40000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['레갈리아 편대 전원', 'Type 42 / Type 23', 'Sea Dart'],
    recommendation: '대함/공대공 혼합. 야간 — IRST 필수.',
  },
  environment: { biome: 'desert', seed: 3050, timeOfDay: 23.2, weather: 'clear', relief: 1.2, coast: { side: 'east', distanceM: -25_000 } },
  player: { position: { x: -30000, z: -40000, alt: 5000 }, heading: 140, speed: 260, recommendedPreset: 'antiship' },
  wingmen: [MAGPIE, withPreset(TAROT, 'antiship'), PUCK],
  parTime: 900,
  rankThresholds: { S: 8800, A: 7200, B: 5400, C: 3600 },
  reward: 20000,
});

// ================================================================ 3막 — 완충지대 (한반도)

export const M11 = planned({
  id: 'm11',
  act: 3,
  index: 1,
  title: '도자기 회선',
  subtitle: '완충지대 비밀 회담 상공 초계',
  date: '2000-08-15',
  location: '압록강 완충지대, 강계 상공',
  kinds: ['defense', 'intercept'],
  briefing: {
    paragraphs: [
      'Imperial Grace 는 아덴만을 지나 동쪽으로 사라졌다. 그리고 2주 뒤, 팍스의 화물기가 한반도 북부 완충지대에 내렸다는 첩보가 들어왔다.',
      '완충지대에는 1953년부터 구 북한 정권이 주둔해 있다. 친바르샤바 성향이지만 수십 년간 NATO 와 바르샤바 사이의 비밀 연락선 — "도자기 회선" — 을 지켜 온 곳이다. 오늘 강계에서 양측 대표가 앰풀라에 대해 처음으로 직접 마주 앉는다.',
      '할버드는 회담장 상공을 지킨다. 중국 공군 J-11 편대도 같은 이유로 상공에 있다. 오늘 바르샤바 기는 적이 아니다. 먼저 쏘는 쪽이 이 회담을, 어쩌면 세계를 끝낸다. 교전 규칙: 바르샤바 기에 대한 발포 금지.',
      '한서윤 대위, 이곳은 귀관 조부의 고향과 멀지 않다. 사적인 감정은 착륙 후에. — 렌윅',
    ],
    objectivesText: ['강계 회담장 보호', '팍스 순항 미사일과 공격대 요격', '교전 규칙 준수: 바르샤바 기에 발포 금지'],
    mapMarkers: [
      { x: 0, z: 0, label: '강계 (회담장)', kind: 'objective', radius: 3000 },
      { x: 30000, z: -40000, label: '중국 J-11 초계 구역', kind: 'friendly', radius: 20000 },
      { x: -70000, z: 40000, label: '팍스 접근로 (서해)', kind: 'enemy' },
      { x: 0, z: 60000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['Storm Shadow', 'Tornado IDS', 'Typhoon'],
    recommendation: '요격. 산악 지형 — 저공 순항 미사일을 놓치지 않도록 하방 탐지 레이더 권장.',
  },
  environment: { biome: 'mountains', seed: 4011, timeOfDay: 5.6, weather: 'scattered', relief: 1.6, cities: [{ x: 0, z: 0, radius: 2500, density: 0.6 }], flatten: [{ x: 0, z: 0, radius: 2500 }] },
  player: { position: { x: 0, z: 60000, alt: 6000 }, heading: 0, speed: 250, recommendedPreset: 'air' },
  wingmen: [MAGPIE, TAROT],
  parTime: 900,
  rankThresholds: { S: 8000, A: 6500, B: 4900, C: 3200 },
  reward: 18000,
});

export const M12 = planned({
  id: 'm12',
  act: 3,
  index: 2,
  title: '안개 속 활주로',
  subtitle: '개마고원 비밀 비행장 타격',
  date: '2000-08-29',
  location: '개마고원 북부',
  kinds: ['strike', 'sead'],
  briefing: {
    paragraphs: [
      '강계 회담을 노린 순항 미사일은 완충지대 안쪽에서 발사됐다. 팍스는 개마고원 깊은 골짜기에 비밀 활주로를 깔아 두었다. 누군가 구 정권 안에서 길을 열어 준 것이다.',
      '골짜기는 구름에 덮여 있고 입구는 SA-15 와 대공포가 지킨다. 계곡을 따라 저공으로 들어가 격납고와 탄약고를 파괴하라.',
      '차경문 위원장이 배신자의 이름을 넘겨 왔다. 완충지대 행정위원회 보위국장 한도진. — 한서윤 대위의 작은할아버지다.',
      'Magpie, 출격에서 빠져도 된다. 아무도 탓하지 않는다. …알았다. 그럼 1번기 옆을 지켜라. — 렌윅',
    ],
    objectivesText: ['계곡 입구 방공망 제압', '비밀 활주로 격납고·탄약고 파괴', '(보조) 탈출하는 수송 차량 저지'],
    mapMarkers: [
      { x: 0, z: 0, label: '비밀 활주로', kind: 'target', radius: 2000 },
      { x: 8000, z: 14000, label: '계곡 입구 (SA-15)', kind: 'enemy', radius: 12000 },
      { x: 20000, z: 55000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['SA-15 Tor', 'ZU-23 / ZSU-23-4', 'Typhoon', '산악·구름 (지형 충돌)'],
    recommendation: '공격. GBU-12/GBU-31, 표적 포드. 지형 회피를 위해 기동성 좋은 기체 권장.',
  },
  environment: { biome: 'mountains', seed: 4029, timeOfDay: 8, weather: 'overcast', relief: 2, flatten: [{ x: 0, z: 0, radius: 2000, height: 900 }] },
  player: { position: { x: 20000, z: 55000, alt: 3000 }, heading: 340, speed: 240, recommendedPreset: 'strike' },
  wingmen: [withPreset(MAGPIE, 'strike'), withPreset(TAROT, 'sead')],
  parTime: 900,
  rankThresholds: { S: 7800, A: 6300, B: 4700, C: 3100 },
  reward: 18000,
});

export const M13 = planned({
  id: 'm13',
  act: 3,
  index: 3,
  title: '발포 금지',
  subtitle: '두만강 하구, 위장 순항 미사일 차단',
  date: '2000-09-09',
  location: '두만강 하구 / 동해',
  kinds: ['intercept'],
  briefing: {
    paragraphs: [
      '팍스가 동해에서 순항 미사일을 쏜다. 표적은 두만강 건너 소련 연해주. 미사일 동체에는 NATO 표식이 칠해져 있다. 한 발이라도 소련 영토에 떨어지면 1962년 협정 이후 처음으로 미소 본토가 공격당하는 것이다.',
      '팍스가 원하는 건 그것이다. 미국과 소련이 서로를 핵으로 태우면, 남는 건 MOUK 를 가진 세 제국뿐이다.',
      '소련 MiG-31BM 과 Su-35S 가 이미 NATO 초계선으로 향하고 있다. 그들은 미사일을 우리가 쏜 줄 안다. 교전 규칙: 상대가 먼저 쏘기 전에는 절대 발포하지 마라. 미사일만 떨어뜨려라.',
      'Kordon 이 소련 측 주파수에서 우리 편을 들어 주고 있다. 시간을 벌어 줄 것이다. 그 시간을 낭비하지 마라. — 렌윅',
    ],
    objectivesText: ['위장 순항 미사일 전량 요격 (한 발도 소련 영토에 닿지 않을 것)', '발사 플랫폼 (팍스 프리깃) 격침', '교전 규칙 준수: 바르샤바 기에 먼저 발포 금지'],
    mapMarkers: [
      { x: 0, z: -40000, label: '소련 연해주 해안선', kind: 'objective' },
      { x: 30000, z: 40000, label: '팍스 발사 함정', kind: 'target' },
      { x: -20000, z: -60000, label: '소련 요격기 접근로', kind: 'enemy' },
      { x: -30000, z: 20000, label: '할버드 초계선', kind: 'friendly' },
    ],
    threats: ['Storm Shadow (위장)', 'Type 23 프리깃', 'MiG-31BM / Su-35S (교전 금지)'],
    recommendation: '요격. AIM-9X 와 AIM-120D 다수, 연료 탱크.',
  },
  environment: { biome: 'mountains', seed: 4039, timeOfDay: 12, weather: 'scattered', relief: 1.1, coast: { side: 'south', distanceM: -20_000 } },
  player: { position: { x: -30000, z: 20000, alt: 6000 }, heading: 60, speed: 260, recommendedPreset: 'air' },
  wingmen: [MAGPIE, TAROT],
  timeLimit: 720,
  parTime: 600,
  rankThresholds: { S: 8200, A: 6600, B: 5000, C: 3300 },
  reward: 20000,
});

export const M14 = planned({
  id: 'm14',
  act: 3,
  index: 4,
  title: '마지막 찻잔',
  subtitle: '도자기 합의 서명장 방어',
  date: '2000-09-23',
  location: '강계, 완충지대 행정위원회 청사',
  kinds: ['defense', 'ace'],
  briefing: {
    paragraphs: [
      '두만강의 일 이후, 모스크바와 워싱턴이 마침내 같은 테이블에 앉는다. 장소는 강계 — 차경문 위원장이 반세기 동안 찻잔을 내놓던 그 방이다. 서명될 문서의 이름은 "도자기 합의": MOUK 를 핵무기에 준해 다루고, 그 사용에 미소가 공동으로 대응한다는 약속이다.',
      '팍스에게 이 합의는 사형 선고다. 레갈리아 편대 전원과 대규모 공격대가 올 것이다. 이번에는 Kordon 의 Su-47 편대가 처음부터 우리 편에서 난다.',
      '청사, 통신탑, 지하 회의실 입구 — 셋 중 하나라도 무너지면 대표단은 서명하지 못한다.',
      'Tarot 이 오늘 아침 카드를 뽑지 않았다고 한다. 이유를 묻지 마라.',
    ],
    objectivesText: ['행정위원회 청사·통신탑·지하 입구 보호', '팍스 공격대 격추', '레갈리아 편대 격퇴'],
    mapMarkers: [
      { x: 0, z: 0, label: '행정위원회 청사', kind: 'objective', radius: 1500 },
      { x: -50000, z: -30000, label: '팍스 공격대', kind: 'enemy' },
      { x: 40000, z: -20000, label: 'Kordon 편대', kind: 'friendly' },
      { x: 0, z: 40000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['레갈리아 편대 전원', 'Storm Shadow', 'Tornado IDS / Typhoon'],
    recommendation: '공대공 최대 탑재.',
  },
  environment: { biome: 'mountains', seed: 4048, timeOfDay: 16.2, weather: 'clear', relief: 1.5, cities: [{ x: 0, z: 0, radius: 2500, density: 0.6 }], flatten: [{ x: 0, z: 0, radius: 2500 }] },
  player: { position: { x: 0, z: 40000, alt: 6500 }, heading: 0, speed: 250, recommendedPreset: 'air' },
  wingmen: [MAGPIE, TAROT],
  parTime: 900,
  rankThresholds: { S: 9000, A: 7300, B: 5500, C: 3700 },
  reward: 22000,
});

export const M15 = planned({
  id: 'm15',
  act: 3,
  index: 5,
  title: '백두의 칼날',
  subtitle: 'MOUK 조립 기지 타격',
  date: '2000-10-12',
  location: '백두산 남록, 삼지연 일대',
  kinds: ['strike', 'precision'],
  briefing: {
    paragraphs: [
      'Tarot 의 장례식은 비행단 격납고에서 치러졌다. 그가 남긴 덱 맨 위의 카드는 "별" 이었다.',
      '도자기 합의는 서명됐다. 그리고 한도진이 입을 열었다. 팍스는 백두산 남쪽 기슭 옛 구 정권 비밀 기지에서 앰풀라 원료를 MOUK 탄두 세 발로 조립했다. 화물기는 내일 새벽 뜬다.',
      '이번에는 NATO 와 바르샤바가 처음으로 공동 작전 명령서에 서명했다. 할버드와 Kordon 편대가 함께 기지를 친다. 핵은 쓰지 않는다 — 조립된 MOUK 가 연쇄 반응할지 아무도 모른다.',
      '격납고 안에 탄두가 있다면 정밀 유도로 문만 부숴라. 나머지는 특수부대가 한다.',
    ],
    objectivesText: ['기지 방공망 제압', '조립 격납고 3동 문 파괴 (정밀 유도)', '이륙하는 화물기 저지'],
    mapMarkers: [
      { x: 0, z: 0, label: 'MOUK 조립 기지', kind: 'target', radius: 1500 },
      { x: 0, z: -15000, label: '백두산', kind: 'objective' },
      { x: 30000, z: 30000, label: 'Kordon 합류점', kind: 'friendly' },
    ],
    threats: ['SA-15', 'Rapier', 'Typhoon', '산악 강풍'],
    recommendation: '정밀 타격. GBU-39 SDB / GBU-12 와 표적 포드.',
  },
  environment: { biome: 'mountains', seed: 4061, timeOfDay: 6.3, weather: 'scattered', relief: 2, flatten: [{ x: 0, z: 0, radius: 2000, height: 1300 }] },
  player: { position: { x: -10000, z: 55000, alt: 5000 }, heading: 10, speed: 250, recommendedPreset: 'strike' },
  wingmen: [withPreset(MAGPIE, 'strike')],
  timeLimit: 840,
  parTime: 660,
  rankThresholds: { S: 8600, A: 7000, B: 5300, C: 3500 },
  reward: 22000,
});

// ================================================================ 4막 — 대관식 (독일)

export const M16 = planned({
  id: 'm16',
  act: 4,
  index: 1,
  title: '하르츠의 포로',
  subtitle: '브로켄 수용소 구출 지원',
  date: '2000-11-04',
  location: '하르츠 산지 (독일제국-동독 경계)',
  kinds: ['sead', 'strike'],
  briefing: {
    paragraphs: [
      '백두에서 찾은 탄두는 하나뿐이었다. 나머지 두 발은 이미 러시아 제국을 거쳐 독일제국으로 옮겨졌다. 그리고 그 경로를 추적하던 중, 홍해에서 실종된 Puck — 노아 휘트컴 중위 — 이 하르츠 산지의 팍스 포로수용소에 살아 있다는 사실이 확인됐다.',
      '하르츠는 2차대전 휴전선 위에 있다. 서쪽은 독일제국, 동쪽은 동독. 수용소는 경계선에서 불과 4 km 서쪽이다. 특수부대 차량이 동독 쪽에서 국경을 넘는다. 할버드는 수용소 주변 방공망과 경비 병력을 제거해 길을 연다.',
      '이것은 팍스 후원국 본토에 대한 첫 NATO 공격이다. MOUK 억지력이 이 정도 작전에도 작동할지는 아무도 모른다.',
      'Puck 은 무언가를 봤다. 그가 수용소에서 끌려다니며 들은 "대관식" 이라는 단어의 의미를 알아야 한다.',
    ],
    objectivesText: ['수용소 주변 방공망 제압', '경비 병력 제거', '특수부대 차량 보호', '구출 완료까지 상공 확보'],
    mapMarkers: [
      { x: 0, z: 0, label: '브로켄 수용소', kind: 'objective', radius: 1500 },
      { x: 4000, z: 0, label: '휴전선', kind: 'objective' },
      { x: 25000, z: 10000, label: '특수부대 출발점 (동독)', kind: 'friendly' },
      { x: -15000, z: -10000, label: '팍스 대공 진지', kind: 'enemy', radius: 20000 },
    ],
    threats: ['Rapier Mk2', 'SA-10 (노획)', 'mbt_pax 기갑', 'Typhoon / Su-27 (러시아 제국)'],
    recommendation: 'SEAD + 근접항공지원. AGM-88E, AGM-65K, GBU-12.',
  },
  environment: { biome: 'temperate', seed: 5004, timeOfDay: 3.5, weather: 'overcast', relief: 1.3, flatten: [{ x: 0, z: 0, radius: 1500 }], cities: [{ x: -12000, z: 8000, radius: 2500, density: 0.6 }] },
  player: { position: { x: 30000, z: 20000, alt: 4000 }, heading: 280, speed: 240, recommendedPreset: 'sead' },
  wingmen: [withPreset(MAGPIE, 'strike')],
  parTime: 900,
  rankThresholds: { S: 8400, A: 6800, B: 5100, C: 3400 },
  reward: 22000,
});

export const M17 = planned({
  id: 'm17',
  act: 4,
  index: 2,
  title: '엘베 서약',
  subtitle: 'NATO-바르샤바 공동 방공전',
  date: '2000-11-18',
  location: '동독, 엘베 강 전선 마그데부르크 상공',
  kinds: ['air_superiority', 'intercept'],
  briefing: {
    paragraphs: [
      'Puck 이 들은 것: "대관식" 은 MOUK 의 첫 실전 사용이다. 표적은 엘베 강에 집결한 바르샤바 기갑군. 제한 핵사용 협정에서 동독은 미소 영토가 아니다 — 팍스의 논리로는 "합법" 이다. 그리고 바르샤바 기갑군이 증발하면, 다음은 베를린이다.',
      '소련은 MOUK 가 한 발이라도 떨어지면 런던에 핵으로 답하겠다고 선언했다. 그 순간 협정은 끝나고, 세계도 끝난다.',
      '오늘 팍스가 엘베 상공으로 대규모 공습을 보낸다. 리허설일 수도, 본 공격일 수도 있다. NATO 와 바르샤바 전투기가 같은 하늘을 지킨다. Kordon 의 편대가 할버드의 좌익을 맡는다.',
      'Puck 이 돌아왔다. 의사는 반대했다. 그는 말을 듣지 않았다.',
    ],
    objectivesText: ['팍스 공습대 격추', '엘베 방어선 보호', '"MOUK 탑재기" 식별 및 격추'],
    mapMarkers: [
      { x: 0, z: 0, label: '마그데부르크', kind: 'friendly', radius: 3000 },
      { x: -60000, z: 0, label: '팍스 공습대 (독일제국 방면)', kind: 'enemy' },
      { x: 10000, z: 20000, label: 'Kordon 편대', kind: 'friendly' },
    ],
    threats: ['Tornado IDS 대편대', 'Typhoon', 'Su-27 (러시아 제국)', '레갈리아 Orb·Spur'],
    recommendation: '공대공 최대 탑재. 장거리 미사일(AIM-54C)도 유효하다.',
  },
  environment: { biome: 'temperate', seed: 5018, timeOfDay: 13, weather: 'overcast', relief: 0.5, cities: [{ x: 0, z: 0, radius: 4000, density: 0.8 }] },
  player: { position: { x: 30000, z: 10000, alt: 7000 }, heading: 270, speed: 260, recommendedPreset: 'air' },
  wingmen: [MAGPIE, PUCK_VET],
  parTime: 900,
  rankThresholds: { S: 9200, A: 7500, B: 5600, C: 3800 },
  reward: 24000,
});

export const M18 = planned({
  id: 'm18',
  act: 4,
  index: 3,
  title: '합법적인 지옥',
  subtitle: '헬골란트 MOUK 저장고 타격',
  date: '2000-12-01',
  location: '북해, 헬골란트 섬 (독일제국령)',
  kinds: ['strike', 'anti_ship', 'precision'],
  briefing: {
    paragraphs: [
      '엘베의 폭격기들은 모형 탄두를 싣고 있었다. 진짜 MOUK 두 발은 북해의 헬골란트 섬, 2차대전 때 판 해저 벙커에 있다.',
      'NATO 사령부가 B61 사용을 승인했다. 1962년 협정은 미소 영토만을 지킨다. 헬골란트는 법적으로 "제3국" 이다. 이 출격에 한해 할버드 기체에 전술핵을 장착할 수 있다.',
      '렌윅 대령의 말: "법은 허락한다. 그게 옳다는 뜻은 아니다. 핵을 실을지, 정밀 유도로 벙커 입구만 무너뜨릴지는 각자 정해라. 다만 핵을 쓰면, MOUK 가 남아 있을 경우 런던이든 베를린이든 그 대가를 치른다."',
      '섬은 팍스 구축함과 프리깃이 둘러싸고 있고, 해안포대와 Rapier 가 촘촘하다.',
    ],
    objectivesText: ['헬골란트 해저 벙커 파괴 (재래식 또는 B61)', '섬 주변 팍스 함정 격침', '해안 방공망 제압'],
    mapMarkers: [
      { x: 0, z: 0, label: '헬골란트 해저 벙커', kind: 'target', radius: 1000 },
      { x: 6000, z: 4000, label: '팍스 함대', kind: 'enemy', radius: 25000 },
      { x: -50000, z: 40000, label: '할버드 진입점', kind: 'friendly' },
    ],
    threats: ['Type 42 / Type 23 (Sea Dart, Sea Wolf)', 'Rapier Mk2', 'Typhoon', '레갈리아 Spur'],
    recommendation: '정밀 타격 (GBU-31/GBU-24) 또는 B61. 대함 무장 병행.',
  },
  environment: { biome: 'ocean', seed: 5031, timeOfDay: 7.6, weather: 'storm', relief: 0.6, flatten: [{ x: 0, z: 0, radius: 1200, height: 40 }] },
  player: { position: { x: -50000, z: 40000, alt: 5000 }, heading: 50, speed: 250, recommendedPreset: 'strike', allowNuclear: true },
  wingmen: [withPreset(MAGPIE, 'strike'), withPreset(PUCK_VET, 'antiship')],
  parTime: 900,
  rankThresholds: { S: 9000, A: 7300, B: 5500, C: 3700 },
  reward: 26000,
});

export const M19 = planned({
  id: 'm19',
  act: 4,
  index: 4,
  title: '대관식 전야',
  subtitle: '풀다 회랑 스텔스 사냥',
  date: '2000-12-16',
  location: '독일 중부, 풀다 회랑 상공',
  kinds: ['intercept', 'ace'],
  briefing: {
    paragraphs: [
      '헬골란트에 남은 것은 빈 거치대 하나였다. 마지막 MOUK 는 이미 XF-1 의 MOUK 운반 개조기 "Ampulla" 에 실렸다. 조종사는 레갈리아 4번기 Ring.',
      '오늘 밤 Ampulla 가 풀다 회랑을 따라 동쪽으로 시험 비행을 한다는 첩보가 있다. 탑재 상태인지, 진짜 대관식의 날이 언제인지 알 수 없다. 스텔스기를 레이더로 찾는 건 불가능에 가깝다. IRST, 데이터링크, 그리고 Kordon 편대의 지상 레이더망을 엮어야 한다.',
      '그리고 이상한 통신이 하나 들어왔다. 독일제국 귀족 가문의 문장으로 서명된 짧은 메시지 — "Ampulla 의 배기 신호 주파수를 보낸다. 베를린에는 내 동생이 산다. — O"',
      'Orb 를 믿을지는 현장에서 판단하라. 함정일 수도 있다. — 린드크비스트',
    ],
    objectivesText: ['Ampulla 탐지 및 추적', '레갈리아 호위기 격추', 'Orb 의 이탈 지원 (선택)'],
    mapMarkers: [
      { x: 0, z: 0, label: '풀다 회랑', kind: 'objective', radius: 20000 },
      { x: -50000, z: 10000, label: 'Ampulla 예상 경로 (서)', kind: 'enemy' },
      { x: 50000, z: -10000, label: '엘베 방면', kind: 'friendly' },
    ],
    threats: ['XF-1 Lampyris x2 (스텔스)', 'Typhoon (Orb)', 'Su-27 (Spur)', 'Typhoon 다수'],
    recommendation: '공대공. IRST 와 IFDL/Link 16 데이터링크 필수.',
  },
  environment: { biome: 'temperate', seed: 5046, timeOfDay: 21.8, weather: 'scattered', relief: 1.1, cities: [{ x: 15000, z: 12000, radius: 3000, density: 0.6 }] },
  player: { position: { x: 40000, z: 20000, alt: 8000 }, heading: 270, speed: 270, recommendedPreset: 'air' },
  wingmen: [MAGPIE, PUCK_VET],
  parTime: 900,
  rankThresholds: { S: 9400, A: 7600, B: 5700, C: 3800 },
  reward: 26000,
});

export const M20 = planned({
  id: 'm20',
  act: 4,
  index: 5,
  title: '왕관 없는 하늘',
  subtitle: '대관식 저지',
  date: '2000-12-31',
  location: '발트해 상공, 메클렌부르크 해안',
  kinds: ['superweapon', 'ace', 'intercept'],
  briefing: {
    paragraphs: [
      '천년이 끝나는 날, 팍스 이사회가 "대관식" 을 선언했다. Ampulla 가 마지막 MOUK 를 싣고 발트해 상공을 돌아 베를린 방향으로 진입한다. 소련 전략로켓군은 이미 발사 대기에 들어갔다. 표적은 런던이다.',
      '도자기 합의에 따라 NATO 와 바르샤바의 모든 가용 전투기가 발트해 상공으로 모인다. 그러나 Sceptre 와 Ring 의 XF-1 을 잡을 수 있는 건 지금까지 그들과 싸워 온 편대뿐이다.',
      'Ampulla 를 육지 상공에서 격추하면 MOUK 가 그 자리에서 터질 수 있다. 바다 위에서 떨어뜨려라. 해안선까지 남은 시간은 8분.',
      '할버드 1. 이 전쟁의 시작부터 끝까지 같은 하늘에 있었던 건 너와 그다. 끝내라. — 렌윅',
    ],
    objectivesText: ['Ampulla 를 해안선 도달 전, 바다 위에서 격추', 'Sceptre 격추', '연합 방공망 엄호'],
    mapMarkers: [
      { x: 0, z: 30000, label: '메클렌부르크 해안선', kind: 'objective' },
      { x: -30000, z: -40000, label: 'Ampulla 접근로', kind: 'target' },
      { x: 40000, z: 10000, label: 'Kordon 편대', kind: 'friendly' },
      { x: 30000, z: 60000, label: '베를린 방향', kind: 'objective' },
    ],
    threats: ['XF-1 "Ampulla" (MOUK 탑재)', 'XF-1 Lampyris (Sceptre)', '팍스 잔존 에이스', 'MOUK 폭발'],
    recommendation: '어떤 기체든, 가장 믿는 로드아웃으로.',
  },
  environment: { biome: 'temperate', seed: 5100, timeOfDay: 15.4, weather: 'overcast', relief: 0.4, coast: { side: 'north', distanceM: -30_000 } },
  player: { position: { x: 40000, z: 30000, alt: 9000 }, heading: 300, speed: 280, recommendedPreset: 'air' },
  wingmen: [MAGPIE, PUCK_VET],
  timeLimit: 480,
  parTime: 420,
  rankThresholds: { S: 10000, A: 8000, B: 6000, C: 4000 },
  reward: 40000,
});

export const PLANNED_MISSIONS: readonly MissionDef[] = [M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14, M15, M16, M17, M18, M19, M20];
