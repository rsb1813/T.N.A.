"""AGM-65 Maverick (G/K) — 길이 2.49 m, 지름 0.305 m, 날개폭 0.72 m.
큰 둥근 유리 시커 돔, 몸통 대부분에 걸친 긴 시위 삼각익 + 바로 뒤 조종면.

    blender -b --factory-startup -P tools/blender/weapons/agm65.py -- public/models/agm65.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("agm65", length=2.49, diameter=0.305, lug_x=1.20, lug_h=0.035, colors={"paint": C.GULL_GREY})
R = s.R
pts = C.dome(0.0, 0.128, n=5)
pts += [(0.128, 0.128, "paint_dark"), (0.15, 0.142, "paint_dark"), (0.17, R, "paint"), (2.45, R, "paint")]
pts += C.nozzle_end(2.49, R * 0.95, 0.075, depth=0.06)
s.body(pts, bands=[(0.58, 0.035, "band_he"), (1.32, 0.035, "band_motor"), (1.98, 0.01, "paint_dark")])
# 긴 시위 삼각익 (앞전은 거의 몸통을 따라 누운 형태)
s.fins(0.92, [(0, 0), (0.21, 1.00), (0.21, 1.08), (0, 1.10)], t=0.016, t_tip=0.008)
# 조종면 (날개 바로 뒤)
s.fins(2.06, [(0, 0), (0.205, 0.10), (0.205, 0.33), (0, 0.38)], t=0.012, t_tip=0.006)
for x in (0.85, 1.55):
    s.hanger(x, "rail", length=0.09, width=0.03)
s.nozzle_empty()
s.finish()
