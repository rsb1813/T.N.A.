"""예시 에셋: 1m 로우폴리 나무 상자 (도구 동작 확인용).

    blender -b --factory-startup -P tools/blender/examples/crate.py -- out/crate.glb [out/crate.blend]

- 판자 텍스처를 numpy 로 직접 생성해서 GLB 안에 PNG 로 넣는다.
- 테두리 프레임 + 판자 몸통을 한 메쉬(머티리얼 2개)로 만든다.
- 피벗은 바닥 중앙(게임에서 바닥에 놓기 쉽게).
"""

import os
import sys

import bmesh
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import tna  # noqa: E402

S = 1.0      # 상자 한 변(m)
T = 0.1      # 프레임 두께(m)
INSET = 0.03 # 판자 면이 프레임보다 들어간 깊이(m)


def plank_texture(res=256, planks=5, seed=7):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:res, 0:res] / res
    idx = np.minimum((y * planks).astype(int), planks - 1)
    local = y * planks - idx  # 판자 안에서 0..1

    # 결: 판자마다 위상이 다른 물결. 주파수를 정수로 둬서 가로로 이음매 없이 반복된다.
    phase = rng.random((planks, 3))[idx]
    wobble = (0.6 * np.sin(2 * np.pi * (x * 1 + phase[..., 0]))
              + 0.3 * np.sin(2 * np.pi * (x * 3 + phase[..., 1]))
              + 0.15 * np.sin(2 * np.pi * (x * 7 + phase[..., 2])))
    grain = 0.5 + 0.5 * np.sin(2 * np.pi * (local * 5 + wobble * 0.6 + idx * 0.37))
    fine = rng.random((res, res)) * 0.06

    base = np.array([0.62, 0.42, 0.24])
    tint = 0.85 + 0.25 * rng.random(planks)[idx]
    shade = (0.82 + 0.18 * grain - fine) * tint
    rgb = base[None, None, :] * shade[..., None]

    # 판자 사이 홈
    gap = (local < 0.035) | (local > 0.965)
    rgb[gap] *= 0.35
    return np.clip(rgb, 0, 1)


def build():
    tna.reset_scene()

    wood = tna.material("Crate_Planks", roughness=0.75,
                        image=tna.image_from_array("crate_planks", plank_texture()))
    # 머티리얼 색은 리니어 값이다(0.09 리니어 ≈ 0.33 sRGB).
    frame = tna.material("Crate_Frame", color=(0.09, 0.05, 0.025, 1.0), roughness=0.85)

    bm = bmesh.new()
    h = S / 2
    c = h - T / 2       # 프레임 각재 중심 위치
    inner = S - 2 * T   # 모서리 사이에 들어가는 각재 길이

    # 몸통(판자): 프레임보다 INSET 만큼 안쪽
    body = S - 2 * INSET
    tna.add_box(bm, (body, body, body), (0, 0, h), mat_index=0)

    # 12개 모서리 각재 (겹치지 않게 X 방향만 전체 길이)
    for sy in (-1, 1):
        for sz in (-1, 1):
            tna.add_box(bm, (S, T, T), (0, sy * c, h + sz * c), mat_index=1)
    for sx in (-1, 1):
        for sz in (-1, 1):
            tna.add_box(bm, (T, inner, T), (sx * c, 0, h + sz * c), mat_index=1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            tna.add_box(bm, (T, T, inner), (sx * c, sy * c, h), mat_index=1)

    bm.normal_update()
    tna.box_uv(bm, tile=S)
    obj = tna.new_mesh_object("Crate", bm)
    obj.data.materials.append(wood)
    obj.data.materials.append(frame)

    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 1
    bevel.limit_method = "ANGLE"
    return obj


if __name__ == "__main__":
    args = tna.script_args()
    out = args[0] if args else "out/crate.glb"
    build()
    tna.export_glb(out)
    if len(args) > 1:
        tna.save_blend(args[1])
