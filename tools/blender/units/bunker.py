"""지휘 벙커 — 흙으로 덮은 콘크리트 구조물. 32 x 22 m, 높이 ~5 m.
흙 둔덕(뒤·옆 경사), 앞 콘크리트 면벽, 돌출 출입구 + 방폭문, 날개벽, 노출 지붕 슬래브, 환기 샤프트, 안테나.
원점 = 바닥 중앙, 정면(출입구) = +Y. 주 재질 'paint'(콘크리트).

    blender -b --factory-startup -P tools/blender/units/bunker.py -- public/models/bunker.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C
from mathutils import Euler, Vector

C.reset()
B = C.Building("bunker", colors={"paint": C.CONCRETE, "paint_dark": (0.05, 0.055, 0.05),
                                 "earth": (0.055, 0.06, 0.03)})
b = B.b
YF = 10.0


def rect(x, y0, y1, z):
    return [Vector((-x, y0, z)), Vector((x, y0, z)), Vector((x, y1, z)), Vector((-x, y1, z))]


# 흙 둔덕: 앞면(j=2)만 콘크리트 면벽
berm = [rect(16.0, -12.0, YF, 0.0), rect(14.2, -10.0, YF, 2.6), rect(11.6, -7.8, YF, 4.2)]
b.loft(berm, "earth", smooth=False, cap1="earth", mat_fn=lambda i, j: "paint" if j == 2 else None)
b.face(list(reversed(b.verts(rect(16.0, -12.0, YF, 0.0)))), "earth")
# 노출 지붕 슬래브
b.box((21.0, 14.0, 0.6), (0, YF - 7.2, 4.35), "paint", bevel=0.12)
# 앞면 위 처마 보
b.box((23.6, 1.0, 0.8), (0, YF + 0.3, 3.9), "paint", bevel=0.1)
# 돌출 출입구 + 방폭문 + 문틀
b.box((8.0, 3.0, 3.8), (0, YF + 1.5, 1.9), "paint", bevel=0.12)
b.box((4.2, 0.4, 2.9), (0, YF + 3.05, 1.45), "paint_dark")
b.box((4.6, 0.2, 0.25), (0, YF + 3.1, 3.0), "metal")
for sx in (-1, 1):
    b.box((0.25, 0.2, 3.0), (sx * 2.2, YF + 3.1, 1.5), "metal")
# 날개벽 (출입구 앞으로 벌어짐)
for sx in (-1, 1):
    rot = Euler((0, 0, sx * math.radians(-25)), "XYZ")
    b.box((0.7, 6.0, 2.6), (sx * 5.6, YF + 4.6, 1.3), "paint", rot=rot, bevel=0.08)
# 환기 샤프트 2 (어두운 그릴) + 비상 출구 해치
for x in (-6.0, 6.5):
    b.box((1.6, 1.6, 1.4), (x, YF - 10.0, 5.3), "paint", bevel=0.08)
    b.box((1.2, 0.1, 0.6), (x, YF - 9.15, 5.4), "intake")
b.box((1.8, 1.8, 0.5), (0.0, YF - 12.5, 4.85), "paint_dark")
# 안테나 마스트 2 + 잠망경
b.cyl((-3.0, YF - 4.5, 4.6), (-3.0, YF - 4.5, 12.0), 0.08, segs=6, mat="metal")
b.cyl((3.0, YF - 5.0, 4.6), (3.0, YF - 5.0, 9.0), 0.12, segs=6, mat="metal")
b.box((0.2, 1.8, 0.1), (3.0, YF - 5.0, 8.4), "metal")
b.cyl((0.0, YF - 3.0, 4.6), (0.0, YF - 3.0, 5.6), 0.3, segs=8, mat="metal")
b.box((0.3, 0.2, 0.2), (0.0, YF - 2.75, 5.5), "canopy")
B.finish()
