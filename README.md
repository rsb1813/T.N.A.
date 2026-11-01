# T.N.A.

3D 게임 프로젝트.

## 3D 작업 도구

| 도구 | 용도 |
|---|---|
| Blender 5.2.3 LTS (헤드리스) | 모델링, UV, 머티리얼, 리깅, 애니메이션, GLB 내보내기. Python 스크립트로 작업 |
| three.js + 헤드리스 Chromium | GLB 미리보기 렌더 (`tools/preview.mjs`) |
| glTF-Transform | 검증, 최적화(메쉬 압축, 텍스처 WebP/KTX2), 포맷 변환 |
| trimesh, manifold3d, pygltflib | Python 메쉬 처리, 불리언 연산, glTF 직접 편집 |
| numpy, Pillow, opensimplex | 절차적 텍스처 생성 |

설치(여러 번 실행해도 안전):

```bash
bash tools/setup.sh
```

## 작업 흐름

```bash
# 1) Blender 스크립트로 모델 생성 → GLB (+ 편집용 .blend)
blender -b --factory-startup -P tools/blender/examples/crate.py -- out/crate.glb out/crate.blend

# 2) glTF 규격 검증
npx gltf-transform validate out/crate.glb

# 3) 미리보기: 4각도 렌더 + 폴리곤/드로우콜/크기 통계
node tools/preview.mjs out/crate.glb out/crate.png

# 4) 게임용 최적화 (메쉬 meshopt 압축 + 텍스처 WebP)
npx gltf-transform optimize out/crate.glb out/crate.opt.glb --compress meshopt --texture-compress webp
```

`tools/preview.mjs` 옵션: `--views 1|4`, `--size 1024`, `--bg '#2b2f36'`, `--no-grid`.
Draco, meshopt, KTX2 압축 모델도 읽는다.

새 모델 스크립트는 `tools/blender/tna.py` 헬퍼(씬 초기화, 머티리얼, numpy 배열을 텍스처로 변환, 박스 UV, GLB 내보내기)를 import 해서 쓴다. `tools/blender/examples/crate.py` 참고.

## 에셋 규칙

- 1 단위 = 1m.
- Blender 는 Z-up, glTF 는 Y-up. 내보낼 때 자동 변환된다. Blender 정면 뷰(-Y)가 glTF 의 앞(+Z)이 된다.
- 피벗은 바닥 중앙.
- Blender 머티리얼 색 값은 리니어다(sRGB 아님).
- 생성물은 `out/` (git 에서 제외). 확정된 에셋은 `assets/` 에 둔다.
