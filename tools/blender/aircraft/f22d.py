"""F-22D Raptor (F-22A 기반 가상 개량형) — 플레이어 기체 `f22d`.

    blender -b --factory-startup -P tools/blender/aircraft/f22d.py -- public/models/f22d.glb

길이 18.9 m, 폭 13.6 m. 다이아몬드 평면형 주익(앞전 42°, 뒷전 -17°), 차인 기수, 캐럿 흡입구,
바깥으로 28° 기운 쌍수직꼬리, 2D 추력편향 노즐, 닫힌 무장창(윤곽선), 프레임 없는 금빛 캐노피.
선택: opt_pylons (외부 날개 파일런 L1/L2/R1/R2 — 외부 무장을 달 때만 표시, 기본 숨김).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import aero  # noqa: E402
from aero import cut, gl, nose, sec  # noqa: E402

ac = aero.Aircraft("f22d", paint=(0.135, 0.145, 0.155), paint_dark=(0.085, 0.09, 0.10), canopy="gold", seed=22,
                   insignia=(0.075, 0.08, 0.085))

SILL = 0.56
CH = dict(chine=1.0)

# ------------------------------------------------------------------ 동체 (렌즈형 단면 + 옆 차인)
fus = nose(9.30, 2.6, 0.62, 0.40, 0.38, z=0.06, z_tip=-0.04, power=0.72, count=8, nt=2.3, nb=2.2, **CH) + [
    sec(5.90, 0.74, 0.50, 0.48, 0.06, nt=2.4, nb=2.4, **CH),
    sec(4.60, 0.84, 0.50, 0.55, 0.06, nt=2.6, nb=2.6, **CH),
    sec(3.30, 0.96, 0.52, 0.60, 0.05, nt=2.8, nb=3.0, chine=0.9),
    sec(1.80, 1.30, 0.66, 0.62, 0.04, nt=2.4, nb=3.4, chine=0.9),
    sec(0.20, 1.55, 0.60, 0.60, 0.03, nt=2.8, nb=3.6, chine=0.85),
    sec(-2.00, 1.68, 0.54, 0.56, 0.02, nt=3.2, nb=3.8, chine=0.85),
    sec(-4.40, 1.72, 0.48, 0.50, 0.02, nt=3.4, nb=3.8, chine=0.85),
    sec(-6.30, 1.62, 0.40, 0.42, 0.02, nt=3.4, nb=3.6, chine=0.85),
    sec(-7.40, 1.40, 0.32, 0.34, 0.02, nt=3.2, nb=3.4, chine=0.8),
]
ac.fuselage(fus, N=40, step=0.4)

# 꼬리붐 (스태빌레이터 지지, 노즐 바깥)
ac.pod([sec(-5.6, 0.0, 0.0, 0.0, 0.0, x=1.42), sec(-6.2, 0.22, 0.17, 0.17, 0.0, x=1.42, n=2.6, chine=0.6),
        sec(-8.9, 0.22, 0.15, 0.15, 0.0, x=1.42, n=2.6, chine=0.6), sec(-9.35, 0.0, 0.0, 0.0, 0.0, x=1.42)],
       side="both", N=16, step=0.6)

# 캐럿 흡입구: 평행사변형 입구, 평면에서 바깥쪽이 뒤로 / 측면에서 아래가 뒤로 기운 립
def caret(sx=1.0, sz=1.0):
    return [(-0.34 * sx, 0.40 * sz), (0.40 * sx, 0.40 * sz), (0.16 * sx, -0.46 * sz), (-0.34 * sx, -0.40 * sz)]


ac.intake([dict(y=3.40, x=1.22, z=-0.22, corners=caret()),
           dict(y=2.20, x=1.20, z=-0.22, corners=caret(1.02, 1.0)),
           dict(y=0.40, x=1.12, z=-0.20, corners=caret(1.04, 0.96)),
           dict(y=-1.80, x=0.98, z=-0.16, corners=caret(0.96, 0.88)),
           dict(y=-3.60, x=0.86, z=-0.12, corners=caret(0.8, 0.75))],
          shape="quad", side="both", N=24, lip=0.045, depth=1.5, slant=(-0.85, 0.45))

# ------------------------------------------------------------------ 주익 (다이아몬드, 하반각 3.25°)
WING = [dict(s=0.0, le=1.95, c=8.35, t=0.045), dict(s=5.30, le=-2.83, c=1.85, t=0.03)]
ac.wing(WING, x0=1.48, z0=0.02, dihedral=-3.25, airfoil="biconvex", m=10,
        cuts=[cut("flap", 0.45, 2.40, 0.80), cut("aileron", 2.55, 4.70, 0.78),
              cut("flap_le", 0.6, 5.15, 0.12, edge="le")])

# 수평꼬리 (전체 가동)
ac.wing([dict(s=0.0, le=-6.05, c=3.50, t=0.04), dict(s=2.85, le=-8.30, c=0.95, t=0.03)],
        x0=1.50, z0=0.0, airfoil="hex", m=7, part="elevator", pivot=dict(s=0.0, f=0.40))

# 수직꼬리 (바깥 28°) + 러더
ac.vtail([dict(s=0.0, le=-3.65, c=4.10, t=0.04), dict(s=3.10, le=-4.97, c=1.72, t=0.035)],
         x0=1.62, z0=0.30, cant=28.0, side="both", airfoil="biconvex", m=8,
         cuts=[cut("rudder", 0.25, 2.60, 0.68)])

# 2D 추력편향 노즐 (톱니 뒷전)
ac.nozzle_2d(x=0.66, z=0.0, y=-8.25, length=1.35, w=0.56, h_base=0.40, h_exit=0.21, side="both",
             serration=0.22)
ac.paint("paint_dark", x=(0.0, 1.3), y=(-7.6, -6.6), src=("paint",))

# ------------------------------------------------------------------ 캐노피 (프레임 없는 버블)
ac.canopy([dict(y=6.20, w=0.40, h=0.02, z=SILL), dict(y=5.85, w=0.54, h=0.36, z=SILL),
           dict(y=5.20, w=0.60, h=0.66, z=SILL), dict(y=4.40, w=0.61, h=0.78, z=SILL),
           dict(y=3.60, w=0.57, h=0.70, z=SILL + 0.02), dict(y=2.90, w=0.46, h=0.48, z=SILL + 0.06),
           dict(y=2.35, w=0.30, h=0.20, z=SILL + 0.14), dict(y=2.05, w=0.16, h=0.05, z=SILL + 0.22)],
          N=20, frames=[], sill=True, hinge=(0.0, 2.2, SILL + 0.2))
ac.seat(4.25, SILL - 0.04)
# 캐노피 뒤 등 융기
ac.fuselage([sec(3.2, 0.0, 0.0, 0.0, 0.52), sec(2.8, 0.32, 0.26, 0.12, 0.54, n=2.2),
             sec(1.9, 0.46, 0.34, 0.12, 0.56, n=2.4), sec(0.2, 0.50, 0.20, 0.12, 0.56, n=2.6),
             sec(-1.6, 0.40, 0.08, 0.12, 0.54, n=2.6), sec(-2.4, 0.0, 0.0, 0.0, 0.52)], N=20, step=0.4)

# ------------------------------------------------------------------ 무장창 (닫힌 문 윤곽) + 스테이션
zb = ac.surface_z(0.0, -1.0, z_from=-3.0)
ac.decal((0.0, -1.6, zb), (0, 0, -1), aero.shape_frame(1.25, 4.2, t=0.03, split=1, saw=3), up=(0, 1, 0),
         mat="paint_dark", rot=90)
for sx in (1, -1):
    ac.decal((1.30 * sx, 0.6, -0.55), (0.35 * sx, 0, -1), aero.shape_frame(0.45, 2.3, t=0.028, saw=2),
             up=(0, 1, 0), mat="paint_dark", rot=90)
ac.station("BAY_C", gl(0, -0.7, 0.5))
ac.station_pair("BAY_SL", "BAY_SR", gl(-1.2, -0.3, -1.0))

# 외부 파일런 (opt_pylons, 기본 숨김)
for sid, (x, y, z) in (("1", (4.2, -2.0, -0.4)), ("2", (2.6, -1.5, -0.5))):
    ac.pylon(x, y - 0.25, z, length=2.0, width=0.13, rake=0.3, part="opt_pylons")
    ac.station_pair("L" + sid, "R" + sid, (-x, y, z))

# ------------------------------------------------------------------ 마킹 / 기타
ac.insignia((1.48, 1.2, -0.10), (1, 0, 0.1), size=0.48, kind="star_bar", side="both")
ac.insignia((-4.1, -2.6, 0.02), (0, 0, 1), size=0.75, kind="star_bar", up=(0, 1, 0))
ac.insignia((4.1, -2.6, -0.06), (0, 0, -1), size=0.75, kind="star_bar", up=(0, 1, 0))
ac.decal((1.30, 1.75, 0.28), (0.25, 0, 1), aero.shape_frame(0.28, 0.7, t=0.025), up=(0, 1, 0),
         mat="paint_dark", rot=90)   # 기관포 문 (우측 날개뿌리)

ac.empty("gun", (1.30, 2.05, 0.30))
ac.empty("cockpit", (0.0, 4.15, SILL + 0.58))
ac.empty("wingtip_R", (6.78, -3.9, -0.28))
ac.empty("wingtip_L", (-6.78, -3.9, -0.28))

ac.finish()
