# tools/blender — 모델 생성 스크립트

헤드리스 Blender 5.2 에서 Python 스크립트로 모델을 만들고 `public/models/<id>.glb` 로 내보낸다.
**스크립트 파일 이름 = 모델 id** (`aircraft/f15ex.py` → `public/models/f15ex.glb`).

| 경로 | 내용 |
|---|---|
| `tna.py` | 공용 저수준 헬퍼 (씬 초기화, 머티리얼, numpy → 텍스처, GLB 내보내기) |
| `aero.py` | **항공기 제작 키트** — 동체 로프트, 날개/꼬리, 흡입구, 노즐, 캐노피, 파일런, 스테이션, 조종면 부품, 휘장 |
| `aircraft/*.py` | 기체 (플레이어 5종 + 적 기체) |
| `weapons/*.py`, `units/*.py` | 무장, 지상/해상 유닛, 건물 |
| `build_all.sh` | 전체(또는 일부) 빌드 + glTF 검증 + 요약 표 |

## 빌드 / 검증

```bash
# 한 개
blender -b --factory-startup -P tools/blender/aircraft/f16p.py -- public/models/f16p.glb [out/f16p.blend]
npx gltf-transform validate public/models/f16p.glb          # 오류 0 이어야 함
node tools/preview.mjs public/models/f16p.glb out/models/f16p.png   # 4면 렌더 + 삼각형 수

# 전부 / 일부 / 병렬
tools/blender/build_all.sh                 # aircraft, weapons, units 의 모든 모델 스크립트
tools/blender/build_all.sh f15ex aim120    # 지정한 id 만
tools/blender/build_all.sh -j 4            # 4 개씩 병렬
tools/blender/build_all.sh --list          # 빌드 대상 목록
```

`build_all.sh` 는 `_*.py`, `common.py`, `*_common.py`, `build_*.py`, 첫 20줄에 `# tna: helper` 가 있는 파일,
`finish(` / `export_glb` 를 부르지 않는 파일을 도우미로 보고 건너뛴다. 로그는 `out/build/<id>.log`.

> 주의: `tools/preview.mjs` 의 "앞(+Z)" 라벨은 glTF +Z 기준이다. 우리 규약에서 기수는 glTF **-Z** 이므로
> 미리보기의 "3/4 앞" 칸에는 기체의 **꼬리 쪽**이 보이고 "3/4 뒤" 칸에 기수 쪽이 보인다(정상).
> 미리보기는 `opt_*` 노드도 함께 그린다(게임에서는 기본 숨김).

## 규약 요약 (docs/architecture.md 6·7절)

- 단위 m, 실제 크기. **Blender 좌표로 작업**: 기수 = **+Y**, 위 = +Z, 오른쪽 = +X.
  내보내면 glTF 기수 = -Z, 위 = +Y 가 된다. 원점 = 기체 중심(대략 무게중심, 동체 중심선 높이).
- 스테이션 표는 glTF 좌표다 → `aero.gl(x, y, z)` 로 Blender 좌표로 바꿔 넣는다. 좌측(L)=-X, 우측(R)=+X.
- 노드 이름: `station_<ID>`(무장 장착 러그 = 무장 위쪽 중앙, 무장 기수 = -Z), `nozzle_L/R`(단발 `nozzle`, 배기구 중심),
  `gun`(총구), `cockpit`(조종사 눈), `wingtip_L/R`, 움직이는 부품 `canopy`, `wing_L/R`, `aileron_*`, `elevator_*`,
  `rudder_*`, `flap_*`(앞전 플랩은 `flap_le_*`), `canard_*`, `airbrake`, 선택 장비 `opt_<이름>`(게임에서 기본 숨김,
  glTF extras 에 `tna_optional: 1`).
- 머티리얼 이름: `paint`, `paint_dark`(둘 다 회색조 패널 라인 텍스처 × 색 → 게임이 색만 바꿔도 패널 라인 유지),
  `metal`, `nozzle`, `canopy`(반투명 BLEND), `intake`(어두운 내부/조종석), `insignia`, `glow`(발광: 엔진 터빈면),
  `rubber`.
