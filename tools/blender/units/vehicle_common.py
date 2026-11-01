"""T.N.A. 지상 차량 / SAM / 함정 공용 생성기 (헤드리스 Blender 용).
# tna: helper

차량 스크립트는 `tools/blender/units/<모델 id>.py` 이고 이렇게 실행한다:

    blender -b --factory-startup -P tools/blender/units/t80.py -- public/models/t80.glb

메쉬 빌더(Builder)와 재질 팔레트는 tools/blender/weapons/common.py 를 그대로 쓴다.

좌표(Blender): 정면 = +Y, 위 = +Z, 오른쪽 = +X, 1 단위 = 1 m. glTF 로 내보내면 정면 = -Z, 위 = +Y.
원점: 지상 유닛 = 바닥(지면) 중앙, 함정 = 흘수선 중앙(흘수선 z = 0).

움직이는 부품(노드)
- `turret`  : 선회부. 원점 = 선회축 (지면 높이 아님, 링 높이). three.js rotation.y 로 돌린다.
- `barrel` / `launcher` : 고각부. 원점 = 트러니언/힌지. rotation.x (+ = 위로).
  **부품 메쉬는 고각 0(수평, 앞 = 로컬 -Z) 으로 만들고, 전개 자세는 노드 회전으로 준다.**
  즉 노드의 rotation.x 가 곧 현재 고각(라디안)이다 (예: SA-10 발사관은 rotation.x = π/2 로 세워져 있다).
- `radar*`  : 계속 도는 수색 레이더 (rotation.y 로 회전시키면 된다, 선택).
- empty `gun` : 총구 (barrel 의 자식, 로컬 -Z 가 사격 방향).
- empty `launch_<n>` : 미사일 발사 위치 (launcher 의 자식, 로컬 -Z 가 발사 방향).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils import noise as mnoise

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "weapons"))
import common as C  # noqa: E402
from common import DEG, Builder, basis, ring_points  # noqa: E402,F401

# ---------------------------------------------------------------- 재질 (리니어 색, 거칠기, 금속성, 발광)

C.PALETTE.update({
    "tire": ((0.022, 0.022, 0.022), 0.92, 0.0, None),
    "rubber": ((0.025, 0.025, 0.025), 0.9, 0.0, None),
    "track": ((0.045, 0.040, 0.036), 0.75, 0.45, None),
    "glass": ((0.025, 0.04, 0.05), 0.08, 0.6, None),
    "canvas": ((0.075, 0.085, 0.045), 0.95, 0.0, None),
    "deck": ((0.050, 0.054, 0.058), 0.92, 0.0, None),
    "deck_wood": ((0.20, 0.13, 0.07), 0.85, 0.0, None),
    "marking": ((0.70, 0.70, 0.66), 0.7, 0.0, None),
    "marking_y": ((0.80, 0.52, 0.02), 0.7, 0.0, None),
    "marking_r": ((0.55, 0.04, 0.03), 0.7, 0.0, None),
    "hull_red": ((0.20, 0.035, 0.025), 0.8, 0.0, None),
    "boot": ((0.02, 0.02, 0.022), 0.7, 0.0, None),
    "radome": ((0.62, 0.62, 0.60), 0.5, 0.0, None),
    "light": ((0.9, 0.85, 0.6), 0.3, 0.0, (0.9, 0.8, 0.5)),
    "cont_red": ((0.36, 0.05, 0.03), 0.7, 0.2, None),
    "cont_blue": ((0.03, 0.10, 0.28), 0.7, 0.2, None),
    "cont_green": ((0.05, 0.20, 0.07), 0.7, 0.2, None),
    "cont_orange": ((0.65, 0.20, 0.02), 0.7, 0.2, None),
    "cont_white": ((0.55, 0.56, 0.56), 0.7, 0.2, None),
    "cont_grey": ((0.20, 0.21, 0.22), 0.7, 0.2, None),
    "cont_yellow": ((0.70, 0.50, 0.03), 0.7, 0.2, None),
})

# 세력별 기본 도장 (게임은 'paint' / 'paint_dark' 를 세력 색으로 다시 칠해도 된다)
SCHEMES = {
    "warsaw": {"paint": ((0.080, 0.105, 0.040), 0.75, 0.0), "paint_dark": ((0.028, 0.032, 0.020), 0.8, 0.0)},
    "pax": {"paint": ((0.205, 0.180, 0.115), 0.75, 0.0), "paint_dark": ((0.045, 0.055, 0.035), 0.8, 0.0)},
    "won": {"paint": ((0.36, 0.26, 0.14), 0.8, 0.0), "paint_dark": ((0.12, 0.085, 0.045), 0.85, 0.0)},
    "navy": {"paint": ((0.25, 0.27, 0.29), 0.6, 0.0), "paint_dark": ((0.10, 0.11, 0.12), 0.65, 0.0)},
    "navy_ru": {"paint": ((0.22, 0.25, 0.29), 0.6, 0.0), "paint_dark": ((0.07, 0.08, 0.09), 0.65, 0.0)},
}

BUDGET = {"ground": 4000, "ship": 15000}


# ---------------------------------------------------------------- 유닛

class Unit:
    """지상 유닛/함정 한 개. 본체(self.b) + 움직이는 부품(part) + empty."""

    def __init__(self, model_id, kind="ground", scheme="warsaw", colors=None, budget=None, sharp_deg=40.0):
        self.id = model_id
        self.kind = kind
        self.colors = dict(SCHEMES.get(scheme, {}))
        self.colors.update(colors or {})
        self.budget = budget or BUDGET[kind]
        self.sharp_deg = sharp_deg
        self.b = Builder(sharp_deg)
        self.parts = []     # dict(name, b, pivot, parent, rot)
        self.empties = []   # (name, loc, parent, rot)

    def part(self, name, pivot, parent=None, rot=(0.0, 0.0, 0.0)):
        """움직이는 부품 빌더. 메쉬는 '모델 좌표, 휴지(고각 0) 자세' 로 만든다.
        pivot = 회전축 위치(모델 좌표, 휴지 자세 기준). rot = 노드 오일러 회전(라디안, 전개 자세).
        parent 의 pivot/회전은 자식 좌표에도 그대로 적용된다(자식도 '부모 휴지 자세' 기준으로 만든다)."""
        b = Builder(self.sharp_deg)
        self.parts.append(dict(name=name, b=b, pivot=Vector(pivot), parent=parent, rot=tuple(rot)))
        return b

    def empty(self, name, loc, parent=None, rot=None):
        self.empties.append((name, Vector(loc), parent, rot))

    def tris(self):
        return self.b.tris() + sum(p["b"].tris() for p in self.parts)

    def finish(self):
        root = self.b.to_object(self.id, self.colors)
        objs = {None: (root, Vector((0.0, 0.0, 0.0)))}
        for p in self.parts:
            par, ppiv = objs[p["parent"]]
            ob = p["b"].to_object(p["name"], self.colors, origin=p["pivot"])
            ob.parent = par
            ob.location = p["pivot"] - ppiv
            ob.rotation_euler = p["rot"]
            objs[p["name"]] = (ob, p["pivot"])
        for name, loc, parent, rot in self.empties:
            par, ppiv = objs[parent]
            e = C.add_empty(name, loc - ppiv, par)
            if rot is not None:
                e.rotation_euler = rot
        print(f"[tna] {self.id}: 부품 " + ", ".join(f"{p['name']}={p['b'].tris()}" for p in self.parts)
              + f" 본체={self.b.tris()}")
        return C.export(C.out_path(self.id), self.budget, self.id)


# ---------------------------------------------------------------- 2D 도형 도우미

def rrect(w, l, r, n=2, cx=0.0, cy=0.0):
    """XY 평면 둥근 사각형 외곽 (반시계). w = x 폭, l = y 길이, r = 모서리 반지름, n = 모서리 분할."""
    pts = []
    hw, hl = w / 2 - r, l / 2 - r
    for (sx, sy, a0) in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        for k in range(n + 1):
            a = (a0 + 90.0 * k / n) * DEG
            pts.append((cx + sx * hw + r * math.cos(a), cy + sy * hl + r * math.sin(a)))
    return pts


def chamfer_rect(w, l, cf, cb=None, cx=0.0, cy=0.0, side_cf=None):
    """모따기 사각형 8 점 (반시계, +X+Y 부터). cf = 앞(+Y) 모서리 모따기, cb = 뒤 모서리."""
    cb = cf if cb is None else cb
    hw, hl = w / 2, l / 2
    return [(cx + hw, cy + hl - cf), (cx + hw - cf, cy + hl), (cx - hw + cf, cy + hl), (cx - hw, cy + hl - cf),
            (cx - hw, cy - hl + cb), (cx - hw + cb, cy - hl), (cx + hw - cb, cy - hl), (cx + hw, cy - hl + cb)]


def at_z(pts, z):
    return [Vector((x, y, z)) for x, y in pts]


def scale2(pts, sx, sy=None, cx=0.0, cy=0.0):
    sy = sx if sy is None else sy
    return [(cx + (x - cx) * sx, cy + (y - cy) * sy) for x, y in pts]


def inset2(pts, d):
    """볼록 다각형(반시계)을 안쪽으로 d 만큼 (마이터)."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e0 = (p1 - p0).normalized()
        e1 = (p2 - p1).normalized()
        n0 = Vector((-e0.y, e0.x))
        n1 = Vector((-e1.y, e1.x))
        nm = (n0 + n1)
        if nm.length < 1e-9:
            nm = n0
        nm.normalize()
        k = d / max(nm.dot(n0), 0.2)
        q = p1 + nm * k
        out.append((q.x, q.y))
    return out


