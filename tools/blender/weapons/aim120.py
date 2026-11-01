"""AIM-120D AMRAAM — 길이 3.65 m, 지름 0.178 m, 날개/조종면 폭 0.447 m (C/D 형 '잘린' 날개).

    blender -b --factory-startup -P tools/blender/weapons/aim120.py -- public/models/aim120.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("aim120", length=3.65, diameter=0.178, lug_x=1.83, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.53, R, tip_r=0.006, n=7, mat="radome")
pts += [(0.53, R, "paint"), (3.58, R, "paint"), (3.65, R * 0.93, "paint")]
pts += C.nozzle_end(3.65, R * 0.93, 0.056)
s.body(pts, bands=[(0.53, 0.012, "paint_dark"), (1.13, 0.03, "band_he"), (1.98, 0.03, "band_motor"),
                   (2.92, 0.008, "paint_dark")])
# 중간 날개 (잘린 삼각익) / 꼬리 조종면
s.fins(1.42, [(0, 0), (0.118, 0.255), (0.118, 0.33), (0, 0.33)], t=0.010, t_tip=0.005)
s.fins(3.30, [(0, 0), (0.135, 0.15), (0.135, 0.27), (0, 0.30)], t=0.010, t_tip=0.005)
for x in (1.02, 1.83, 2.78):
    s.hanger(x, "rail")
s.nozzle_empty()
s.finish()
