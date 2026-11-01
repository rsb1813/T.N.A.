"""표적 지시 포드 (AN/AAQ-33 Sniper 급) — 길이 2.39 m, 지름 0.30 m.
각진 회전 머리(유리 창), 원통 몸통, 뒤쪽 냉각부, 위쪽 어댑터 + 러그.

    blender -b --factory-startup -P tools/blender/weapons/pod_targeting.py -- public/models/pod_targeting.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
AD = 0.075  # 어댑터 높이
s = C.Store("pod_targeting", length=2.39, diameter=0.30, lug_x=1.30, lug_h=AD, segs=16,
            colors={"paint": C.GULL_GREY})
R = s.R


def octa(scale, dz=0.0):
    n = 8
    out = []
    for k in range(n):
        a = math.pi / 2 + math.pi / n + 2 * math.pi * k / n
        out.append((math.cos(a) * R * scale / math.cos(math.pi / n), math.sin(a) * R * scale / math.cos(math.pi / n) + dz))
    return out


# 각진 머리: 8 면 각뿔 → 8 각 기둥. 아래쪽 앞면 다섯 장이 유리.
secs = [(0.0, [(0.0, -0.02)] * 1), (0.22, octa(0.62, -0.012)), (0.42, octa(0.96)), (0.52, octa(0.97))]


def glass(i, j):
    # 면 j: 0 = 왼쪽 위, 1 = 왼쪽, 2 = 왼쪽 아래, 3 = 아래, 4 = 오른쪽 아래, 5 = 오른쪽, 6 = 오른쪽 위, 7 = 위.
    # 끝쪽 구간은 위 3 면을 뺀 전부, 둘째 구간은 아래 3 면이 창.
    if (i == 0 and 1 <= j <= 5) or (i == 1 and 2 <= j <= 4):
        return "canopy"
    return None


rings = []
for x, sec in secs:
    rings.append([C.Vector((sx, s.Y(x), s.zc + sz)) for sx, sz in sec])
s.b.loft(rings, ["paint_dark", "paint_dark", "paint_dark"], smooth=False, cap1="paint_dark", mat_fn=glass)
# 몸통 (회전 이음부 띠 + 원통 + 꼬리)
pts = [(0.52, 0.0, "paint_dark"), (0.52, R * 0.96, "paint_dark"), (0.56, R * 0.96, "metal"), (0.58, R, "paint"),
       (1.95, R, "paint"), (2.10, R * 0.97, "paint_dark")]
pts += C.ogive_tail(2.10, 0.29, R * 0.97, 0.09, n=3, mat="paint_dark")
pts += [(2.39, 0.0, "paint_dark")]
s.body(pts, bands=[(1.15, 0.008, "paint_dark")])
s.outline = [(0.0, 0.0), (0.42, R), (2.39, 0.09)]
# 위쪽 어댑터 (러그 두 개)
s.b.box((0.13, 1.05, AD - 0.012), (0, s.Y(1.30), s.zc + R + (AD - 0.012) / 2 - 0.01), "paint")
s.b.box((0.10, 0.92, 0.012), (0, s.Y(1.30), -0.006), "paint_dark")
# 아래 접근 패널 띠
s.b.box((0.12, 0.6, 0.02), (0, s.Y(1.5), s.zc - R + 0.005), "paint_dark")
for x in (1.12, 1.48):
    s.hanger(x, "block", length=0.05, width=0.04)
s.finish()
