"""T.N.A. 항공기 제작 키트 (aero.py) — 헤드리스 Blender 에서 실제 크기 전투기 모델을 파라미터로 만든다.

    blender -b --factory-startup -P tools/blender/aircraft/f16p.py -- public/models/f16p.glb [out/f16p.blend]

사용법 요약 (자세한 설명/예시는 tools/blender/README.md):

    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    import aero
    from aero import gl

    ac = aero.Aircraft("f16p", paint=(0.23, 0.25, 0.27), canopy="gold")
    ac.fuselage([aero.sec(-7.3, 0.45, 0.4, 0.4), ...])        # 단면 키프레임 → 로프트
    ac.wing(aero.planform(span=3.6, root=4.9, tip=1.1, sweep=40, le=1.6), x0=0.9,
            cuts=[aero.cut("flaperon", 0.2, 3.0, 0.72)])          # 좌우 자동 대칭, 조종면 분리
    ac.station("L1", gl(-4.9, 0, 1.6))                            # 표 좌표(glTF) 그대로
    ac.finish()                                                   # 예산 검사 + GLB 내보내기

좌표: 모든 형상 함수는 **Blender 좌표** (+X 오른쪽, +Y 기수 방향, +Z 위, m) 를 받는다.
architecture.md 의 스테이션 표는 glTF 좌표(+Y 위, -Z 기수)이므로 gl(x, y, z) 로 변환해서 넘긴다.

움직이는 부품 회전 규칙 (three.js 에서 로컬 축 기준, 원점 = 힌지선/회전축 위):
  - aileron_*, flap_*, elevator_*, canard_*, airbrake, canopy : rotation.x  (+ = 뒷전 내림 / 앞쪽 올림)
      → 캐노피·에어브레이크(앞 힌지 제외)는 + 가 열림. 앞전 플랩(slat_*)은 - 가 처짐.
  - rudder_* : rotation.y (+ = 뒷전이 오른쪽 = 기수 오른쪽)
  - wing_L / wing_R (가변익) : rotation.y. wing_L 은 +, wing_R 은 - 가 후퇴 방향.
힌지가 비스듬한 조종면은 로컬 X(또는 러더는 로컬 Y)가 힌지선과 평행하도록 노드가 회전되어 있다.
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tna  # noqa: E402

SMOOTH = 40.0          # 기본 smooth-by-angle 각도(도). 0 이면 평면 셰이딩.
CHINE_B = 0.75         # chine=1 일 때 측면 지수 (1 미만 = 칼날 같은 차인)
EPS = 1e-6

PALETTE_ORDER = ["paint", "paint_dark", "metal", "nozzle", "canopy", "intake", "insignia", "glow", "rubber", "tire"]


# ============================================================================ 좌표 / 수학

def gl(x, y, z):
    """glTF/게임 모델 좌표(+X 오른쪽, +Y 위, -Z 기수) → Blender 좌표(+X 오른쪽, +Y 기수, +Z 위)."""
    return (float(x), float(-z), float(y))


def to_gl(p):
    """Blender 좌표 → glTF 좌표."""
    return (float(p[0]), float(p[2]), float(-p[1]))


def _v(p):
    return np.asarray(p, dtype=float)


def _unit(v):
    v = _v(v)
    n = np.linalg.norm(v)
    return v / n if n > EPS else v


def pchip(x, y, xq):
    """단조 3차 보간(Fritsch-Carlson). 키프레임 사이를 과도한 출렁임 없이 부드럽게 잇는다."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    xq = np.asarray(xq, float)
    n = len(x)
    if n == 1:
        return np.full_like(xq, y[0])
    h = np.diff(x)
    d = np.diff(y) / h
    m = np.zeros(n)
    if n == 2:
        m[:] = d[0]
    else:
        for k in range(1, n - 1):
            if d[k - 1] * d[k] <= 0:
                m[k] = 0.0
            else:
                w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
                m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])

        def end(h0, h1, d0, d1):
            mm = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
            if np.sign(mm) != np.sign(d0):
                return 0.0
            if np.sign(d0) != np.sign(d1) and abs(mm) > abs(3 * d0):
                return 3 * d0
            return mm

        m[0] = end(h[0], h[1], d[0], d[1])
        m[-1] = end(h[-1], h[-2], d[-1], d[-2])
    idx = np.clip(np.searchsorted(x, xq) - 1, 0, n - 2)
    t = (xq - x[idx]) / h[idx]
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * y[idx] + (t3 - 2 * t2 + t) * h[idx] * m[idx]
            + (-2 * t3 + 3 * t2) * y[idx + 1] + (t3 - t2) * h[idx] * m[idx + 1])


# ============================================================================ 메쉬 빌더

class Mesh:
    """정점/면 누적기. 면마다 머티리얼 이름과 smooth 각도(0=평면)를 가진다. 좌표는 월드(Blender)."""

    def __init__(self):
        self.v = []
        self.f = []
        self.m = []
        self.s = []

    # -- 기본
    def add_verts(self, pts):
        i0 = len(self.v)
        for p in pts:
            self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return list(range(i0, len(self.v)))

    def add_face(self, idx, mat="paint", smooth=SMOOTH):
        out = []
        for i in idx:
            if not out or out[-1] != i:
                out.append(i)
        while len(out) > 1 and out[0] == out[-1]:
            out.pop()
        if len(set(out)) >= 3:
            self.f.append(tuple(out))
            self.m.append(mat)
            self.s.append(float(smooth))

    def extend(self, other):
        off = len(self.v)
        self.v.extend(other.v)
        self.f.extend(tuple(i + off for i in face) for face in other.f)
        self.m.extend(other.m)
        self.s.extend(other.s)
        return self

    def copy(self):
        return Mesh().extend(self)

    def flip(self):
        self.f = [tuple(reversed(face)) for face in self.f]
        return self

    def mirrored(self):
        """X 대칭 복사본(면 방향 보정)."""
        o = Mesh()
        o.v = [(-x, y, z) for (x, y, z) in self.v]
        o.f = [tuple(reversed(face)) for face in self.f]
        o.m = list(self.m)
        o.s = list(self.s)
        return o

    def transform(self, fn):
        """fn(np.array (N,3)) → (N,3) 로 정점 변환."""
        if self.v:
            self.v = [tuple(p) for p in np.asarray(fn(np.asarray(self.v, float)), float)]
        return self

    def translate(self, d):
        d = _v(d)
        return self.transform(lambda P: P + d)

    # -- 고급
    def loft(self, rings, mat="paint", smooth=SMOOTH, closed=True, cap0=False, cap1=False,
             cap_mat=None, cap_smooth=None, mats=None):
        """rings: (R, N, 3). 연속 링 사이를 사각형 띠로 잇는다. 한 점으로 모인 링은 정점 하나(부채꼴).
        mats(r, k) 가 주어지면 면마다 머티리얼을 고른다. 반환: 링별 정점 인덱스."""
        idx = []
        for ring in rings:
            ring = _v(ring)
            if np.max(np.linalg.norm(ring - ring.mean(0), axis=1)) < 1e-7:
                i = self.add_verts([ring.mean(0)])[0]
                idx.append([i] * len(ring))
            else:
                idx.append(self.add_verts(ring))
        n = len(idx[0])
        segs = n if closed else n - 1
        for r in range(len(idx) - 1):
            a, b = idx[r], idx[r + 1]
            for k in range(segs):
                k2 = (k + 1) % n
                self.add_face([a[k], a[k2], b[k2], b[k]], mats(r, k) if mats else mat, smooth)
        cs = 0.0 if cap_smooth is None else cap_smooth
        if cap0:
            self.add_face(list(reversed(idx[0])), cap_mat or mat, cs)
        if cap1:
            self.add_face(list(idx[-1]), cap_mat or mat, cs)
        return idx

    def tri_normals(self):
        V = np.asarray(self.v, float)
        out = []
        for face in self.f:
            P = V[list(face)]
            n = np.zeros(3)
            for i in range(len(P)):  # Newell
                a, b = P[i], P[(i + 1) % len(P)]
                n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
            out.append(n)
        return np.asarray(out)

    def volume(self):
        V = np.asarray(self.v, float)
        vol = 0.0
        for face in self.f:
            p0 = V[face[0]]
            for i in range(1, len(face) - 1):
                vol += np.dot(p0, np.cross(V[face[i]], V[face[i + 1]]))
        return vol / 6.0

    def ensure_outward(self):
        """닫힌 솔리드: 부호 있는 부피가 음수면 전체 면을 뒤집는다."""
        if self.f and self.volume() < 0:
            self.flip()
        return self

    def orient_from(self, center):
        """열린 곡면: 다수결로 면 법선이 center 에서 바깥을 향하게."""
        if not self.f:
            return self
        V = np.asarray(self.v, float)
        N = self.tri_normals()
        c = _v(center)
        score = 0.0
        for face, n in zip(self.f, N):
            score += np.dot(n, V[list(face)].mean(0) - c)
        if score < 0:
            self.flip()
        return self

    def centroids(self):
        V = np.asarray(self.v, float)
        return np.asarray([V[list(f)].mean(0) for f in self.f]) if self.f else np.zeros((0, 3))

    def recolor(self, mat, *, x=None, y=None, z=None, where=None, src=None):
        """면 중심이 범위 안이면 머티리얼 교체. x/y/z = (min, max) (None 이면 무시), where(c, n) → bool."""
        C = self.centroids()
        N = self.tri_normals() if where is not None else None
        hit = 0
        for i, c in enumerate(C):
            if src is not None and self.m[i] not in (src if isinstance(src, (list, tuple, set)) else (src,)):
                continue
            ok = True
            for k, rng in ((0, x), (1, y), (2, z)):
                if rng is not None and not (rng[0] <= c[k] <= rng[1]):
                    ok = False
            if ok and where is not None:
                n = N[i]
                ln = np.linalg.norm(n)
                ok = bool(where(c, n / ln if ln > EPS else n))
            if ok:
                self.m[i] = mat
                hit += 1
        return hit

    def tri_count(self):
        return sum(len(f) - 2 for f in self.f)

    def bvh(self):
        return BVHTree.FromPolygons([Vector(p) for p in self.v], [list(f) for f in self.f], all_triangles=False)


