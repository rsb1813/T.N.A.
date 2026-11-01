# T.N.A. 아키텍처 / 구현 규칙

게임 디자인은 `docs/GDD.md`, 세계관은 `docs/world.md`, 스토리는 `docs/story.md`.

## 1. 기술 스택과 명령

- three.js 0.186 + TypeScript 7 (strict) + Vite 8, 테스트는 Vitest 5.
- `npm run dev` 개발 서버 / `npm run build` / `npx tsc --noEmit` 타입체크 / `npx vitest run` 테스트.
- 3D 모델: Blender 5.2 헤드리스 스크립트 → `public/models/<id>.glb` (`tools/blender/`).
- 화면 검증: `node tools/shot.mjs <페이지> <out.png> --wait "window.__ready"` (Vite 서버+헤드리스 Chromium, 동시에 여러 개 실행 가능).
  모델 검증: `node tools/preview.mjs public/models/<id>.glb out/<id>.png`.
- 외부 npm 패키지 추가 금지 (three, three/addons 만 사용).

## 2. 디렉터리와 소유권

| 경로 | 내용 | 비고 |
|---|---|---|
| `src/core/` | 수학·좌표·대기, Entity, World, Sim, 이벤트, 서비스 인터페이스, 계약(contracts.ts), 게임 루프, 모델 로더 | **공용 계약. 병렬 작업 중 수정 금지** — 변경이 필요하면 `docs/contract-notes.md` 에 요청을 적는다 |
| `src/data/` | 기체·무장·모듈·지상유닛 DB, 로드아웃 검증/성능 계산 | `schema.ts` 는 계약 (추가만 가능, 기존 필드 변경 금지) |
| `src/flight/` | 비행모델, Aircraft 엔티티, 입력, 플레이어 컨트롤러, 카메라 | |
| `src/combat/` | 미사일·폭탄·기관포·디코이, 유도/시커, 레이더·IRST·RWR·MAW·EW·데이터링크(Avionics), Stores, 피해 | |
| `src/ai/` | 적/윙맨 조종 AI, SAM·대공포·차량·함정·건물 유닛 | |
| `src/world/` | 지형·바다·하늘·구름·바이옴, 시각효과(fx) | |
| `src/audio/` | WebAudio 절차적 사운드 | |
| `src/ui/` | HUD, 메뉴/브리핑/격납고/결과/설정 화면 | |
| `src/campaign/` | 캠페인·미션 정의, 미션 실행기, 무전 대사(chatter), 저장/경제 | `docs/story.md` 도 소유 |
| `src/game/` | **통합**: 세션 구성, 스폰 서비스, 화면 흐름 | 통합 단계에서 작성 |
| `tools/blender/` | 모델 생성 스크립트 | `tna.py` 는 공용 헬퍼 |
| `public/models/` | 생성된 GLB | |
| `sandbox/<모듈>.html/.ts` | 모듈 단독 테스트 페이지 | 각 모듈이 자기 이름으로 |
| `tests/` | Vitest (`tests/<모듈>.*.test.ts`) | |

### 의존 방향

```
core ← data ← (flight, combat, world, audio) ← ai ← campaign ← ui ← game
```
- 같은 층/아래 층 모듈의 **구현**을 직접 import 하지 말고 `core` 의 인터페이스와 `sim.services` 로 접근한다. (예: combat 은 fx 를 `sim.services.fx.explosion()` 으로 호출)
- 다른 모듈의 **타입**은 `core/contracts.ts`, `core/services.ts`, `data/schema.ts` 에서 가져온다.
- 예외: `ui` 는 `data` 의 함수(computeStats 등)와 `campaign` 의 타입을 직접 써도 된다. `game` 은 모든 모듈을 조립한다.

## 3. 공통 규칙

