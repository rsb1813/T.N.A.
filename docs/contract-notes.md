# 계약 변경 요청 / 모듈 간 메모

병렬 작업 중 core 계약(src/core, src/data/schema.ts) 변경이 필요하거나 다른 모듈에 알릴 내용을 `## <모듈>` 제목으로 추가한다.

## flight

core 변경 요청은 없음. 아래는 다른 모듈이 알아야 할 가정/규칙.

**data (computeStats)**
- `DerivedStats.rcs` 는 schema 주석대로 "외부 무장 포함" 으로 가정한다. Aircraft 는 `기체 고유 RCS = stats.rcs - (스폰 시 stores.rcsAdd)` 를 구해 두고 매 스텝 `rcs = 고유 RCS + stores.rcsAdd` 로 갱신한다. computeStats 가 무장 RCS 를 빼고 준다면 알려 달라 (aircraft.ts 의 `baseRcs` 한 줄만 바꾸면 됨).
- 연료: 내부 연료 = `loadout.fuel × (stats.fuelCapacityKg - stores.externalFuelKg)` (스폰 시 외부탱크는 가득 찬 것으로 가정). `stats.fuelKg` 는 쓰지 않는다. → `fuelCapacityKg` 에 외부탱크 용량이 포함되어야 한다 (schema 주석대로).
- `stats.maxIas` 를 넘으면 과속 항력 ΔCD = 0.3x + 6x² (x = IAS/maxIas - 1). `maxMach` 초과도 ΔCD = 0.6ΔM + 4ΔM². 보정 시 최고속도가 이 한계 근처에서 멈춘다.
- `supercruise` 플래그는 비행모델이 쓰지 않는다 (aero.ts 공식의 추력/항력으로 자연히 결정).
- FBW 리미터는 α ≤ min(aoaMaxDeg, clMax/clAlpha) 로 막는다 (실속각 너머는 리미터를 끈 플레이어만). aoaMaxDeg 를 실속각보다 크게 줘도 FBW 는 최대 양력 받음각에서 멈춘다.
- 가변익(F-14EX, Tornado, Tu-22M3): 공력 수치는 **clMax·k = 최소 후퇴각(날개 전개) 값, waveDragRise = 최대 후퇴각 값** 으로 넣어 달라. 비행모델은 후퇴율 s(0..1) 에 따라 clMax×(1-0.25s), k×(1+0.3s), 조파항력×(1+0.6(1-s)) 를 적용한다 (스케줄: M0.4 이하 최소 → M1.2 이상 최대, 7.5°/s). k 는 물리적으로(종횡비 감소) 후퇴 시 증가시킨다.
- 손상: 엔진 → 추력 ×(1-0.7d), 날개 → clMax ×(1-0.5d) + 롤 쏠림, 조종 → 각속도 ×(1-0.6d).

**combat (createStores / createAvionics)**
- Aircraft 생성자 안에서 호출된다. 그 시점에 `ac.def / loadout / stats / flight / telemetry / object3d / model / getStationWorldPosition / getStationLocalPosition(모델 로컬, 무장 메시 부착용) / getGunWorldPosition` 은 준비되어 있다.
- `Stores.massKg` 에는 외부탱크 **연료를 넣지 말 것** (연료는 `externalFuelKg` 로, 비행모델이 먼저 소모하며 직접 감소시킨다). `dragArea`/`massKg`/`rcsAdd` 는 매 스텝 읽는다 (발사/투하 즉시 반영).
- 피해: 기관포는 `kind: 'kinetic'`, 탄두는 `'blast'` 로 주면 부위 피해 분배가 다르다 (kinetic = 한 부위 집중, blast = 여러 부위 확률). `maxHp = 100 × clamp(√(빈 무게/13t), 0.85, 3)` → F-16 ≈ 85, F-15 ≈ 105, 폭격기 최대 300.
- 격추 후(alive=false) Aircraft 는 avionics/stores.update 를 더 부르지 않는다 (기관포 방아쇠·재머 끔, `emission = null`).
- 미사일 시점(CameraRig)은 `sim.events 'weaponLaunched'` 의 `shooter === 플레이어 기체` 로 마지막 발사체를 잡는다 → 발사 시 이 이벤트를 꼭 내보내 달라. 잔해는 3.5~6 s 나선 추락 후 폭발·제거 (과잉 피해/핵이면 1~2.5 s).

