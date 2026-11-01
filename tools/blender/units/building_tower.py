"""고층 업무용 타워 — 기단부 44 x 40 m(9 m), 타워 28 x 28 m, 높이 ~100 m(+안테나 112 m).
유리 커튼월 + 층별 스팬드럴 띠, 모서리 기둥, 수직 멀리언 핀, 셋백 왕관부, 꼭대기 항공 장애등.
원점 = 바닥 중앙, 정면 = +Y. 주 재질 'paint'(프레임/스팬드럴).

    blender -b --factory-startup -P tools/blender/units/building_tower.py -- public/models/building_tower.glb
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C

C.reset()
B = C.Building("building_tower", colors={"paint": (0.36, 0.37, 0.38), "paint_dark": (0.10, 0.11, 0.12),
                                         "glass": ((0.035, 0.06, 0.09), 0.06, 0.8)})
b = B.b
PW, PD, PH = 22.0, 20.0, 9.0
TW, Z0, FH, NF = 14.0, PH, 3.6, 24
ZT = Z0 + FH * NF  # 타워 몸통 꼭대기

# 기단부 (로비 유리 띠 + 상부 매스)
b.box((2 * PW, 2 * PD, PH - 4.6), (0, 0, 4.6 + (PH - 4.6) / 2), "paint", bevel=0.15)
b.box((2 * PW - 1.0, 2 * PD - 1.0, 4.6), (0, 0, 2.3), "glass")
b.box((2 * PW + 0.4, 2 * PD + 0.4, 0.5), (0, 0, PH + 0.25), "paint_dark")
for sx in (-1, 1):
    for k in range(5):
        b.box((0.8, 0.8, 4.6), (sx * (PW - 0.6) if k == 0 else -PW + 0.6 + k * (2 * PW - 1.2) / 4, PD - 0.6, 2.3),
              "paint")
# 정문 캐노피
b.box((12.0, 4.0, 0.4), (0, PD + 2.0, 4.4), "paint", bevel=0.05)

# 타워: 유리 몸통 + 층별 스팬드럴 띠
b.box((2 * TW - 0.6, 2 * TW - 0.6, ZT - Z0), (0, 0, (Z0 + ZT) / 2), "glass")
for f in range(1, NF + 1):
    z = Z0 + f * FH
    b.box((2 * TW, 2 * TW, 0.9), (0, 0, z - 0.45), "paint")
# 모서리 기둥
for sx in (-1, 1):
    for sy in (-1, 1):
        b.box((1.8, 1.8, ZT - Z0 + 1.0), (sx * (TW - 0.5), sy * (TW - 0.5), (Z0 + ZT) / 2 + 0.5), "paint")
# 수직 멀리언 핀 (면마다 5 개)
for k in range(5):
    t = -TW + 2 * TW * (k + 1) / 6
    for s in (-1, 1):
        b.box((0.35, 0.7, ZT - Z0), (t, s * (TW + 0.05), (Z0 + ZT) / 2), "paint_dark")
        b.box((0.7, 0.35, ZT - Z0), (s * (TW + 0.05), t, (Z0 + ZT) / 2), "paint_dark")

# 왕관부: 셋백 기계실 + 유리 띠 + 열린 프레임
b.box((2 * TW - 6, 2 * TW - 6, 6.0), (0, 0, ZT + 3.0), "paint", bevel=0.1)
b.box((2 * TW - 5.8, 2 * TW - 5.8, 1.6), (0, 0, ZT + 3.4), "glass")
for s in (-1, 1):
    b.box((2 * TW, 0.8, 1.0), (0, s * (TW - 0.4), ZT + 7.5), "paint")
    b.box((0.8, 2 * TW, 1.0), (s * (TW - 0.4), 0, ZT + 7.5), "paint")
    for s2 in (-1, 1):
        b.box((0.8, 0.8, 7.0), (s * (TW - 0.4), s2 * (TW - 0.4), ZT + 4.0), "paint")
# 안테나 마스트 + 장애등
b.cyl((0, 0, ZT + 6.0), (0, 0, ZT + 18.0), 0.35, 0.15, segs=8, mat="metal")
b.box((0.6, 0.6, 0.6), (0, 0, ZT + 18.2), "glow")
for sx in (-1, 1):
    for sy in (-1, 1):
        b.box((0.5, 0.5, 0.5), (sx * (TW - 0.4), sy * (TW - 0.4), ZT + 8.3), "glow")
B.finish()