- **단위**: SI (m, s, kg, N, rad). 화면 표시만 kt/ft/NM(기본) 또는 km/h, m.
- **좌표**: Y-up. +X 동, -Z 북. 기체/미사일/지상유닛 모델의 앞 = 로컬 **-Z**, 위 = +Y, 오른쪽 = +X. 방위각 0°=북, 90°=동. 헬퍼는 `core/math.ts`.
- **세계 크기**: 맵 반경 기본 100km. 해수면 y=0. 카메라 far 400km, logarithmicDepthBuffer.
- **시간**: 시뮬레이션은 고정 스텝 1/60s (`Entity.update`, `System.fixedUpdate`). 렌더 프레임마다 `System.update` (카메라/HUD/fx/오디오).
- **난수**: 시뮬레이션 로직은 `sim.rng` 만 사용 (재현성). `Math.random` 은 순수 시각/소리 효과에서만.
- **텍스트**: UI·무전·설명은 한국어. 제식명(AIM-120D, Su-35S, AN/APG-82)과 콜사인은 영문.
- **표적 표시**: 미션 주요 표적은 `entity.tags.has('target')` → HUD 에 TGT 표시.
- **원작 표절 금지**: 에이스컴뱃의 고유명사·대사·초병기를 그대로 쓰지 않는다.
- 성능: 동시에 항공기 ~40, 미사일 ~60, 지상유닛 ~150 을 60fps 로. 매 프레임 할당(new Vector3) 최소화 — 모듈 스코프 임시 벡터 재사용.

## 4. 런타임 구조

- `Game` (core/game.ts): 렌더러·씬·카메라·루프. `addSystem()` 으로 시스템 등록.
- `Sim` (core/sim.ts): `world`, `events`, `rng`, `relations`, `settings`, `services`, `db`.
- `World` (core/world.ts): 엔티티 등록/질의(`query`, `nearest`), 지형 충돌 시 `onTerrainCollision` 호출.
- `Entity` (core/entity.ts): 위치·속도·자세·HP·RCS·IR·레이더 방사(emission)·태그. 파괴 시 `destroyed` 이벤트.
- 서비스 (core/services.ts): `terrain`(world), `fx`(world), `audio`(audio), `weapons`(combat), `spawn`(game), `radio`(core 기본: 이벤트 발행), `mission`(campaign).
- 계약 (core/contracts.ts): `AircraftLike`, `ControlInput`, `FlightTelemetry`, `Avionics`, `Stores`, `Track`, `Threat`, `LockState`, `LaunchZone`, `MissileLike`, `DecoyLike`, `AircraftController`.
- 환경 (core/environment.ts): `EnvironmentOptions`, `Environment`, `BiomeId`.
- 모델 (core/assets.ts): `preloadModels(ids)` → `getModel(id, fallback)` (없으면 대체 형상), `findNode`, `tintMaterial`.

## 5. 모듈별 공개 API (각 모듈의 `index.ts` 에서 export)

통합 단계(`src/game`)가 이것만 보고 조립할 수 있어야 한다. 시그니처를 바꿔야 하면 모듈 `index.ts` 상단 주석에 실제 사용법을 적는다.

