"""R-27R (AA-10 Alamo) — 길이 4.08 m, 지름 0.23 m, 날개폭 ~0.8 m.
앞쪽 작은 안정판, '나비' 모양 조종 날개(끝으로 갈수록 넓다), 보조익 달린 꼬리 날개.

    blender -b --factory-startup -P tools/blender/weapons/r27.py -- public/models/r27.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("r27", length=4.08, diameter=0.23, lug_x=1.95, segs=14, colors={"paint": C.WHITE})
R = s.R
pts = C.ogive(0.0, 0.66, R, tip_r=0.006, n=7, mat="radome")
pts += [(4.02, R, "paint")]
pts += C.nozzle_end(4.08, R * 0.92, 0.075, depth=0.06)
s.body(pts, bands=[(0.66, 0.01, "paint_dark"), (2.30, 0.01, "paint_dark")])
# 앞 안정판
s.fins(0.80, [(0, 0), (0.055, 0.20), (0.055, 0.24), (0, 0.27)], t=0.007, t_tip=0.004)
# 나비 날개: 뿌리 시위 짧고 끝 시위 길다
s.fins(1.15, [(0, 0), (0.285, -0.13), (0.285, 0.37), (0, 0.24)], t=0.012, t_tip=0.006)
# 꼬리 날개 + 보조익
s.fins(3.52, [(0, 0), (0.27, 0.30), (0.27, 0.47), (0, 0.52)], t=0.011, t_tip=0.005)
s.fins(3.99, [(0.15, 0.0), (0.27, 0.0), (0.27, 0.07), (0.15, 0.07)], t=0.007, t_tip=0.006,
       mat="paint_dark")
for x in (1.70, 2.20):
    s.hanger(x, "lug", length=0.06)
s.nozzle_empty()
s.finish()
