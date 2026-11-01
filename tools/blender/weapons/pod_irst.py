"""IRST 포드 (Legion 포드 + IRST21 급) — 길이 2.45 m, 지름 0.36 m.
둥근 앞머리에 큰 IR 유리 창, 원통 몸통, 꼬리 페어링, 위쪽 어댑터.

    blender -b --factory-startup -P tools/blender/weapons/pod_irst.py -- public/models/pod_irst.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
AD = 0.075
s = C.Store("pod_irst", length=2.45, diameter=0.36, lug_x=1.30, lug_h=AD, segs=18,
            colors={"paint": C.GULL_GREY})
R = s.R
pts = C.dome(0.0, 0.125, n=4)
pts += [(0.125, 0.125, "paint_dark"), (0.15, 0.142, "paint_dark")]
pts += [(0.15 + 0.32 * t, 0.142 + (R - 0.142) * (1 - (1 - t) ** 2), "paint") for t in (0.33, 0.66, 1.0)]
pts += [(2.0, R, "paint")]
pts += C.ogive_tail(2.0, 0.45, R, 0.07, n=4, mat="paint_dark")
pts += [(2.45, 0.0, "paint_dark")]
s.body(pts, bands=[(0.47, 0.01, "paint_dark"), (1.25, 0.008, "paint_dark")])
s.b.box((0.14, 1.05, AD - 0.012), (0, s.Y(1.30), s.zc + R + (AD - 0.012) / 2 - 0.01), "paint")
s.b.box((0.11, 0.92, 0.012), (0, s.Y(1.30), -0.006), "paint_dark")
# 냉각 공기 흡입구 (아래)
s.b.box((0.10, 0.22, 0.03), (0, s.Y(1.65), s.zc - R + 0.008), "paint_dark")
s.b.box((0.07, 0.01, 0.02), (0, s.Y(1.54) + 0.002, s.zc - R + 0.0), "intake")
for x in (1.12, 1.48):
    s.hanger(x, "block", length=0.05, width=0.04)
s.finish()
