"""Mk 82 LDGP 500 lb 일반 폭탄 (원뿔형 꼬리날개 BSU-33) — 길이 2.21 m, 지름 0.273 m. 러그 간격 14 in.

    blender -b --factory-startup -P tools/blender/weapons/mk82.py -- public/models/mk82.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("mk82", length=2.21, diameter=0.273, lug_x=1.0, lug_h=0.035, colors={"paint": C.OLIVE})
R = s.R
pts = [(0.0, 0.0, "metal"), (0.0, 0.022, "metal"), (0.045, 0.026, "paint")]
pts += C.ogive(0.045, 0.62, R, tip_r=0.03, n=6, cap=False)
pts += [(1.42, R, "paint")]
pts += C.ogive_tail(1.42, 0.40, R, 0.095, n=3)
pts += [(2.21, 0.072, "paint_dark"), (2.21, 0.0, "paint_dark")]
s.body(pts, bands=[(0.30, 0.04, "band_he"), (1.48, 0.04, "band_he")])
# 원뿔형 꼬리 날개 (바깥 모서리가 뒤로 갈수록 넓어진다)
s.fins(1.80, [(0, 0), (0.022, 0.0), (0.098, 0.37), (0.098, 0.41), (0, 0.41)], t=0.006, t_tip=0.006,
       mat="paint")
for x in (0.82, 1.18):
    s.hanger(x, "lug")
s.finish()
