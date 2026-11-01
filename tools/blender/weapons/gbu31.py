"""GBU-31(V)1 JDAM — Mk 84 2000 lb 폭탄 + JDAM 꼬리 키트 + 몸통 스트레이크. 길이 3.88 m, 지름 0.458 m.
러그 간격 30 in.

    blender -b --factory-startup -P tools/blender/weapons/gbu31.py -- public/models/gbu31.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("gbu31", length=3.88, diameter=0.458, lug_x=1.63, lug_h=0.035, segs=14, colors={"paint": C.OLIVE})
R = s.R
pts = [(0.0, 0.0, "metal"), (0.0, 0.03, "metal"), (0.06, 0.036, "paint")]
pts += C.ogive(0.06, 1.10, R, tip_r=0.04, n=6, cap=False)
pts += [(2.32, R, "paint")]
pts += C.ogive_tail(2.32, 0.78, R, 0.19, n=3)
# JDAM 꼬리 키트 (회색 원뿔대)
pts += [(3.10, 0.205, "paint_dark"), (3.88, 0.13, "paint_dark"), (3.88, 0.0, "paint_dark")]
s.body(pts, bands=[(0.55, 0.06, "band_he"), (2.52, 0.06, "band_he"),
                   (1.20, 0.06, "paint_dark"), (2.12, 0.06, "paint_dark")])
# 몸통 스트레이크 (JDAM 스트레이크 키트, 앞 띠에서 뒤 띠까지)
s.fins(1.22, [(0, 0), (0.075, 0.22), (0.075, 0.86), (0, 0.94)], t=0.012, t_tip=0.008, mat="paint_dark")
# 꼬리 조종면
s.fins(3.28, [(0, 0), (0.15, 0.26), (0.15, 0.50), (0, 0.54)], t=0.014, t_tip=0.008, mat="paint_dark",
       r_ref=0.19)
for x in (1.25, 2.01):
    s.hanger(x, "lug", length=0.06, width=0.03)
s.finish()
