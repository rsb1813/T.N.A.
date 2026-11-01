"""T.N.A. 무장/건물 공용 생성기 (헤드리스 Blender 용).

무장 스크립트는 `tools/blender/weapons/<모델 id>.py` 이고 이렇게 실행한다:

    blender -b --factory-startup -P tools/blender/weapons/aim120.py -- public/models/aim120.glb

인자를 생략하면 `public/models/<id>.glb` 로 저장한다. 건물 스크립트(`tools/blender/units/*.py`)도
이 모듈의 Builder/Building 을 쓴다.

좌표(Blender): 기수/정면 = +Y, 위 = +Z, 오른쪽 = +X, 1 단위 = 1 m. glTF 로 내보내면 기수 = -Z.

무장 규칙 (docs/architecture.md 7장)
- 원점 = 장착 러그(위쪽 중앙). 몸통 축은 z = -(반지름 + 러그 높이) 에 있다.
- 축 방향 위치는 '기수 끝에서 뒤로 잰 거리 x(m)' 로 적는다 → Blender y = lug_x - x.
- 단면 각도 phi(도)는 +X(오른쪽)에서 +Z(위)쪽으로 잰다. X 배치 = (45, 135, 225, 315).
- 주 도장 재질 'paint'. 그 밖에 paint_dark, radome, metal, nozzle, canopy(시커 유리), intake,
  band_he(노란 탄두 띠), band_motor(갈색 로켓 모터 띠).
- 미사일은 모터 출구에 empty 'nozzle' 을 둔다 (연기 꼬리 위치).
- 삼각형 ≤ 800 (finish 에서 검사).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, ".."))
import tna  # noqa: E402

DEG = math.pi / 180.0
X_FINS = (45, 135, 225, 315)
PLUS_FINS = (0, 90, 180, 270)

# ---------------------------------------------------------------- 재질

# 리니어 색. (color, roughness, metallic, emission)
PALETTE = {
    "paint": ((0.58, 0.60, 0.61), 0.45, 0.0, None),
    "paint_dark": ((0.12, 0.125, 0.13), 0.5, 0.0, None),
    "radome": ((0.50, 0.50, 0.47), 0.4, 0.0, None),
    "metal": ((0.45, 0.46, 0.48), 0.35, 0.9, None),
    "nozzle": ((0.03, 0.028, 0.026), 0.55, 0.6, None),
    "canopy": ((0.10, 0.07, 0.02), 0.06, 0.9, None),
    "intake": ((0.012, 0.012, 0.012), 0.9, 0.0, None),
    "band_he": ((0.89, 0.52, 0.01), 0.5, 0.0, None),
    "band_motor": ((0.17, 0.064, 0.013), 0.6, 0.0, None),
    "glass": ((0.03, 0.045, 0.06), 0.08, 0.7, None),
    "glow": ((1.0, 0.08, 0.04), 0.5, 0.0, (1.0, 0.08, 0.04)),
    "rubber": ((0.02, 0.02, 0.02), 0.9, 0.0, None),
    "earth": ((0.10, 0.11, 0.06), 0.95, 0.0, None),
    "band_red": ((0.55, 0.05, 0.03), 0.6, 0.0, None),
}

CONCRETE = (0.155, 0.152, 0.138)

OLIVE = (0.075, 0.085, 0.045)      # 미군 폭탄 올리브 드랍
GULL_GREY = (0.40, 0.42, 0.43)     # 회색 무장/포드
WHITE = (0.72, 0.73, 0.73)         # 흰색 미사일


def get_material(name, colors=None):
    """이름별로 한 번만 만든다. colors[name] 로 색(또는 (색, 거칠기, 금속성)) 덮어쓰기."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    color, rough, metal, emis = PALETTE.get(name, ((0.5, 0.5, 0.5), 0.5, 0.0, None))
    over = (colors or {}).get(name)
    if over is not None:
        if len(over) == 3 and isinstance(over[0], (int, float)):
            color = over
        else:
            color, rough, metal = over[0], over[1], over[2]
    mat = tna.material(name, color=(*color, 1.0), roughness=rough, metallic=metal,
                       emission=None if emis is None else (*emis, 1.0))
    mat.use_backface_culling = True  # 닫힌 메쉬만 만든다 → glTF doubleSided=false
    mat.diffuse_color = (*color, 1.0)
    return mat