- **data**: `DB: GameDatabase`, `computeStats(loadout, db?) → DerivedStats`, `validateLoadout(loadout, db?) → {ok, errors[], warnings[]}`, `presetLoadout(aircraftId, presetId?) → Loadout`, `playableAircraft()`, `weaponsForStation(aircraftId, stationId)`, `modulesForSlot(aircraftId, slot)`, `storesMass/dragArea/rcs 계산 헬퍼`.
- **flight**: `class Aircraft extends Entity implements AircraftLike` — `new Aircraft({ def, loadout, faction, sim, callsign? })` (모델은 내부에서 `getModel(def.model)`; avionics/stores 는 `sim.services.weapons.create*` 로 생성). `FlightModel`(순수 계산, 테스트 가능). `class InputManager` (키보드/마우스/게임패드, `attach(el)`, 바인딩). `class PlayerController implements AircraftController` (`new PlayerController(input, sim)`). `class CameraRig implements System` (`new CameraRig(camera, input)`, `setTarget(aircraft)`; 모드: 추적/조종석/둘러보기/표적 시점/미사일 시점/격추 시점).
- **combat**: `createWeaponService(): WeaponService` (미사일·폭탄·디코이·기관포탄 처리 + `createAvionics` + `createStores` + `applyBlast`). 기관포탄은 엔티티가 아닌 경량 시스템으로 처리해도 됨 — 그 경우 `combatSystem: System` 도 export 해서 통합에서 등록.
- **ai**: `createAIPilot({ skill, role?, ... }) → AircraftController`, `createWingmanController(leader, slot) → AircraftController`, `createGroundUnit(def: UnitDef, req: GroundSpawn, sim) → Entity` (SAM/대공포/레이더/차량/함정/건물; 행동 포함).
- **world**: `createEnvironment(opts: EnvironmentOptions, game: { renderer, scene, camera }) → Environment`, `createFx(scene, camera) → FxService & System`.
- **audio**: `createAudio(settings) → AudioService & System & { unlock(): void; setMasterVolume(v): void; dispose(): void }` (브라우저 정책상 첫 사용자 입력 때 `unlock()`).
- **ui**: `class Hud implements System` (`new Hud(container)`), 화면들(Promise 기반): 타이틀, 메인 메뉴, 캠페인 미션 선택, 브리핑, 격납고(로드아웃 편집 → `Loadout` 반환), 일시정지, 결과, 설정, 로딩. `ui/styles.css`.
- **campaign**: `CAMPAIGN` (막/미션 목록), `MissionDef` 타입, `class MissionRunner implements MissionService, System` (`new MissionRunner(def, sim)`, `start()`), `createChatter(sim): System` (전투 상황 무전), `createSkirmish(opts) → MissionDef` (자유 전투), `loadSave()/saveGame()`, 크레딧/해금.

## 6. 플레이어 기체 스테이션 표 (data 와 모델이 공유)

모델에는 각 스테이션 위치에 empty `station_<ID>` 를 둔다 (무장의 장착 러그 지점, 무장 기수 방향 = -Z).
좌표는 모델 공간 대략값 (m, 원점 = 기체 중심, +X 오른쪽, +Y 위, -Z 기수). 좌측(L)만 적고 우측(R)은 x 부호 반대.

**F-15EX** (`f15ex`, 길이 19.4 m, 폭 13.05 m)
| ID | 위치(좌) | 용도 |
|---|---|---|
| L1 / R1 | (-5.0, -0.5, 1.6) | 외측 날개 신설 스테이션: AAM 1 |
| L2 / R2 | (-3.0, -0.8, 1.0) | 날개 파일런: 탱크/대형 폭탄/AGM |
| L2A / R2A | (-3.3, -0.9, 1.0) | 파일런 외측 레일: AAM 1 |
| L2B / R2B | (-2.7, -0.9, 1.0) | 파일런 내측 레일: AAM 1 |
| CFT_LF / CFT_RF | (-1.6, -0.9, -1.5) | CFT 전방: AIM-120 1 또는 폭탄 3 |
| CFT_LR / CFT_RR | (-1.6, -0.9, 1.8) | CFT 후방: AIM-120 1 또는 폭탄 3 |
| C | (0, -1.3, 0.5) | 중앙: 탱크/Legion IRST 포드/대형 폭탄 |

**F-22D** (`f22d`, 18.9 m, 13.6 m)
| ID | 위치(좌) | 용도 |
|---|---|---|
| BAY_C | (0, -0.7, 0.5) | 주 무장창: AAM 6 / GBU-32 2 / SDB 8 (내부) |
| BAY_SL / BAY_SR | (-1.2, -0.3, -1.0) | 측면 무장창: AAM(IR) 1 (내부) |
| L1 / R1 | (-4.2, -0.4, 2.0) | 외측 날개 파일런 (외부, RCS↑) |
| L2 / R2 | (-2.6, -0.5, 1.5) | 내측 날개 파일런 (외부, RCS↑) |

