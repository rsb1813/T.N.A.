"""통신 격자탑 — 높이 60 m(격자 48 m + 마스트), 밑변 8 m 정사각 → 꼭대기 1.8 m.
네 다리 + 구간별 X 가새·수평재(빨강/흰 항공 표지 띠), 작업 발판 2, 접시 안테나 3, 패널 안테나 6, 장애등, 장비 쉘터.
원점 = 바닥 중앙, 정면 = +Y. 주 재질 'paint'.

    blender -b --factory-startup -P tools/blender/units/comm_tower.py -- public/models/comm_tower.glb
"""
import math, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))
import common as C
from mathutils import Vector

C.reset()
B = C.Building("comm_tower", colors={"paint": (0.62, 0.62, 0.60), "metal": ((0.30, 0.31, 0.32), 0.45, 0.7)})
b = B.b
B0, B1, HL, NSEC, HM = 4.0, 0.9, 48.0, 10, 60.0
hw = lambda z: B0 + (B1 - B0) * z / HL
CORN = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
band = lambda k: "band_red" if (k // 2) % 2 == 1 else "paint"

# 다리 (구간마다 끊어서 띠 색)
for k in range(NSEC):
    z0, z1 = HL * k / NSEC, HL * (k + 1) / NSEC
    for sx, sy in CORN:
        b.beam((sx * hw(z0), sy * hw(z0), z0), (sx * hw(z1), sy * hw(z1), z1), 0.32, mat=band(k), caps=False)
# 가새: 면마다 X + 위 수평재
for k in range(NSEC):
    z0, z1 = HL * k / NSEC, HL * (k + 1) / NSEC
    for i in range(4):
        (ax, ay), (bx, by) = CORN[i], CORN[(i + 1) % 4]
        p00 = Vector((ax * hw(z0), ay * hw(z0), z0))
        p01 = Vector((bx * hw(z0), by * hw(z0), z0))
        p10 = Vector((ax * hw(z1), ay * hw(z1), z1))
        p11 = Vector((bx * hw(z1), by * hw(z1), z1))
        m = band(k)
        b.tri_beam(p00, p11, 0.14, mat=m)
        b.tri_beam(p01, p10, 0.14, mat=m)
        b.tri_beam(p10, p11, 0.16, mat=m)
# 작업 발판
for z in (24.0, HL):
    w = hw(z) + 0.6
    b.box((2 * w, 2 * w, 0.18), (0, 0, z - 0.1), "metal")
# 마스트
b.cyl((0, 0, HL - 1.0), (0, 0, 54.0), 0.32, segs=8, mat="paint")
b.cyl((0, 0, 54.0), (0, 0, HM), 0.25, 0.12, segs=8, mat="band_red")
b.box((0.45, 0.45, 0.45), (0, 0, HM + 0.2), "glow")
for sx, sy in CORN:
    b.box((0.35, 0.35, 0.35), (sx * (B1 + 0.2), sy * (B1 + 0.2), HL + 0.3), "glow")
# 접시 안테나 3 (바깥을 향함)
for ang, z, r in ((90, 40.0, 1.0), (210, 37.0, 0.8), (330, 42.5, 0.75)):
    a = math.radians(ang)
    d = Vector((math.cos(a), math.sin(a), 0))
    base = Vector((0, 0, z)) + d * (hw(z) + 0.3)
    b.loft([C.ring_points(base + d * 0.75, *C.basis(d), r, 12),
            C.ring_points(base + d * 0.35, *C.basis(d), r * 0.35, 12),
            C.ring_points(base, *C.basis(d), r * 0.2, 12)], ["paint", "metal"], smooth=True,
           cap0="paint_dark", cap1="metal")
    b.beam(base - d * 0.4, base + d * 0.1, 0.12, mat="metal")
# 패널 안테나 6 (마스트 둘레)
for k in range(6):
    a = 2 * math.pi * k / 6
    p = Vector((math.cos(a) * 0.75, math.sin(a) * 0.75, 51.0))
    b.box((0.32, 0.16, 2.2), p, "paint", rot=C.Matrix.Rotation(a + math.pi / 2, 3, "Z"))
# 기초 패드 + 장비 쉘터 + 사다리 케이블 트레이
for sx, sy in CORN:
    b.box((1.4, 1.4, 0.5), (sx * B0, sy * B0, 0.25), "paint_dark", bevel=0.05)
b.box((3.2, 2.4, 2.6), (0.0, 0.0, 1.3), "paint_dark", bevel=0.06)
b.box((0.9, 0.1, 2.0), (0.0, 1.22, 1.0), "metal")
b.box((0.6, 0.6, 0.5), (1.0, -0.6, 2.85), "metal")
B.finish()
