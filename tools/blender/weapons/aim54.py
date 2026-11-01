"""AIM-54C Phoenix — 길이 3.96 m, 지름 0.38 m, 날개폭 0.91 m. 긴 시위의 낮은 날개 + 꼬리 조종면.

    blender -b --factory-startup -P tools/blender/weapons/aim54.py -- public/models/aim54.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("aim54", length=3.96, diameter=0.38, lug_x=1.98, lug_h=0.035, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.88, R, tip_r=0.02, n=7, mat="radome")
pts += [(3.90, R, "paint")]
pts += C.nozzle_end(3.96, R * 0.94, 0.12, depth=0.08)
s.body(pts, bands=[(0.88, 0.012, "paint_dark"), (1.02, 0.045, "band_he"), (2.62, 0.045, "band_motor"),
                   (3.22, 0.01, "paint_dark")])
# 긴 시위 날개 (스트레이크형)
s.fins(1.20, [(0, 0), (0.265, 1.02), (0.265, 1.26), (0, 1.30)], t=0.020, t_tip=0.010)
# 꼬리 조종면
s.fins(3.32, [(0, 0), (0.27, 0.33), (0.27, 0.53), (0, 0.60)], t=0.018, t_tip=0.008)
for x in (1.60, 2.36):
    s.hanger(x, "lug", length=0.06, width=0.03)
s.nozzle_empty()
s.finish()
