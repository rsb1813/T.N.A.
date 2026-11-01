"""경화 항공기 엄체호 (NATO HAS, TAB-VEE 3세대 급) — 폭 26 m(아치) / 34 m(도어 포켓 포함), 길이 ~40 m, 높이 10 m.
아치형 콘크리트 셸(신축 이음 홈), 앞쪽 두꺼운 아치 테두리, 4 짝 미닫이 방폭문, 양옆 문 수납 포켓, 뒤쪽 배기구.
원점 = 바닥 중앙, 정면(문) = +Y. 주 재질 'paint'(콘크리트).

    blender -b --factory-startup -P tools/blender/units/hangar_has.py -- public/models/hangar_has.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C
from mathutils import Vector

C.reset()
B = C.Building("hangar_has", colors={"paint": C.CONCRETE, "paint_dark": (0.10, 0.11, 0.10)})
b = B.b
A, H = 13.0, 9.6          # 아치 반폭, 높이
Y_REAR, Y_FRONT = -20.0, 16.0
N = 16


def arch(s, y, closed=True):
    """아치 단면 점들 (바닥 오른쪽 → 꼭대기 → 바닥 왼쪽). s = 배율."""
    pts = []
    for k in range(N + 1):
        t = math.pi * k / N
        pts.append(Vector((A * s * math.cos(t), y, H * s * math.sin(t) ** 0.92)))
    return pts


# 셸: 신축 이음 홈이 있는 아치 (바닥면까지 닫힌 고리)
rings, mats = [], []
stations = [Y_REAR]
for yj in (-12.0, -4.0, 4.0, 11.0):
    stations += [yj - 0.18, yj - 0.18, yj + 0.18, yj + 0.18]
stations.append(Y_FRONT)
scales = [1.0] + [1.0, 0.985, 0.985, 1.0] * 4 + [1.0]
for y, sc in zip(stations, scales):
    rings.append(arch(sc, y))
mats = ["paint"] * (len(rings) - 1)
b.loft(rings, mats, smooth=True, cap0="paint", cap1="paint")

# 앞 아치 테두리 (단면 사각형을 아치를 따라 쓸기)
SO, SI = 1.075, 0.90
yf0, yf1 = Y_FRONT - 0.6, Y_FRONT + 1.8
r_if, r_of, r_ob, r_ib = arch(SI, yf1), arch(SO, yf1), arch(SO, yf0), arch(SI, yf0)
vr = b.loft([r_if, r_of, r_ob, r_ib], "paint", smooth=True, closed=True, wrap=False)
for j in (0, N):  # 발 끝 막기
    b.face([vr[0][j], vr[1][j], vr[2][j], vr[3][j]], "paint")

# 방폭문 4 짝 (아치 안쪽 윤곽을 따라 윗변이 굽은 강철 문), 앞뒤로 엇갈림
AI, HI = A * SI, H * SI


def ztop(x):
    u = max(0.0, 1.0 - (x / AI) ** 2)
    return HI * math.sqrt(u) ** 0.92 * 0.995


edges = [-AI * 0.995 + 2 * AI * 0.995 * k / 4 for k in range(5)]
for k in range(4):
    x0, x1 = edges[k], edges[k + 1]
    xm = (x0 + x1) / 2
    y = Y_FRONT + (0.75 if k % 2 == 0 else 1.05)
    poly = [(x0, 0.0), (x1, 0.0), (x1, ztop(x1)), (xm, ztop(xm)), (x0, ztop(x0))]
    if ztop(x0) < 0.05:
        poly.pop()
    if ztop(x1) < 0.05:
        poly.pop(2)
    pa = [Vector((x, y, z)) for x, z in poly]
    pb = [Vector((x, y + 0.45, z)) for x, z in poly]
    b.prism(pa, pb, "paint_dark")
    # 보강 리브
    for zr in (1.2, 3.6, 6.0):
        top = min(ztop(x0), ztop(x1))
        if zr < top - 0.5:
            b.box((x1 - x0 - 0.3, 0.18, 0.28), (xm, y + 0.45 + 0.09, zr), "metal")
# 문 레일 (바닥)
b.box((2 * A * 1.25, 1.6, 0.35), (0, Y_FRONT + 1.0, 0.175), "metal")

# 양옆 문 수납 포켓 (두꺼운 콘크리트 블록)
for sx in (-1, 1):
    b.box((5.2, 6.4, 6.8), (sx * (A * 0.93 + 2.6), Y_FRONT - 1.4, 3.4), "paint", bevel=0.25)
    b.box((4.0, 5.2, 0.5), (sx * (A * 0.93 + 2.6), Y_FRONT - 1.4, 7.05), "paint", bevel=0.1)

# 셸 바닥 연석 (옆 기초)
for sx in (-1, 1):
    b.box((1.2, Y_FRONT - Y_REAR - 2.0, 0.9), (sx * (A + 0.35), (Y_FRONT + Y_REAR) / 2 - 1.0, 0.45), "paint",
          bevel=0.12)

# 뒤 배기구 하우징 + 어두운 개구부 + 위쪽 편향판
b.box((7.5, 2.4, 5.2), (0, Y_REAR - 1.1, 2.6), "paint", bevel=0.2)
b.box((5.6, 0.2, 3.2), (0, Y_REAR - 2.32, 2.3), "intake")
b.box((8.6, 3.0, 0.5), (0, Y_REAR - 1.4, 5.45), "paint", bevel=0.1)

# 문 위 경고등
for sx in (-1, 1):
    b.box((0.4, 0.3, 0.4), (sx * 3.2, Y_FRONT + 1.95, H * SO - 0.6), "glow")
B.finish()
