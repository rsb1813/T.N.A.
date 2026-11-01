"""5층 콘크리트 건물 (아파트/관공서 블록) — 42 x 14 m, 높이 ~17 m.
층마다 띠창(유리), 앞으로 나온 기둥(필라스터), 층 슬래브 띠, 옥상 난간·계단실·물탱크·실외기, 1층 출입구 캐노피.
원점 = 바닥 중앙, 정면(긴 면) = +Y. 주 재질 'paint'.

    blender -b --factory-startup -P tools/blender/units/building_block.py -- public/models/building_block.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C

C.reset()
B = C.Building("building_block", colors={"paint": (0.30, 0.27, 0.22), "paint_dark": (0.12, 0.11, 0.10)})
b = B.b
W, D, FH, NF = 21.0, 7.0, 3.2, 5
H = FH * NF + 0.4

b.box((2 * W, 2 * D, H), (0, 0, H / 2), "paint", bevel=0.08)
# 기단
b.box((2 * W + 0.4, 2 * D + 0.4, 0.7), (0, 0, 0.35), "paint_dark")
# 층별 띠창 (네 면을 감싸는 유리 띠) + 층 슬래브 띠
for f in range(NF):
    z0 = f * FH + (1.0 if f > 0 else 1.1)
    h = 1.55 if f > 0 else 2.0
    b.box((2 * W + 0.1, 2 * D + 0.1, h), (0, 0, z0 + h / 2), "glass")
    if f > 0:
        b.box((2 * W + 0.36, 2 * D + 0.36, 0.28), (0, 0, f * FH + 0.2), "paint_dark")
# 필라스터 (긴 면 13 개, 짧은 면 3 개)
for sy in (-1, 1):
    for k in range(13):
        x = -W + 0.3 + k * (2 * W - 0.6) / 12
        b.box((0.55, 0.42, H - 0.7), (x, sy * (D + 0.18), 0.7 + (H - 0.7) / 2), "paint")
for sx in (-1, 1):
    for k in range(3):
        y = -D + 3.5 + k * 3.5
        b.box((0.42, 0.55, H - 0.7), (sx * (W + 0.18), y, 0.7 + (H - 0.7) / 2), "paint")
# 옥상 난간
for sy in (-1, 1):
    b.box((2 * W + 0.3, 0.3, 1.0), (0, sy * (D + 0.0), H + 0.5), "paint")
for sx in (-1, 1):
    b.box((0.3, 2 * D, 1.0), (sx * W, 0, H + 0.5), "paint")
# 계단실 + 문, 물탱크, 실외기
b.box((5.0, 4.0, 3.0), (-9.0, -1.0, H + 1.5), "paint", bevel=0.06)
b.box((1.0, 0.1, 2.1), (-9.0, 1.02, H + 1.05), "paint_dark")
b.cyl((6.0, -2.0, H + 0.6), (6.0, -2.0, H + 3.4), 1.4, segs=12, mat="metal")
for k in range(4):
    b.box((1.6, 1.0, 1.2), (12.0 + (k % 2) * 2.4, -3.0 + (k // 2) * 2.0, H + 0.6), "metal")
for sx in (-1, 1):
    b.box((0.25, 0.25, 0.6), (6.0 + sx * 0.9, -2.0, H + 0.3), "metal")
# 1층 출입구 (어두운 문 + 캐노피)
b.box((4.0, 0.25, 2.6), (0, D + 0.12, 1.3), "paint_dark")
b.box((7.0, 2.6, 0.3), (0, D + 1.3, 3.0), "paint", bevel=0.05)
for sx in (-1, 1):
    b.box((0.25, 0.25, 2.9), (sx * 3.2, D + 2.4, 1.45), "metal")
B.finish()
