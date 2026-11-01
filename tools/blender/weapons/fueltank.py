"""외부 연료 탱크 (파일런 장착, 480 gal 급) — 길이 5.2 m, 지름 0.74 m. 러그 간격 30 in.

    blender -b --factory-startup -P tools/blender/weapons/fueltank.py -- public/models/fueltank.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("fueltank", length=5.2, diameter=0.74, lug_x=2.45, lug_h=0.04, segs=16,
            colors={"paint": C.GULL_GREY})
R = s.R
pts = C.ogive(0.0, 1.75, R, tip_r=0.035, n=6)
pts += [(3.10, R, "paint")]
pts += C.ogive_tail(3.10, 2.10, R, 0.05, n=6)
pts += [(5.2, 0.0, "paint_dark")]
s.body(pts, bands=[(1.75, 0.012, "paint_dark"), (3.10, 0.012, "paint_dark")])
# 작은 꼬리 안정판 2장 (수평)
s.fins(4.30, [(0, 0), (0.10, 0.30), (0.10, 0.44), (0, 0.50)], phis=(0, 180), t=0.012, t_tip=0.008)
# 급유구 캡, 흔들림 방지 패드
top = s.zc + R
s.b.cyl((0, s.Y(1.15), top - 0.02), (0, s.Y(1.15), top + 0.012), 0.05, segs=10, mat="metal")
for x in (2.07, 2.83):
    for sx in (-1, 1):
        s.b.box((0.10, 0.12, 0.03), (sx * 0.15, s.Y(x), top - 0.004), "paint_dark")
for x in (2.07, 2.83):
    s.hanger(x, "lug", length=0.06, width=0.03)
s.finish()