# ============================================================================ 단면

def sec(y, w, ht, hb=None, z=0.0, **shape):
    """동체 단면 키프레임. y=기수 방향 위치, w=반폭, ht=중심선 위 높이, hb=아래 깊이, z=중심선 높이.
    shape: n(전체 지수, 2=타원 4+=각진), nt/nb(윗면/아랫면 평평함), ns(옆면 지수), chine(0..1 차인 날카로움),
           x(가로 중심, 포드용), wl(왼쪽 반폭, 비대칭)."""
    d = dict(y=float(y), w=float(w), ht=float(ht), hb=float(ht if hb is None else hb), z=float(z))
    d.update(shape)
    return d


def nose(y_tip, length, w, ht, hb=None, z=0.0, z_tip=None, power=0.55, count=6, **shape):
    """멱함수 기수(레이돔) 키프레임 목록(끝 → 뿌리). power 0.5=둥근 포물선, 0.75=뾰족한 오자이브.
    z_tip 을 주면 기수 끝이 처지거나 들린다."""
    hb = ht if hb is None else hb
    z_tip = z if z_tip is None else z_tip
    out = [sec(y_tip, 0.0, 0.0, 0.0, z_tip, **shape)]
    for i in range(1, count + 1):
        s = i / count
        s2 = s ** 0.85  # 끝쪽 링을 촘촘히
        f = s2 ** power
        out.append(sec(y_tip - length * s2, w * f, ht * f, hb * f, z_tip + (z - z_tip) * (1 - (1 - s2) ** 2), **shape))
    return out


_SHAPE_KEYS = ("n", "nt", "nb", "ns", "nsl", "nsr", "chine", "x", "wl")


def _shape_defaults(k):
    n = k.get("n", 2.0)
    return dict(
        x=k.get("x", 0.0),
        wl=k.get("wl", None),
        nt=k.get("nt", n), nb=k.get("nb", n),
        nsl=k.get("nsl", k.get("ns", n)), nsr=k.get("nsr", k.get("ns", n)),
        chine=k.get("chine", 0.0),
    )


def ring_super(N, w, ht, hb, z=0.0, x=0.0, nt=2.0, nb=2.0, nsl=2.0, nsr=2.0, chine=0.0, wl=None, t0=None):
    """일반화 초타원 단면 (N 점, 위 중앙에서 시작해 +X 쪽으로 시계방향). 반환 (N, 2) = (x, z).
    사분면마다 |x/W|^a + |z/H|^b = 1 (a = 윗/아랫면 평평함, b = 옆면 모양)."""
    t = (np.pi / 2 if t0 is None else t0) - 2 * np.pi * np.arange(N) / N
    c, s = np.cos(t), np.sin(t)
    top = s >= 0
    right = c >= 0
    a = np.where(top, nt, nb)
    b = np.where(right, nsr, nsl)
    b = b * (1 - chine) + CHINE_B * chine
    W = np.where(right, w, w if wl is None else wl)
    H = np.where(top, ht, hb)
    xs = x + W * np.sign(c) * np.abs(c) ** (2.0 / a)
    zs = z + H * np.sign(s) * np.abs(s) ** (2.0 / np.maximum(b, 0.05))
    return np.stack([xs, zs], axis=1)


def ring_quad(N, corners, x=0.0, z=0.0):
    """사각(캐럿) 단면. corners = [(u,v)×4] (위-안쪽부터 시계방향 권장), 변마다 N/4 점. 반환 (N,2)."""
    q = N // 4
    pts = []
    C = [np.asarray(c, float) for c in corners]
    for i in range(4):
        a, b = C[i], C[(i + 1) % 4]
        for j in range(q):
            pts.append(a + (b - a) * (j / q))
    P = np.asarray(pts)
    P[:, 0] += x
    P[:, 1] += z
    return P


def _interp_keys(keys, ys, fields):
    """키프레임 dict 목록을 ys 위치로 보간. 크기는 PCHIP, 지수류는 선형."""
    ky = np.array([k["y"] for k in keys])
    out = {}
    for f in fields:
        vals = np.array([k[f] for k in keys], float)
        if f in ("w", "ht", "hb", "z", "x", "wl"):
            out[f] = pchip(ky, vals, ys)
        else:
            out[f] = np.interp(ys, ky, vals)
    return out


def _sample_ys(ky, step):
    ys = [ky[0]]
    for a, b in zip(ky[:-1], ky[1:]):
        n = max(1, int(math.ceil((b - a) / step - 1e-9)))
        ys.extend(a + (b - a) * (i / n) for i in range(1, n + 1))
    return np.array(ys)


def loft_rings(keys, N=32, step=0.4, ys=None):
    """키프레임(sec) → (R, N, 3) 링 배열 (y 오름차순 = 꼬리 → 기수)."""
    keys = sorted(keys, key=lambda k: k["y"])
    full = []
    for k in keys:
        d = dict(k)
        d.update(_shape_defaults(k))
        if d["wl"] is None:
            d["wl"] = d["w"]
        full.append(d)
    ky = np.array([k["y"] for k in full])
    if ys is None:
        ys = _sample_ys(ky, step)
    P = _interp_keys(full, ys, ["w", "ht", "hb", "z", "x", "wl", "nt", "nb", "nsl", "nsr", "chine"])
    rings = []
    for i, y in enumerate(ys):
        g = {k: float(v[i]) for k, v in P.items()}
        r2 = ring_super(N, max(g["w"], 0.0), max(g["ht"], 0.0), max(g["hb"], 0.0), g["z"], g["x"],
                        g["nt"], g["nb"], g["nsl"], g["nsr"], g["chine"], max(g["wl"], 0.0))
        rings.append(np.column_stack([r2[:, 0], np.full(N, y), r2[:, 1]]))
    return np.asarray(rings)


# ============================================================================ 익형 / 평면형

def _af_half(f, kind, t):
    f = np.clip(np.asarray(f, float), 0.0, 1.0)
    if kind == "naca":
        return 5 * t * (0.2969 * np.sqrt(f) - 0.1260 * f - 0.3516 * f ** 2 + 0.2843 * f ** 3 - 0.1036 * f ** 4)
    if kind == "biconvex":
        return 2 * t * f * (1 - f)
    if kind == "hex":     # 쐐기 앞뒤 + 평평한 가운데 (초음속 꼬리날개)
        return 0.5 * t * np.clip(np.minimum(f / 0.22, (1 - f) / 0.22), 0, 1)
    if kind == "plate":   # 얇은 판 + 둥근 앞전 (파일런/안테나)
        return 0.5 * t * np.clip(np.minimum(np.sqrt(f / 0.12), (1 - f) / 0.25), 0, 1)
    raise ValueError(kind)


def _af_samples(f0, f1, m):
    k = np.arange(m + 1) / m
    if f0 <= EPS:
        k = 0.45 * k + 0.55 * (1 - np.cos(np.pi / 2 * k))  # 앞전 쪽 촘촘히
    return f0 + (f1 - f0) * k


def _af_loop(f0, f1, m, kind, t):
    """코드 구간 [f0,f1] 의 닫힌 단면 (f, h/c) 목록. 앞전/뒷전 두께 0 이면 점 공유."""
    fs = _af_samples(f0, f1, m)
    h = _af_half(fs, kind, t)
    le_shared = f0 <= EPS
    te_shared = f1 >= 1 - EPS and h[-1] < 1e-5
    top = [(f, hh) for f, hh in zip(fs, h)]
    bot = [(f, -hh) for f, hh in zip(fs, h)]
    bot = bot[::-1]
    if te_shared:
        bot = bot[1:]
    if le_shared:
        bot = bot[:-1]
    return top + bot


def planform(span, root, tip, sweep=None, le=0.0, t=0.05, t_tip=None, s0=0.0, le_tip=None, dz_tip=0.0):
    """사다리꼴 날개 스테이션 2개. sweep=앞전 후퇴각(도) 또는 le_tip(끝 앞전 y) 직접 지정. 반환 [root, tip]."""
    if le_tip is None:
        le_tip = le - span * math.tan(math.radians(sweep or 0.0))
    return [dict(s=s0, le=le, c=root, t=t, dz=0.0),
            dict(s=s0 + span, le=le_tip, c=tip, t=t if t_tip is None else t_tip, dz=dz_tip)]


def station_at(stations, s, side=+1):
    """스팬 위치 s 의 단면(선형 보간). 같은 s 의 중복 스테이션(도그투스)은 side=-1 이면 안쪽, +1 이면 바깥쪽."""
    st = stations
    if s <= st[0]["s"] + EPS:
        cand = [k for k in st if abs(k["s"] - st[0]["s"]) < EPS]
        return dict(cand[-1] if side > 0 else cand[0])
    if s >= st[-1]["s"] - EPS:
        cand = [k for k in st if abs(k["s"] - st[-1]["s"]) < EPS]
        return dict(cand[0] if side < 0 else cand[-1])
    same = [k for k in st if abs(k["s"] - s) < EPS]
    if same:
        return dict(same[-1] if side > 0 else same[0])
    for a, b in zip(st[:-1], st[1:]):
        if a["s"] <= s <= b["s"] and b["s"] - a["s"] > EPS:
            u = (s - a["s"]) / (b["s"] - a["s"])
            return {k: (a[k] + (b[k] - a[k]) * u) if k in ("s", "le", "c", "t", "dz") else a[k] for k in a}
    raise ValueError(s)


