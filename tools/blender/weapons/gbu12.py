"""GBU-12 Paveway II — Mk 82 500 lb 폭탄 + 레이저 시커(링 달린 '새' 머리) + 카나드 + 펼친 꼬리 날개.
길이 3.27 m, 지름 0.273 m, 날개폭 ~1.1 m. 러그 간격 14 in.

    blender -b --factory-startup -P tools/blender/weapons/gbu12.py -- public/models/gbu12.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

C.reset()
s = C.Store("gbu12", length=3.27, diameter=0.273, lug_x=1.90, lug_h=0.035, segs=14,
            colors={"paint": C.OLIVE})
R = s.R
# 시커 머리 (유리 돔 + 원통) → 유도 조종부(CCG) → Mk 82 오자이브 코 → 몸통 → 꼬리 날개 키트
pts = C.dome(0.0, 0.056, n=3)
pts += [(0.056, 0.056, "paint_dark"), (0.25, 0.062, "paint_dark"), (0.25, 0.098, "paint"), (0.86, 0.104, "paint"),
        (0.86, 0.075, "paint")]
pts += C.ogive(0.62, 0.66, R, tip_r=0.075, n=4, cap=False)[1:]
pts += [(2.48, R, "paint")]
pts += C.ogive_tail(2.48, 0.38, R, 0.10, n=3)
pts += [(3.27, 0.092, "paint_dark"), (3.27, 0.0, "paint_dark")]
s.body(pts, bands=[(1.30, 0.04, "band_he"), (2.86, 0.41, "paint_dark")])
# 시커 링 + 지지대
s.ring_tube(0.09, 0.175, 0.085, 0.094, mat="paint_dark", segs=12)
s.fins(0.10, [(0, 0), (0.032, 0.0), (0.032, 0.06), (0, 0.06)], t=0.006, t_tip=0.006, mat="paint_dark",
       r_ref=0.056)
# 카나드
s.fins(0.33, [(0, 0), (0.17, 0.20), (0.17, 0.35), (0, 0.38)], t=0.010, t_tip=0.006)
# 펼친 꼬리 날개 (접이식)
s.fins(2.84, [(0, 0), (0.44, 0.10), (0.44, 0.40), (0, 0.43)], t=0.008, t_tip=0.006, mat="paint_dark",
       r_ref=0.10)
for x in (1.72, 2.08):
    s.hanger(x, "lug")
s.finish()
