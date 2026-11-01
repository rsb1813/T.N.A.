"""AIM-132 ASRAAM — 길이 2.9 m, 지름 0.166 m, 꼬리날개 폭 0.45 m. 큰 IR 돔, 중간 날개 없음.

    blender -b --factory-startup -P tools/blender/weapons/asraam.py -- public/models/asraam.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("asraam", length=2.9, diameter=0.166, lug_x=1.42, segs=14, colors={"paint": C.WHITE})
R = s.R
pts = C.dome(0.0, 0.066, n=4)
pts += [(0.066, 0.066, "paint_dark"), (0.085, 0.068, "paint"), (0.22, R, "paint"), (2.86, R, "paint")]
pts += C.nozzle_end(2.90, R * 0.93, 0.054, depth=0.05)
s.body(pts, bands=[(0.88, 0.025, "band_he"), (1.22, 0.025, "band_motor")])
s.fins(2.44, [(0, 0), (0.142, 0.21), (0.142, 0.35), (0, 0.42)], t=0.009, t_tip=0.005)
for x in (0.82, 1.42, 2.12):
    s.hanger(x, "rail", length=0.07, width=0.02)
s.nozzle_empty()
s.finish()