**world (fx)**
- `afterburner(target=ac.object3d, nozzles, level)` 는 기체당 1회, 생성자에서 호출. level 0 = 꺼짐/엔진 정지.
- `vapor(ac, wingtips, intensity)` 의 wingtips 배열은 가변익이면 **같은 Vector3 인스턴스를 매 스텝 갱신**한다 → 생성 시 복사하지 말고 참조로 읽어 달라.
- `damageTrail(ac, 'smoke')` HP<50%, `'fire'` HP<25% 또는 격추 시. 핸들은 제거 시 stop.

**ai**
- `ac.controls` 의 pitch 는 "요구 피치 각속도 비율" (stats.pitchRate × 동압 권한). **조종간 중립 = 비행경로 유지 (중력 보상, 배면에서도 유지)** 이므로 수평 직진은 0 이면 된다. 경사 중 중립이면 경로가 처진다 (협조 선회는 당겨야 함).
- 방향 지향 조종이 필요하면 `instructorControls(ac, aimDirWorld, ac.controls)` (flight/index 에서 export) 를 그대로 써도 된다 — 플레이어 마우스 에임 교관과 같은 협조 선회 오토파일럿. 동압 권한은 `(ac as Aircraft).flight.authority(qbar)`.
- AI 는 항상 리미터가 켜진다. 격추된 기체의 controller.update 는 호출되지 않는다.

**ui / game**
- PlayerController 가 내보내는 `uiAction`: `pause`, `map`, `view`, `missileCam`, `targetView`(누름), `targetViewEnd`(뗌). CameraRig 가 view/missileCam/targetView* 를 처리하고, pause/map 은 UI 담당.
- `input.poll(dt)` 는 PlayerController.update 가 고정 스텝마다 호출한다. 일시정지 중엔 고정 스텝이 돌지 않으므로 **일시정지 해제(Esc)는 UI 가 직접 키를 들어야 한다**.
- 설정 화면: `DEFAULT_BINDINGS`(한국어 label, padLabel), `bindingLabel(b)`, `loadBindings()/saveBindings()`, `input.bindings = ...` 로 재설정 가능.
- 기본 감속 키 Ctrl 은 GDD 대로지만 **Ctrl+W(피치) 가 브라우저 탭 닫기**와 겹친다. 전체화면 + `navigator.keyboard.lock()` 을 쓰거나 설정에서 다른 키로 바꾸도록 안내 필요.
- 마우스 에임 모드는 포인터 잠금이 필요: `input.pointerLockOnClick = true` 또는 `input.requestPointerLock()` (사용자 제스처 안에서).
- HUD: `controller.aimDirection` (PlayerController, 월드 단위벡터)·`mouseAimActive`, `ac.telemetry`, `ac.flight.alphaCmdDeg`, `turnRateDeg(g, v)`.
- 스폰: `ac.placeAt(position, headingDeg, speed, { pathDeg?, rollDeg?, throttle? })` 로 트림 상태 배치 (엔진 스풀도 맞춤).

**models (tools/blender)**
- 조종면 회전 방향은 메시가 힌지(노드 원점)에서 로컬 ±Z 어느 쪽으로 뻗었는지로 자동 판정한다 (현재 f15ex/f16p/fa18i/f22d 모두 정상). 앞전 플랩은 `flap_le_*`, 가변익 `wing_L/wing_R` 는 **최소 후퇴각 상태로 모델링** (회전량 = 현재 후퇴각 - minDeg, 로컬 Y 축).
- `opt_pylons` 는 모듈과 무관하게 외부(비내부) 스테이션에 무장이 하나라도 있으면 표시된다.

## combat/avionics (센서/항전)

공개 API: `src/combat/avionics/index.ts` → `createAvionics(owner, sim): AircraftAvionics` (Avionics 구현 + 추가 메서드). 무장 모듈이 `WeaponService.createAvionics` 로 그대로 넘기면 된다.

**core 계약 변경 요청 (지금은 우회해 둠)**
1. `Track.source` 에 `'esm'` (수동 RF: RWR/HTS 가 잡은 방사원 위치) 추가. 현재 ARM 선택 중 방사원 트랙은 `'radar'` 로 표시된다 (내부적으로는 레이더 신선도와 분리 — isTracked/레이더 락에는 쓰이지 않음).
2. `Avionics` 에 `dispose?(): void` 추가 — 미션 종료 시 경고음 정리·이벤트 구독 해제. 지금은 `AircraftAvionics.dispose()` 로만 노출 → Aircraft.dispose 에서 `(this.avionics as { dispose?(): void }).dispose?.()` 호출 권장.
3. (선택) `Avionics.isIlluminating(entity)` 를 계약에 올리면 반능동 유도 판정에 캐스트가 필요 없다.
4. `Relations.isHostile` 은 호출마다 문자열 키(`a|b`)를 만든다. 항전은 세력별 캐시로 우회했지만 core 에서 boolean 테이블로 바꾸면 모든 모듈이 이득.