**F/A-18I** (`fa18i`, 18.3 m, 13.6 m)
| ID | 위치(좌) | 용도 |
|---|---|---|
| L1 / R1 | (-6.7, 0, 2.2) | 날개끝: AAM(IR/레이더) 1 |
| L2 / R2 | (-4.9, -0.5, 1.5) | 외측 날개: AAM/경량 A/G |
| L3 / R3 | (-3.6, -0.6, 1.0) | 중간 날개: 무장/탱크 |
| L4 / R4 | (-2.3, -0.7, 0.6) | 내측 날개: 무장/탱크 |
| FL / FR | (-0.9, -0.9, 0.0) | 동체 측면: AIM-120 / 표적 포드 |
| C | (0, -1.1, 0.4) | 중앙: 탱크/대형 무장 |

**F-16P** (`f16p`, 15.1 m, 10.0 m)
| ID | 위치(좌) | 용도 |
|---|---|---|
| L1 / R1 | (-4.9, 0, 1.6) | 날개끝: AAM 1 |
| L2 / R2 | (-4.0, -0.4, 1.4) | 외측 날개: AAM |
| L3 / R3 | (-3.0, -0.5, 1.0) | 중간 날개: 무장 |
| L4 / R4 | (-1.9, -0.6, 0.6) | 내측 날개: 무장/탱크 |
| C | (0, -1.1, 0.4) | 중앙: 탱크/포드 |
| CHIN_L / CHIN_R | (-0.5, -1.2, -2.6) | 흡입구 측면: 표적/IRST 포드 |

**F-14EX** (`f14ex`, 19.1 m, 19.5 m(전개))
| ID | 위치(좌) | 용도 |
|---|---|---|
| GLOVE_L / GLOVE_R | (-2.6, -0.9, -0.5) | 글러브 파일런: AIM-54/AIM-7/AIM-120/폭탄 |
| GLOVE_L_RAIL / GLOVE_R_RAIL | (-3.0, -0.9, -0.5) | 글러브 측면 레일: AAM 1 |
| TUNNEL_1 ~ TUNNEL_4 | (0, -1.1, -2.0 / -0.3 / 1.4 / 3.1) | 동체 터널: AIM-54/AIM-7/AIM-120/폭탄 (x=±0.6 교대 가능) |
| NAC_L / NAC_R | (-1.8, -1.1, 1.0) | 엔진 나셀 하부: 탱크 |

**적 기체**: 날개끝부터 안쪽으로 `L1, L2, ...` / `R1, R2, ...`, 중앙 `C` (여럿이면 `C1, C2`), 동체 측면/흡입구 하부 `FL/FR`, 내부창 `BAY_*`. data 와 모델이 각자 실제 기체를 참고해 이 규칙으로 붙이고, 이름이 안 맞으면 `StationDef.position` 이 쓰인다.

## 7. 모델 규칙 (`public/models/<id>.glb`)

- 단위 m, 실제 크기. 앞 = glTF -Z (Blender **+Y** 방향으로 기수를 둔다), 위 = +Y, 오른쪽 = +X.
- 원점: 항공기/미사일 = 기체 중심(대략 무게중심, 동체 중심선 높이). 무장은 **장착 러그(위쪽 중앙)** 가 원점. 지상유닛/건물 = 바닥 중앙. 함정 = 흘수선 중앙.
- 노드 이름 (glTF 노드):
  - `station_<ID>` 무장 장착점 empty, `nozzle_L`/`nozzle_R` (단발은 `nozzle`) 배기구 중심 empty, `gun` 총구 empty, `cockpit` 조종사 눈 위치 empty, `wingtip_L`/`wingtip_R` 날개끝 empty (베이퍼 효과).
  - 움직이는 부품(선택, 권장): `canopy`, `wing_L`/`wing_R` (가변익 — 원점 = 회전축), `aileron_*`, `elevator_*`(스태빌레이터), `rudder_*`, `flap_*`, `canard_*`, `airbrake` — 원점 = 힌지선. 지상유닛: `turret`(Y축 회전), `barrel`/`launcher`(X축 고각).
  - 선택 장비 `opt_<이름>` (기본 숨김; 모듈 `visual.show` 로 표시): 예 `opt_cft`, `opt_irst`, `opt_canards`, `opt_dorsal`.
