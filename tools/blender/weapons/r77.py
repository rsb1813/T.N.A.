"""R-77 (RVV-AE, AA-12 Adder) — 길이 3.6 m, 지름 0.2 m. 짧은 폭·긴 시위 날개, 꼬리 격자 날개 4장.

    blender -b --factory-startup -P tools/blender/weapons/r77.py -- public/models/r77.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("r77", length=3.6, diameter=0.2, lug_x=1.85, segs=12, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.56, R, tip_r=0.006, n=6, mat="radome")
pts += [(3.38, R, "paint"), (3.60, R * 0.80, "paint")]
pts += C.nozzle_end(3.60, R * 0.80, 0.062, depth=0.05)
s.body(pts, bands=[(0.56, 0.01, "paint_dark")])
# 짧은 폭·긴 시위 날개
s.fins(1.05, [(0, 0), (0.072, 0.32), (0.072, 1.08), (0, 1.18)], t=0.010, t_tip=0.006)
# 격자 날개
s.grid_fins(3.40, span=0.215, width=0.19, depth=0.045, n=3, slat_t=0.007, slat_mat="paint")
for x in (1.15, 1.85, 2.75):
    s.hanger(x, "rail", length=0.08)
s.nozzle_empty()
s.finish()
