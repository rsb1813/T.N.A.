"""R-33 (AA-9 Amos) — 길이 4.15 m, 지름 0.38 m, 꼬리날개 폭 1.18 m. 긴 시위 날개 + 큰 꼬리 조종면.

    blender -b --factory-startup -P tools/blender/weapons/r33.py -- public/models/r33.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("r33", length=4.15, diameter=0.38, lug_x=2.0, lug_h=0.035, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.98, R, tip_r=0.014, n=7, mat="radome")
pts += [(4.09, R, "paint")]
pts += C.nozzle_end(4.15, R * 0.93, 0.13, depth=0.08)
s.body(pts, bands=[(0.98, 0.012, "paint_dark"), (2.98, 0.01, "paint_dark")])
s.fins(1.78, [(0, 0), (0.24, 0.92), (0.24, 1.08), (0, 1.14)], t=0.020, t_tip=0.010)
s.fins(3.45, [(0, 0), (0.40, 0.36), (0.40, 0.55), (0, 0.65)], t=0.020, t_tip=0.008)
for x in (1.70, 2.30):
    s.hanger(x, "lug", length=0.06, width=0.03)
s.nozzle_empty()
s.finish()
