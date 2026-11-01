"""MBDA Meteor — 길이 3.65 m, 지름 0.178 m. 날개 없음, 아래 양옆 램제트 흡입구 2개, 꼬리 조종면 4장.

    blender -b --factory-startup -P tools/blender/weapons/meteor.py -- public/models/meteor.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("meteor", length=3.65, diameter=0.178, lug_x=1.75, segs=14, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.64, R, tip_r=0.005, n=7, mat="radome")
pts += [(3.61, R, "paint")]
pts += C.nozzle_end(3.65, R * 0.95, 0.072, depth=0.06)
s.body(pts, bands=[(0.64, 0.01, "paint_dark"), (1.05, 0.03, "band_he"), (1.55, 0.008, "paint_dark")])
# 램제트 흡입구 (아래 양옆)
for phi in (232, 308):
    s.duct(2.02, 3.08, phi, w=0.078, h=0.05, ramp=0.3)
# 꼬리 조종면
s.fins(3.20, [(0, 0), (0.118, 0.17), (0.118, 0.30), (0, 0.38)], t=0.009, t_tip=0.005)
for x in (1.57, 1.93):
    s.hanger(x, "lug", length=0.05)
s.nozzle_empty()
s.finish()
