"""AIM-9X Sidewinder Block II — 길이 3.02 m, 지름 0.127 m, 꼬리 조종면 폭 ~0.36 m.
IR 유리 돔, 작은 고정 전방 날개, 꼬리 조종면(+추력편향 베인).

    blender -b --factory-startup -P tools/blender/weapons/aim9x.py -- public/models/aim9x.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("aim9x", length=3.02, diameter=0.127, lug_x=1.48, lug_h=0.03, colors={"paint": C.WHITE})
R = s.R
pts = C.dome(0.0, 0.046, n=4)
pts += [(0.046, 0.046, "paint_dark"), (0.07, 0.05, "paint"), (0.20, R * 0.97, "paint"), (0.30, R, "paint"),
        (2.97, R, "paint")]
pts += C.nozzle_end(3.02, R * 0.94, 0.042, depth=0.05)
s.body(pts, bands=[(0.92, 0.025, "band_he"), (1.28, 0.025, "band_motor"), (0.62, 0.006, "paint_dark")])
# 고정 전방 날개(작음)
s.fins(0.40, [(0, 0), (0.032, 0.09), (0.032, 0.15), (0, 0.17)], t=0.006, t_tip=0.004)
# 꼬리 조종면
s.fins(2.62, [(0, 0), (0.116, 0.165), (0.116, 0.255), (0, 0.33)], t=0.008, t_tip=0.004)
# 추력편향 베인 (노즐 출구 뒤)
s.fins(2.995, [(0, 0), (0.012, 0), (0.012, 0.045), (0, 0.045)], phis=C.X_FINS, t=0.004,
       r_ref=0.03, mat="metal", embed=0.5)
for x in (0.86, 1.48, 2.32):
    s.hanger(x, "rail", length=0.07, width=0.02)
s.nozzle_empty()
s.finish()
