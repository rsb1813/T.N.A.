"""B61-12 전술 핵폭탄 — 길이 3.58 m, 지름 0.33 m. 둥근 코, 원통 몸통, 꼬리 유도 키트(날개 4).

    blender -b --factory-startup -P tools/blender/weapons/b61.py -- public/models/b61.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("b61", length=3.58, diameter=0.33, lug_x=1.60, lug_h=0.035,
            colors={"paint": (0.42, 0.43, 0.44), "paint_dark": (0.16, 0.165, 0.17)})
R = s.R
pts = C.power_nose(0.0, 0.52, R, k=0.45, n=6, mat="paint")
pts += [(2.55, R, "paint")]
pts += C.ogive_tail(2.55, 0.55, R, 0.125, n=4)
pts += [(3.10, 0.125, "paint_dark"), (3.58, 0.105, "paint_dark"), (3.58, 0.0, "paint_dark")]
s.body(pts, bands=[(0.52, 0.01, "paint_dark"), (0.95, 0.01, "paint_dark"), (2.20, 0.01, "paint_dark")])
s.fins(3.02, [(0, 0), (0.16, 0.30), (0.16, 0.48), (0, 0.54)], t=0.012, t_tip=0.007, mat="paint_dark",
       r_ref=0.15)
for x in (1.42, 1.78):
    s.hanger(x, "lug")
s.finish()