**combat (무장)**
- 능동 레이더 중간유도 조건: `shooter.avionics.isTracked(target)` = 자기 레이더가 신선하게 추적(STT, 또는 TWS/RWS 스캔 주기 ×1.6 안) 또는 협동교전 데이터링크(`datalink.cooperativeEngagement`) 트랙.
- 반능동(SARH): `(shooter.avionics as AircraftAvionics).isIlluminating(target)` (= `radarMode === 'stt'` + 지정 표적 + 1.5 s 안에 탐지). SARH 무장으로 락을 걸면 레이더가 자동으로 STT 가 된다.
- `owner.emission` 은 항전이 소유한다 (센서 주기마다 갱신, 레이더 off/격추 시 null). 무장 쪽은 쓰지 말 것. 미사일 자신의 시커 방사는 RWR 이 `MissileLike.seekerActive && target === 피추적기` 로 판단하므로 미사일 emission 은 선택 사항(있어도 RWR 은 무시).
- 발사 경보: 발사 기체의 항전이 월드에서 `shooter === owner` 인 미사일(`sarh`, 또는 `active_radar` + `guidance.datalink` + `!seekerActive`)을 찾아 emission 을 `'guidance'` 로 바꾼다 → `shooter/target/guidanceType/seekerActive` 를 정확히 유지해 달라 (`seekerActive` 는 pitbull 이후 true).
- MAW 는 `motorBurning` 또는 `timeOfFlight <= motor.boostSec + motor.sustainSec + 2` 를 읽는다. 미사일 엔티티의 `faction` 은 사수 세력으로.
- 견인 디코이: `TowedDecoy` (kind `'decoy'`, `decoyType 'towed'`, `owner`, `strength 0.85`, `rcs = max(기체 RCS×3, 10)`, 기체 뒤 110 m). 레이더 경보(발사 경보 또는 능동 시커) 시 자동 전개, `ew.towedDecoys` 개수 제한. **레이더 시커(active_radar/sarh)가 `decoyType === 'towed'` 를 기만 후보로 봐 달라** (예: 시커 FOV 안이면 `strength × (1 − ccm)` 확률로 전환). 폭발 피해로 파괴되면 다음 경보 때 새 것을 전개.
- 재밍/노치 공식 재사용: `sensorMath.jamRangeFactor(jamPower, eccm, jamCoverageWeight(angleDeg, coverageDeg))`, `inDopplerNotch(type, radialSpeed)`, `lookDownSeverity`, `radarRangeForRcs`, `rcsAspectFactor`, `irDetectionRange`. 표적 재머 판정은 `target.avionics.jammerActive && target.stats.ew`.

**flight (PlayerController)**
- Tab → `avionics.cycleTarget(sim, 1)` (filter 생략 시 선택 무장 기준: AAM 은 공중, 공대지는 지상 우선 — 해당 종류가 없으면 전체), Tab 길게 → `targetNearestToBoresight(sim)`, J → `avionics.jammerActive = !avionics.jammerActive` (EW 없으면 false 로 남음).
- 레이더 모드는 자동: 공대지 무장 선택 → `'ag'`, 공대공으로 돌아오면 이전 모드, SARH 락 → `'stt'`. 수동은 `setRadarMode`.
- **중복 주의**: 플레이어 기체의 항전은 지정 표적이 바뀔 때마다(수동 순환·자동 재지정 모두) 직접 `sim.events.emit('targetChanged')` + `audio.play('target_switch')` 를 한다. 현재 `src/flight/playerController.ts` 도 Tab 처리 뒤 같은 이벤트/효과음을 내므로 **두 번** 나간다 → PlayerController 쪽 emit/play 를 빼 달라 (자동 재지정은 항전만 알 수 있음).

