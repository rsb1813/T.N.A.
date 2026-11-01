"""대형 정비 격납고 — 폭 80 m(+양옆 부속동 8 m), 깊이 60 m, 처마 15 m, 원통형 지붕 꼭대기 21 m.
정면 전폭 미닫이 문 6 짝(윗부분 채광창), 문 상부 보, 옆 벽 기둥, 양옆 단층 부속동, 지붕 용마루 환기구.
원점 = 바닥 중앙, 정면(문) = +Y. 주 재질 'paint'(벽 패널).

    blender -b --factory-startup -P tools/blender/units/hangar_big.py -- public/models/hangar_big.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C
from mathutils import Vector

C.reset()
B = C.Building("hangar_big", colors={"paint": (0.19, 0.21, 0.20), "paint_dark": (0.06, 0.07, 0.075),
                                     "metal": ((0.22, 0.23, 0.24), 0.5, 0.6)})
b = B.b
W, D, HE, RISE = 40.0, 30.0, 15.0, 6.0

# 벽체
b.box((2 * W, 2 * D, HE), (0, 0, HE / 2), "paint", bevel=0.25)
# 원통형 지붕 (D 단면: 위 호 + 처마 높이 바닥) — 앞뒤 박공면은 벽색
N = 14
OV = 0.8
arc = []
for k in range(N + 1):
    t = k / N
    x = (W + OV) * (1 - 2 * t)
    z = HE + RISE * (1 - (x / (W + OV)) ** 2) - 0.25
    arc.append((x, z))
ring = lambda y: [Vector((x, y, z)) for x, z in arc]
roof_mat = lambda i, j: "metal" if j < N else "paint_dark"
b.loft([ring(-D - OV), ring(D + OV)], "metal", smooth=True, cap0="paint", cap1="paint", mat_fn=roof_mat)
# 용마루 환기구
b.box((2.4, 2 * D - 4, 0.9), (0, 0, HE + RISE + 0.1), "metal", bevel=0.1)

# 정면 미닫이 문 6 짝 + 채광창
DW, DH = 70.0, 13.2
leaf = DW / 6
for k in range(6):
    x = -DW / 2 + leaf * (k + 0.5)
    y = D + (0.25 if k % 2 == 0 else 0.6)
    b.box((leaf + 0.15, 0.35, DH), (x, y, DH / 2), "paint_dark")
    b.box((leaf - 1.2, 0.1, 1.6), (x, y + 0.2, DH - 1.6), "glass")
    b.box((0.25, 0.12, DH - 3.0), (x, y + 0.2, (DH - 3.0) / 2 + 0.2), "metal")
# 문 상부 보 + 바닥 레일 + 양쪽 문 기둥
b.box((DW + 6, 1.6, 1.8), (0, D + 0.7, DH + 0.9), "paint_dark", bevel=0.1)
b.box((DW + 8, 1.4, 0.2), (0, D + 0.6, 0.1), "metal")
for sx in (-1, 1):
    b.box((3.4, 1.8, HE), (sx * (DW / 2 + 1.8), D + 0.6, HE / 2), "paint", bevel=0.15)

# 옆 벽 기둥 (패널 리듬)
for sx in (-1, 1):
    for k in range(7):
        y = -D + 4 + k * (2 * D - 8) / 6
        b.box((0.5, 0.8, HE - 7.0), (sx * (W + 0.25), y, 7.0 + (HE - 7.0) / 2), "paint_dark")
# 양옆 부속동 (작업장/사무실) + 창 띠 + 지붕판
for sx in (-1, 1):
    cx = sx * (W + 4.0)
    b.box((8.0, 2 * D - 8, 7.0), (cx, -2.0, 3.5), "paint", bevel=0.15)
    b.box((8.6, 2 * D - 7.4, 0.4), (cx, -2.0, 7.2), "paint_dark")
    b.box((0.1, 2 * D - 14, 1.4), (sx * (W + 8.02), -2.0, 4.0), "glass")
    for k in range(3):
        b.box((0.12, 2.2, 2.6), (sx * (W + 8.02), -D + 8 + k * 16, 1.3), "paint_dark")
# 뒤 화물 출입문 + 사람 출입문
b.box((10.0, 0.3, 7.0), (0, -D - 0.15, 3.5), "paint_dark")
b.box((1.2, 0.3, 2.4), (-12, -D - 0.15, 1.2), "paint_dark")
# 정면 경고등 / 투광등
for sx in (-1, 1):
    b.box((0.6, 0.4, 0.4), (sx * 30.0, D + 1.6, DH + 2.0), "glow")
B.finish()
