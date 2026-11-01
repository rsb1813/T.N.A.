"""대형 지대공 미사일 (S-300PMU 48N6 / 5V55 급) — 길이 7.5 m, 지름 0.515 m. 긴 오자이브 코, 꼬리 조종면 4장.
원점 = 위쪽 중앙(발사 슈 위치).

    blender -b --factory-startup -P tools/blender/weapons/sam_large.py -- public/models/sam_large.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("sam_large", length=7.5, diameter=0.515, lug_x=3.75, lug_h=0.04, segs=16,
            colors={"paint": (0.66, 0.67, 0.66), "radome": (0.55, 0.55, 0.52)})
R = s.R
pts = C.ogive(0.0, 1.95, R, tip_r=0.018, n=8, mat="radome")
pts += [(7.38, R, "paint")]
pts += C.nozzle_end(7.5, R * 0.9, 0.20, depth=0.12)
s.body(pts, bands=[(1.95, 0.02, "paint_dark"), (3.05, 0.02, "paint_dark"), (6.55, 0.02, "paint_dark"),
                   (2.35, 0.05, "band_he")])
# 꼬리 조종면
s.fins(6.70, [(0, 0), (0.34, 0.30), (0.34, 0.60), (0, 0.72)], t=0.030, t_tip=0.014)
# 작은 공력 스트레이크(앞쪽, 접이식 안정판)
s.fins(5.70, [(0, 0), (0.07, 0.25), (0.07, 0.55), (0, 0.65)], t=0.02, t_tip=0.012, phis=C.PLUS_FINS)
for x in (3.0, 4.5):
    s.hanger(x, "block", length=0.12, width=0.06)
s.nozzle_empty()
s.finish()