# ---------------------------------------------------------------- 메쉬 빌더

def ring_points(center, u, v, r, segs, roll=0.0):
    """center 를 중심으로 u,v 평면의 원 (u→v 방향, roll 라디안부터)."""
    if r <= 1e-9:
        return [Vector(center)]
    out = []
    for k in range(segs):
        a = roll + 2 * math.pi * k / segs
        out.append(Vector(center) + (Vector(u) * math.cos(a) + Vector(v) * math.sin(a)) * r)
    return out


def basis(axis):
    """축 벡터에 수직인 정규직교 u, v."""
    a = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    u = a.cross(ref).normalized()
    v = a.cross(u).normalized()
    return u, v


class Builder:
    """오브젝트 하나 분량의 bmesh + 재질 슬롯."""

    def __init__(self, sharp_deg=50.0):
        self.bm = bmesh.new()
        self.mats = []
        self.sharp_deg = sharp_deg

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def verts(self, pts):
        return [self.bm.verts.new(Vector(p)) for p in pts]

    def face(self, verts, mat, smooth=False):
        f = self.bm.faces.new(verts)
        f.material_index = self.mi(mat)
        f.smooth = smooth
        return f

    def poly(self, pts, mat, smooth=False):
        return self.face(self.verts(pts), mat, smooth)

    # -- 기본형 --------------------------------------------------------------

    def loft(self, rings, mats, smooth=True, cap0=None, cap1=None, closed=False, mat_fn=None, wrap=True):
        """같은 개수의 점 링들을 차례로 잇는다(점 1개 링 = 꼭짓점). mats: 구간별 재질 또는 하나.
        cap0/cap1: 처음/끝 링을 막는 재질(None = 열림). closed: 마지막 링을 첫 링에 잇는다(고리).
        mat_fn(i, j) → 재질: 구간 i 의 j 번째 면 재질을 따로 정할 때 (None 이면 mats).
        wrap=False 면 링을 닫힌 고리가 아닌 열린 선(아치 단면 등)으로 본다."""
        nseg = len(rings) if closed else len(rings) - 1
        if isinstance(mats, str):
            mats = [mats] * nseg
        vr = [self.verts(r) for r in rings]
        for i in range(nseg):
            a, b, m = vr[i], vr[(i + 1) % len(vr)], mats[i]
            if mat_fn is not None:
                n = max(len(a), len(b))
                for j in range(n if wrap else n - 1):
                    mm = mat_fn(i, j) or m
                    if len(a) == 1:
                        self.face([a[0], b[j], b[(j + 1) % n]], mm, smooth)
                    elif len(b) == 1:
                        self.face([a[j], a[(j + 1) % n], b[0]], mm, smooth)
                    else:
                        self.face([a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]], mm, smooth)
                continue
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                n = len(b)
                for j in range(n):
                    self.face([a[0], b[j], b[(j + 1) % n]], m, smooth)
            elif len(b) == 1:
                n = len(a)
                for j in range(n):
                    self.face([a[j], a[(j + 1) % n], b[0]], m, smooth)
            else:
                n = len(a)
                for j in range(n if wrap else n - 1):
                    self.face([a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]], m, smooth)
        if closed:
            return vr
        if cap0 and len(vr[0]) > 2:
            self.face(list(reversed(vr[0])), cap0, False)
        if cap1 and len(vr[-1]) > 2:
            self.face(vr[-1], cap1, False)
        return vr

    def prism(self, a_pts, b_pts, mat, cap_mat=None, smooth=False, side_mats=None):
        """다각형 a 와 그에 대응하는 다각형 b 로 닫힌 각기둥. side_mats[j] = 변 j→j+1 옆면 재질."""
        va, vb = self.verts(a_pts), self.verts(b_pts)
        n = len(va)
        self.face(list(reversed(va)), cap_mat or mat, False)
        self.face(vb, cap_mat or mat, False)
        for j in range(n):
            sm = (side_mats[j] if side_mats and side_mats[j] else mat)
            self.face([va[j], va[(j + 1) % n], vb[(j + 1) % n], vb[j]], sm, smooth)
        return va, vb

    def extrude(self, pts, offset, mat, cap_mat=None):
        """평면 다각형 pts 를 offset 벡터만큼 밀어낸 각기둥."""
        off = Vector(offset)
        return self.prism(pts, [Vector(p) + off for p in pts], mat, cap_mat)

    def box(self, size, center, mat, rot=None, bevel=0.0):
        """축 정렬(또는 rot: 3x3 Matrix/Euler) 박스. bevel>0 이면 모서리 모따기 1단."""
        m = Matrix.Diagonal((*size, 1.0))
        if rot is not None:
            m = rot.to_matrix().to_4x4() @ m if hasattr(rot, "to_matrix") else Matrix(rot).to_4x4() @ m
        m = Matrix.Translation(Vector(center)) @ m
        geom = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        verts = geom["verts"]
        faces = {f for v in verts for f in v.link_faces}
        mi = self.mi(mat)
        for f in faces:
            f.material_index = mi
            f.smooth = False
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            res = bmesh.ops.bevel(self.bm, geom=list(verts) + edges, offset=bevel, segments=1,
                                  affect="EDGES", profile=0.5, clamp_overlap=True)
            for f in res["faces"]:
                f.material_index = mi
                f.smooth = False
        return verts

    def cyl(self, p0, p1, r0, r1=None, segs=12, mat="paint", cap0=True, cap1=True, smooth=True,
            roll=0.0, cap_mat=None):
        """p0→p1 축 원기둥/원뿔대. cap0/cap1: 끝 막기."""
        r1 = r0 if r1 is None else r1
        u, v = basis(Vector(p1) - Vector(p0))
        rings = [ring_points(p0, u, v, r0, segs, roll), ring_points(p1, u, v, r1, segs, roll)]
        cm = cap_mat or mat
        return self.loft(rings, mat, smooth, cap0=cm if cap0 else None, cap1=cm if cap1 else None)

    def beam(self, p0, p1, w, h=None, mat="metal", up=(0, 0, 1), caps=True):
        """p0→p1 사각 단면 부재 (w x h). up 은 단면 방향 기준."""
        h = w if h is None else h
        a = (Vector(p1) - Vector(p0)).normalized()
        upv = Vector(up)
        if abs(a.dot(upv.normalized())) > 0.95:
            upv = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
        s = a.cross(upv).normalized() * (w / 2)
        t = s.cross(a).normalized() * (h / 2)
        quad = [-s - t, s - t, s + t, -s + t]
        rings = [[Vector(p0) + q for q in quad], [Vector(p1) + q for q in quad]]
        return self.loft(rings, mat, False, cap0=mat if caps else None, cap1=mat if caps else None)

    def tri_beam(self, p0, p1, w, mat="metal", up=(0, 0, 1)):
        """삼각 단면 가는 부재 (격자탑 등, 삼각형 6개)."""
        a = (Vector(p1) - Vector(p0)).normalized()
        upv = Vector(up)
        if abs(a.dot(upv.normalized())) > 0.95:
            upv = Vector((1, 0, 0))
        s = a.cross(upv).normalized()
        t = s.cross(a).normalized()
        r = w * 0.58
        tri = [s * r * math.cos(k * 2 * math.pi / 3) + t * r * math.sin(k * 2 * math.pi / 3) for k in range(3)]
        rings = [[Vector(p0) + q for q in tri], [Vector(p1) + q for q in tri]]
        return self.loft(rings, mat, False)

    # -- 오브젝트로 ----------------------------------------------------------

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def to_object(self, name, colors=None, origin=None, collection=None):
        bm = self.bm
        if origin is not None:
            bmesh.ops.translate(bm, verts=bm.verts, vec=-Vector(origin))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        flags = [f.smooth for f in bm.faces]
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(get_material(m, colors))
        # 각도 기준 날카로운 모서리. (이 함수는 모든 면을 부드럽게 바꾸므로 평면 면 표시를 다시 적용)
        me.set_sharp_from_angle(angle=self.sharp_deg * DEG)
        me.polygons.foreach_set("use_smooth", flags)
        me.update()
        obj = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(obj)
        if origin is not None:
            obj.location = Vector(origin)
        return obj