- 머티리얼 이름 (게임이 이름으로 색을 바꾼다): `paint`(주 도장), `paint_dark`(보조 도장/위장 무늬), `metal`, `nozzle`, `canopy`(반투명 금빛/어두운 유리), `intake`(어두운 내부), `insignia`, `glow`(발광), `rubber`/`tire`.
- 폴리곤 예산 (삼각형): 플레이어 기체 ≤ 20k, 적 기체 ≤ 10k, 무장 ≤ 800, 지상유닛 ≤ 4k, 건물 ≤ 2k, 함정 ≤ 15k.
- 검증: `npx gltf-transform validate` 오류 0, `tools/preview.mjs` 4면 렌더로 실루엣 확인.

### 모델 id 목록 (data 의 `model` 필드와 일치시킬 것)

- 플레이어 기체: `f15ex`, `f22d`, `fa18i`, `f16p`, `f14ex`
- 적 기체: `flanker`(Su-27/Su-30/Su-35/J-11 공용, `opt_canards`), `mig29`, `mig31`, `su47`, `typhoon`, `tornado`, `pax_x1`(팍스 실험 스텔스기 XF-1), `mirage_f1`, `mig21`, `tu22m3`, `a50`
- 무장: `aim120`, `aim9x`, `aim7`, `aim54`, `agm88`, `agm65`, `agm158`, `agm84`, `gbu31`, `gbu12`, `gbu39`, `mk82`, `b61`, `fueltank`, `pod_targeting`, `pod_irst`, `r77`, `r73`, `r27`, `r33`, `meteor`, `asraam`, `sam_large`, `sam_medium`, `sam_small`
- 지상/해상 유닛: `sa10_tel`, `sa10_radar`, `sa11`, `sa15`, `zsu234`, `ew_radar`, `t80`, `bmp2`, `truck`, `scud`, `rapier`, `mbt_pax`, `sa2_launcher`, `sa2_radar`, `zu23`, `technical`, `frigate_pax`, `destroyer_pax`, `cruiser_warsaw`, `frigate_warsaw`, `carrier_nato`, `cargo_ship`
- 건물: `hangar_has`, `hangar_big`, `building_block`, `building_tower`, `factory`, `fuel_tank`, `bunker`, `comm_tower`

## 8. 검증 방법

- 단위 테스트: `tests/<모듈>.*.test.ts`. 물리/유도/로드아웃 같은 계산은 반드시 테스트.
- 시각 확인: `sandbox/<모듈>.html` + `sandbox/<모듈>.ts` 를 만들고 `window.__ready = true` 를 세팅, `node tools/shot.mjs sandbox/<모듈>.html out/<모듈>.png --wait "window.__ready"` 로 찍어서 직접 이미지를 확인한다. 헤드리스는 소프트웨어 렌더라 느리다 (해상도 낮춰도 됨).
- 타입체크는 전체(`npx tsc --noEmit`)로 돌리되, 병렬 작업 중에는 **자기 경로의 오류만** 책임진다.

## 9. 병렬 작업 규칙

- 자기 소유 경로만 생성/수정한다. 남의 경로 파일이 필요하면 core 인터페이스에 맞춰 쓰고, 테스트에서는 간단한 목(mock)을 만든다.
- `src/core/*`, `package.json`, `tsconfig.json`, `vite.config.ts` 수정 금지. 계약 변경 요청은 `docs/contract-notes.md` 에 `## <모듈>` 제목으로 추가(append).
- git commit/push 하지 않는다 (통합 단계에서 일괄).
- 산출물(스크린샷 등 임시 파일)은 `out/` 에.
