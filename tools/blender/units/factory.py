"""공장 (톱니 지붕 생산동 + 굴뚝) — 생산동 60 x 40 m(벽 9 m, 톱니 13 m), 굴뚝 38 / 30 m, 사일로 2, 사무동.
원점 = 바닥 중앙(전체 배치 기준), 정면(사무동) = +Y. 주 재질 'paint'.

    blender -b --factory-startup -P tools/blender/units/factory.py -- public/models/factory.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C
from mathutils import Vector

C.reset()
B = C.Building("factory", colors={"paint": (0.28, 0.26, 0.21), "paint_dark": (0.10, 0.095, 0.09),
                                  "metal": ((0.30, 0.31, 0.32), 0.5, 0.6)})
b = B.b
HX, Y0, Y1, HW = 30.0, -17.0, 21.0, 9.0   # 생산동 반폭, 뒤/앞 y, 벽 높이

# 생산동 벽체
b.box((2 * HX, Y1 - Y0, HW), (0, (Y0 + Y1) / 2, HW / 2), "paint", bevel=0.2)
b.box((2 * HX + 0.3, Y1 - Y0 + 0.3, 0.6), (0, (Y0 + Y1) / 2, 0.3), "paint_dark")
# 톱니 지붕: 앞(+Y)으로 향한 수직 유리면 + 뒤로 내려가는 경사 지붕
NT = 6
tw = (Y1 - Y0) / NT
for k in range(NT):
    yf = Y1 - k * tw
    tri = [(yf, HW), (yf, HW + 4.2), (yf - tw, HW)]
    a = [Vector((-HX, y, z)) for y, z in tri]
    c = [Vector((HX, y, z)) for y, z in tri]
    b.prism(a, c, "paint", side_mats=["glass", "metal", "paint"])
# 옆 하역문 3 + 앞 창 띠
for k in range(3):
    b.box((0.3, 5.0, 5.5), (HX + 0.1, Y0 + 7 + k * 10, 2.75), "paint_dark")
b.box((2 * HX - 26, 0.1, 1.4), (8.0, Y1 + 0.02, 5.6), "glass")

# 사무동 (2 층, 앞쪽 왼편)
OX0, OX1, OY1 = -27.0, -4.0, Y1 + 8.0
b.box((OX1 - OX0, OY1 - Y1, 7.2), ((OX0 + OX1) / 2, (Y1 + OY1) / 2, 3.6), "paint", bevel=0.1)
for z in (1.2, 4.6):
    b.box((OX1 - OX0 + 0.1, OY1 - Y1 - 1.0, 1.4), ((OX0 + OX1) / 2, (Y1 + OY1) / 2 - 0.4, z + 0.7), "glass")
b.box((OX1 - OX0 + 0.4, OY1 - Y1 + 0.4, 0.5), ((OX0 + OX1) / 2, (Y1 + OY1) / 2, 7.45), "paint_dark")
b.box((3.0, 0.2, 2.4), (-15.5, OY1 + 0.05, 1.2), "paint_dark")

# 보일러동 + 굴뚝 2 (빨강/흰 띠, 그을린 꼭대기)
b.box((16.0, 9.0, 11.0), (17.0, Y0 - 4.5, 5.5), "paint", bevel=0.15)


def stack(x, y, r0, r1, h):
    zs = [0.0, h * 0.62, h * 0.70, h * 0.78, h * 0.86, h * 0.95, h]
    ms = ["paint", "band_red", "paint", "band_red", "paint", "paint_dark"]
    rr = lambda z: r0 + (r1 - r0) * z / h
    rings = [C.ring_points((x, y, z), (1, 0, 0), (0, 1, 0), rr(z), 14) for z in zs]
    top_in = C.ring_points((x, y, h), (1, 0, 0), (0, 1, 0), rr(h) * 0.8, 14)
    top_dn = C.ring_points((x, y, h - 1.5), (1, 0, 0), (0, 1, 0), rr(h) * 0.8, 14)
    b.loft(rings + [top_in, top_dn], ms + ["paint_dark", "intake"], smooth=True, cap1="intake")


stack(21.0, Y0 - 12.0, 2.0, 1.4, 38.0)
stack(13.0, Y0 - 12.0, 1.6, 1.1, 30.0)
for x in (21.0, 13.0):
    b.box((5.0, 5.0, 2.0), (x, Y0 - 12.0, 1.0), "paint_dark", bevel=0.1)

# 사일로 2 (원뿔 지붕, 다리 기초)
for x in (-22.0, -13.0):
    y = Y0 - 7.0
    rings = [C.ring_points((x, y, z), (1, 0, 0), (0, 1, 0), r, 16)
             for z, r in ((1.5, 3.4), (14.0, 3.4), (14.0, 3.55), (16.6, 0.5))]
    b.loft(rings, ["metal", "paint_dark", "metal"], smooth=True, cap0="metal", cap1="metal")
    b.cyl((x, y, 0.0), (x, y, 1.5), 2.6, segs=8, mat="paint_dark")
# 배관 랙 (사일로 → 생산동)
for z in (7.0, 7.9):
    b.cyl((-22.0, Y0 - 7.0, z), (-22.0, Y0 - 0.2, z), 0.35, segs=8, mat="metal")
    b.cyl((-13.0, Y0 - 7.0, z), (-13.0, Y0 - 0.2, z), 0.35, segs=8, mat="metal")
for y in (Y0 - 3.5,):
    for x in (-22.0, -13.0):
        b.box((0.4, 0.4, 7.0), (x + 1.2, y, 3.5), "paint_dark")
# 지붕 환기팬
for x in (-18.0, 0.0, 18.0):
    b.cyl((x, Y1 - 2.5 * tw, HW + 1.0), (x, Y1 - 2.5 * tw, HW + 3.6), 0.9, segs=10, mat="metal")
B.finish()