def add_empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.scene.collection.objects.link(e)
    e.location = Vector(loc)
    if parent is not None:
        e.parent = parent
    return e


def out_path(model_id):
    args = tna.script_args()
    return args[0] if args else os.path.join(REPO, "public", "models", f"{model_id}.glb")


def export(path, budget, model_id):
    tna.export_glb(path)
    st = tna.scene_stats()
    tris = st["triangles"]
    status = "OK" if tris <= budget else "OVER BUDGET"
    print(f"[tna] {model_id}: {tris} tris (예산 {budget}) {status}")
    if tris > budget:
        raise SystemExit(f"{model_id}: 삼각형 {tris} > {budget}")
    if len(tna.script_args()) > 1:
        tna.save_blend(tna.script_args()[1])
    return tris


# ---------------------------------------------------------------- 단면 프로필 (x = 기수에서 뒤로, r = 반지름)

def _lerp(a, b, t):
    return a + (b - a) * t


def ogive(x0, length, R, tip_r=0.0, n=6, mat="paint", cap=True):
    """접선 오자이브 기수 (x0 = 끝). tip_r>0 이면 끝을 둥글게 뭉갠다.
    cap=False 면 뭉갠 끝(반지름 tip_r 이하)을 빼고 반지름 tip_r 링부터 돌려준다(신관 등을 따로 붙일 때)."""
    rho = (R * R + length * length) / (2 * R)

    def r_at(xp):
        return math.sqrt(max(rho * rho - (length - xp) ** 2, 0.0)) + R - rho

    pts = []
    x_start = 0.0
    if tip_r > 0:
        # r(x)=tip_r 인 지점 찾기
        lo, hi = 0.0, length
        for _ in range(40):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if r_at(mid) < tip_r else (lo, mid)
        x_start = lo
        if cap:
            pts.append((x0 + max(x_start - tip_r * 0.55, 0.0), 0.0, mat))
            pts.append((x0 + max(x_start - tip_r * 0.15, 0.0), tip_r * 0.78, mat))
        else:
            pts.append((x0 + x_start, tip_r, mat))
    else:
        pts.append((x0, 0.0, mat))
    for i in range(1, n + 1):
        t = i / n
        t = 0.55 * t + 0.45 * (1 - math.cos(t * math.pi / 2))
        xp = _lerp(x_start, length, t)
        pts.append((x0 + xp, r_at(xp), mat))
    return pts


