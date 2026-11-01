"""원통형 유류 저장 탱크 (API 650 급) — 지름 24 m, 높이 14 m(+원뿔 지붕 1.5 m).
콘크리트 기초 고리, 바람 보강 링, 나선 계단, 지붕 난간·통기구, 앞쪽 배관 2 + 밸브.
원점 = 탱크 바닥 중앙, 정면(배관) = +Y. 주 재질 'paint'.

    blender -b --factory-startup -P tools/blender/units/fuel_tank.py -- public/models/fuel_tank.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C
from mathutils import Vector

C.reset()
B = C.Building("fuel_tank", colors={"paint": (0.55, 0.56, 0.54), "paint_dark": C.CONCRETE,
                                    "metal": ((0.12, 0.13, 0.14), 0.6, 0.5)})
b = B.b
R, H0, H1, RISE = 12.0, 0.45, 14.45, 1.5
U, V = (1, 0, 0), (0, 1, 0)
ring = lambda z, r, n=32: C.ring_points((0, 0, z), U, V, r, n)

# 기초 + 탱크 몸통 + 원뿔 지붕
b.loft([ring(0.0, R + 0.7), ring(H0, R + 0.7)], "paint_dark", smooth=True, cap0="paint_dark", cap1="paint_dark")
b.loft([ring(H0 - 0.05, R), ring(H1, R), ring(H1, R + 0.12), ring(H1 + 0.25, R + 0.12),
        ring(H1 + 0.25, R - 0.05), [Vector((0, 0, H1 + RISE))]],
       ["paint", "paint", "paint", "paint", "paint"], smooth=True, cap0="paint")
# 바람 보강 링
b.loft([ring(10.6, R - 0.05), ring(10.6, R + 0.45), ring(10.85, R + 0.45), ring(10.85, R - 0.05)],
       "paint", smooth=True, closed=True)
# 지붕 난간 (위 레일 고리 + 기둥)
b.loft([ring(H1 + 1.05, R - 0.35), ring(H1 + 1.05, R - 0.2), ring(H1 + 1.15, R - 0.2), ring(H1 + 1.15, R - 0.35)],
       "metal", smooth=False, closed=True)
for k in range(16):
    a = 2 * math.pi * k / 16
    p = Vector((math.cos(a) * (R - 0.27), math.sin(a) * (R - 0.27), 0))
    b.box((0.1, 0.1, 1.0), (p.x, p.y, H1 + 0.6), "metal")
# 나선 계단 (탱크 벽을 따라 바닥에서 지붕까지)
A0, A1, NS = math.radians(200), math.radians(320), 12
w_in, w_out, th = R + 0.05, R + 1.15, 0.25


def hp(t, r, dz=0.0):
    a = A0 + (A1 - A0) * t
    return Vector((math.cos(a) * r, math.sin(a) * r, 0.2 + (H1 - 0.2) * t + dz))


lines = [[hp(k / NS, w_in, 0) for k in range(NS + 1)], [hp(k / NS, w_out, 0) for k in range(NS + 1)],
         [hp(k / NS, w_out, -th) for k in range(NS + 1)], [hp(k / NS, w_in, -th) for k in range(NS + 1)]]
vr = b.loft(lines, "metal", smooth=False, closed=True, wrap=False)
for j in (0, NS):
    b.face([vr[0][j], vr[1][j], vr[2][j], vr[3][j]], "metal")
# 계단 바깥 난간
for k in range(NS):
    p0, p1 = hp(k / NS, w_out - 0.05, 1.0), hp((k + 1) / NS, w_out - 0.05, 1.0)
    b.beam(p0, p1, 0.08, mat="metal")
    q = hp(k / NS, w_out - 0.05, 0.5)
    b.box((0.08, 0.08, 1.0), (q.x, q.y, q.z), "metal")
# 지붕 통기구 + 맨홀
for x, y in ((3.0, 2.0), (-4.0, -3.5)):
    z = H1 + RISE * (1 - math.hypot(x, y) / R)
    b.cyl((x, y, z - 0.3), (x, y, z + 1.0), 0.35, segs=8, mat="metal")
    b.cyl((x, y, z + 1.0), (x, y, z + 1.25), 0.6, segs=8, mat="metal")
# 앞 배관 2 (탱크 → 밖으로, 땅으로 내려감) + 밸브
for x in (-2.5, 2.5):
    b.cyl((x, R - 0.3, 1.4), (x, R + 4.2, 1.4), 0.4, segs=10, mat="metal")
    b.cyl((x, R + 4.2, 1.4), (x, R + 4.2, -0.3), 0.4, segs=10, mat="metal", cap0=False)
    b.box((1.2, 0.8, 1.2), (x, R + 2.2, 1.4), "paint_dark")
    b.cyl((x, R + 2.2, 2.0), (x, R + 2.2, 2.8), 0.1, segs=6, mat="metal")
    b.cyl((x, R + 2.2, 2.8), (x, R + 2.2, 2.9), 0.45, segs=8, mat="band_red")
    b.box((0.6, 0.6, 1.0), (x, R + 3.4, 0.5), "paint_dark")
B.finish()
