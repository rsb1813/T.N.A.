"""F/A-18I Super Hornet (F/A-18E/F Block III 기반 가상 개량형, 단좌) — 플레이어 기체 `fa18i`.

    blender -b --factory-startup -P tools/blender/aircraft/fa18i.py -- public/models/fa18i.glb

길이 18.3 m, 폭 13.6 m(날개끝 레일 포함). 큰 LEX, 사다리꼴 캐럿 흡입구, 도그투스(스내그) 주익,
바깥으로 20° 기운 쌍수직꼬리, 날개끝 레일, 기수 상부 기관포.
선택: opt_cft (등 위 컨포멀 탱크, Block III).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import aero  # noqa: E402
from aero import cut, gl, nose, sec  # noqa: E402

ac = aero.Aircraft("fa18i", paint=(0.20, 0.215, 0.23), paint_dark=(0.10, 0.11, 0.12), canopy="gold", seed=18)

SILL = 0.62

# ------------------------------------------------------------------ 동체
fus = nose(9.15, 2.05, 0.43, 0.42, 0.40, z=0.12, z_tip=0.02, power=0.62, count=8) + [
    sec(6.90, 0.49, 0.46, 0.47, 0.13, nb=2.2),
    sec(6.10, 0.55, 0.49, 0.55, 0.13, nb=2.5),
    sec(4.90, 0.60, 0.49, 0.62, 0.13, nb=2.8, nt=2.3),
    sec(3.60, 0.65, 0.55, 0.68, 0.11, nb=3.0, nt=2.2),
    sec(2.40, 0.72, 0.72, 0.70, 0.10, nb=3.0, nt=1.9),
    sec(0.60, 0.82, 0.66, 0.68, 0.08, nb=3.2, nt=2.3),
    sec(-2.00, 0.92, 0.58, 0.62, 0.06, nb=3.4, nt=2.8),
    sec(-4.60, 0.98, 0.52, 0.56, 0.04, nb=3.4, nt=3.2),
    sec(-6.60, 0.96, 0.44, 0.48, 0.02, nb=3.2, nt=3.2),
    sec(-7.60, 0.86, 0.36, 0.40, 0.0, nb=3.0, nt=3.0),
]
ac.fuselage(fus, N=32, step=0.42)
# 엔진 나셀 (쌍발, 가깝게)
ac.pod([sec(-3.6, 0.0, 0.0, 0.0, -0.02, x=0.52), sec(-4.2, 0.40, 0.42, 0.44, -0.02, x=0.52),
        sec(-7.0, 0.50, 0.50, 0.50, -0.02, x=0.52), sec(-7.70, 0.475, 0.475, 0.475, -0.02, x=0.52)],
       side="both", N=24, step=0.6)

# 캐럿 흡입구 (앞에서 보면 위가 넓은 사다리꼴, 립은 평면에서 바깥쪽이 뒤로, 측면에서 아래가 뒤로)
def caret(sx, sz):
    return [(-0.25 * sx, 0.40 * sz), (0.31 * sx, 0.40 * sz), (0.18 * sx, -0.44 * sz), (-0.25 * sx, -0.36 * sz)]


ac.intake([dict(y=3.45, x=0.98, z=-0.36, corners=caret(1.0, 1.0)),
           dict(y=2.40, x=0.96, z=-0.36, corners=caret(1.03, 1.02)),
           dict(y=0.60, x=0.92, z=-0.33, corners=caret(1.06, 1.0)),
           dict(y=-1.80, x=0.80, z=-0.28, corners=caret(1.0, 0.9)),
           dict(y=-3.60, x=0.66, z=-0.22, corners=caret(0.85, 0.75))],
          shape="quad", side="both", N=24, lip=0.05, depth=1.4, slant=(-0.55, 0.28))

# LEX — 윈드실드 옆에서 날개 앞전까지 휘어지는 큰 판
ac.wing([dict(s=0.00, le=6.60, c=6.90, t=0.02), dict(s=0.35, le=5.60, c=5.90, t=0.022),
         dict(s=0.65, le=4.60, c=4.90, t=0.024), dict(s=0.90, le=3.60, c=3.90, t=0.027),
         dict(s=1.10, le=2.60, c=2.90, t=0.03), dict(s=1.30, le=1.60, c=1.95, t=0.035),
         dict(s=1.45, le=0.95, c=1.35, t=0.04), dict(s=1.53, le=0.74, c=1.10, t=0.045)],
        x0=0.45, z0=0.30, airfoil="biconvex", m=7)

# 주익: 앞전 20°, 바깥쪽 스내그(도그투스), 플랩/에일러론/앞전 플랩
WING = aero.dogtooth([dict(s=0.0, le=0.97, c=4.75, t=0.05), dict(s=5.25, le=-0.94, c=1.75, t=0.035)], 3.0, 0.24)
ac.wing(WING, x0=1.40, z0=0.24, m=10,
        cuts=[cut("flap", 0.35, 2.90, 0.70), cut("aileron", 3.10, 5.05, 0.74),
              cut("flap_le", 0.45, 5.10, 0.15, edge="le")])

# 스태빌레이터 (하반각 2°)
ac.wing([dict(s=0.0, le=-5.35, c=3.10, t=0.045), dict(s=3.05, le=-7.95, c=1.20, t=0.035)],
        x0=0.82, z0=-0.02, dihedral=-2.0, airfoil="hex", m=7, part="elevator", pivot=dict(s=0.0, f=0.42))

# 쌍수직꼬리 (바깥 20°) + 러더
ac.vtail([dict(s=0.0, le=-3.55, c=3.45, t=0.045), dict(s=2.85, le=-5.75, c=1.45, t=0.04)],
         x0=0.98, z0=0.30, cant=20.0, side="both", m=8, cuts=[cut("rudder", 0.25, 1.95, 0.68)])

# 노즐 (F414 EPE)
ac.nozzle(x=0.52, z=-0.02, y=-8.60, length=1.0, r_base=0.475, r_exit=0.41, petals=14, side="both")
ac.paint("metal", x=(0.0, 1.0), y=(-7.75, -7.0), src=("paint",))

# ------------------------------------------------------------------ 캐노피 (단좌)
ac.canopy([dict(y=6.25, w=0.38, h=0.02, z=SILL), dict(y=5.95, w=0.50, h=0.32, z=SILL),
           dict(y=5.50, w=0.55, h=0.55, z=SILL), dict(y=4.80, w=0.56, h=0.66, z=SILL),
           dict(y=4.10, w=0.54, h=0.62, z=SILL), dict(y=3.45, w=0.46, h=0.45, z=SILL + 0.02),
           dict(y=2.95, w=0.35, h=0.24, z=SILL + 0.08), dict(y=2.65, w=0.25, h=0.07, z=SILL + 0.15)],
          N=20, split=5.55, frames=[5.55], hinge=(0.0, 2.8, SILL + 0.15))
ac.seat(4.55, SILL - 0.05)

# ------------------------------------------------------------------ 무장 스테이션
zr = ac.rail(6.72, -1.95, 0.25, length=2.8, height=0.13)
ac.station_pair("L1", "R1", (-6.72, -1.95, zr))
for sid, (x, y, z) in (("2", (4.9, -1.5, -0.5)), ("3", (3.6, -1.0, -0.6)), ("4", (2.3, -0.6, -0.7))):
    ac.pylon(x, y - 0.35, z, length=2.5, width=0.15, rake=0.3)
    ac.station_pair("L" + sid, "R" + sid, gl(-x, z, -y))
# 동체 측면 (흡입구 트렁크 아래 모서리)
ac.pylon(0.95, -0.1, -0.92, length=1.2, width=0.12, rake=0.2)
ac.station_pair("FL", "FR", gl(-0.9, -0.9, 0.0))
ac.pylon(0.0, -0.55, -1.10, length=2.4, width=0.15, side="center")
ac.station("C", gl(0, -1.1, 0.4))

# ------------------------------------------------------------------ 선택: 등 위 CFT
ac.pod([sec(2.55, 0.0, 0.0, 0.0, 0.62, x=0.52), sec(2.2, 0.24, 0.16, 0.12, 0.64, x=0.55, n=2.5),
        sec(0.6, 0.33, 0.22, 0.12, 0.66, x=0.58, n=2.6), sec(-2.6, 0.32, 0.20, 0.12, 0.60, x=0.58, n=2.6),
        sec(-3.7, 0.0, 0.0, 0.0, 0.54, x=0.52)], side="both", N=20, step=0.4, part="opt_cft")

# ------------------------------------------------------------------ 마킹 / 기타
ac.insignia((1.24, 1.2, -0.32), (1, 0, -0.12), size=0.50, kind="star_bar", side="both")
ac.insignia((-3.55, -1.25, 0.30), (0, 0, 1), size=0.80, kind="star_bar", up=(0, 1, 0))
ac.insignia((3.55, -1.25, 0.18), (0, 0, -1), size=0.80, kind="star_bar", up=(0, 1, 0))
ac.insignia((0.0, 7.55, 0.50), (0, 0.25, 1), size=0.12, kind="disc", mat="intake")  # 기관포 포구
ac.blade(0.0, 1.6, 0.82, height=0.24, chord=0.32)
ac.blade(0.0, 1.0, -0.55, height=0.18, chord=0.25, down=True)

ac.empty("gun", (0.0, 7.62, 0.50))
ac.empty("cockpit", (0.0, 4.45, SILL + 0.55))
ac.empty("wingtip_R", (6.70, -2.6, 0.25))
ac.empty("wingtip_L", (-6.70, -2.6, 0.25))

ac.finish()
