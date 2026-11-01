"""단거리 지대공 미사일 (Tor 9M331 / Rapier 급) — 길이 2.9 m, 지름 0.235 m.
앞쪽 카나드 조종면 + 펼친 꼬리 날개.

    blender -b --factory-startup -P tools/blender/weapons/sam_small.py -- public/models/sam_small.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("sam_small", length=2.9, diameter=0.235, lug_x=1.45, lug_h=0.03, segs=14,
            colors={"paint": (0.30, 0.34, 0.27), "radome": (0.36, 0.38, 0.35)})
R = s.R
pts = C.ogive(0.0, 0.48, R, tip_r=0.012, n=6, mat="radome")
pts += [(2.85, R, "paint")]
pts += C.nozzle_end(2.90, R * 0.92, 0.08, depth=0.06)
s.body(pts, bands=[(0.48, 0.01, "paint_dark"), (0.98, 0.03, "band_he"), (1.60, 0.01, "paint_dark")])
s.fins(0.56, [(0, 0), (0.12, 0.10), (0.12, 0.21), (0, 0.25)], t=0.010, t_tip=0.006)
s.fins(2.38, [(0, 0), (0.205, 0.12), (0.205, 0.44), (0, 0.48)], t=0.010, t_tip=0.007)
for x in (1.15, 1.75):
    s.hanger(x, "block", length=0.06, width=0.035)
s.nozzle_empty()
s.finish()
