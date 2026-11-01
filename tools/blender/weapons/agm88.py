"""AGM-88E AARGM (HARM 계열) — 길이 4.17 m, 지름 0.254 m, 날개폭 1.12 m.
뾰족한 레이돔, 큰 이중 삼각 중간 날개(조종), 작은 고정 꼬리날개.

    blender -b --factory-startup -P tools/blender/weapons/agm88.py -- public/models/agm88.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("agm88", length=4.17, diameter=0.254, lug_x=2.08, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.78, R, tip_r=0.004, n=7, mat="radome")
pts += [(4.11, R, "paint")]
pts += C.nozzle_end(4.17, R * 0.92, 0.08, depth=0.06)
s.body(pts, bands=[(0.78, 0.012, "paint_dark"), (1.22, 0.035, "band_he"), (2.55, 0.035, "band_motor"),
                   ])
# 이중 삼각 중간 날개
s.fins(1.50, [(0, 0), (0.13, 0.26), (0.43, 0.53), (0.43, 0.66), (0, 0.72)], t=0.014, t_tip=0.006)
# 꼬리날개
s.fins(3.71, [(0, 0), (0.19, 0.22), (0.19, 0.36), (0, 0.41)], t=0.010, t_tip=0.005)
for x in (1.70, 2.46):
    s.hanger(x, "lug")
s.nozzle_empty()
s.finish()