def dogtooth(stations, s, extend, fade=0.0):
    """스팬 s 에서 앞전이 extend 만큼 앞으로 튀어나오는 도그투스(스내그). fade=1 이면 끝으로 갈수록 0."""
    st = _norm_stations(stations)
    inner = station_at(st, s, -1)
    smax = st[-1]["s"]
    out = [k for k in st if k["s"] < s - EPS] + [inner]
    for k in [station_at(st, s, +1)] + [k for k in st if k["s"] > s + EPS]:
        u = (k["s"] - s) / max(smax - s, EPS)
        e = extend * (1 - fade * u)
        k = dict(k)
        k["le"] += e
        k["c"] += e
        out.append(k)
    return out


def _norm_stations(stations):
    out = []
    for k in stations:
        if isinstance(k, dict):
            d = dict(s=0.0, le=0.0, c=1.0, t=0.05, dz=0.0)
            d.update(k)
        else:
            d = dict(zip(("s", "le", "c", "t", "dz"), k))
            d.setdefault("t", 0.05)
            d.setdefault("dz", 0.0)
        out.append(d)
    out.sort(key=lambda k: k["s"])
    return out


def cut(name, s0, s1, f, edge="te", gap=0.012, sgap=0.025):
    """조종면 정의. name 은 기본 이름(aileron → aileron_R/aileron_L), s0..s1 스팬 범위(m),
    f 힌지 코드 비율, edge='te'(뒷전: aileron/flap/rudder) 또는 'le'(앞전 플랩)."""
    return dict(name=name, s0=float(s0), s1=float(s1), f=float(f), edge=edge, gap=gap, sgap=sgap)


# ============================================================================ 머티리얼 / 텍스처

