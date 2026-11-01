"""AIM-7M Sparrow — 길이 3.66 m, 지름 0.203 m, 날개폭 1.0 m. 큰 중간 삼각익(조종) + 고정 꼬리날개.

    blender -b --factory-startup -P tools/blender/weapons/aim7.py -- public/models/aim7.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("aim7", length=3.66, diameter=0.203, lug_x=1.86, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.62, R, tip_r=0.007, n=7, mat="radome")
pts += [(3.60, R, "paint")]
pts += C.nozzle_end(3.66, R * 0.93, 0.068)
s.body(pts, bands=[(0.62, 0.01, "paint_dark"), (1.98, 0.035, "band_he"), (2.40, 0.035, "band_motor"),
                   (3.12, 0.008, "paint_dark")])
s.fins(1.20, [(0, 0), (0.395, 0.47), (0.395, 0.53), (0, 0.56)], t=0.012, t_tip=0.005)
s.fins(3.20, [(0, 0), (0.30, 0.32), (0.30, 0.39), (0, 0.42)], t=0.010, t_tip=0.005)
for x in (1.48, 2.24):
    s.hanger(x, "lug")
s.nozzle_empty()
s.finish()
