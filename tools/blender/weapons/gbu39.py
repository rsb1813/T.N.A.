"""GBU-39/B SDB (소형 정밀 유도 폭탄) — 길이 1.80 m, 단면 둥근 사각 0.19 m, 'Diamond Back' 날개 펼침 폭 1.38 m.

전개 날개는 따로 움직일 수 있게 자식 노드 `wing_L` / `wing_R` (원점 = 회전축, 위 중앙)로 둔다.
모델은 펼친 상태. 랙에 실린 상태로 보이려면 게임에서 각 날개를 위축(glTF Y) 기준으로 돌려 몸통과 나란히 접는다
(wing_R: +65°, wing_L: -65° 정도).

    blender -b --factory-startup -P tools/blender/weapons/gbu39.py -- public/models/gbu39.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
from mathutils import Vector

C.reset()
A = 0.095  # 단면 반폭
s = C.Store("gbu39", length=1.80, diameter=2 * A, lug_x=0.90, lug_h=0.03, colors={"paint": C.GULL_GREY})


def squircle(scale, n=12, p=4.0):
    out = []
    for k in range(n):
        a = math.pi / 2 + 2 * math.pi * k / n
        c, si = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2 / p), c) * A * scale
        z = math.copysign(abs(si) ** (2 / p), si) * A * scale
        out.append((x, z))
    return out


prof = [(0.0, 0.0), (0.05, 0.22), (0.14, 0.48), (0.27, 0.72), (0.42, 0.90), (0.58, 0.985), (0.70, 1.0),
        (1.64, 1.0), (1.80, 0.84)]
secs = [(x, squircle(k) if k > 0 else [(0.0, 0.0)]) for x, k in prof]
mats = ["paint_dark", "paint", "paint", "paint", "paint", "paint", "paint", "paint"]
s.section_body(secs, mats, smooth=True, cap1="paint_dark")
s.outline = [(x, k * A * 1.12) for x, k in prof]
# 노란 띠 (얇은 고리판)
for x in (0.36,):
    k = 0.82
    ring = [(sx * 1.01, sz * 1.01) for sx, sz in squircle(k)]
    s.section_body([(x, ring), (x + 0.025, [(sx * 1.01, sz * 1.01) for sx, sz in squircle(0.86)])],
                   "band_he", smooth=True)
# 꼬리 날개 (X)
s.fins(1.53, [(0, 0), (0.085, 0.13), (0.085, 0.24), (0, 0.27)], t=0.008, t_tip=0.005)
# 날개 허브 + 러그
top = s.zc + A
s.b.box((0.11, 0.24, 0.012), (0, s.Y(0.90), top + 0.004), "paint_dark")
for x in (0.72, 1.08):
    s.hanger(x, "lug", length=0.04, width=0.02)
# 펼친 Diamond Back 날개 (위아래로 겹친 두 장, 뒤로 25° 후퇴)
SW = 25 * C.DEG
for name, side, z in (("wing_R", 1, top + 0.016), ("wing_L", -1, top + 0.028)):
    pivot = Vector((0.0, s.Y(0.90), z))
    b = s.child(name, pivot)
    span, c0, c1, th = 0.69, 0.10, 0.075, 0.011
    d = Vector((side * math.cos(SW), -math.sin(SW), 0.0))     # 날개 방향 (바깥, 뒤)
    f = Vector((0.0, 1.0, 0.0))                               # 앞
    root = pivot + f * 0.03
    pts = [root + f * 0.0, root + d * span, root + d * span - f * c1, root - f * c0]
    lo = [p - Vector((0, 0, th / 2)) for p in pts]
    hi = [p + Vector((0, 0, th / 2)) for p in pts]
    b.prism(lo, hi, "paint")
    b.cyl(pivot - Vector((0, 0, th / 2 + 0.002)), pivot + Vector((0, 0, th / 2 + 0.002)), 0.03, segs=8, mat="metal")
s.finish()
