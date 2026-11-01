"""AGM-84D Harpoon (공중 발사형) — 길이 3.84 m, 지름 0.343 m, 날개폭 0.91 m.
둥근 레이돔, 중간 십자 날개, 꼬리 조종면, 배 쪽 터보제트 흡입구.

    blender -b --factory-startup -P tools/blender/weapons/agm84.py -- public/models/agm84.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("agm84", length=3.84, diameter=0.343, lug_x=1.93, lug_h=0.035, colors={"paint": C.WHITE})
R = s.R
pts = C.power_nose(0.0, 0.50, R, k=0.5, n=6, mat="radome")
pts += [(3.66, R, "paint"), (3.84, R * 0.78, "paint")]
pts += C.nozzle_end(3.84, R * 0.78, 0.085, depth=0.07)
s.body(pts, bands=[(0.50, 0.012, "paint_dark"), (1.02, 0.04, "band_he"), (1.62, 0.01, "paint_dark"),
                   (3.18, 0.01, "paint_dark")])
s.fins(1.70, [(0, 0), (0.285, 0.33), (0.285, 0.52), (0, 0.56)], t=0.016, t_tip=0.007)
s.fins(3.30, [(0, 0), (0.25, 0.24), (0.25, 0.43), (0, 0.48)], t=0.014, t_tip=0.006)
s.duct(2.32, 3.10, 270, w=0.17, h=0.075, ramp=0.35, lip=0.012, depth=0.06)
for x in (1.55, 2.31):
    s.hanger(x, "lug", length=0.06, width=0.03)
s.nozzle_empty()
s.finish()