- 삼각형 예산: 플레이어 기체 ≤ 20k, 적 기체 ≤ 10k (`Aircraft(..., budget=10000)`; 넘으면 빌드 실패).

### 움직이는 부품 회전 규칙 (three.js 로컬 축)

| 부품 | 축 | + 방향 |
|---|---|---|
| `aileron_*`, `flap_*`, `elevator_*`, `canard_*` | `rotation.x` | 뒷전 내림 (앞전 올림). 좌우 모두 같은 부호 규칙 |
| `flap_le_*` (앞전 플랩) | `rotation.x` | − 가 앞전 처짐 |
| `rudder_*` | `rotation.y` | 뒷전이 오른쪽(기수 오른쪽) |
| `canopy` (뒤 힌지) | `rotation.x` | 열림 |
| `airbrake` | `rotation.x` | 열림 (노드가 Y축으로 180° 돌려져 있음) |
| `wing_L` / `wing_R` (가변익) | `rotation.y` | `wing_L` + / `wing_R` − 가 후퇴. F-14EX 는 20° 상태로 모델링 → 68° 는 ±48° |

비스듬한 힌지(후퇴익 에일러론, 기울어진 러더)는 노드 자체가 힌지선에 맞춰 회전돼 있어서 위 한 축만 돌리면 된다.
원점은 항상 힌지선(가변익은 글러브 안 회전축) 위에 있다.

## aero.py 사용법

```python
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import aero
from aero import cut, gl, sec

ac = aero.Aircraft("demo_delta", paint=(0.30, 0.31, 0.30), canopy="smoke", budget=10000)

# 동체: sec(y, 반폭, 위 높이, 아래 깊이, 중심 z, n=단면지수 ...) 키프레임을 PCHIP 으로 이어 로프트
ac.fuselage([sec(6.60, 0.46, 0.46), sec(5.0, 0.55, 0.62, 0.55), sec(1.0, 0.62, 0.66, 0.62),
             sec(-3.0, 0.60, 0.60), sec(-5.4, 0.48, 0.48)], N=28)
ac.nose_intake(y=6.65, r=0.44, cone_len=0.9)                     # 기수 흡입구 + 충격파 원뿔

# 날개: planform() 이 스테이션 2개를 만든다. 오른쪽 기준으로 만들고 좌우 자동 대칭.
ac.wing(aero.planform(span=3.2, root=4.6, tip=0.5, sweep=57, le=1.2, t=0.045),
        x0=0.45, z0=-0.05, cuts=[cut("flap", 0.15, 1.4, 0.75), cut("aileron", 1.5, 2.8, 0.72)])
ac.wing(aero.planform(span=1.5, root=1.6, tip=0.5, sweep=55, le=-3.6, t=0.04),   # 전체 가동 스태빌레이터
        x0=0.40, airfoil="hex", part="elevator", pivot=dict(s=0.0, f=0.4))
ac.vtail(aero.planform(span=2.1, root=3.2, tip=0.9, sweep=60, le=-1.9),
         x0=0.0, z0=0.45, side="center", cuts=[cut("rudder", 0.3, 1.7, 0.72)])

ac.nozzle(y=-6.2, length=0.8, r_base=0.48, r_exit=0.42, petals=12)   # 'nozzle' empty 자동
ac.canopy([dict(y=3.6, w=0.30, h=0.02, z=0.55), dict(y=3.2, w=0.36, h=0.32, z=0.55),
           dict(y=2.5, w=0.38, h=0.40, z=0.55), dict(y=1.7, w=0.30, h=0.24, z=0.6),
           dict(y=1.2, w=0.16, h=0.04, z=0.62)], split=3.15, frames=[3.15, 2.0])
ac.seat(2.5, 0.5)

for sid, x in (("1", 2.3), ("2", 1.4)):
    ac.pylon(x, -0.9, -0.55, length=1.6)                 # 위쪽 날개면을 찾아 자동으로 붙는다
    ac.station_pair("L" + sid, "R" + sid, (-x, -0.8, -0.55))
ac.station("C", gl(0, -0.95, 0.5))                       # 표의 glTF 좌표 그대로
ac.insignia((-1.9, -1.6, 0.0), (0, 0, 1), size=0.7, kind="star_ring", up=(0, 1, 0))
ac.empty("gun", (-0.45, 1.0, -0.45))
ac.empty("cockpit", (0, 2.4, 1.05))
ac.empty("wingtip_R", (3.65, -3.4, -0.05)); ac.empty("wingtip_L", (-3.65, -3.4, -0.05))
ac.finish()      # 예산 검사 → GLB (명령줄 첫 인자, 없으면 public/models/<id>.glb)
```