def convex_hull(pts):
    """2D 볼록 껍질 (반시계)."""
    p = sorted(set((round(x, 6), round(y, 6)) for x, y in pts))
    if len(p) <= 2:
        return p

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 1e-9:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 1e-9:
            hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]


# ---------------------------------------------------------------- 3D 기본형

def frustum(b, bottom, z0, top, z1, mat, cap_mat=None, smooth=False, side_mats=None):
    """XY 외곽 bottom(z0) → top(z1) 로 잇는 각뿔대 (점 개수 같아야 함)."""
    return b.prism(at_z(bottom, z0), at_z(top, z1), mat, cap_mat=cap_mat, smooth=smooth, side_mats=side_mats)


def slices(b, layers, mat, smooth=False, cap0=True, cap1=True, mats=None):
    """수평 단면 층 [(z, [(x, y), ...])] 을 아래→위로 잇는다."""
    rings = [at_z(pts, z) for z, pts in layers]
    return b.loft(rings, mats or mat, smooth, cap0=mat if cap0 else None, cap1=mat if cap1 else None)


def side_prism(b, prof_yz, x0, x1, mat, cap_mat=None, smooth=False, side_mats=None):
    """옆모습 외곽 [(y, z)] 를 x0 → x1 로 밀어낸 덩어리."""
    a = [Vector((x0, y, z)) for y, z in prof_yz]
    c = [Vector((x1, y, z)) for y, z in prof_yz]
    return b.prism(a, c, mat, cap_mat=cap_mat, smooth=smooth, side_mats=side_mats)


def section_loft(b, sections, mat, smooth=False, cap0=True, cap1=True, mat_fn=None):
    """Y 방향으로 늘어선 단면 [(y, [(x, z), ...])] 을 잇는다 (점 개수 같게)."""
    rings = [[Vector((x, y, z)) for x, z in pts] for y, pts in sections]
    return b.loft(rings, mat, smooth, cap0=mat if cap0 else None, cap1=mat if cap1 else None, mat_fn=mat_fn)


def lathe(b, p0, p1, prof, segs=12, smooth=True, roll=None, cap0=None, cap1=None):
    """p0→p1 축 회전체. prof = [(t[m], r, 재질)] (t 는 p0 에서 축 방향 거리). 구간 재질 = 앞 점의 재질.
    r = 0 인 점은 꼭짓점(부채꼴). cap0/cap1 = 끝 막기 재질."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    u, v = basis(d)
    roll = math.pi / segs if roll is None else roll
    rings = [ring_points(p0 + d * t, u, v, r, segs, roll) for t, r, _ in prof]
    mats = [m for _, _, m in prof[:-1]]
    return b.loft(rings, mats, smooth, cap0=cap0, cap1=cap1)


def tube(b, p0, p1, r, segs=10, mat="metal", cap=True, r1=None, smooth=True):
    return b.cyl(p0, p1, r, r1, segs=segs, mat=mat, cap0=cap, cap1=cap, smooth=smooth)


def sphere(b, c, r, segs=12, rings=6, mat="radome", sz=None, z_cut=None):
    """구(또는 z 방향 납작한 타원체). z_cut 을 주면 그 높이(중심 기준 -r..r) 아래를 잘라 평평한 바닥."""
    c = Vector(c)
    sz = r if sz is None else sz
    pts_rings = []
    lo = -math.pi / 2
    if z_cut is not None:
        lo = math.asin(max(-1.0, min(1.0, z_cut / sz)))
    for i in range(rings + 1):
        a = lo + (math.pi / 2 - lo) * i / rings
        rr = r * math.cos(a)
        z = sz * math.sin(a)
        if i == rings:
            pts_rings.append([c + Vector((0, 0, sz))])
        elif i == 0 and z_cut is None:
            pts_rings.append([c + Vector((0, 0, -sz))])
        else:
            pts_rings.append([c + Vector((rr * math.cos(2 * math.pi * k / segs), rr * math.sin(2 * math.pi * k / segs), z))
                              for k in range(segs)])
    cap0 = mat if z_cut is not None else None
    return b.loft(pts_rings, mat, True, cap0=cap0)


def dish(b, c, look, R, depth, thick=0.06, segs=14, rings=3, front="metal", back=None, up=(0, 0, 1), rx=None):
    """회전 포물면 접시 (오목면이 look 방향). c = 접시 바닥 중심(뒤쪽 꼭지)."""
    c, d = Vector(c), Vector(look).normalized()
    back = back or front
    rx = R if rx is None else rx
    upv = Vector(up)
    s = d.cross(upv)
    if s.length < 1e-6:
        s = d.cross(Vector((1, 0, 0)))
    s.normalize()
    t = s.cross(d).normalized()

    def ring(k, off):
        f = k / rings
        out = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            ca, sa = math.cos(a), math.sin(a)
            out.append(c + s * (rx * f * ca) + t * (R * f * sa) + d * (depth * f * f + off))
        return out

    fr = [[c + d * 0.0]] + [ring(k, 0.0) for k in range(1, rings + 1)]
    bk = [ring(k, -thick) for k in range(rings, 0, -1)] + [[c - d * thick]]
    mats = [front] * rings + [back] + [back] * rings
    return b.loft(fr + bk, mats, True)


def grid_dish(b, c, right, up, look, hw, hh, du, dv, nu=8, nv=3, thick=0.08, front="metal", back=None,
              smooth=True):
    """사각으로 자른 포물면 반사판. c = 반사판 중심(꼭지), right/up = 반사판 가로/세로 방향,
    look = 오목면이 보는 방향. 가장자리 깊이: 가로 끝 du, 세로 끝 dv."""
    c, r, u, d = Vector(c), Vector(right).normalized(), Vector(up).normalized(), Vector(look).normalized()
    back = back or front

    def P(i, j, off):
        x = -1 + 2 * i / nu
        y = -1 + 2 * j / nv
        return c + r * (x * hw) + u * (y * hh) + d * (du * x * x + dv * y * y + off)

    F = [[b.bm.verts.new(P(i, j, 0.0)) for j in range(nv + 1)] for i in range(nu + 1)]
    B = [[b.bm.verts.new(P(i, j, -thick)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            b.face([F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1]], front, smooth)
            b.face([B[i][j + 1], B[i + 1][j + 1], B[i + 1][j], B[i][j]], back, smooth)
    edge = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + \
           [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
    for k in range(len(edge)):
        i0, j0 = edge[k]
        i1, j1 = edge[(k + 1) % len(edge)]
        b.face([F[i0][j0], B[i0][j0], B[i1][j1], F[i1][j1]], back, False)
    return F, B


def lattice(b, z0, z1, w0, w1, bays, leg=0.18, brace=0.08, mat="metal", cx=0.0, cy=0.0, faces=(0, 1, 2, 3),
            ring_every=1, d0=None, d1=None):
    """4 다리 격자 마스트 (밑변 w0 x d0 → 꼭대기 w1 x d1, X 가새)."""
    d0 = w0 if d0 is None else d0
    d1 = w1 if d1 is None else d1

    def corner(k, z):
        f = (z - z0) / (z1 - z0)
        hw = (w0 + (w1 - w0) * f) / 2
        hd = (d0 + (d1 - d0) * f) / 2
        sx, sy = ((1, 1), (-1, 1), (-1, -1), (1, -1))[k]
        return Vector((cx + sx * hw, cy + sy * hd, z))

    for k in range(4):
        b.beam(corner(k, z0), corner(k, z1), leg, mat=mat)
    for i in range(bays):
        za = z0 + (z1 - z0) * i / bays
        zb = z0 + (z1 - z0) * (i + 1) / bays
        for k in faces:
            k2 = (k + 1) % 4
            b.tri_beam(corner(k, za), corner(k2, zb), brace, mat=mat)
            b.tri_beam(corner(k2, za), corner(k, zb), brace, mat=mat)
            if (i + 1) % ring_every == 0:
                b.tri_beam(corner(k, zb), corner(k2, zb), brace, mat=mat)


# ---------------------------------------------------------------- 바퀴 / 궤도

def wheel(b, c, r, w, side=1, segs=12, tire="tire", hub="metal", hub_r=0.48, both=False, rim=0.70):
    """X 축 바퀴. side=+1 이면 +X 쪽이 바깥(허브 보이는 면)."""
    c = Vector(c)
    ax = Vector((side, 0.0, 0.0))
    p0 = c - ax * (w / 2)
    p1 = c + ax * (w / 2)
    dish_d = min(0.06 * r / 0.5, w * 0.3)
    prof = []
    if both:
        prof += [(dish_d, r * hub_r, hub), (0.0, r * rim, tire)]
    else:
        prof += [(0.0, r * 0.90, tire)]
    prof += [(w * 0.12, r, tire), (w * 0.88, r, tire), (w, r * rim, hub), (w - dish_d, r * hub_r, hub)]
    lathe(b, p0, p1, prof, segs=segs, cap0=hub if both else tire, cap1=hub)
    # 허브 너트 뭉치
    tube(b, p1 - ax * dish_d, p1 - ax * (dish_d - 0.05 * r / 0.5), r * 0.2, segs=6, mat="metal")
    if both:
        tube(b, p0 + ax * dish_d, p0 + ax * (dish_d - 0.05 * r / 0.5), r * 0.2, segs=6, mat="metal")


def road_wheel(b, c, r, w, side=1, segs=12, tire="rubber", hub="paint_dark"):
    """궤도 차량 보기륜 (고무 테 + 접시형 휠 + 허브)."""
    c = Vector(c)
    ax = Vector((side, 0.0, 0.0))
    p0 = c - ax * (w / 2)
    p1 = c + ax * (w / 2)
    prof = [(0.0, r * 0.86, tire), (w * 0.1, r, tire), (w * 0.9, r, tire), (w, r * 0.86, hub),
            (w + 0.03, r * 0.55, hub), (w + 0.05, r * 0.2, hub)]
    lathe(b, p0, p1, prof, segs=segs, cap0=tire, cap1="metal")


def sprocket(b, c, r, w, side=1, teeth=10, mat="paint_dark"):
    """기동륜(톱니). 톱니 별 모양 각기둥 + 허브."""
    c = Vector(c)
    pts = []
    for k in range(teeth * 2):
        a = math.pi * k / teeth
        rr = r if k % 2 == 0 else r * 0.80
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    a = [Vector((c.x - side * w / 2, c.y + y, c.z + z)) for y, z in pts]
    bb = [Vector((c.x + side * w / 2, c.y + y, c.z + z)) for y, z in pts]
    b.prism(a, bb, mat)
    tube(b, (c.x + side * w / 2, c.y, c.z), (c.x + side * (w / 2 + 0.06), c.y, c.z), r * 0.45, segs=8, mat="metal")


def track_outline(circles, n=10):
    """[(y, z, r)] 원들의 볼록 껍질 → 궤도 외곽 (y, z) 반시계."""
    pts = []
    for y, z, r in circles:
        for k in range(n):
            a = 2 * math.pi * k / n
            pts.append((y + r * math.cos(a), z + r * math.sin(a)))
    return convex_hull(pts)


def belt(b, outline, x0, x1, thick=0.08, mat="track"):
    """궤도 고리 (외곽 outline (y,z) 반시계, x0..x1 폭)."""
    inner = inset2(outline, thick)
    r_out0 = [Vector((x0, y, z)) for y, z in outline]
    r_out1 = [Vector((x1, y, z)) for y, z in outline]
    r_in1 = [Vector((x1, y, z)) for y, z in inner]
    r_in0 = [Vector((x0, y, z)) for y, z in inner]
    return b.loft([r_out0, r_out1, r_in1, r_in0], mat, False, closed=True)


def running_gear(b, x_c, width, wheels_y, wheel_r, sprocket_yzr, idler_yzr, thick=0.09, return_rollers=(),
                 rr_r=0.13, segs=12, wheel_mat="paint_dark", sprocket_mat="paint_dark", web=True, n=8,
                 sag=0.0):
    """양쪽 궤도 장치. x_c = 궤도 중심 |x|, wheels_y = 보기륜 y 목록, 바닥 z = 0.
    sprocket_yzr / idler_yzr = (y, z, r). return_rollers = 상부 지지륜 y 목록."""
    zc = thick + wheel_r
    circles = [(y, zc, wheel_r + thick) for y in (wheels_y[0], wheels_y[-1])]
    sy, sz, sr = sprocket_yzr
    iy, iz, ir = idler_yzr
    circles += [(sy, sz, sr + thick * 0.6), (iy, iz, ir + thick)]
    outline = track_outline(circles, n)
    # 위쪽 궤도 처짐: 위쪽 점 중 중간 것들을 살짝 내린다
    for side in (1, -1):
        x0 = side * (x_c - width / 2)
        x1 = side * (x_c + width / 2)
        belt(b, outline, min(x0, x1), max(x0, x1), thick)
        xw = side * x_c
        for y in wheels_y:
            road_wheel(b, (xw - side * width * 0.05, y, zc), wheel_r, width * 0.75, side=side, segs=segs,
                       hub=wheel_mat)
        sprocket(b, (xw, sy, sz), sr, width * 0.7, side=side, mat=sprocket_mat)
        road_wheel(b, (xw - side * width * 0.05, iy, iz), ir, width * 0.7, side=side, segs=segs, hub=wheel_mat)
        top = max(z for _, z in outline)
        for y in return_rollers:
            tube(b, (xw - side * width * 0.3, y, top - thick - rr_r), (xw + side * width * 0.25, y, top - thick - rr_r),
                 rr_r, segs=8, mat=wheel_mat)
    return outline


# ---------------------------------------------------------------- 무장 / 장비

def gun_barrel(b, p0, look, segments, segs=10, muzzle=None):
    """포신. segments = [(길이, 반지름, 재질)] 을 p0 에서 look 방향으로 차례로 (계단 포함)."""
    p0 = Vector(p0)
    d = Vector(look).normalized()
    prof = []
    t = 0.0
    for ln, r, m in segments:
        prof.append((t, r, m))
        t += ln
        prof.append((t, r, m))
    p1 = p0 + d * t
    lathe(b, p0, p1, prof, segs=segs, cap0=segments[0][2], cap1="intake")
    return p0 + d * t


def missile(b, p_tail, look, L, r, nose=0.18, fins=None, fin_mat="paint", segs=8, mat="paint", nose_mat=None,
            fin_t=0.02, fin_roll=45.0):
    """단순 미사일 (꼬리 → 기수 방향 look). fins = [(꼬리에서 거리, 길이, 폭)] (X 배치 4 장)."""
    p_tail = Vector(p_tail)
    d = Vector(look).normalized()
    nl = L * nose
    prof = [(0.0, r * 0.75, "nozzle"), (0.03, r, mat), (L - nl, r, mat)]
    for k in range(1, 4):
        f = k / 4
        prof.append((L - nl + nl * f, r * math.cos(f * math.pi / 2) ** 0.8, nose_mat or mat))
    prof.append((L, 0.0, nose_mat or mat))
    lathe(b, p_tail, p_tail + d * L, prof, segs=segs, cap0="nozzle")
    u, v = basis(d)
    for (x0, ln, span) in (fins or []):
        for k in range(4):
            a = (fin_roll + 90 * k) * DEG
            n = u * math.cos(a) + v * math.sin(a)
            m = n.cross(d).normalized() * (fin_t / 2)
            base0 = p_tail + d * x0 + n * r * 0.8
            base1 = p_tail + d * (x0 + ln) + n * r * 0.8
            tip0 = p_tail + d * (x0 + ln * 0.15) + n * (r + span)
            tip1 = p_tail + d * (x0 + ln * 0.55) + n * (r + span)
            A = [base0, tip0, tip1, base1]
            b.prism([p - m for p in A], [p + m for p in A], fin_mat)


def zu23(u, base, parent=None, name_t="turret", name_b="barrel", scale=1.0, carriage=True, elev=0.0):
    """ZU-23-2 쌍열 23 mm (상부 회전부 + 포신). base = 선회축 바닥점 (모델 좌표).
    turret / barrel 부품을 u 에 추가하고 (turret_builder, barrel_builder) 를 돌려준다."""
    base = Vector(base)
    s = scale
    t = u.part(name_t, base, parent=parent)
    # 회전 받침 + 상부 프레임
    tube(t, base, base + Vector((0, 0, 0.12 * s)), 0.42 * s, segs=12, mat="paint")
    t.box((1.10 * s, 1.0 * s, 0.18 * s), base + Vector((0, -0.05 * s, 0.21 * s)), "paint", bevel=0.03 * s)
    # 양쪽 트러니언 기둥(삼각 받침판)
    for sx in (-1, 1):
        x = sx * 0.50 * s
        A = [base + Vector((x, -0.45 * s, 0.30 * s)), base + Vector((x, 0.45 * s, 0.30 * s)),
             base + Vector((x, 0.05 * s, 0.78 * s))]
        t.prism([p - Vector((0.03 * s, 0, 0)) for p in A], [p + Vector((0.03 * s, 0, 0)) for p in A], "paint")
    # 사수 좌석 2 + 조준기 기둥
    for sx in (-1, 1):
        t.box((0.38 * s, 0.36 * s, 0.07 * s), base + Vector((sx * 0.30 * s, -0.75 * s, 0.50 * s)), "paint_dark",
              bevel=0.015 * s)
        t.box((0.36 * s, 0.06 * s, 0.38 * s), base + Vector((sx * 0.30 * s, -0.95 * s, 0.70 * s)), "paint_dark",
              bevel=0.01 * s)
        t.beam(base + Vector((sx * 0.30 * s, -0.75 * s, 0.30 * s)), base + Vector((sx * 0.30 * s, -0.75 * s, 0.47 * s)),
               0.06 * s, mat="metal")
    t.box((0.12 * s, 0.18 * s, 0.30 * s), base + Vector((-0.14 * s, -0.35 * s, 0.95 * s)), "metal", bevel=0.01 * s)
    # 포신부 (트러니언 축 = base + (0, 0.05, 0.78))
    piv = base + Vector((0, 0.05 * s, 0.78 * s))
    g = u.part(name_b, piv, parent=name_t, rot=(elev, 0.0, 0.0))
    for sx in (-1, 1):
        x = sx * 0.24 * s
        # 기관부(리시버)
        g.box((0.20 * s, 1.20 * s, 0.26 * s), piv + Vector((x, 0.05 * s, 0.0)), "paint", bevel=0.02 * s)
        # 탄약통 (바깥쪽)
        g.box((0.22 * s, 0.48 * s, 0.34 * s), piv + Vector((sx * 0.48 * s, 0.05 * s, -0.04 * s)), "paint_dark",
              bevel=0.02 * s)
        # 포신 + 소염기
        gun_barrel(g, piv + Vector((x, 0.65 * s, 0.03 * s)), (0, 1, 0),
                   [(0.35 * s, 0.045 * s, "paint"), (1.45 * s, 0.022 * s, "metal"), (0.20 * s, 0.035 * s, "metal")],
                   segs=8)
    # 요람(두 포 사이 연결)
    g.box((0.30 * s, 0.70 * s, 0.10 * s), piv + Vector((0, 0.10 * s, -0.10 * s)), "paint", bevel=0.01 * s)
    u.empty("gun", piv + Vector((0, 2.65 * s, 0.03 * s)), parent=name_b)
    return t, g


# ---------------------------------------------------------------- MAZ-543 8x8 차대 (SA-10 TEL, SCUD 공용)

MAZ_WHEEL_R = 0.775
MAZ_AXLES = (3.55, 1.35, -1.95, -4.15)   # 차 중심 기준 y (앞 → 뒤)


def maz543(u, length=11.7, deck_z=1.95, cab_len=2.6, rear_overhang=None, wheel_segs=10, gap_cover=False):
    """MAZ-543 차대: 앞쪽 좌우로 갈라진 두 운전실(사이에 엔진/미사일 기수 자리), 8x8 바퀴, 긴 화물대.
    길이 방향 중심 = y 0. 반환 dict(front, rear, deck_z, cab_back)."""
    b = u.b
    W = 3.05
    yf, yr = length / 2, -length / 2
    wr = MAZ_WHEEL_R
    # 프레임 (낮은 사다리 프레임 + 앞뒤 범퍼)
    b.box((1.1, length - 0.6, 0.55), (0, -0.1, 1.05), "paint_dark")
    # 바퀴 위 흙받이 겸 측면 박스 (좌우 펜더 데크)
    y_cab_back = yf - cab_len
    for sx in (-1, 1):
        # 펜더 띠: 운전실 뒤 ~ 차 끝
        b.box((0.62, y_cab_back - yr - 0.3, 0.16), (sx * (W / 2 - 0.31), (y_cab_back + yr) / 2 - 0.15, 1.72), "paint",
              bevel=0.03)
        # 바퀴 사이 측면 공구함
        b.box((0.42, 1.3, 0.55), (sx * (W / 2 - 0.30), -0.30, 1.30), "paint", bevel=0.04)
        b.box((0.42, 1.1, 0.55), (sx * (W / 2 - 0.30), 2.45, 1.30), "paint", bevel=0.04)
    # 화물대(데크)
    b.box((W - 1.25, y_cab_back - yr - 0.2, 0.30), (0, (y_cab_back + yr) / 2 - 0.1, deck_z - 0.15), "paint",
          bevel=0.04)
    # 엔진실 (두 운전실 사이, 낮고 앞은 라디에이터 그릴)
    eng_w = 0.95
    b.box((eng_w, cab_len + 0.2, 0.95), (0, yf - cab_len / 2 - 0.15, 1.75), "paint", bevel=0.05)
    b.box((eng_w * 0.85, 0.05, 0.55), (0, yf - 0.03, 1.75), "intake")
    if gap_cover:
        b.box((eng_w, cab_len, 0.2), (0, yf - cab_len / 2, 2.30), "paint")
    # 앞 범퍼
    b.box((W - 0.1, 0.35, 0.40), (0, yf - 0.05, 0.95), "paint_dark", bevel=0.05)
    # 운전실 2 개 (유리섬유 운전실: 앞 유리 경사 + 옆 유리 + 둥근 지붕)
    cab_w = (W - eng_w) / 2 - 0.05
    for sx in (-1, 1):
        cx = sx * (eng_w / 2 + 0.05 + cab_w / 2)
        y0, y1 = y_cab_back, yf - 0.05
        prof = [(y0, 1.25), (y1 - 0.05, 1.25), (y1, 1.60), (y1 - 0.35, 2.75), (y1 - 0.6, 2.95), (y0 + 0.1, 2.95),
                (y0, 2.85)]
        side_prism(b, prof, cx - cab_w / 2, cx + cab_w / 2, "paint")
        # 앞 유리 (경사면 위) + 옆 유리
        ga = Vector((0, y1 - 0.06, 1.72))
        gb = Vector((0, y1 - 0.36, 2.68))
        mid = (ga + gb) / 2
        ang = math.atan2(gb.y - ga.y, gb.z - ga.z)
        b.box((cab_w - 0.18, 0.04, (gb - ga).length - 0.08), (cx, mid.y + 0.02, mid.z),
              "glass", rot=Matrix.Rotation(ang, 3, "X") @ Matrix.Identity(3) if False else _rx(-ang))
        xs = cx + sx * (cab_w / 2 + 0.005)
        b.box((0.03, 1.0, 0.55), (xs, y1 - 1.05, 2.45), "glass")
        b.box((0.03, 0.55, 0.85), (xs, y0 + 0.55, 2.10), "paint_dark")  # 문 윤곽
        # 헤드라이트
        b.box((0.28, 0.06, 0.16), (cx, y1 + 0.02, 1.42), "light")
        # 앞 유리 와이퍼/챙
        b.box((cab_w - 0.1, 0.25, 0.05), (cx, y1 - 0.62, 2.96), "paint_dark")
    # 바퀴 8 쌍
    for y in MAZ_AXLES:
        for sx in (-1, 1):
            wheel(b, (sx * (W / 2 - 0.36), y, wr), wr, 0.60, side=sx, segs=wheel_segs)
    # 바퀴 위 흙받이 아치(앞 두 축)
    for sx in (-1, 1):
        for y in MAZ_AXLES[:2]:
            b.box((0.66, 1.75, 0.08), (sx * (W / 2 - 0.36), y, 1.62), "paint_dark")
    return dict(front=yf, rear=yr, deck_z=deck_z, cab_back=y_cab_back, W=W)


def _rx(a):
    return Matrix.Rotation(a, 3, "X")


def _ry(a):
    return Matrix.Rotation(a, 3, "Y")


def _rz(a):
    return Matrix.Rotation(a, 3, "Z")


rx, ry, rz = _rx, _ry, _rz


# ---------------------------------------------------------------- 함정 선체

def ship_hull(b, L, B, T, fb_mid, fb_bow, fb_stern, n=28, bow_frac=0.32, stern_w=0.78, rake=0.12, flare=0.10,
              bow_v=1.0, keel_rise_bow=0.55, stern_rise=0.25, deck_mat="deck", knuckle=None, y0=None,
              transom_z=None):
    """선체 로프트. 원점 = 흘수선 중앙, 흘수선 z = 0, 선수 = +Y.
    L = 수선 길이 근사(m), B = 최대 폭, T = 흘수, fb_* = 건현(갑판 높이) 중앙/선수/선미.
    bow_frac = 선수 쪽으로 좁아지는 구간 비율, stern_w = 트랜섬 폭 비율, rake = 선수재 경사(갑판 높이당 y 이동 비율),
    flare = 선수 갑판 벌어짐. 재질: 갑판 deck_mat, 현측 paint, 수선대 boot, 수선 아래 hull_red.
    반환: deck_fn(y) → (반폭, 갑판 높이)."""
    y0 = -L / 2 if y0 is None else y0
    y1 = y0 + L

    def tpos(i):
        f = i / n
        # 선수 쪽 단면을 촘촘히
        return 1 - (1 - f) ** 1.35 if False else f

    def wl_half(t):
        # 수선 반폭 (t 0 = 선미, 1 = 선수)
        if t > 1 - bow_frac:
            s = (t - (1 - bow_frac)) / bow_frac
            return B / 2 * max(0.02, (1 - s ** 1.9)) ** 0.85
        if t < 0.18:
            s = (0.18 - t) / 0.18
            return B / 2 * (1 - (1 - stern_w) * s ** 1.6)
        return B / 2

    def freeboard(t):
        if t >= 0.5:
            s = (t - 0.5) / 0.5
            return fb_mid + (fb_bow - fb_mid) * s ** 2.2
        s = (0.5 - t) / 0.5
        return fb_mid + (fb_stern - fb_mid) * s ** 2

    def deck_half(t):
        s = max(0.0, (t - (1 - bow_frac * 1.1)) / (bow_frac * 1.1))
        wl = wl_half(t)
        fl = 1.0 + flare * (s ** 0.7) * (1 - s ** 3)
        dh = wl * (1.03 + 0.0) * fl
        if t > 0.985:
            dh = max(dh, 0.15)
        return min(dh, B / 2 * 1.04)

    def fullness(t):
        if t > 1 - bow_frac:
            s = (t - (1 - bow_frac)) / bow_frac
            return max(0.0, 1 - s * 1.5 * bow_v)
        if t < 0.15:
            return 0.65 + 0.35 * t / 0.15
        return 1.0

    FULL = [1.0, 0.995, 0.97, 0.86, 0.50]
    VEE = [1.0, 0.70, 0.42, 0.18, 0.04]
    ZF = [0.0, -0.35, -0.70, -0.92, -1.0]

    rings, info = [], []
    for i in range(n + 1):
        t = i / n
        y = y0 + L * t
        wl = wl_half(t)
        fb = freeboard(t)
        dh = deck_half(t)
        fu = fullness(t)
        # 용골 높이 (선수/선미에서 들림)
        keel = -T
        if t > 1 - bow_frac * 0.5:
            s = (t - (1 - bow_frac * 0.5)) / (bow_frac * 0.5)
            keel = -T * (1 - keel_rise_bow * s ** 1.5)
        if t < 0.12:
            s = (0.12 - t) / 0.12
            keel = -T * (1 - stern_rise * s)
        # 선수재 경사: z 에 따라 y 이동
        rk = 0.0
        if t > 0.9:
            rk = rake * ((t - 0.9) / 0.1) ** 1.5
        side = []
        side.append((dh, fb))
        if knuckle:
            side.append((dh * 0.995 + (wl - dh) * 0.15, fb * knuckle))
        side.append((wl + (dh - wl) * 0.12, 1.0 if fb > 2.5 else fb * 0.4))   # 수선대 위
        for k in range(5):
            f = FULL[k] * fu + VEE[k] * (1 - fu)
            z = ZF[k] * (-keel) if k else 0.0
            side.append((max(wl * f, 0.02), z))
        pts = []
        for (x, z) in side:
            pts.append(Vector((x, y + rk * z, z)))
        left = [Vector((-p.x, p.y, p.z)) for p in reversed(pts)]
        ring = pts + left
        rings.append(ring)
        info.append((y, dh, fb))
    nside = len(rings[0]) // 2
    ki = 1 if knuckle else 0

    def mat_fn(i, j):
        # j: 0..2*nside-1. 0..nside-2 오른쪽 위→아래, nside-1 바닥, nside..2nside-2 왼쪽 아래→위, 2nside-1 갑판
        if j == 2 * nside - 1:
            return deck_mat
        jj = j if j < nside else 2 * nside - 2 - j
        if jj <= ki:
            return "paint"
        if jj == ki + 1:
            return "boot"
        return "hull_red"

    vr = b.loft(rings, "paint", True, mat_fn=mat_fn)
    # 트랜섬(선미 평판) / 선수 끝 막기
    b.face(list(reversed(vr[0])), "paint", False)
    b.face(vr[-1], "paint", False)
    # 갑판 모서리 / 수선 아래는 각진 경계로 (smooth 플래그는 유지하고 sharp 각도로 처리)

    def deck_at(yq):
        if yq <= info[0][0]:
            return info[0][1], info[0][2]
        for (ya, ha, fa), (yb, hb, fb_) in zip(info, info[1:]):
            if ya <= yq <= yb:
                f = (yq - ya) / (yb - ya)
                return ha + (hb - ha) * f, fa + (fb_ - fa) * f
        return info[-1][1], info[-1][2]

    return deck_at


def deck_edge_rail(b, deck_at, y0, y1, step=4.0, h=0.9, mat="metal", inset=0.15):
    """갑판 가장자리 난간(얇은 띠)."""
    ys = []
    y = y0
    while y < y1:
        ys.append(y)
        y += step
    ys.append(y1)
    for sx in (-1, 1):
        for ya, yb in zip(ys, ys[1:]):
            ha, za = deck_at(ya)
            hb, zb = deck_at(yb)
            p0 = Vector((sx * (ha - inset), ya, za + h))
            p1 = Vector((sx * (hb - inset), yb, zb + h))
            b.beam(p0, p1, 0.05, mat=mat, caps=False)


def camo(b, src="paint", dst="paint_dark", cell=1.4, thresh=0.18, scale=3.2, seed=0.0, min_area=None):
    """'paint' 면을 격자로 잘라 노이즈 기준 일부를 'paint_dark' 로 (디지털 위장 무늬)."""
    bm = b.bm
    si = b.mi(src)
    di = b.mi(dst)
    min_area = (cell * cell * 0.6) if min_area is None else min_area
    faces = [f for f in bm.faces if f.material_index == si and f.calc_area() > min_area]
    if faces:
        lo = Vector((min(v.co.x for f in faces for v in f.verts), min(v.co.y for f in faces for v in f.verts),
                     min(v.co.z for f in faces for v in f.verts)))
        hi = Vector((max(v.co.x for f in faces for v in f.verts), max(v.co.y for f in faces for v in f.verts),
                     max(v.co.z for f in faces for v in f.verts)))
        for ax in range(3):
            no = Vector((0, 0, 0))
            no[ax] = 1.0
            c = math.floor(lo[ax] / cell) * cell + cell
            while c < hi[ax]:
                cur = [f for f in bm.faces if f.material_index == si and f.calc_area() > min_area * 0.25]
                geom = list({e for f in cur for e in f.edges}) + cur + list({v for f in cur for v in f.verts})
                co = Vector((0, 0, 0))
                co[ax] = c
                bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=co, plane_no=no)
                c += cell
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
    for f in bm.faces:
        if f.material_index != si:
            continue
        p = f.calc_center_median() / scale + off
        if mnoise.noise(p) > thresh:
            f.material_index = di
