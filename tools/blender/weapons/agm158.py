"""AGM-158 JASSM — 길이 4.27 m, 폭 ~0.55 m, 높이 ~0.45 m, 날개 펼침 폭 2.4 m.
스텔스 사다리꼴 단면(평평한 바닥, 옆 차인, 좁은 윗면), 아래에 붙은 전개 날개, 등쪽 수직 꼬리, 배쪽 흡입구.

전개 날개는 자식 노드 `wing_L` / `wing_R` (원점 = 회전축, 바닥 중앙). 모델은 펼친 상태
(접으려면 glTF Y 축 기준으로 각 날개를 뒤로 돌린다: wing_R +75°, wing_L -75°).

    blender -b --factory-startup -P tools/blender/weapons/agm158.py -- public/models/agm158.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
from mathutils import Vector

C.reset()
H_TOP = 0.22   # 축에서 윗면까지
s = C.Store("agm158", length=4.27, diameter=2 * H_TOP, lug_x=2.10, lug_h=0.03,
            colors={"paint": (0.30, 0.31, 0.32), "paint_dark": (0.10, 0.105, 0.11)})
ZB = -0.20      # 바닥
SEC = [(0.225, -0.20), (0.285, -0.075), (0.135, 0.22), (-0.135, 0.22), (-0.285, -0.075), (-0.225, -0.20)]


def sec(w, h, dz=0.0):
    """바닥은 평평하게 두고 폭 w, 높이 h 배율. dz: 바닥을 올림."""
    return [(sx * w, ZB + dz + (sz - ZB) * h) for sx, sz in SEC]


prof = [
    (0.0, sec(0.10, 0.10, 0.10)),
    (0.10, sec(0.34, 0.30, 0.06)),
    (0.32, sec(0.62, 0.55, 0.025)),
    (0.70, sec(0.86, 0.80, 0.008)),
    (1.15, sec(0.98, 0.96)),
    (1.55, sec(1.0, 1.0)),
    (3.35, sec(1.0, 1.0)),
    (3.85, sec(0.90, 0.80)),
    (4.27, sec(0.70, 0.52, 0.01)),
]
s.section_body(prof, ["canopy", "paint", "paint", "paint", "paint", "paint", "paint", "paint"],
               smooth=True, cap0="canopy", cap1="paint_dark")
s.outline = [(0.0, 0.03), (1.15, 0.24), (3.35, 0.24), (4.27, 0.15)]
# 배기구
s.b.box((0.22, 0.04, 0.07), (0, s.Y(4.27) - 0.012, s.zc + ZB + 0.06), "nozzle")
# 배쪽 흡입구 (작은 스쿱)
iz = s.zc + ZB
rings = []
for x, w, h in ((2.72, 0.18, 0.004), (2.86, 0.20, 0.05), (3.30, 0.20, 0.05), (3.55, 0.14, 0.004)):
    y = s.Y(x)
    rings.append([Vector((-w / 2, y, iz + 0.01)), Vector((w / 2, y, iz + 0.01)), Vector((w / 2, y, iz - h)),
                  Vector((-w / 2, y, iz - h))])
s.b.loft(rings, "paint", smooth=False, cap0="paint", cap1="paint")
s.b.box((0.17, 0.012, 0.042), (0, s.Y(2.86) + 0.004, iz - 0.024), "intake")
# 등쪽 수직 꼬리 (전개)
ztop = lambda x: s.zc + ZB + (0.22 - ZB) * (1.0 if x <= 3.35 else 1.0 - (1.0 - 0.80) * (x - 3.35) / 0.5)
x0, x1 = 3.62, 4.12
fin = [(x0, 0.0), (x1 - 0.12, 0.26), (x1 + 0.02, 0.26), (x1, 0.0)]
th = 0.018
pts = [Vector((0, s.Y(x), ztop(min(x, 3.85)) - 0.01 + h)) for x, h in fin]
s.b.prism([p - Vector((th / 2, 0, 0)) for p in pts], [p + Vector((th / 2, 0, 0)) for p in pts], "paint")
# 러그
for x in (1.72, 2.48):
    s.hanger(x, "lug", length=0.06, width=0.03)
# 전개 날개 (바닥 중앙 회전축, 위아래로 겹친 두 장)
SW = 12 * C.DEG
for name, side, z in (("wing_R", 1, s.zc + ZB - 0.014), ("wing_L", -1, s.zc + ZB - 0.040)):
    pivot = Vector((0.0, s.Y(2.05), z))
    b = s.child(name, pivot)
    span, c0, c1, thw = 1.18, 0.34, 0.20, 0.024
    d = Vector((side * math.cos(SW), -math.sin(SW), 0.0))
    f = Vector((0.0, 1.0, 0.0))
    root = pivot + f * 0.16
    pts = [root, root + d * span, root + d * span - f * c1, root - f * c0]
    b.prism([p - Vector((0, 0, thw / 2)) for p in pts], [p + Vector((0, 0, thw / 2)) for p in pts], "paint")
    b.cyl(pivot - Vector((0, 0, thw / 2 + 0.003)), pivot + Vector((0, 0, thw / 2 + 0.003)), 0.06, segs=10,
          mat="paint_dark")
s.finish()