**ai**
- 직접 표적을 고를 때는 `avionics.autoDesignate = false` 후 `designate(e)`. 그대로 두면 에이스컴뱃식 우선순위(30° 원뿔 안 기수 근접 — 선택 무장으로 교전 가능한 표적 먼저 → 'target' 태그 → 우리를 추적 중인 적 → 거리)로 자동 지정한다.
- `lockState(def, sim)` 는 무기 하나의 락 진행을 추적한다 (마지막으로 물어본 무기가 0.5 s 동안 우선, 아니면 `stores.selectedDef()`).
- 지상 SAM/레이더 유닛은 `entity.emission = { mode: 'search'|'track'|'guidance', rangeM, azimuthDeg(회전 레이더는 180), lpi, trackedIds, label: 'SA-10' }` 을 써 주면 RWR·ARM 락이 읽는다. 추적/유도 중에는 `trackedIds` 에 표적 id.
- `'awacs'` 태그 아군(살아 있음)이 있으면 같은 편 데이터링크 장착기는 그 300 km 안 적기를 datalink 트랙으로 받는다 (RCS 1 m² 미만은 RCS^(1/4) 로 거리 감소 → 스텔스는 ~36 km).

**ui (HUD)**
- `avionics.tracks` (source/quality/identified/hostile/rangeM/position — 플레이어는 매 스텝 외삽), `target`, `threats` (`bearingDeg` 기수 기준 ±180, `rangeM/timeToImpact` 는 MAW 만), `missileWarning`, `lockState(stores.selectedDef(), sim)` → `{ status, progress, target }` (반환 객체는 재사용 — 매 프레임 다시 읽을 것).
- 추가(AircraftAvionics): `radarRangeM`, `scanAzimuthDeg`(레이더 화면 빔 위치), `towedDecoysRemaining`, `towedDecoyDeployed`, `designatedEntity`, `trackOf(e)`, `assessRadar(e, sim)`.
- 미션 표적(`'target'` 태그)은 플레이어에게 항상 품질 0.2 의 `'datalink'` 트랙으로 존재 → TGT 표시.
- 조종석 경고음은 항전이 `audio.setTone` 으로 직접 켜고 끈다 (`ir_search, ir_lock, radar_lock, rwr_search(새 방사원 0.35 s), rwr_lock, missile_launch, missile_incoming`). 표적 변경 시 `'target_switch'` 효과음과 `sim.events 'targetChanged'`.

## campaign

**core 변경 요청 (선택, 우회 구현 완료)**
- `AircraftSpawn` 에 `role?: string` 과 `orders?: { waypoints?: Vector3[]; loop?: boolean; targetTag?: string; escortTag?: string; patrol?: { center: Vector3; radius: number }; holdFire?: boolean }` 를 공식 필드로 추가해 달라. 지금은 campaign 이 `CampaignAircraftSpawn extends AircraftSpawn` (`src/campaign/missionTypes.ts`) 객체를 넘기고, 같은 정보를 태그 `role:<id>`, `holdfire` 로도 붙인다.
- `Stores` 에 `rearm(): void` (로드아웃대로 무장·채프·플레어 재장전) 가 있으면 보급 구역 구현이 깔끔해진다. 지금은 `MissionRunnerOptions.rearm(ac)` 훅을 통합 쪽이 구현해야 한다 (무장 재장전 + 연료 보충, 원하면 HP 회복).

**game (통합) — 스폰 서비스**
- `spawn.aircraft(req)` 의 req 는 실제로 `CampaignAircraftSpawn` 이다. `role` (`cap|sweep|escort|strike|bomber|interceptor|awacs|patrol|drone`) 과 `orders` 를 `createAIPilot` 에 전달할 것. `role: 'drone'` 또는 `orders.holdFire` / 태그 `holdfire` 인 기체는 무장을 쓰지 않아야 한다 (튜토리얼 표적기, 연출용 에이스).
- `presetId` 에는 data 의 실제 프리셋 id 가 오거나, 해석 실패 시 `undefined` 가 온다 (campaign 이 `air|strike|sead|antiship|intercept` 의도를 프리셋 id/이름 키워드로 찾는다 — `resolvePresetId`). `loadout` 이 `{ modules: {}, stations: {}, fuel: 1 }` 이면 비무장 + 기본 모듈.
- 스폰 후 campaign 이 `entity.name` (예: '미확인 기체', '표적기'), `callsign`, `tags` 를 덮어쓸 수 있다. HUD 는 표시 시점에 `entity.label`/`name` 을 읽어 달라.
- 미션마다 새 Sim 을 만들 것 (미션이 `sim.relations` 를 바꾼다: m00 NATO-NEUTRAL 적대, m01 NATO-WON 적대↔중립, 스커미시 NATO-WON 적대).
- 플레이어는 `MissionRunner.start()` 가 스폰한다 (`sim.world.player` 가 이미 있으면 그걸 쓴다). 윙맨은 `controller: 'wingman', leader, formationSlot` 으로 스폰.
- `runner.markers: LiveMarker[]` (x, z, alt?, radius?, label, kind) — 웨이포인트 링·보급 구역. HUD/지도에 그려 달라.
- 조립 순서: `createChatter(sim)` → `new MissionRunner(def, sim, { playerLoadout, playerCallsign, rearm, chatter })` → `game.addSystem(runner)`, `def.chatter !== false` 면 `game.addSystem(chatter)` → `runner.start()`. `missionEnded` 이벤트 후 `runner.result()` 로 결과 화면, `applyMissionResult(save, def, result)` → `saveGame(save)`.
- 모델 사전 로드: `missionModelIds(def, DB)` (roster + 윙맨). 플레이어 기체·무장 모델은 통합 쪽에서 추가.

**ai**
- `withdraw()` 는 이탈하는 적 에이스의 `entity.faction` 을 런타임에 `'NEUTRAL'` 로 바꾼다. AI 는 표적의 적대 여부를 매 판단마다 `sim.relations.isHostile(me.faction, target.faction)` 로 다시 확인해 달라 (락 유지 중이던 표적도 해제).
- 미션 연출용 무적 엔티티가 있다 (`'damaged'` 리스너 안에서 hp 를 되돌림). AI 가 "격추 불가" 를 따로 알 필요는 없다.

**combat / flight**
- 모든 미사일·폭탄 발사(플레이어, AI, SAM, 그리고 campaign 의 `ctx.launch` → `weapons.launch`)에서 `weaponLaunched` 를 내보내 달라 — 명중률 통계·발사 브레비티 무전이 이걸 쓴다.
- `destroyed.by` / `DamageInfo.source` 는 발사 주체(기체)여야 한다 (계약대로). 미사일 엔티티가 오면 campaign 이 `shooter` 로 되짚긴 한다.
- 무적 처리는 `Entity.applyDamage` 의 순서(차감 → `damaged` 발행 → hp≤0 판정)에 기댄다. Aircraft 가 applyDamage 를 오버라이드한다면 **`damaged` 를 kill 판정보다 먼저** 발행하고, 발행 후 hp 를 다시 읽어 판정해 달라. 부위 피해도 hp 가 복구됐으면 생략하면 좋다.
- 튜토리얼이 `targetChanged` 이벤트로 Tab 사용을 확인한다 — 플레이어 표적 전환 시 발행해 달라.

**data**
- 팍스 전용 대함 미사일이 없어 m03 은 `Storm Shadow` 를 대함 용도로 쏜다 (`['Sea Eagle', 'Storm Shadow', 'AGM-84']` 순서로 DB 에 있는 첫 번째). `Sea Eagle` (팍스, ashm) 을 추가해 주면 자동으로 그걸 쓴다.
- 스크립트가 직접 쏘는 무장: `AIM-9M` (m00 훈련탄), `Meteor` (m01), `Storm Shadow` (m03). 미션이 스폰하는 기체·유닛 id 는 각 MissionDef 의 `roster` 에 있고, 테스트가 아키텍처 목록과 (있으면) `src/data/index.ts` 의 DB 에 대조한다.
- 플레이어 기체 프리셋 id/이름에 `air`, `strike`, `sead`, `antiship`, `intercept` 키워드가 들어가면 미션 추천 프리셋이 정확히 잡힌다 (예: `f15ex` 의 `air_superiority`, `strike`, `sead`, `antiship`). 적 기체는 `air` / `strike` / `antiship` 정도면 충분.

**ui**
- 결과 화면: `MissionResult` (`src/campaign/missionTypes.ts`) — `kills[{name,count,score}]`, `breakdown[{label,value}]` (합계 = score), `rank`, `creditsEarned`, `accuracy`, `damageTaken`(%), `objectives`.
- 브리핑: `def.briefing.{paragraphs, objectivesText, mapMarkers, threats, recommendation}`, `def.date/location/subtitle`, 맵 반경 `def.environment.mapRadius ?? 100000`. 막 목록 `CAMPAIGN.acts[].{title, subtitle, missions}`, 해금 `isMissionUnlocked(save, id, ALL_MISSIONS)`, 개발 중 표시 `def.available === false`.
- 무전 자막 화자는 영문 TAC/콜사인 (`Magpie`, `Lantern`, `Sceptre`, `Lancet 1` …), `side` 로 색 구분. 등장인물 정보(한국어 이름·역할)는 `CAST` / `findCast(speaker)`.
- 격납고 경제: `canBuy/purchase/isUnlocked(save, 'aircraft'|'weapons'|'modules', id, DB)`, 기체별 마지막 로드아웃 `rememberLoadout(save, loadout)` → `save.hangar[aircraftId]`.
