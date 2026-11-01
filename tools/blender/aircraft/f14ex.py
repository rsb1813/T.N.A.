"""F-14EX Tomcat (F-14D / Super Tomcat 21 계열 가상 개량형, 복좌) — 플레이어 기체 `f14ex`.

    blender -b --factory-startup -P tools/blender/aircraft/f14ex.py -- public/models/f14ex.glb

길이 19.1 m, 폭 19.5 m(20° 전개) / 11.6 m(68° 후퇴). 가변익: wing_L / wing_R 노드의 원점이 글러브 안의
회전축이고, 로컬 수직축(glTF Y) 회전으로 후퇴한다 (wing_L: +각, wing_R: -각; 20°→68° 이면 ±48°).
플랩/슬랫/날개끝 empty 는 wing_* 의 자식이라 함께 움직인다.
넓게 벌어진 나셀 사이의 평평한 터널(TUNNEL_1~4), 글러브 파일런(GLOVE_*), 나셀 하부(NAC_*).
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import aero  # noqa: E402
from aero import cut, gl, nose, sec  # noqa: E402

ac = aero.Aircraft("f14ex", paint=(0.24, 0.255, 0.27), paint_dark=(0.11, 0.12, 0.13), canopy="clear", seed=14,
                   metal=(0.32, 0.30, 0.28))

SILL = 0.62
PIVOT = (2.71, -1.30, 0.32)   # 오른쪽 날개 회전축 (Blender)

# ------------------------------------------------------------------ 앞동체
fore = nose(9.55, 2.25, 0.60, 0.58, 0.58, z=0.14, z_tip=0.0, power=0.58, count=8) + [
    sec(6.90, 0.66, 0.52, 0.64, 0.12, nb=2.4),
    sec(5.60, 0.72, 0.50, 0.68, 0.12, nb=2.8, nt=2.4),
    sec(4.40, 0.78, 0.52, 0.70, 0.12, nb=3.0, nt=2.4),
    sec(3.20, 0.84, 0.56, 0.68, 0.10, nb=3.2, nt=2.4),
    sec(2.00, 0.92, 0.66, 0.62, 0.06, nb=3.4, nt=2.2),
    sec(0.50, 1.00, 0.46, 0.55, 0.02, nb=3.6, nt=3.0),
    sec(-1.20, 0.95, 0.40, 0.50, 0.02, nb=3.6, nt=3.4),
]
ac.fuselage(fore, N=32, step=0.42)
# 턱 아래 IRST/TCS 듀얼 포드
ac.fuselage([sec(7.55, 0.0, 0.0, 0.0, -0.52), sec(7.40, 0.10, 0.10, 0.10, -0.52), sec(7.15, 0.17, 0.16, 0.14, -0.50),
             sec(6.45, 0.17, 0.16, 0.14, -0.48), sec(6.10, 0.0, 0.0, 0.0, -0.42)], N=16, step=0.3)
ac.fuselage([sec(7.62, 0.0, 0.0, 0.0, -0.52), sec(7.58, 0.08, 0.08, 0.08, -0.52), sec(7.50, 0.10, 0.10, 0.10, -0.52),
             sec(7.46, 0.0, 0.0, 0.0, -0.52)], N=12, mat="canopy")

# 팬케이크(중앙 동체) — 나셀 사이 넓고 평평한 윗면, 아래는 터널 천장
ac.fuselage([sec(3.0, 0.0, 0.0, 0.0, 0.10), sec(2.4, 0.80, 0.30, 0.55, 0.10, n=4),
             sec(0.5, 1.15, 0.36, 0.60, 0.08, n=5), sec(-3.5, 1.25, 0.36, 0.62, 0.08, n=5),
             sec(-6.5, 1.15, 0.30, 0.55, 0.06, n=5), sec(-7.8, 0.95, 0.20, 0.35, 0.05, n=5)], N=28, step=0.5)
# 비버테일 (노즐 사이 납작한 꼬리) + 위 스피드브레이크
ac.wing([dict(s=0.0, le=-6.4, c=2.75, t=0.06), dict(s=0.62, le=-6.6, c=2.40, t=0.06)],
        x0=0.0, z0=0.05, side="both", airfoil="hex", m=5)
zt = ac.surface_z(0.0, -7.6, z_from=2.0, up=False)
ac.part("airbrake", (0.0, -7.05, zt + 0.01), [[-1, 0, 0], [0, -1, 0], [0, 0, 1]])
ac.box((0.0, -7.75, zt + 0.02), (0.95, 1.4, 0.04), part="airbrake", taper=(0.85, 1.0))

# ------------------------------------------------------------------ 흡입구 + 나셀 (넓게 벌어짐)
NAC = [dict(y=3.75, x=1.62, z=-0.36, w=0.43, ht=0.60, hb=0.56, n=5.0),
       dict(y=2.40, x=1.62, z=-0.36, w=0.47, ht=0.62, hb=0.60, n=4.6),
       dict(y=0.0, x=1.58, z=-0.34, w=0.55, ht=0.62, hb=0.62, n=3.6),
       dict(y=-3.0, x=1.48, z=-0.32, w=0.60, ht=0.62, hb=0.62, n=2.8),
       dict(y=-5.6, x=1.40, z=-0.30, w=0.58, ht=0.58, hb=0.58, n=2.3),
       dict(y=-7.55, x=1.36, z=-0.30, w=0.52, ht=0.52, hb=0.52, n=2.0)]
ac.intake(NAC, side="both", N=28, lip=0.06, depth=1.6, slant=(0.0, 0.62), duct_scale=0.85)
ac.nozzle(x=1.36, z=-0.30, y=-8.85, length=1.30, r_base=0.52, r_exit=0.46, petals=15, side="both")
ac.paint("metal", x=(0.8, 2.0), y=(-7.6, -6.6), src=("paint",))

# ------------------------------------------------------------------ 글러브 (고정, 67° 앞전) — 날개 뿌리를 덮는다
ac.wing([dict(s=0.0, le=4.60, c=10.4, t=0.032), dict(s=1.2, le=1.77, c=7.4, t=0.045),
         dict(s=2.10, le=-0.35, c=4.10, t=0.085)], x0=0.85, z0=0.32, m=10, airfoil="naca", side="both")

# ------------------------------------------------------------------ 가변익 (20° 전개 상태로 모델링)
SW = math.tan(math.radians(20.0))
WING = [dict(s=0.0, le=-0.15, c=3.80, t=0.07), dict(s=7.0, le=-0.15 - 7.0 * SW, c=1.45, t=0.05)]
ac.wing(WING, x0=PIVOT[0], z0=PIVOT[2], m=10, part="wing", pivot=PIVOT, axes="world",
        cuts=[cut("flap", 0.70, 4.90, 0.70),
              cut("flap_le", 0.6, 6.85, 0.14, edge="le")])
ac.empty("wingtip_R", (PIVOT[0] + 7.0, -0.15 - 7.0 * SW - 1.0, PIVOT[2]), parent="wing_R")
ac.empty("wingtip_L", (-(PIVOT[0] + 7.0), -0.15 - 7.0 * SW - 1.0, PIVOT[2]), parent="wing_L")

# ------------------------------------------------------------------ 꼬리
ac.wing([dict(s=0.0, le=-5.55, c=3.85, t=0.045), dict(s=3.0, le=-8.40, c=1.10, t=0.035)],
        x0=1.98, z0=-0.22, dihedral=-3.0, airfoil="hex", m=7, part="elevator", pivot=dict(s=0.0, f=0.42))
ac.vtail([dict(s=0.0, le=-4.20, c=3.90, t=0.045), dict(s=2.70, le=-6.40, c=1.62, t=0.04),
          dict(s=3.0, le=-6.85, c=0.95, t=0.035)], x0=1.60, z0=0.30, cant=5.0, side="both", m=8,
         cuts=[cut("rudder", 0.30, 2.55, 0.68)])
ac.vtail([dict(s=0.0, le=-4.70, c=1.60, t=0.05), dict(s=0.55, le=-5.25, c=0.95, t=0.05)],
         x0=1.78, z0=-0.78, cant=160, airfoil="plate", m=5)

# ------------------------------------------------------------------ 캐노피 (복좌, 프레임 윈드실드)
ac.canopy([dict(y=6.25, w=0.42, h=0.02, z=SILL), dict(y=5.95, w=0.55, h=0.36, z=SILL),
           dict(y=5.55, w=0.61, h=0.60, z=SILL), dict(y=4.90, w=0.63, h=0.70, z=SILL),
           dict(y=4.00, w=0.63, h=0.69, z=SILL), dict(y=3.20, w=0.59, h=0.62, z=SILL + 0.01),
           dict(y=2.50, w=0.49, h=0.40, z=SILL + 0.04), dict(y=2.00, w=0.36, h=0.15, z=SILL + 0.12)],
          N=20, split=5.62, frames=[5.62, 5.85, 3.95], hinge=(0.0, 2.1, SILL + 0.15))
ac.seat(4.75, SILL - 0.05)
ac.seat(3.40, SILL - 0.02)

# ------------------------------------------------------------------ 무장 스테이션
# 터널 팔레트 (AIM-54 등) — 터널 천장에서 내려온 짧은 받침
for i, yy in enumerate((2.0, 0.3, -1.4, -3.1), start=1):
    ac.pylon(0.0, yy - 0.1, -0.88, length=1.3, width=0.16, side="center", rake=0.15, rear_rake=0.15)
    ac.station(f"TUNNEL_{i}", (0.0, yy, -0.88))
# 글러브 파일런 + 측면 레일
ac.pylon(2.60, 0.25, -0.72, length=2.6, width=0.16, rake=0.3)
ac.rail(2.86, 0.35, -0.50, length=2.2, height=0.12)
ac.station_pair("GLOVE_L", "GLOVE_R", (-2.6, 0.5, -0.72))
ac.station_pair("GLOVE_L_RAIL", "GLOVE_R_RAIL", (-2.86, 0.5, -0.62))
# 나셀 하부 (탱크)
ac.pylon(1.80, -1.1, -1.08, length=1.4, width=0.12, rake=0.2)
ac.station_pair("NAC_L", "NAC_R", gl(-1.8, -1.08, 1.0))

# ------------------------------------------------------------------ 마킹 / 기타
ac.insignia((2.06, 2.6, -0.32), (1, 0, 0), size=0.62, kind="star_bar", side="both")
ac.insignia((-6.2, -1.9, PIVOT[2] + 0.1), (0, 0, 1), size=0.85, kind="star_bar", up=(0, 1, 0), target="wing_L")
ac.insignia((6.2, -1.9, PIVOT[2] - 0.1), (0, 0, -1), size=0.85, kind="star_bar", up=(0, 1, 0), target="wing_R")
ac.insignia((-0.70, 6.55, -0.20), (-1, 0, 0), size=0.12, kind="oval", mat="intake")   # 기관포 포구(좌측)
ac.blade(0.0, 1.3, 0.70, height=0.24, chord=0.32)
ac.blade(0.0, 4.6, -0.58, height=0.18, chord=0.24, down=True)

ac.empty("gun", (-0.72, 6.60, -0.20))
ac.empty("cockpit", (0.0, 4.65, SILL + 0.55))

ac.finish()