def panel_texture(res=1024, seed=3, line=0.72, tint=0.035):
    """반복되는 패널 라인 텍스처(흰 바탕 + 어두운 선 + 패널별 미세 명암 + 리벳 점). (res,res,3)."""
    rng = np.random.default_rng(seed)
    img = np.ones((res, res), np.float32)
    lines = np.zeros((res, res), bool)
    rivets = np.zeros((res, res), bool)
    lw = max(1, res // 512)
    cols = np.sort(rng.choice(np.arange(res // 16, res, res // 16), size=4, replace=False))
    bounds = list(cols) + [cols[0] + res]
    for ci in range(4):
        x0, x1 = bounds[ci], bounds[ci + 1]
        xs = np.arange(x0, x1) % res
        lines[:, np.arange(x0, x0 + lw) % res] = True
        nrow = rng.integers(2, 5)
        rows = np.sort(rng.choice(np.arange(res // 16, res, res // 16), size=nrow, replace=False))
        rb = list(rows) + [rows[0] + res]
        for ri in range(nrow):
            y0, y1 = rb[ri], rb[ri + 1]
            ys = np.arange(y0, y1) % res
            lines[np.ix_(np.arange(y0, y0 + lw) % res, xs)] = True
            img[np.ix_(ys, xs)] *= 1.0 + tint * (rng.random() * 2 - 1)
            # 리벳 줄 (패널 가장자리 안쪽)
            for yy in (y0 + 5 * lw, y1 - 5 * lw):
                rivets[np.ix_([yy % res], xs[(xs - x0) % (6 * lw) == 0])] = True
            # 작은 점검창
            if rng.random() < 0.7:
                w = rng.integers(res // 40, res // 14)
                h = rng.integers(res // 40, res // 14)
                if (x1 - x0) > w + 24 and (y1 - y0) > h + 24:
                    ax = rng.integers(x0 + 10, x1 - w - 10)
                    ay = rng.integers(y0 + 10, y1 - h - 10)
                    xx = np.arange(ax, ax + w) % res
                    yy = np.arange(ay, ay + h) % res
                    lines[np.ix_([ay % res, (ay + h) % res], xx)] = True
                    lines[np.ix_(yy, [ax % res, (ax + w) % res])] = True
    img[lines] *= line
    img[rivets & ~lines] *= 0.88
    return np.clip(np.repeat(img[:, :, None], 3, axis=2), 0, 1)


CANOPY_TINTS = {
    "gold": ((0.30, 0.20, 0.07, 1.0), 0.55, 0.85),   # 색, 알파, 금속성
    "smoke": ((0.035, 0.045, 0.055, 1.0), 0.62, 0.4),
    "clear": ((0.10, 0.12, 0.13, 1.0), 0.35, 0.2),
}


def _textured_material(name, color, roughness, metallic, image):
    mat = bpy.data.materials.new(name)
    if not getattr(mat, "use_nodes", True):
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    links.new(tex.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = tuple(color)
    links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


def make_materials(paint=(0.20, 0.22, 0.24), paint_dark=(0.09, 0.10, 0.11), metal=(0.42, 0.40, 0.37),
                   nozzle=(0.10, 0.095, 0.09), canopy="smoke", intake=(0.012, 0.012, 0.014),
                   insignia=(0.055, 0.06, 0.065), glow=(1.0, 0.42, 0.12), panel_lines=True, seed=3, res=1024):
    """머티리얼 팔레트 dict (이름 → bpy 머티리얼). 색은 리니어 RGB. paint/paint_dark 에 패널 라인 텍스처."""
    rgba = lambda c: tuple(c) + ((1.0,) if len(c) == 3 else ())  # noqa: E731
    mats = {}
    img = tna.image_from_array("panel_lines", panel_texture(res=res, seed=seed)) if panel_lines else None
    for name, col, rough, met in (("paint", paint, 0.55, 0.05), ("paint_dark", paint_dark, 0.6, 0.05)):
        mats[name] = _textured_material(name, rgba(col), rough, met, img) if img else tna.material(name, rgba(col), rough, met)
    mats["metal"] = tna.material("metal", rgba(metal), 0.38, 0.85)
    mats["nozzle"] = tna.material("nozzle", rgba(nozzle), 0.5, 0.75)
    tint = CANOPY_TINTS.get(canopy, None) if isinstance(canopy, str) else (rgba(canopy), 0.55, 0.5)
    can = tna.material("canopy", tint[0], 0.06, tint[2])
    bsdf = next(n for n in can.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Alpha"].default_value = tint[1]
    mats["canopy"] = can
    mats["intake"] = tna.material("intake", rgba(intake), 0.9, 0.0)
    mats["insignia"] = tna.material("insignia", rgba(insignia), 0.6, 0.0)
    mats["glow"] = tna.material("glow", rgba(tuple(c * 0.6 for c in glow)), 0.4, 0.0, emission=rgba(glow))
    mats["rubber"] = tna.material("rubber", (0.02, 0.02, 0.02, 1.0), 0.9, 0.0)
    for m in mats.values():
        m.use_backface_culling = True
    return mats


# ============================================================================ 휘장 2D 도형

def _shape_star(r=0.5, ri=0.19, rot=90.0):
    """5각 별 (중심 부채꼴 + 중간 링, 곡면 투영용). 반환 (verts2d, faces)."""
    V = [(0.0, 0.0)]
    outer = []
    for i in range(10):
        a = math.radians(rot + i * 36)
        rr = r if i % 2 == 0 else ri
        outer.append((rr * math.cos(a), rr * math.sin(a)))
    mid = [(p[0] * 0.5, p[1] * 0.5) for p in outer]
    V += mid + outer
    F = []
    for i in range(10):
        j = (i + 1) % 10
        F.append((0, 1 + i, 1 + j))
        F.append((1 + i, 11 + i, 11 + j, 1 + j))
    return V, F


def _shape_ring(r0, r1, seg=28):
    V, F = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        V += [(r0 * math.cos(a), r0 * math.sin(a)), (r1 * math.cos(a), r1 * math.sin(a))]
    for i in range(seg):
        j = (i + 1) % seg
        F.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    return V, F


def _shape_disc(r, seg=24, sx=1.0):
    V = [(0.0, 0.0)] + [(sx * r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    F = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
    return V, F


def _shape_rect(x0, x1, y0, y1, nx=3, ny=2):
    V, F = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            V.append((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            F.append((a, a + 1, a + nx + 2, a + nx + 1))
    return V, F


def _combine(*shapes):
    V, F = [], []
    for sv, sf in shapes:
        off = len(V)
        V += sv
        F += [tuple(i + off for i in f) for f in sf]
    return V, F


def shape_frame(w, h, t=0.035, split=0, saw=0):
    """문/패널 윤곽선 (w x h m, 선 두께 t). split=n 이면 가운데 세로 분할선 n 개, saw=n 이면 위아래 변이 톱니(n 개)."""
    parts = []
    hx, hy = w / 2, h / 2
    if saw:
        for yy in (hy, -hy):
            pts = []
            for i in range(2 * saw + 1):
                x = -hx + w * i / (2 * saw)
                pts.append((x, yy + (0.0 if i % 2 == 0 else (-1 if yy > 0 else 1) * min(w / saw * 0.35, h * 0.25))))
            for a, b in zip(pts[:-1], pts[1:]):
                parts.append(_shape_segment(a, b, t))
    else:
        parts += [_shape_rect(-hx, hx, hy - t, hy, 2, 1), _shape_rect(-hx, hx, -hy, -hy + t, 2, 1)]
    parts += [_shape_rect(-hx, -hx + t, -hy, hy, 1, 2), _shape_rect(hx - t, hx, -hy, hy, 1, 2)]
    for i in range(split):
        x = -hx + w * (i + 1) / (split + 1)
        parts.append(_shape_rect(x - t / 2, x + t / 2, -hy, hy, 1, 2))
    return _combine(*parts)


def _shape_segment(a, b, t):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    n = np.array([-d[1], d[0]]) / max(np.linalg.norm(d), EPS) * t / 2
    V = [tuple(a - n), tuple(b - n), tuple(b + n), tuple(a + n)]
    return V, [(0, 1, 2, 3)]


def insignia_shape(kind):
    """kind: 'star' | 'star_ring' | 'star_bar'(나토/미국식 저시인성) | 'roundel' | 'disc' | 'oval' | 'bar'.
    지름 1 기준 2D 도형."""
    if kind == "star":
        return _shape_star(0.5)
    if kind == "star_ring":
        return _combine(_shape_ring(0.42, 0.5), _shape_star(0.4))
    if kind == "star_bar":
        return _combine(_shape_ring(0.43, 0.5), _shape_star(0.41),
                        _shape_rect(0.53, 1.0, -0.17, 0.17), _shape_rect(-1.0, -0.53, -0.17, 0.17))
    if kind == "roundel":
        return _combine(_shape_ring(0.32, 0.5), _shape_disc(0.17))
    if kind == "disc":
        return _shape_disc(0.5)
    if kind == "oval":
        return _shape_disc(0.5, sx=1.8)
    if kind == "bar":
        return _shape_rect(-0.5, 0.5, -0.12, 0.12, 4, 1)
    raise ValueError(kind)


# ============================================================================ 항공기

class Part:
    def __init__(self, name, origin, axes, parent=None, optional=False):
        self.name = name
        self.mesh = Mesh()
        self.origin = _v(origin)
        self.axes = np.eye(3) if axes is None else np.asarray(axes, float)  # 열 = 로컬 X, Y, Z
        self.parent = parent
        self.optional = optional


def _frame(axis, normal, rule):
    """조종면 로컬 축. rule 'h': X=힌지(+x 쪽), Z=위. rule 'v': Z=힌지(위쪽), X=두께방향(+x 쪽)."""
    a = _unit(axis)
    n = _unit(normal)
    if rule == "h":
        X = a if a[0] >= 0 else -a
        Z = _unit(n - np.dot(n, X) * X)
        if Z[2] < 0:
            Z = -Z
        Y = np.cross(Z, X)
    else:
        Z = a if a[2] >= 0 else -a
        X = _unit(n - np.dot(n, Z) * Z)
        if X[0] < 0:
            X = -X
        Y = np.cross(Z, X)
    return np.column_stack([X, Y, Z])


def _mirror_vec(v):
    v = _v(v).copy()
    v[0] = -v[0]
    return v


def _side_name(name, side):
    if side == 0:
        return name
    return f"{name}_{'R' if side > 0 else 'L'}"


class Aircraft:
    """항공기 한 대를 조립한다. 정적 형상은 하나의 'body' 메쉬로 합쳐지고(드로우콜 절약),
    움직이는 부품/선택 장비(opt_*)는 별도 노드, 스테이션/노즐/기관포 등은 empty 노드가 된다."""

    def __init__(self, model_id, *, paint=(0.20, 0.22, 0.24), paint_dark=(0.09, 0.10, 0.11), canopy="smoke",
                 panel_lines=True, panel_tile=4.0, seed=3, budget=20000, **mat_kwargs):
        tna.reset_scene()
        self.id = model_id
        self.budget = budget
        self.panel_tile = panel_tile
        self.mats = make_materials(paint=paint, paint_dark=paint_dark, canopy=canopy,
                                   panel_lines=panel_lines, seed=seed, **mat_kwargs)
        self.body = Mesh()
        self.parts = {}
        self.empties = []   # (name, pos, parent)

    # ------------------------------------------------------------------ 저수준
    def _target(self, part):
        if part is None:
            return self.body
        if isinstance(part, Mesh):
            return part
        if part not in self.parts:
            self.part(part)
        return self.parts[part].mesh

    def part(self, name, origin=(0, 0, 0), axes=None, parent=None, optional=None):
        """움직이는 부품/선택 장비 노드를 만든다(이미 있으면 그대로 반환). origin=회전축 위 점(Blender)."""
        if name not in self.parts:
            opt = name.startswith("opt_") if optional is None else optional
            self.parts[name] = Part(name, origin, axes, parent, opt)
        return self.parts[name]

    def add(self, mesh, part=None, closed=True):
        if closed:
            mesh.ensure_outward()
        self._target(part).extend(mesh)
        return mesh

    def empty(self, name, pos, parent=None):
        self.empties.append((name, _v(pos), parent))

    def station(self, sid, pos, parent=None):
        """station_<sid> empty. pos 는 Blender 좌표 (표 좌표는 gl() 로 변환)."""
        self.empty(f"station_{sid}", pos, parent)

    def station_pair(self, left_id, right_id, pos_left, parent=None):
        """좌측 좌표를 주면 우측은 X 대칭으로 둘 다 만든다."""
        p = _v(pos_left)
        self.station(left_id, p, parent)
        self.station(right_id, _mirror_vec(p), parent)

    def _sides(self, side):
        return {"both": (1, -1), "center": (0,), "right": (1,), "left": (-1,)}[side]

    def _emit(self, mesh_right, side, part=None, closed=True):
        """오른쪽 기준 메쉬를 side 에 따라 추가(both 면 대칭 복사)."""
        for sd in self._sides(side):
            m = mesh_right.copy() if sd >= 0 else mesh_right.mirrored()
            p = part
            # 이미 만든 부품(ac.part)이나 opt_* 는 양쪽을 한 노드에, 아니면 _R/_L 노드로 나눈다
            if (isinstance(part, str) and sd != 0 and side == "both" and not part.startswith("opt_")
                    and part not in self.parts):
                p = _side_name(part, sd)
            self.add(m, p, closed)

    # ------------------------------------------------------------------ 동체 / 포드
    def fuselage(self, keys, *, N=32, step=0.4, mat="paint", smooth=SMOOTH, side="center", part=None,
                 cap_mat=None, mats=None, ys=None):
        """단면 키프레임(sec/nose)을 길이 방향으로 로프트한 닫힌 솔리드. side='both' 면 x 대칭 포드 한 쌍.
        mats(ring_idx, point_idx) 로 면별 머티리얼 지정 가능. 반환: 오른쪽(또는 중앙) 메쉬."""
        assert N % 4 == 0, "N 은 4의 배수"
        rings = loft_rings(keys, N, step, ys)
        m = Mesh()
        m.loft(rings, mat, smooth, closed=True, cap0=True, cap1=True, cap_mat=cap_mat, mats=mats)
        self._emit(m, side, part)
        return m

    pod = fuselage

    def rings(self, rings, *, mat="paint", smooth=SMOOTH, side="center", part=None, cap0=True, cap1=True,
              closed=True, mats=None):
        """직접 만든 링 배열(R,N,3)을 로프트(커스텀 형상용)."""
        m = Mesh()
        m.loft(rings, mat, smooth, closed=closed, cap0=cap0, cap1=cap1, mats=mats)
        self._emit(m, side, part)
        return m

    # ------------------------------------------------------------------ 날개 / 꼬리날개
    def wing(self, stations, *, x0=0.0, z0=0.0, dihedral=0.0, vertical=False, cant=0.0, side="both",
             airfoil="naca", m=9, cuts=(), mat="paint", smooth=50.0, part=None, pivot=None, axes=None,
             parent=None, incidence=0.0):
        """날개/꼬리날개 (닫힌 솔리드, 오른쪽 기준으로 만들고 side='both' 면 대칭).
        stations: dict(s=스팬 거리, le=앞전 y, c=코드, t=두께비, dz=두께방향 오프셋) 목록 (planform/dogtooth 도우미).
        x0, z0: 뿌리(s=0) 위치. dihedral: 상반각(도). vertical=True 면 수직꼬리, cant=바깥 기울기(도).
        cuts: cut(...) 목록 → 조종면 부품(힌지 원점). part='elevator' 등을 주면 전체가 움직이는 부품
        (pivot=dict(s, f) 코드비 위치 또는 (x,y,z) 점, axes='world' 면 축 회전 없음 — 가변익).
        incidence: 단면 받음각(도, 앞전 올림 +)."""
        st = _norm_stations(stations)
        if vertical:
            c_, s_ = math.cos(math.radians(cant)), math.sin(math.radians(cant))
            ds, dn = np.array([s_, 0, c_]), np.array([c_, 0, -s_])
        else:
            c_, s_ = math.cos(math.radians(dihedral)), math.sin(math.radians(dihedral))
            ds, dn = np.array([c_, 0, s_]), np.array([-s_, 0, c_])
        O = np.array([x0, 0.0, z0])
        Y = np.array([0.0, 1.0, 0.0])
        inc = math.radians(incidence)

        def P(s, f, h, k):
            # 앞전 기준 받음각 회전(코드 방향 -Y, 두께 방향 dn)
            u = f * k["c"]
            v = h * k["c"]
            cu, cv = u * math.cos(inc) + v * math.sin(inc), -u * math.sin(inc) + v * math.cos(inc)
            return O + ds * s + Y * (k["le"] - cu) + dn * (k["dz"] + cv)

        cuts = [dict(c) for c in cuts]
        rule = "v" if vertical else "h"
        whole = None
        if part is not None:
            if axes == "world":
                ax = np.eye(3)
            else:
                ax = _frame(ds, dn, rule if axes is None else axes)
            if pivot is None:
                pv = P(0.0, 0.25, 0.0, station_at(st, 0.0))
            elif isinstance(pivot, dict):
                pv = P(pivot["s"], pivot["f"], 0.0, station_at(st, pivot["s"]))
            else:
                pv = _v(pivot)
            whole = (part, pv, ax)

        # 구간 경계
        S = sorted(set([k["s"] for k in st] + [c["s0"] for c in cuts] + [c["s1"] for c in cuts]
                       + [c["s0"] + c["sgap"] for c in cuts] + [c["s1"] - c["sgap"] for c in cuts]))
        S = [s for s in S if st[0]["s"] - EPS <= s <= st[-1]["s"] + EPS]
        pieces = {}   # owner -> Mesh(right side)
        runs = {}     # key -> list of (s, station)
        finished = []

        def partition(a, b):
            f0, f1 = 0.0, 1.0
            ctrl = []
            for c in cuts:
                if c["s0"] - EPS <= a and b <= c["s1"] + EPS:
                    if c["edge"] == "te":
                        f1 = min(f1, c["f"] - c["gap"] / 2)
                    else:
                        f0 = max(f0, c["f"] + c["gap"] / 2)
                if c["s0"] + c["sgap"] - EPS <= a and b <= c["s1"] - c["sgap"] + EPS:
                    if c["edge"] == "te":
                        ctrl.append((c["name"], c["f"] + c["gap"] / 2, 1.0))
                    else:
                        ctrl.append((c["name"], 0.0, c["f"] - c["gap"] / 2))
            return [(None, round(f0, 6), round(f1, 6))] + [(n, round(a_, 6), round(b_, 6)) for n, a_, b_ in ctrl]

        for a, b in zip(S[:-1], S[1:]):
            if b - a < 1e-5:
                continue
            ka, kb = station_at(st, a, +1), station_at(st, b, -1)
            keys = partition(a, b)
            for key in list(runs):
                if key not in keys:
                    finished.append((key, runs.pop(key)))
            for key in keys:
                if key in runs:
                    last_s, last_k = runs[key][-1]
                    cont = abs(last_s - a) < EPS and all(abs(last_k[q] - ka[q]) < 1e-6 for q in ("le", "c", "t", "dz"))
                    if cont:
                        runs[key].append((b, kb))
                        continue
                    finished.append((key, runs.pop(key)))
                runs[key] = [(a, ka), (b, kb)]
        finished += list(runs.items())

        cut_meta = {}
        for (owner, f0, f1), run in finished:
            if f1 - f0 < 1e-4:
                continue
            mm = m if (f0 <= EPS and f1 >= 1 - EPS) else max(2, int(round(m * (f1 - f0) * 1.1)))
            loop = _af_loop(f0, f1, mm, airfoil, 1.0)
            rings = []
            for s, k in run:
                rings.append([P(s, f, h * k["t"], k) for f, h in loop])
            msh = Mesh()
            msh.loft(rings, mat, smooth, closed=True, cap0=True, cap1=True)
            msh.ensure_outward()
            pieces.setdefault(owner, Mesh()).extend(msh)
        for c in cuts:
            sa, sb = c["s0"] + c["sgap"], c["s1"] - c["sgap"]
            fh = c["f"]
            ha = P(sa, fh, 0.0, station_at(st, sa))
            hb = P(sb, fh, 0.0, station_at(st, sb))
            cut_meta[c["name"]] = ((ha + hb) / 2, hb - ha)

        for sd in self._sides(side):
            mir = sd < 0
            main = pieces.get(None, Mesh())
            main = main.mirrored() if mir else main.copy()
            if whole is not None:
                pname, pv, ax = whole
                if mir:
                    pv = _mirror_vec(pv)
                    if axes == "world":
                        axm = np.eye(3)
                    else:
                        axm = _frame(_mirror_vec(ds), _mirror_vec(dn), rule if axes is None else axes)
                else:
                    axm = ax
                wname = _side_name(pname, sd)
                self.part(wname, pv, axm, _side_name(parent, sd) if (parent and sd) else parent)
                self.add(main, wname)
                par = wname
            else:
                self.add(main, None)
                par = _side_name(parent, sd) if (parent and sd) else parent
            for c in cuts:
                cm = pieces.get(c["name"])
                if cm is None:
                    continue
                org, axis = cut_meta[c["name"]]
                nrm = dn
                if mir:
                    cm = cm.mirrored()
                    org, axis, nrm = _mirror_vec(org), _mirror_vec(axis), _mirror_vec(dn)
                else:
                    cm = cm.copy()
                cname = _side_name(c["name"], sd)
                self.part(cname, org, _frame(axis, nrm, rule), par)
                self.add(cm, cname)
        return dict(P=P, ds=ds, dn=dn, stations=st)

    def vtail(self, stations, *, x0=0.0, z0=0.0, cant=0.0, side="both", **kw):
        """수직꼬리 (cant = 바깥으로 기울어진 각도). side='center' 면 단일 꼬리."""
        kw.setdefault("airfoil", "naca")
        return self.wing(stations, x0=x0, z0=z0, vertical=True, cant=cant, side=side, **kw)

    def blade(self, x, y, z, *, height=0.35, chord=0.3, sweep=35.0, t=0.08, side="center", cant=0.0,
              mat="paint_dark", down=False):
        """블레이드 안테나/작은 핀 (down=True 면 아래로)."""
        st = [dict(s=0, le=y, c=chord, t=t), dict(s=height, le=y - height * math.tan(math.radians(sweep)),
                                                   c=chord * 0.45, t=t)]
        c = 180.0 if down else cant
        return self.wing(st, x0=x, z0=z, vertical=True, cant=c, side=side, airfoil="plate", m=5, mat=mat)

    # ------------------------------------------------------------------ 흡입구
    def intake(self, sections, *, side="both", shape="super", N=24, lip=0.05, depth=1.0, slant=(0.0, 0.0),
               mat="paint", smooth=SMOOTH, duct_scale=0.88, step=0.4, part=None):
        """흡입구: 바깥 덕트 외피(mat) + 입구 립 + 어두운 내부 덕트('intake') + 압축기면.
        sections: 앞(입구) → 뒤 순서 dict(y, x, z, ...). shape='super' 면 sec() 와 같은 단면 키
        (w 또는 w/wl, ht, hb, n/nt/nb/ns/nsl/nsr/chine), shape='quad' 면 corners=[(u,v)×4] (캐럿/사각).
        slant=(dy/dx, dy/dz): 입구 면 기울기 (예: 아래 립이 앞으로 → dy/dz < 0). 오른쪽 기준."""
        secs = sorted(sections, key=lambda k: -k["y"])
        y_front = secs[0]["y"]

        def ring2(k):
            if shape == "quad":
                return ring_quad(N, k["corners"], k.get("x", 0.0), k.get("z", 0.0))
            d = _shape_defaults(k)
            return ring_super(N, k["w"], k["ht"], k.get("hb", k["ht"]), k.get("z", 0.0), d["x"], d["nt"], d["nb"],
                              d["nsl"], d["nsr"], d["chine"], d["wl"])

        # 단면 사이 보간 (2D 링 선형 보간 + 위치 PCHIP 생략: 단면을 충분히 주면 됨)
        rings2, ys = [], []
        for a, b in zip(secs[:-1], secs[1:]):
            n = max(1, int(math.ceil((a["y"] - b["y"]) / step)))
            ra, rb = ring2(a), ring2(b)
            for i in range(n):
                u = i / n
                u2 = u * u * (3 - 2 * u)
                rings2.append(ra + (rb - ra) * u2)
                ys.append(a["y"] + (b["y"] - a["y"]) * u)
        rings2.append(ring2(secs[-1]))
        ys.append(secs[-1]["y"])
        c0 = np.array([secs[0].get("x", 0.0), secs[0].get("z", 0.0)])
        if shape == "quad":
            c0 = ring2(secs[0]).mean(0)

        def slant_dy(p2):
            if callable(slant):
                return slant(p2[:, 0], p2[:, 1])
            return slant[0] * (p2[:, 0] - c0[0]) + slant[1] * (p2[:, 1] - c0[1])

        rings = []
        for i, (r2, y) in enumerate(zip(rings2, ys)):
            yy = np.full(N, y)
            if i == 0:
                yy = yy + slant_dy(r2)
            else:  # 기울기를 뒤로 갈수록 풀어준다
                w = max(0.0, 1.0 - (y_front - y) / max(depth, 0.5))
                yy = yy + slant_dy(r2) * w
            rings.append(np.column_stack([r2[:, 0], yy, r2[:, 1]]))
        front2 = rings2[0]
        # 안쪽 오프셋(립 두께)
        n2 = len(front2)
        inner2 = np.zeros_like(front2)
        cen = front2.mean(0)
        for k in range(n2):
            p0, p1, p2 = front2[k - 1], front2[k], front2[(k + 1) % n2]
            e1, e2 = _unit(p1 - p0), _unit(p2 - p1)
            nrm = _unit(np.array([-e1[1], e1[0]]) + np.array([-e2[1], e2[0]]))
            if np.dot(nrm, cen - p1) < 0:
                nrm = -nrm
            inner2[k] = p1 + nrm * lip
        lip_mid2 = (front2 + inner2) / 2
        dy0 = slant_dy(front2)
        dyi = slant_dy(inner2)
        lip_ring = np.column_stack([lip_mid2[:, 0], y_front + (dy0 + dyi) / 2 + lip * 0.35, lip_mid2[:, 1]])
        inner_ring = np.column_stack([inner2[:, 0], y_front + dyi - lip * 0.6, inner2[:, 1]])
        back2 = cen + (inner2 - cen) * duct_scale
        duct_end = np.column_stack([back2[:, 0], np.full(n2, y_front - depth), back2[:, 1]])
        duct_mid = (inner_ring + duct_end) / 2

        msh = Mesh()
        # 바깥 외피 (뒤 → 앞) + 뒤 마개
        outer = rings[::-1]
        msh.loft(outer + [lip_ring], mat, smooth, closed=True, cap0=True)
        # 립 안쪽 + 덕트 + 압축기 면
        msh.loft([lip_ring, inner_ring], mat, smooth, closed=True)
        msh.loft([inner_ring, duct_mid, duct_end], "intake", smooth, closed=True, cap1=True, cap_mat="intake")
        # 위 3 개 로프트는 정점을 공유하지 않으므로 같은 위치 정점을 병합해 닫힌 솔리드로 만든다
        _weld(msh)
        self._emit(msh, side, part)
        return msh

    def nose_intake(self, *, y, r, z=0.0, cone_len=1.0, cone_r=None, lip=0.05, depth=1.0, N=24, mat="paint",
                    cone_mat="paint_dark"):
        """기수 원형 흡입구 + 충격파 원뿔 (MiG-21 등). 동체 앞 링이 반지름 r 로 끝난다고 가정."""
        self.intake([dict(y=y, x=0, z=z, w=r, ht=r), dict(y=y - 0.3, x=0, z=z, w=r * 1.02, ht=r * 1.02)],
                    side="center", N=N, lip=lip, depth=depth, mat=mat, duct_scale=0.95)
        cr = cone_r or r * 0.55
        keys = nose(y + cone_len * 0.55, cone_len, cr, cr, power=0.9, count=4) + [sec(y - depth * 0.8, cr, cr)]
        return self.fuselage(keys, N=16, mat=cone_mat, step=0.3)

    # ------------------------------------------------------------------ 노즐
    def nozzle(self, *, x=0.0, z=0.0, y=0.0, length=1.2, r_exit=0.5, r_base=0.55, petals=14, petal_depth=0.035,
               side="center", lip=0.035, inner_depth=0.9, mat="nozzle", glow=True, name="nozzle", base_mat=None,
               base_len=0.0, smooth=30.0):
        """원형 수렴-확산 노즐 (페탈 홈 표현) + 내부 + 'glow' 터빈면. y = 배기 출구 면.
        name 노드 empty 를 출구 중심에 둔다 (side='both' 면 nozzle_R/nozzle_L)."""
        Np = petals * 2   # 페탈마다 홈/마루 2 점
        th = np.pi / 2 - 2 * np.pi * np.arange(Np) / Np
        mod = 1 - petal_depth * (np.arange(Np) % 2)

        def ring(r, yy, modulate=True):
            rr = r * (mod if modulate else 1.0)
            return np.column_stack([x + rr * np.cos(th), np.full(Np, yy), z + rr * np.sin(th)])

        msh = Mesh()
        rs = [ring(r_base, y + length, False), ring(r_base * 0.995, y + length * 0.82),
              ring((r_base + r_exit) / 2 * 1.0, y + length * 0.4), ring(r_exit, y)]
        if base_len > 0:
            rs = [ring(r_base * 1.01, y + length + base_len, False)] + rs
        lip_r = ring(r_exit - lip * 0.5, y - lip * 0.25)
        inner = ring(r_exit - lip, y + lip * 0.4, False)
        deep = ring((r_exit - lip) * 0.82, y + inner_depth, False)
        idx = msh.loft(rs + [lip_r, inner], mat, smooth, closed=True, cap0=True, cap_mat=base_mat or mat)
        msh.loft([inner, deep], mat, smooth, closed=True, cap1=True, cap_mat="glow" if glow else mat)
        if base_mat:
            # 첫 띠(뿌리 링)를 base_mat 로
            for i in range(Np):
                msh.m[i] = base_mat
        _weld(msh)
        self._emit(msh, side)
        for sd in self._sides(side):
            self.empty(_side_name(name, sd) if side == "both" else name, (x * (1 if sd >= 0 else -1), y, z))
        return msh

    def nozzle_2d(self, *, x=0.0, z=0.0, y=0.0, length=1.4, w=0.55, h_base=0.55, h_exit=0.28, side="both",
                  serration=0.18, N=24, lip=0.035, inner_depth=0.8, mat="nozzle", glow=True, name="nozzle",
                  sq=5.0):
        """2D 추력편향 노즐(F-22): 둥근 사각 단면이 위아래로 좁아지는 슬롯, 플랩 뒷전 톱니."""
        def ring(ww, hh, yy, serr=0.0):
            r2 = ring_super(N, ww, hh, hh, z, x, sq, sq, sq, sq)
            dy = np.zeros(N)
            if serr:
                u = np.abs((r2[:, 0] - x) / ww)
                tooth = 1 - np.abs(((u * 2.0) % 1.0) * 2 - 1)   # 삼각파 2 개
                vert = np.abs(r2[:, 1] - z) / hh
                dy = -serr * tooth * np.clip((vert - 0.55) / 0.45, 0, 1)
            return np.column_stack([r2[:, 0], yy + dy, r2[:, 1]])

        msh = Mesh()
        rs = [ring(w, h_base, y + length), ring(w * 0.99, h_base * 0.93, y + length * 0.6),
              ring(w * 0.97, (h_base + h_exit) / 2, y + length * 0.3), ring(w * 0.96, h_exit, y, serration)]
        inner = ring(w * 0.96 - lip, h_exit - lip, y + lip * 0.5, serration * 0.9)
        deep = ring(w * 0.8, h_exit * 0.8, y + inner_depth)
        msh.loft(rs + [inner], mat, smooth=28, closed=True, cap0=True)
        msh.loft([inner, deep], mat, smooth=28, closed=True, cap1=True, cap_mat="glow" if glow else mat)
        _weld(msh)
        self._emit(msh, side)
        for sd in self._sides(side):
            self.empty(_side_name(name, sd) if side == "both" else name, (x * (1 if sd >= 0 else -1), y, z))
        return msh

    # ------------------------------------------------------------------ 캐노피
    def canopy(self, keys, *, N=18, step=0.15, name="canopy", split=None, hinge=None, frames=(), frame_w=0.07,
               frame_mat="paint_dark", frame_off=0.018, sill=True, smooth=70.0, static_frames=None, tub="intake",
               tub_margin=0.9):
        """버블/프레임 캐노피 (위쪽 반 초타원 껍질, 'canopy' 머티리얼, 아래는 열림).
        keys: dict(y, w=턱 반폭, h=턱 위 높이, z=턱 높이, n=지수, x) — 앞→뒤 상관없음.
        split: 이 y 보다 앞은 고정 윈드실드(body), 뒤는 움직이는 'canopy' 노드 (None 이면 전체가 canopy).
        hinge: 캐노피 회전축 점 (기본: 뒤 끝 턱 높이). frames: 프레임 보우 y 목록.
        tub: 캐노피 발자국 안쪽의 위를 향한 몸체 면을 이 머티리얼(조종석 내부색)로 칠한다 (None=안 칠함)."""
        keys = sorted(keys, key=lambda k: k["y"])
        ky = np.array([k["y"] for k in keys])
        ys = list(_sample_ys(ky, step))
        if split is not None and not any(abs(v - split) < 1e-4 for v in ys):
            ys.append(split)
            ys.sort()
        ys = np.array(ys)

        def field(f, default):
            return np.array([k.get(f, default) for k in keys], float)

        W = pchip(ky, field("w", 0.4), ys)
        H = pchip(ky, field("h", 0.4), ys)
        Z = pchip(ky, field("z", 0.0), ys)
        X = np.interp(ys, ky, field("x", 0.0))
        NN = np.interp(ys, ky, field("n", 2.2))
        th = np.linspace(0, np.pi, N + 1)

        def arc(i, off=0.0):
            c, s = np.cos(th), np.sin(th)
            n = NN[i]
            xs = X[i] + (W[i] + off) * np.sign(c) * np.abs(c) ** (2 / n)
            zs = Z[i] + (H[i] + off) * np.abs(s) ** (2 / n) - (0.0 if off == 0 else 0.0)
            return np.column_stack([xs, np.full(N + 1, ys[i]), zs])

        rings = [arc(i) for i in range(len(ys))]
        if tub:
            def inside(c, n):
                if not (ys[0] <= c[1] <= ys[-1]) or n[2] < 0.25 or float(np.interp(c[1], ys, H)) < 0.18:
                    return False
                w = float(np.interp(c[1], ys, W)) * tub_margin
                z0 = float(np.interp(c[1], ys, Z))
                return abs(c[0] - float(np.interp(c[1], ys, X))) < w and z0 - 0.35 < c[2] < z0 + float(np.interp(c[1], ys, H))
            self.body.recolor(tub, where=inside, src=("paint", "paint_dark"))
        y_rear = ys[0]
        if hinge is None:
            hinge = (X[0], y_rear, Z[0])
        groups = [("can", [i for i in range(len(ys)) if split is None or ys[i] <= split + 1e-6]),
                  ("ws", [i for i in range(len(ys)) if split is not None and ys[i] >= split - 1e-6])]
        self.part(name, hinge, None)
        for g, ids in groups:
            if len(ids) < 2:
                continue
            msh = Mesh()
            idx = msh.loft([rings[i] for i in ids], "canopy", smooth, closed=False)
            # 앞/뒤 마구리 (턱 직선으로 닫힘)
            msh.add_face(list(reversed(idx[0])), "canopy", smooth)
            msh.add_face(list(idx[-1]), "canopy", smooth)
            msh.orient_from((X[ids[0]], (ys[ids[0]] + ys[ids[-1]]) / 2, Z[ids[0]] - 0.3))
            if g == "can":
                self.add(msh, name, closed=False)
            else:
                self.add(msh, None, closed=False)
        # 프레임 보우
        for fy in frames:
            fy = float(np.clip(fy, ys[0] + frame_w / 2, ys[-1] - frame_w / 2))
            a_o, b_o = self._canopy_arc_at(keys, fy - frame_w / 2, th, frame_off), self._canopy_arc_at(keys, fy + frame_w / 2, th, frame_off)
            a_i, b_i = self._canopy_arc_at(keys, fy - frame_w / 2, th, -0.01), self._canopy_arc_at(keys, fy + frame_w / 2, th, -0.01)
            band = _band([a_o, b_o, b_i, a_i], frame_mat)
            static = (split is not None and fy >= split - 1e-3) if static_frames is None else (fy in static_frames)
            self.add(band, None if static else name)
        if sill:
            # 턱 레일 (양쪽 아래 가장자리를 따라 얇은 띠)
            for endi in (0, N):
                pts = np.array([r[endi] for r in rings])
                sgn = 1 if endi == 0 else -1
                prof = [np.array([0.0, 0, 0.0]), np.array([sgn * 0.035, 0, 0.0]), np.array([sgn * 0.035, 0, -0.06]),
                        np.array([0.0, 0, -0.06])]
                rail = [[p + d for p in pts] for d in prof]
                ids_can = [i for i in range(len(ys)) if split is None or ys[i] <= split + 1e-6]
                ids_ws = [i for i in range(len(ys)) if split is not None and ys[i] >= split - 1e-6]
                for ids, tgt in ((ids_can, name), (ids_ws, None)):
                    if len(ids) < 2:
                        continue
                    b2 = _band([np.array(r)[ids] for r in rail], frame_mat)
                    self.add(b2, tgt)
        return rings

    def _canopy_arc_at(self, keys, y, th, off):
        ky = np.array([k["y"] for k in keys])
        g = lambda f, d: float(pchip(ky, np.array([k.get(f, d) for k in keys], float), np.array([y]))[0])  # noqa
        w, h, z = g("w", 0.4), g("h", 0.4), g("z", 0.0)
        x = float(np.interp(y, ky, [k.get("x", 0.0) for k in keys]))
        n = float(np.interp(y, ky, [k.get("n", 2.2) for k in keys]))
        c, s = np.cos(th), np.sin(th)
        xs = x + (w + off) * np.sign(c) * np.abs(c) ** (2 / n)
        zs = z + (h + off) * np.abs(s) ** (2 / n)
        if off > 0:
            zs = np.where(np.abs(s) < 1e-6, z, zs)
        return np.column_stack([xs, np.full(len(th), y), zs])

    def seat(self, y, z, *, x=0.0, helmet=True, w=0.27):
        """사출좌석 머리받침 + 조종사 헬멧(간단). z = 턱(캐노피 바닥) 높이 근처."""
        self.fuselage([sec(y - 0.32, w * 0.8, 0.05, 0.25, z + 0.33, x=x, n=5),
                       sec(y - 0.25, w, 0.08, 0.35, z + 0.40, x=x, n=5),
                       sec(y - 0.10, w, 0.08, 0.35, z + 0.42, x=x, n=5),
                       sec(y - 0.05, w * 0.8, 0.04, 0.3, z + 0.38, x=x, n=5)],
                      N=12, step=0.2, mat="intake")
        if helmet:
            hy = y + 0.12
            self.fuselage([sec(hy - 0.14, 0.0, 0.0, 0.0, z + 0.55, x=x), sec(hy - 0.11, 0.10, 0.09, 0.08, z + 0.55, x=x),
                           sec(hy, 0.135, 0.13, 0.11, z + 0.55, x=x), sec(hy + 0.10, 0.11, 0.10, 0.09, z + 0.54, x=x),
                           sec(hy + 0.135, 0.0, 0.0, 0.0, z + 0.53, x=x)], N=12, step=0.08, mat="paint_dark",
                          smooth=80)

    # ------------------------------------------------------------------ 파일런 / 레일
    def _ray_up(self, x, y, z, target=None):
        tree = self._target(target).bvh()
        hit = tree.ray_cast(Vector((x, y, z)), Vector((0, 0, 1)), 20.0)
        return None if hit[0] is None else hit[0].z

    def surface_z(self, x, y, z_from=-10.0, up=True, target=None):
        """(x, y) 에서 아래(z_from)부터 위로 쏜 광선이 처음 닿는 몸체 면 높이."""
        tree = self._target(target).bvh()
        d = Vector((0, 0, 1 if up else -1))
        hit = tree.ray_cast(Vector((x, y, z_from)), d, 40.0)
        return None if hit[0] is None else hit[0].z

    def pylon(self, x, y, z_bottom, *, length=1.8, width=0.12, z_top=None, rake=0.35, embed=0.12, side="both",
              mat="paint", part=None, rear_rake=0.15):
        """무장 파일런 (평면형 익형 단면을 세운 날 모양). z_top 을 안 주면 위쪽 몸체 면을 찾아 붙인다.
        (x, y) = 파일런 중심, z_bottom = 장착 면(스테이션 높이)."""
        if z_top is None:
            zt = self._ray_up(x, y, z_bottom)
            zt2 = self._ray_up(x, y + length * 0.4, z_bottom)
            cands = [v for v in (zt, zt2) if v is not None]
            z_top = (max(cands) if cands else z_bottom + 0.3) + embed
        msh = _blade_solid(x, y, z_bottom, z_top, length, width, rake, rear_rake, mat)
        self._emit(msh, side, part)
        return z_top

    def rail(self, x, y, z_top, *, length=2.6, width=0.09, height=0.12, side="both", mat="paint_dark", part=None):
        """미사일 발사 레일(LAU-127/128 류). 레일 아래면 높이(= 스테이션 높이)를 반환."""
        msh = _blade_solid(x, y, z_top - height, z_top + 0.02, length, width, 0.25, 0.05, mat, airfoil="plate")
        self._emit(msh, side, part)
        return z_top - height

    def box(self, center, size, *, mat="paint", side="center", part=None, smooth=0.0, taper=None):
        """축 정렬 상자 (taper=(sx, sz) 면 +Y 끝 단면 비율)."""
        c, s = _v(center), _v(size) / 2
        tx, tz = taper or (1.0, 1.0)
        r0 = [c + np.array([sx * s[0], -s[1], sz * s[2]]) for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
        r1 = [c + np.array([sx * s[0] * tx, s[1], sz * s[2] * tz]) for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
        msh = Mesh()
        msh.loft([r0, r1], mat, smooth, closed=True, cap0=True, cap1=True)
        self._emit(msh, side, part)
        return msh

    # ------------------------------------------------------------------ 휘장 / 칠
    def insignia(self, center, normal, *, size=0.9, kind="star_bar", **kw):
        """휘장(별/라운델 등, insignia_shape 참고)을 몸체 곡면에 투영. center/normal 은 Blender 좌표,
        size = 지름(m). side='both' 면 반대편에도 대칭으로."""
        return self.decal(center, normal, insignia_shape(kind), size=size, **kw)

    def decal(self, center, normal, shape, *, size=1.0, up=(0, 0, 1), offset=0.012, mat="insignia",
              side="center", target=None, rot=0.0):
        """2D 도형 (verts2d, faces) 을 몸체 곡면에 투영해 offset 만큼 띄운 얇은 마킹 메쉬로 붙인다.
        (u, v) 축: v = up 을 면에 투영한 방향, u = 오른쪽. 예: shape_frame(2.0, 1.2) 무장창 문 윤곽."""
        V2, F = shape
        tree = self._target(target).bvh()
        out = []
        for sd in self._sides(side):
            c = _v(center) if sd >= 0 else _mirror_vec(center)
            n = _unit(normal) if sd >= 0 else _unit(_mirror_vec(normal))
            u0 = _unit(up)
            if sd < 0:
                u0 = _unit(_mirror_vec(up))
            Vv = _unit(u0 - np.dot(u0, n) * n)
            U = np.cross(Vv, n)
            if rot:
                a = math.radians(rot)
                U, Vv = U * math.cos(a) + Vv * math.sin(a), -U * math.sin(a) + Vv * math.cos(a)
            msh = Mesh()
            pts = []
            for (u, v) in V2:
                p0 = c + (U * u + Vv * v) * size
                hit = tree.ray_cast(Vector(p0 + n * 0.6), Vector(-n), 1.5)
                p = (np.array(hit[0]) if hit[0] is not None else p0) + n * offset
                pts.append(p)
            ids = msh.add_verts(pts)
            P = np.asarray(pts)
            for f in F:
                face = [ids[i] for i in f]
                q = P[list(f)]
                fn = np.zeros(3)
                for k in range(len(q)):   # 면마다 바깥(n) 쪽을 보게 감기 방향을 맞춘다
                    fn += np.cross(q[k], q[(k + 1) % len(q)])
                if np.dot(fn, n) < 0:
                    face.reverse()
                msh.add_face(face, mat, 60.0)
            self._target(target).extend(msh)
            out.append(msh)
        return out

    def paint(self, mat, *, x=None, y=None, z=None, where=None, src=("paint",), target=None, both=True):
        """몸체 면 중 중심이 범위 안인 면의 머티리얼을 바꾼다 (예: 레이돔, 눈부심 방지 패널, 금속 꼬리).
        both=True 이고 x 범위가 주어지면 -x 대칭 범위도 함께."""
        tgt = self._target(target)
        n = tgt.recolor(mat, x=x, y=y, z=z, where=where, src=src)
        if both and x is not None and not (x[0] <= 0 <= x[1]):
            n += tgt.recolor(mat, x=(-x[1], -x[0]), y=y, z=z, where=where, src=src)
        return n

    # ------------------------------------------------------------------ 마무리
    def triangles(self):
        return self.body.tri_count() + sum(p.mesh.tri_count() for p in self.parts.values())

    def build(self):
        """씬 오브젝트 생성(내보내기 전 단계)."""
        objs = {}
        objs["body"] = _to_object("body", self.body, self.mats, np.zeros(3), np.eye(3), self.panel_tile)
        order = sorted(self.parts.values(), key=lambda p: (p.parent is not None, p.name))
        world = {"body": Matrix.Identity(4)}
        for p in order:
            obj = _to_object(p.name, p.mesh, self.mats, p.origin, p.axes, self.panel_tile)
            M = _mat4(p.origin, p.axes)
            if p.parent:
                parent = objs[p.parent]
                obj.parent = parent
                obj.matrix_parent_inverse = Matrix.Identity(4)
                obj.matrix_basis = world[p.parent].inverted() @ M
            else:
                obj.matrix_basis = M
            world[p.name] = M
            if p.optional:
                obj["tna_optional"] = 1
            objs[p.name] = obj
        for name, pos, parent in self.empties:
            e = bpy.data.objects.new(name, None)
            e.empty_display_type = "PLAIN_AXES"
            e.empty_display_size = 0.25
            bpy.context.scene.collection.objects.link(e)
            M = Matrix.Translation(Vector(pos))
            if parent:
                e.parent = objs[parent]
                e.matrix_parent_inverse = Matrix.Identity(4)
                e.matrix_basis = world[parent].inverted() @ M
            else:
                e.matrix_basis = M
            objs[name] = e
        self.objects = objs
        return objs

    def _debug_pose(self):
        """미리보기 전용: 환경변수 TNA_POSE="wing_L:z:48,wing_R:z:-48,canopy:x:-30" 로 부품을 로컬 축(Blender)
        기준으로 돌리고, TNA_HIDE_OPT=1 이면 opt_* 를 빼고 내보낸다. 게임용 빌드에는 쓰지 않는다."""
        pose = os.environ.get("TNA_POSE", "").strip()
        for item in filter(None, (p.strip() for p in pose.split(","))):
            name, axis, deg = item.split(":")
            obj = self.objects.get(name)
            if obj is None:
                print(f"[aero] TNA_POSE: '{name}' 없음")
                continue
            i = "xyz".index(axis.lower())
            obj.matrix_basis = obj.matrix_basis @ Matrix.Rotation(math.radians(float(deg)), 4, "XYZ"[i])
        if os.environ.get("TNA_HIDE_OPT"):
            for name, obj in list(self.objects.items()):
                if name.startswith("opt_"):
                    bpy.data.objects.remove(obj, do_unlink=True)
                    self.objects.pop(name)

    def report(self):
        tris = self.triangles()
        names = sorted(n for n, _, _ in self.empties)
        print(f"[aero] {self.id}: 삼각형 {tris} / 예산 {self.budget}")
        print(f"[aero]   부품: {', '.join(sorted(self.parts))}")
        print(f"[aero]   empty: {', '.join(names)}")
        return tris

    def finish(self, out=None, blend=None):
        """예산 검사 → 오브젝트 생성 → GLB 내보내기. out 기본값: 명령줄 첫 인자 또는 public/models/<id>.glb."""
        args = tna.script_args()
        if out is None:
            out = args[0] if args else os.path.join(os.path.dirname(__file__), "..", "..", "public", "models", f"{self.id}.glb")
        if blend is None and len(args) > 1:
            blend = args[1]
        tris = self.report()
        self.build()
        self._debug_pose()
        tna.export_glb(out, export_extras=True)
        if blend:
            tna.save_blend(blend)
        if tris > self.budget:
            print(f"[aero] 오류: 삼각형 {tris} > 예산 {self.budget}", file=sys.stderr)
            sys.exit(2)
        return out


# ============================================================================ 내부 도우미

def _band(arcs, mat, smooth=0.0):
    """같은 길이의 경로 4~n 개(단면 모서리)를 이어 만든 띠 솔리드(프레임/레일)."""
    arcs = [np.asarray(a, float) for a in arcs]
    K = len(arcs[0])
    msh = Mesh()
    ids = [msh.add_verts(a) for a in arcs]
    C = len(arcs)
    for c in range(C):
        a, b = ids[c], ids[(c + 1) % C]
        for k in range(K - 1):
            msh.add_face([a[k], a[k + 1], b[k + 1], b[k]], mat, smooth)
    msh.add_face([ids[c][0] for c in range(C)], mat, 0.0)
    msh.add_face([ids[c][K - 1] for c in reversed(range(C))], mat, 0.0)
    msh.ensure_outward()
    return msh


def _blade_solid(x, y, z0, z1, length, width, rake, rear_rake, mat, airfoil="plate", t=None, m=6):
    """세운 날 모양 솔리드 (파일런/레일): 위 링(z1)은 전체 길이, 아래 링(z0)은 앞/뒤가 rake 비율만큼 깎임."""
    t = t if t is not None else width / length
    loop = _af_loop(0.0, 1.0, m, airfoil, 1.0)

    def ring(zz, L, y_le):
        return [(x + h * t * L * (length / L), y_le - f * L, zz) for f, h in loop]

    L0 = length * (1 - rake - rear_rake)
    y_le0 = y + length / 2 - length * rake
    msh = Mesh()
    msh.loft([ring(z0, L0, y_le0), ring(z1, length, y + length / 2)], mat, 35.0, closed=True, cap0=True, cap1=True)
    msh.ensure_outward()
    return msh


def _weld(msh, tol=1e-6):
    """같은 위치 정점 병합."""
    V = np.asarray(msh.v, float)
    key = np.round(V / tol).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    newv = np.zeros((len(uniq), 3))
    newv[inv] = V
    msh.v = [tuple(p) for p in newv]
    oldf, oldm, olds = msh.f, msh.m, msh.s
    msh.f, msh.m, msh.s = [], [], []
    for f, m_, s_ in zip(oldf, oldm, olds):
        msh.add_face([int(inv[i]) for i in f], m_, s_)
    return msh


def _mat4(origin, axes):
    M = Matrix.Identity(4)
    for r in range(3):
        for c in range(3):
            M[r][c] = float(axes[r][c])
        M[r][3] = float(origin[r])
    return M


def _to_object(name, msh, mats, origin, axes, tile):
    """Mesh → Blender 오브젝트 (로컬 좌표 변환, 머티리얼 슬롯, smooth-by-angle, 박스 UV)."""
    me = bpy.data.meshes.new(name)
    V = np.asarray(msh.v, float) if msh.v else np.zeros((0, 3))
    R = np.asarray(axes, float)
    local = (V - _v(origin)) @ R  # R 의 열 = 로컬 축 → 로컬 좌표 = (v-o)·축
    me.from_pydata([tuple(p) for p in local], [], [list(f) for f in msh.f])
    me.update(calc_edges=True)
    used = [m for m in PALETTE_ORDER if m in set(msh.m)] + sorted(set(msh.m) - set(PALETTE_ORDER))
    for m in used:
        me.materials.append(mats[m])
    slot = {m: i for i, m in enumerate(used)}
    nf = len(msh.f)
    if nf:
        me.polygons.foreach_set("material_index", [slot[m] for m in msh.m])
        me.polygons.foreach_set("use_smooth", [s > 0 for s in msh.s])
        # 면 법선 (월드)
        Nn = msh.tri_normals()
        ln = np.linalg.norm(Nn, axis=1)
        Nu = Nn / np.where(ln > 1e-12, ln, 1.0)[:, None]
        # 모서리 각도 → sharp
        edge_faces = {}
        for fi, f in enumerate(msh.f):
            for k in range(len(f)):
                a, b = f[k], f[(k + 1) % len(f)]
                edge_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
        sharp = np.zeros(len(me.edges), bool)
        ev = np.zeros(len(me.edges) * 2, np.int64)
        me.edges.foreach_get("vertices", ev)
        ev = ev.reshape(-1, 2)
        for ei, (a, b) in enumerate(ev):
            fl = edge_faces.get((min(a, b), max(a, b)), [])
            if len(fl) != 2:
                sharp[ei] = True
                continue
            f0, f1 = fl
            th = min(msh.s[f0], msh.s[f1])
            if th <= 0:
                sharp[ei] = True
                continue
            if ln[f0] < 1e-12 or ln[f1] < 1e-12:
                continue
            ang = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(Nu[f0], Nu[f1]))))))
            if ang > th:
                sharp[ei] = True
        attr = me.attributes.get("sharp_edge") or me.attributes.new("sharp_edge", "BOOLEAN", "EDGE")
        attr.data.foreach_set("value", sharp.tolist())
        # 박스 UV (월드 좌표 / tile)
        uv = []
        for fi, f in enumerate(msh.f):
            n = np.abs(Nu[fi])
            ax = int(np.argmax(n))
            a_, b_ = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[ax]
            for vi in f:
                p = V[vi]
                uv += [p[a_] / tile, p[b_] / tile]
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", uv)
    if me.validate(clean_customdata=False):
        print(f"[aero] 경고: 메쉬 '{name}' 정리됨(퇴화 면 등)")
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj
