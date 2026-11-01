"""R-73 (AA-11 Archer) — 길이 2.9 m, 지름 0.17 m, 날개폭 0.51 m.
IR 돔, 앞쪽 고정 안정판 + 카나드 조종면, 보조익 달린 꼬리 날개.

    blender -b --factory-startup -P tools/blender/weapons/r73.py -- public/models/r73.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("r73", length=2.9, diameter=0.17, lug_x=1.45, segs=14, colors={"paint": C.WHITE})
R = s.R
pts = C.dome(0.0, 0.052, n=4)
pts += [(0.052, 0.052, "paint_dark"), (0.075, 0.056, "paint"), (0.32, R, "paint"), (2.85, R, "paint")]
pts += C.nozzle_end(2.90, R * 0.93, 0.056, depth=0.05)
s.body(pts, bands=[(0.58, 0.008, "paint_dark"), (1.60, 0.008, "paint_dark")])
# 앞 고정 안정판(작은 삼각형) + 카나드
s.fins(0.10, [(0, 0), (0.03, 0.10), (0.03, 0.12), (0, 0.13)], t=0.005, t_tip=0.003)
s.fins(0.34, [(0, 0), (0.105, 0.075), (0.105, 0.165), (0, 0.20)], t=0.008, t_tip=0.004)
# 꼬리 날개 + 보조익
s.fins(2.26, [(0, 0), (0.17, 0.40), (0.17, 0.55), (0, 0.58)], t=0.010, t_tip=0.005)
s.fins(2.81, [(0.095, 0.0), (0.17, 0.0), (0.17, 0.065), (0.095, 0.065)], t=0.006, t_tip=0.005,
       mat="paint_dark")
for x in (1.05, 1.85):
    s.hanger(x, "rail", length=0.08)
s.nozzle_empty()
s.finish()