### 주요 함수

| 함수 | 설명 |
|---|---|
| `Aircraft(id, paint=, paint_dark=, canopy='smoke'/'gold'/'clear'/RGB, budget=, seed=, metal=, insignia=...)` | 씬 초기화 + 팔레트. 정적 형상은 `body` 메쉬 하나로 합쳐짐(드로우콜 절약) |
| `sec(y, w, ht, hb, z, n=, nt=, nb=, ns=, chine=, x=, wl=)` | 단면 키. `n`: 2=타원, 4~6=둥근 사각, 1=마름모. `nt`/`nb` 윗/아랫면 평평함, `ns` 옆면 모양, `chine=1` 옆이 칼날(F-22 기수). `x` 가로 중심(포드) |
| `nose(y_tip, length, w, ht, hb, z, z_tip=, power=)` | 레이돔 키프레임 목록 (`power` 0.5 둥글게 ~ 0.75 뾰족) |
| `fuselage(keys, N=32, step=0.4, side='center'/'both', part=, mats=)` / `pod(...)` | 로프트 솔리드. `side='both'` 면 x 대칭 한 쌍(나셀·CFT·꼬리붐) |
| `wing(stations, x0, z0, dihedral, vertical, cant, side, airfoil='naca'/'biconvex'/'hex'/'plate', cuts, part, pivot, axes, incidence)` | 날개/꼬리. 스테이션 `dict(s, le, c, t, dz)` (스팬 거리, 앞전 y, 코드, 두께비, 두께방향 오프셋) 를 여러 개 주면 크랭크·곡선 LEX 도 된다 |
| `planform(span, root, tip, sweep, le, t, t_tip)` / `dogtooth(stations, s, extend)` | 사다리꼴 스테이션 / 앞전 도그투스(스내그) |
| `cut(name, s0, s1, f, edge='te'/'le')` | 조종면 분리: 스팬 s0..s1, 힌지 코드비 f → `name_R` / `name_L` 부품(원점=힌지) |
| `vtail(stations, x0, z0, cant, side)` | 수직꼬리 (`cant` 바깥 기울기, 아래로 향한 벤트럴 핀은 `cant=160~170`) |
| `intake(sections, shape='super'/'quad', slant=(dy/dx, dy/dz), lip, depth)` | 흡입구 외피 + 립 + 어두운 덕트 + 압축기면. `quad` 는 `corners=[(u,v)×4]` 캐럿/사다리꼴. `slant` 로 입구 면 경사 (F-16 턱 흡입구는 dy/dz<0, F-15 는 >0, 캐럿은 dy/dx<0) |
| `nose_intake(y, r, cone_len)` | 기수 원형 흡입구 + 충격파 원뿔 |
| `nozzle(x, z, y, length, r_base, r_exit, petals, side)` | 원형 노즐(페탈) + `glow` 터빈면 + `nozzle_*` empty |
| `nozzle_2d(x, z, y, length, w, h_base, h_exit, serration, side)` | 2D 추력편향 노즐 |
| `canopy(keys, split=, frames=, hinge=)` / `seat(y, z)` | 캐노피(`split` 앞은 고정 윈드실드), 프레임 보우, 조종석 내부 자동 칠 / 좌석+헬멧 |
| `pylon(x, y, z_bottom, length, width)` / `rail(x, y, z_top, length)` | 파일런(위 몸체 면을 광선으로 찾아 붙음) / 발사 레일(아래면 z 반환) |
| `station(id, pos)` / `station_pair(L, R, pos_left)` / `empty(name, pos, parent=)` | empty 노드 |
| `part(name, origin, axes, parent)` | 직접 부품 노드 만들기 (예: `airbrake` 는 axes `[[-1,0,0],[0,-1,0],[0,0,1]]` 로 + = 열림) |
| `insignia(center, normal, size, kind='star_bar'/'star_ring'/'star'/'roundel'/'disc'/'oval', side=, target=)` | 곡면에 투영되는 휘장. `target='wing_L'` 처럼 부품에도 붙일 수 있다 |
| `decal(center, normal, shape)` + `shape_frame(w, h, split=, saw=)` | 임의 2D 마킹 (닫힌 무장창 문 윤곽 등) |
| `paint(mat, x=, y=, z=, where=, src=)` | 범위 안 면의 머티리얼 교체 (레이돔, 금속 꼬리, 눈부심 방지) |
| `box`, `blade`, `surface_z`, `rings` | 상자, 블레이드 안테나, 몸체 표면 높이 조회, 직접 만든 링 로프트 |

### 팁

- `N` (단면 점 수)은 4의 배수. 삼각형이 많으면 `N` 을 줄이고 `step` 을 키운다. 노즐 `petals` 도 비용이 크다.
- 키프레임 y 는 서로 달라야 한다. 기수/꼬리 끝은 `w=ht=hb=0` 키로 한 점에 모은다.
- 부품끼리 겹쳐도 된다(날개 뿌리는 동체 안에 묻는다). 같은 평면에 겹치는 면만 피하면 z-fighting 이 없다.
- 이미 `ac.part("airbrake", ...)` 로 만든 부품에 `side='both'` 형상을 넣으면 양쪽이 한 노드로 들어간다.
  만들지 않은 이름이면 `_R`/`_L` 두 노드로 나뉜다. `opt_*` 는 항상 한 노드.
- 미리보기용 디버그: `TNA_POSE="wing_L:z:48,wing_R:z:-48,canopy:x:30"` (Blender 로컬 축, 도) 로 부품을 돌려서,
  `TNA_HIDE_OPT=1` 로 `opt_*` 를 빼고 내보낼 수 있다. 게임용 GLB 를 만들 때는 쓰지 않는다.

## 플레이어 기체 (aircraft/)

| id | 특징 | 선택 노드 |
|---|---|---|
| `f15ex` | 어깨날개, 사각 흡입구, CFT(CFT_* 스테이션), 꼬리붐 위 쌍수직꼬리, 도그투스 스태빌레이터, 복좌, 등 에어브레이크, L2A/L2B 어깨 레일 | `opt_irst` (중앙 Legion 포드) |
| `f22d` | 다이아몬드 주익, 차인 기수, 캐럿 흡입구, 28° 쌍꼬리, 2D 노즐, 닫힌 무장창 윤곽, 프레임 없는 금빛 캐노피 | `opt_pylons` (외부 파일런 L1/L2/R1/R2) |
| `fa18i` | 큰 LEX, 사다리꼴 캐럿 흡입구, 스내그 주익, 20° 쌍꼬리, 날개끝 레일, 기수 기관포 | `opt_cft` (등 위 CFT) |
| `f16p` | 블렌디드 윙바디 + 스트레이크, 턱 흡입구, 버블 캐노피, 벤트럴 핀, 노즐 옆 스피드브레이크 | `opt_cft` (Block 60식), `opt_dorsal` (등 스파인) |
| `f14ex` | 가변익(`wing_L/R`, 20°→68°), 글러브, 넓은 나셀 + 평평한 터널, 비버테일 스피드브레이크, 복좌 | — |
