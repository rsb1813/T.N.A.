"""중거리 지대공 미사일 (Buk 9M38M1 급) — 길이 5.55 m, 지름 0.40 m, 날개폭 0.86 m.
긴 시위·낮은 종횡비 날개 + 꼬리 조종면.

    blender -b --factory-startup -P tools/blender/weapons/sam_medium.py -- public/models/sam_medium.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("sam_medium", length=5.55, diameter=0.40, lug_x=2.80, lug_h=0.04, segs=16,
            colors={"paint": (0.48, 0.52, 0.47), "radome": (0.40, 0.42, 0.40)})
R = s.R
pts = C.ogive(0.0, 1.10, R, tip_r=0.012, n=7, mat="radome")
pts += [(5.48, R, "paint")]
pts += C.nozzle_end(5.55, R * 0.92, 0.15, depth=0.1)
s.body(pts, bands=[(1.10, 0.015, "paint_dark"), (1.55, 0.04, "band_he"), (4.62, 0.015, "paint_dark")])
s.fins(2.40, [(0, 0), (0.23, 0.80), (0.23, 1.85), (0, 2.05)], t=0.022, t_tip=0.012)
s.fins(4.74, [(0, 0), (0.30, 0.33), (0.30, 0.62), (0, 0.74)], t=0.022, t_tip=0.010)
for x in (2.4, 3.2):
    s.hanger(x, "block", length=0.1, width=0.05)
s.nozzle_empty()
s.finish()