def ogive_tail(x0, length, R, r_end, n=6, mat="paint"):
    """뒤로 갈수록 가늘어지는 오자이브 꼬리 (x0 에서 반지름 R → x0+length 에서 r_end)."""
    Rb = R - r_end
    rho = (Rb * Rb + length * length) / (2 * Rb)
    pts = []
    for i in range(0, n + 1):
        t = i / n
        t = 0.55 * t + 0.45 * math.sin(t * math.pi / 2)
        xp = length * t  # 꼬리 쪽으로
        xt = length - xp  # 꼬리 끝에서 잰 거리
        r = math.sqrt(max(rho * rho - (length - xt) ** 2, 0.0)) + Rb - rho
        pts.append((x0 + xp, r_end + r, mat))
    return pts


def power_nose(x0, length, R, k=0.6, n=6, mat="paint", tip=True):
    """r = R (x/L)^k 둔한 레이돔/폭탄 코. k 0.5=둥근 레이돔, 0.75=뾰족한 편."""
    pts = [(x0, 0.0, mat)] if tip else []
    for i in range(1, n + 1):
        t = (i / n) ** 1.6
        pts.append((x0 + length * t, R * t ** k, mat))
    return pts


def ellipse_nose(x0, length, R, n=5, mat="paint", tip=True):
    pts = [(x0, 0.0, mat)] if tip else []
    for i in range(1, n + 1):
        th = (math.pi / 2) * i / n
        pts.append((x0 + length * (1 - math.cos(th)), R * math.sin(th), mat))
    return pts


def dome(x0, rd, n=4, mat="canopy"):
    """반구 유리 돔 (x0 = 끝). 마지막 점 반지름 = rd."""
    pts = [(x0, 0.0, mat)]
    for i in range(1, n + 1):
        th = (math.pi / 2) * i / n
        pts.append((x0 + rd * (1 - math.cos(th)), rd * math.sin(th), mat))
    return pts


def nozzle_end(x_base, r_base, r_exit, depth=0.06, mat="nozzle", lip_mat="paint_dark"):
    """평평한 바닥 고리 → 안쪽으로 들어간 노즐 (x 가 다시 앞으로 간다)."""
    return [
        (x_base, r_base, lip_mat),
        (x_base, r_exit, mat),
        (x_base - depth, r_exit * 0.85, mat),
        (x_base - depth, 0.0, mat),
    ]


# ---------------------------------------------------------------- 무장

class Store:
    """미사일/폭탄/포드/탱크 한 개. 원점 = 위쪽 러그 중앙, 기수 = +Y."""

    def __init__(self, model_id, length, diameter, lug_x, lug_h=0.03, segs=16, colors=None,
                 budget=800):
        self.id = model_id
        self.L = length
        self.R = diameter / 2
        self.lug_x = lug_x
        self.lug_h = lug_h
        self.zc = -(self.R + lug_h)
        self.segs = segs
        self.colors = dict(colors or {})
        self.budget = budget
        self.b = Builder()
        self.outline = [(0.0, 0.0), (length, self.R)]
        self.children = []   # (name, Builder, pivot)
        self.empties = []    # (name, loc)

    # 좌표 -----------------------------------------------------------------
    def Y(self, x):
        return self.lug_x - x

    def axis(self, x):
        return Vector((0.0, self.Y(x), self.zc))

    def P(self, x, rad, phi):
        a = phi * DEG
        return Vector((rad * math.cos(a), self.Y(x), self.zc + rad * math.sin(a)))

    def dirs(self, phi):
        a = phi * DEG
        return Vector((math.cos(a), 0.0, math.sin(a))), Vector((-math.sin(a), 0.0, math.cos(a)))

    def radius_at(self, x):
        o = self.outline
        if x <= o[0][0]:
            return o[0][1]
        for (xa, ra), (xb, rb) in zip(o, o[1:]):
            if xa <= x <= xb:
                return ra if xb - xa < 1e-9 else _lerp(ra, rb, (x - xa) / (xb - xa))
        return o[-1][1]

    # 몸통 -----------------------------------------------------------------
    def body(self, pts, bands=(), segs=None, roll=None, builder=None):
        """회전체 몸통. pts = [(x, r, 재질)] 기수→꼬리(노즐 안쪽은 x 가 줄어도 됨).
        bands = [(x 시작, 폭, 재질)] 색띠."""
        pts_in, pts = list(pts), []
        for p in pts_in:  # 같은 점이 연달아 오면 뒤의 것(재질)만 남긴다
            if pts and abs(pts[-1][0] - p[0]) < 1e-6 and abs(pts[-1][1] - p[1]) < 1e-6:
                pts[-1] = p
            else:
                pts.append(p)
        # x 가 증가하는 구간(바깥 윤곽)
        mono = 1
        while mono < len(pts) and pts[mono][0] >= pts[mono - 1][0] - 1e-9:
            mono += 1
        for x0, w, m in bands:
            for xb in (x0, x0 + w):
                for i in range(mono - 1):
                    xa, ra, ma = pts[i]
                    xc, rc, _ = pts[i + 1]
                    if abs(xb - xa) < 1e-6 or abs(xb - xc) < 1e-6:
                        break
                    if xa < xb < xc:
                        pts.insert(i + 1, (xb, _lerp(ra, rc, (xb - xa) / (xc - xa)), ma))
                        mono += 1
                        break
            for i in range(mono - 1):
                if pts[i][0] >= x0 - 1e-6 and pts[i + 1][0] <= x0 + w + 1e-6:
                    pts[i] = (pts[i][0], pts[i][1], m)
        if builder is None:
            self.outline = [(x, r) for x, r, _ in pts[:mono]]
        segs = segs or self.segs
        roll = (math.pi / 2 + math.pi / segs) if roll is None else roll
        u, v = Vector((1, 0, 0)), Vector((0, 0, 1))
        rings = [ring_points(self.axis(x), u, v, r, segs, roll) for x, r, _ in pts]
        mats = [m for _, _, m in pts[:-1]]
        (builder or self.b).loft(rings, mats, smooth=True)
        return pts

    def section_body(self, sections, mats, smooth=True, cap0=None, cap1=None, builder=None):
        """비원형 몸통. sections = [(x, [(sx, sz), ...])] 축 기준 단면 좌표."""
        rings = []
        for x, sec in sections:
            rings.append([Vector((sx, self.Y(x), self.zc + sz)) for sx, sz in sec])
        return (builder or self.b).loft(rings, mats, smooth, cap0, cap1)

    # 날개 -----------------------------------------------------------------
    def fins(self, x_le, planform, phis=X_FINS, t=0.008, t_tip=None, mat="paint", embed=0.92,
             r_ref=None, builder=None):
        """평면형 [(s, c)] — s = 뿌리(몸통 표면)에서 바깥으로, c = 뿌리 앞전에서 뒤로 (m).
        s=0 인 점은 그 위치 몸통 표면 안쪽에 묻고, 나머지는 r_ref(기본: 앞전 위치 반지름)+s."""
        t_tip = t * 0.6 if t_tip is None else t_tip
        r_ref = self.radius_at(x_le) if r_ref is None else r_ref
        smax = max(s for s, _ in planform) or 1.0
        b = builder or self.b
        for phi in phis:
            d, n = self.dirs(phi)
            A, B = [], []
            for s, c in planform:
                x = x_le + c
                rad = self.radius_at(x) * embed if s <= 1e-6 else r_ref + s
                base = self.axis(x) + d * rad
                th = _lerp(t, t_tip, s / smax)
                A.append(base - n * th / 2)
                B.append(base + n * th / 2)
            b.prism(A, B, mat)

    def grid_fins(self, x_front, span, width, depth, phis=X_FINS, n=3, frame_t=0.008, slat_t=0.004,
                  gap=0.012, mat="paint", slat_mat="paint_dark"):
        """격자 날개 (R-77). 격자면이 기류를 마주본다. span = 반지름 방향 길이, width = 둘레 방향 폭."""
        r0 = self.radius_at(x_front + depth / 2) + gap
        y0, y1 = self.Y(x_front), self.Y(x_front + depth)
        for phi in phis:
            d, nn = self.dirs(phi)
            c = Vector((0.0, 0.0, self.zc))

            def P(rd, tg, y):
                p = c + d * rd + nn * tg
                return Vector((p.x, y, p.z))

            # 테두리 (사각 고리 각기둥)
            ro, ri = r0 + span, r0
            wo, wi = width / 2, width / 2 - frame_t
            outer = [(ri, -wo), (ro, -wo), (ro, wo), (ri, wo)]
            inner = [(ri + frame_t, -wi), (ro - frame_t, -wi), (ro - frame_t, wi), (ri + frame_t, wi)]
            vo0 = self.b.verts([P(a, b_, y0) for a, b_ in outer])
            vo1 = self.b.verts([P(a, b_, y1) for a, b_ in outer])
            vi0 = self.b.verts([P(a, b_, y0) for a, b_ in inner])
            vi1 = self.b.verts([P(a, b_, y1) for a, b_ in inner])
            for j in range(4):
                k = (j + 1) % 4
                self.b.face([vo0[j], vo0[k], vi0[k], vi0[j]], mat)
                self.b.face([vo1[k], vo1[j], vi1[j], vi1[k]], mat)
                self.b.face([vo0[k], vo0[j], vo1[j], vo1[k]], mat)
                self.b.face([vi0[j], vi0[k], vi1[k], vi1[j]], mat)
            # 45° 격자판
            lo_r, hi_r = ri + frame_t, ro - frame_t
            lo_t, hi_t = -wi, wi
            for sgn in (1, -1):
                for k in range(1, 2 * n + 1, 2):
                    # 선: r - sgn*t = cst
                    cst = _lerp(lo_r - hi_t, hi_r - lo_t, k / (2 * n)) if sgn == 1 else \
                        _lerp(lo_r + lo_t, hi_r + hi_t, k / (2 * n))
                    seg = []
                    for tt in (lo_t, hi_t):
                        rr = cst + sgn * tt
                        if lo_r - 1e-6 <= rr <= hi_r + 1e-6:
                            seg.append((rr, tt))
                    for rr in (lo_r, hi_r):
                        tt = (rr - cst) * sgn
                        if lo_t - 1e-6 <= tt <= hi_t + 1e-6:
                            seg.append((rr, tt))
                    seg = sorted(set((round(a, 6), round(b_, 6)) for a, b_ in seg))
                    if len(seg) < 2:
                        continue
                    (ra, ta), (rb, tb) = seg[0], seg[-1]
                    dr, dt = rb - ra, tb - ta
                    ln = math.hypot(dr, dt)
                    nr, nt = -dt / ln * slat_t / 2, dr / ln * slat_t / 2
                    quad = [(ra - nr, ta - nt), (ra + nr, ta + nt), (rb + nr, tb + nt), (rb - nr, tb - nt)]
                    q0 = self.b.verts([P(a, b_, y0) for a, b_ in quad])
                    q1 = self.b.verts([P(a, b_, y1) for a, b_ in quad])
                    for j in range(4):
                        kk = (j + 1) % 4
                        if j in (1, 3):
                            continue  # 끝면은 테두리 속에 묻힌다
                        self.b.face([q0[j], q0[kk], q1[kk], q1[j]], slat_mat)
                    self.b.face([q0[0], q0[1], q0[2], q0[3]], slat_mat)
                    self.b.face([q1[3], q1[2], q1[1], q1[0]], slat_mat)
            # 힌지 받침
            hx = x_front + depth * 0.5
            hb = self.axis(hx) + d * (self.radius_at(hx) * 0.9 + (gap + frame_t) / 2)
            rot = Matrix.Rotation(-phi * DEG, 3, "Y")
            self.b.box((gap + frame_t + self.radius_at(hx) * 0.1, depth * 1.4, 0.03), hb, "metal", rot=rot)

    def duct(self, x0, x1, phi, w, h, ramp=0.25, lip=0.008, depth=0.05, mat="paint", fair_len=None):
        """몸통 옆에 붙은 흡입구 덕트 (Meteor 램제트, Harpoon 터보젯). x0 = 입구, x1 = 뒤끝."""
        d, n = self.dirs(phi)
        fair_len = (x1 - x0) * ramp if fair_len is None else fair_len

        def sec(x, hh, ww, inset=0.0):
            r = self.radius_at(x)
            base = r * 0.85
            top = r + hh
            cpts = [(base, -ww / 2), (top - inset, -ww / 2 + inset), (top - inset, ww / 2 - inset),
                    (base, ww / 2)]
            if inset:
                cpts = [(base + 0.0, -ww / 2 + inset), (top - inset, -ww / 2 + inset),
                        (top - inset, ww / 2 - inset), (base + 0.0, ww / 2 - inset)]
            out = []
            for rr, tt in cpts:
                p = self.axis(x) + d * rr + n * tt
                out.append(p)
            return out

        rings = [
            sec(x0 + depth, h, w, inset=lip),
            sec(x0, h, w, inset=lip),
            sec(x0, h, w),
            sec(x0 + (x1 - x0) * 0.15, h, w),
            sec(x1 - fair_len, h, w),
            sec(x1, 0.002, w * 0.7),
        ]
        self.b.loft(rings, ["intake", "paint_dark", mat, mat, mat], smooth=False, cap0="intake", cap1=mat)

    def ring_tube(self, x0, x1, r_in, r_out, mat="paint", segs=None):
        """축을 감싸는 짧은 고리관 (Paveway 시커 링 등)."""
        segs = segs or self.segs
        u, v = Vector((1, 0, 0)), Vector((0, 0, 1))
        roll = math.pi / 2 + math.pi / segs
        rings = [ring_points(self.axis(x), u, v, r, segs, roll)
                 for x, r in ((x0, r_in), (x0, r_out), (x1, r_out), (x1, r_in))]
        self.b.loft(rings, mat, smooth=True, closed=True)

    # 장착물 ---------------------------------------------------------------
    def hanger(self, x, kind="rail", length=None, width=None):
        """위쪽 장착 금구. rail = T 단면 레일 행거, lug = 폭탄 러그(고리), block = 단순 블록."""
        body_top = self.zc + self.radius_at(x) * 0.9
        if kind == "rail":
            ln = length or 0.08
            w = width or 0.022
            self.b.box((w, ln, -0.01 - body_top), (0, self.Y(x), (body_top - 0.01) / 2), "metal")
            self.b.box((w * 2.4, ln, 0.01), (0, self.Y(x), -0.005), "metal")
        elif kind == "lug":
            ln = length or 0.05
            w = width or 0.025
            # 받침판 + 고리 몸체
            self.b.box((w * 2.2, ln * 1.8, 0.012), (0, self.Y(x), body_top + 0.008), "metal")
            self.b.box((w, ln, -body_top - 0.002), (0, self.Y(x), body_top / 2 - 0.001), "metal")
        else:
            ln = length or 0.06
            w = width or 0.03
            self.b.box((w, ln, -body_top), (0, self.Y(x), body_top / 2), "metal")

    def nozzle_empty(self, x=None):
        self.empties.append(("nozzle", self.axis(self.L if x is None else x)))

    def child(self, name, pivot):
        """따로 움직이는 부품(전개 날개 등) 빌더. pivot = 회전축(모델 좌표)."""
        b = Builder()
        self.children.append((name, b, Vector(pivot)))
        return b

    # 출력 -----------------------------------------------------------------
    def finish(self):
        obj = self.b.to_object(self.id, self.colors)
        for name, b, pivot in self.children:
            ch = b.to_object(name, self.colors, origin=pivot)
            ch.parent = obj
        for name, loc in self.empties:
            add_empty(name, loc, obj)
        return export(out_path(self.id), self.budget, self.id)


# ---------------------------------------------------------------- 건물

class Building:
    """건물/구조물. 원점 = 바닥 중앙, 정면 = +Y, 주 재질 'paint'. 삼각형 ≤ 2000."""

    def __init__(self, model_id, colors=None, budget=2000):
        self.id = model_id
        self.colors = dict(colors or {})
        self.budget = budget
        self.b = Builder(sharp_deg=40.0)
        self.empties = []

    def finish(self):
        obj = self.b.to_object(self.id, self.colors)
        for name, loc in self.empties:
            add_empty(name, loc, obj)
        return export(out_path(self.id), self.budget, self.id)


def reset():
    tna.reset_scene()
