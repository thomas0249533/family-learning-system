#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
四年级思维训练 · 巧数图形（V2.12 · 图片支持首个内容包）

## 为什么这个包值得单独一条链路
"数一数图中有几个三角形"这类题，**离开图就是一句无法作答的话**。它也是本项目
第一个真正需要图片资产的内容包，所以顺便当成整条链路的验收用例：
包 JSON 里的 `image` → `assets/<pkg>/xxx.svg` → 导入进 IndexedDB → 答题页渲染。

## 答案从哪来：程序枚举，不是手数
手数是最容易错的一步，且错了**几乎不可能在 review 时发现**（图和答案都在自己手里，
看着都对）。所以这里把图形定义成**线段集合**，再用几何枚举算答案：

  · 点集   = 所有线段端点 ∪ 所有线段交点（Fraction 精确算，不用浮点）
  · 可见边 = 存在某条原始线段同时包含两点
  · 线段数 = 满足"可见"的点对数
  · 三角形 = 三点不共线 + 三条边两两可见
  · 矩形   = 四点中存在一种配对使两条对角线互相平分且等长 + 四边可见
  · 正方形 = 矩形 + 邻边相等

手写的 `answer` 一律被程序结果覆盖，只保留"干扰项"，并对干扰项做去重与合法性校验。

## 图怎么来：SVG
线框几何图用 SVG 比 PNG 小一个数量级（每张 1~2KB），且缩放到任何尺寸都不糊。
每张图自带米白底 `#fffdf7` + 深墨绿线条：**图片不跟随 App 主题**，
深色模式下白底深线依然清晰（否则透明底的深色线在深色卡片上会直接消失）。

用法：python scripts/content/gen-math4-shape.py
"""
from __future__ import annotations

import json
import math
import sys
from fractions import Fraction
from functools import reduce
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG_ID = "special-math-4-up-shape"
CONTENT_DIR = ROOT / "content" / "math-4-up-rjb"
OUT_JSON = CONTENT_DIR / f"{PKG_ID}.json"
ASSET_DIR = CONTENT_DIR / "assets" / PKG_ID

# 配色（图片资产，不参与 src/ 的 token 门禁；深浅主题下都靠米白底保证可读）
# 坐标只是**设计坐标**，没有固定画布：`render_svg` 按图形实际范围裁 viewBox，
# 所以写坐标时只管相对关系，不需要凑满某个尺寸。
INK = "#2f4a3d"
PAPER = "#fffdf7"


# ===========================================================================
# 一、几何引擎：线段集合 → 精确计数
# ===========================================================================


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def on_segment(p, a, b) -> bool:
    """p 是否落在闭线段 ab 上（含端点）。全程有理数，无浮点误差。"""
    if _cross(a, b, p) != 0:
        return False
    return (
        min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
        and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
    )


def intersect(a, b, c, d):
    """两线段交点；平行或不相交返回 None。共线重叠不产生"新"点（端点已入点集）。"""
    ax, ay = Fraction(a[0]), Fraction(a[1])
    bx, by = Fraction(b[0]), Fraction(b[1])
    cx, cy = Fraction(c[0]), Fraction(c[1])
    dx, dy = Fraction(d[0]), Fraction(d[1])

    rx, ry = bx - ax, by - ay
    sx, sy = dx - cx, dy - cy
    denom = rx * sy - ry * sx
    if denom == 0:
        return None
    t = ((cx - ax) * sy - (cy - ay) * sx) / denom
    u = ((cx - ax) * ry - (cy - ay) * rx) / denom
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (ax + t * rx, ay + t * ry)
    return None


def all_points(segs, extra=()):
    """
    点集 = 线段端点 ∪ 交点 ∪ **图上手动画出来的点**。

    第三项不能漏：数线段题里"一条线上标 4 个点"，只有首尾是线段端点，
    中间两个点纯粹是标注出来的。漏掉它们，一条 4 个点的线会被算成 1 条线段 ——
    这个 bug 一开始就踩了，且答案看上去"像那么回事"（1 也是正整数）。
    """
    pts = set()
    for a, b in segs:
        pts.add((Fraction(a[0]), Fraction(a[1])))
        pts.add((Fraction(b[0]), Fraction(b[1])))
    for p in extra:
        pts.add((Fraction(p[0]), Fraction(p[1])))
    for (a, b), (c, d) in combinations(segs, 2):
        p = intersect(a, b, c, d)
        if p is not None:
            pts.add(p)
    return sorted(pts)


def visible(p, q, segs) -> bool:
    """p、q 之间是否有一条完整的线（同属于某条原始线段）。"""
    return any(on_segment(p, a, b) and on_segment(q, a, b) for a, b in segs)


def _collinear(p, q, r) -> bool:
    return _cross(p, q, r) == 0


def _dist2(p, q):
    return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2


def _mid(p, q):
    return ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)


def count_segments(points, segs) -> int:
    return sum(1 for p, q in combinations(points, 2) if visible(p, q, segs))


def count_triangles(points, segs) -> int:
    n = 0
    for p, q, r in combinations(points, 3):
        if _collinear(p, q, r):
            continue
        if visible(p, q, segs) and visible(q, r, segs) and visible(p, r, segs):
            n += 1
    return n


def count_quads(points, segs, square: bool) -> int:
    """
    矩形/正方形计数。

    判定用「对角线互相平分且等长 ⟺ 矩形」：比逐边算直角更省事，也不引入斜率除法。
    四个点有两种可能的对角线配对，逐一试；命中即计数并跳出（避免同一组点被算两次）。
    """
    n = 0
    for quad in combinations(points, 4):
        for i, j, k, l in ((0, 1, 2, 3), (0, 2, 1, 3), (0, 3, 1, 2)):
            p1, p2, p3, p4 = quad[i], quad[j], quad[k], quad[l]
            if _mid(p1, p2) != _mid(p3, p4):
                continue
            if _dist2(p1, p2) != _dist2(p3, p4):
                continue
            # 四边必须都画出来
            sides = ((p1, p3), (p3, p2), (p2, p4), (p4, p1))
            if not all(visible(u, v, segs) for u, v in sides):
                continue
            if square and _dist2(p1, p3) != _dist2(p3, p2):
                continue
            n += 1
            break
    return n


def _dir_key(v):
    """方向归一：约分成最简整数向量，并统一朝右/朝上，用于判"是不是同一条射线"。"""
    dx, dy = Fraction(v[0]), Fraction(v[1])
    den = dx.denominator * dy.denominator // math.gcd(dx.denominator, dy.denominator)
    ix, iy = int(dx * den), int(dy * den)
    g = math.gcd(abs(ix), abs(iy))
    if g == 0:
        return None
    ix, iy = ix // g, iy // g
    if ix < 0 or (ix == 0 and iy < 0):
        ix, iy = -ix, -iy
    return (ix, iy)


def count_angles(vertex, segs) -> int:
    """数角：从顶点出发的不同方向数 n → C(n,2)。"""
    dirs = set()
    vx, vy = Fraction(vertex[0]), Fraction(vertex[1])
    for a, b in segs:
        for p, q in ((a, b), (b, a)):
            if Fraction(p[0]) == vx and Fraction(p[1]) == vy:
                key = _dir_key((Fraction(q[0]) - vx, Fraction(q[1]) - vy))
                if key:
                    dirs.add(key)
    n = len(dirs)
    return n * (n - 1) // 2


def evaluate(q, kind: str) -> int:
    """按题型算一道题的答案。**答案只从这里出**，手写的一律不采信。"""
    segs = q["segs"]
    pts = all_points(segs, q.get("dots", ()))
    if kind == "segment":
        return count_segments(pts, segs)
    if kind == "angle":
        return count_angles(q["vertex"], segs)
    if kind == "triangle":
        return count_triangles(pts, segs)
    if kind == "rect":
        return count_quads(pts, segs, square=False)
    if kind == "square":
        return count_quads(pts, segs, square=True)
    raise ValueError(f"未知题型 {kind}")


def question_kind(q, unit) -> str:
    """单题可覆盖单元默认题型（同一单元里数长方形与数正方形混排时用得到）。"""
    return q.get("mode", unit["mode"])


# ===========================================================================
# 二、SVG 渲染
# ===========================================================================


def _f(v) -> str:
    """Fraction/数字 → SVG 坐标串（最多两位小数，去掉无意义的 .00）。"""
    x = float(v)
    s = f"{x:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def render_svg(segs, dots) -> str:
    """
    按**图形实际范围**裁 viewBox，而不是固定 420×320 画布。

    为什么：固定画布下，一条线的图会上下各留 150px 空白（q01 就是），
    在答题页上表现为"图不大、但占了一整屏"，把选项挤到视野外。
    裁到 bbox + 内边距后，同样的显示高度里图形本身大一圈。

    `MIN_H` 兜底：极扁的图（一条横线）若严格按 bbox 裁会变成一条细带，
    点也小得看不清。给一个最小高度并让内容垂直居中。
    """
    pts = [p for seg in segs for p in seg] + list(dots)
    if not pts:
        raise SystemExit("空图形：既没有线段也没有点")
    xs = [float(p[0]) for p in pts]
    ys = [float(p[1]) for p in pts]

    PAD = 24
    x0, x1 = min(xs) - PAD, max(xs) + PAD
    y0, y1 = min(ys) - PAD, max(ys) + PAD

    MIN_H = 110
    if y1 - y0 < MIN_H:
        extra = (MIN_H - (y1 - y0)) / 2
        y0 -= extra
        y1 += extra

    w, h = x1 - x0, y1 - y0

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{_f(x0)} {_f(y0)} {_f(w)} {_f(h)}" '
        f'width="{_f(w)}" height="{_f(h)}">',
        f'<rect x="{_f(x0)}" y="{_f(y0)}" width="{_f(w)}" height="{_f(h)}" fill="{PAPER}"/>',
    ]
    for a, b in segs:
        parts.append(
            f'<line x1="{_f(a[0])}" y1="{_f(a[1])}" x2="{_f(b[0])}" y2="{_f(b[1])}" '
            f'stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
        )
    for p in dots:
        parts.append(f'<circle cx="{_f(p[0])}" cy="{_f(p[1])}" r="4.5" fill="{INK}"/>')
    parts.append("</svg>")
    return "".join(parts)


# ===========================================================================
# 三、题目定义
# ===========================================================================
# segs 只写"看得见的线"，点由程序从端点/交点推出 —— 不必手写，也就不会漏。

def hline(y, x0, x1):
    return ((x0, y), (x1, y))


def vline(x, y0, y1):
    return ((x, y0), (x, y1))


# --- 单元 1：数线段 ---
SEG_Q = [
    dict(
        n=1, diff="基础",
        question="下图中一条直线上有 4 个点，图中一共有多少条线段？",
        alt="一条水平直线上从左到右依次标出 4 个点",
        segs=[hline(160, 40, 340)],
        dots=[(40, 160), (140, 160), (240, 160), (340, 160)],
        distract="4,5,8",
        how="按间隔分类：相邻两点组成 3 条，隔一个点的 2 条，首尾相连的 1 条，3+2+1=6。"
            "也可以想成「4 个点任取 2 个」，4×3÷2=6。",
    ),
    dict(
        n=2, diff="基础",
        question="下图中一条直线上有 5 个点，图中一共有多少条线段？",
        alt="一条水平直线上从左到右依次标出 5 个点",
        segs=[hline(160, 40, 360)],
        dots=[(40, 160), (120, 160), (200, 160), (280, 160), (360, 160)],
        distract="5,8,12",
        how="4+3+2+1=10 条；或 5×4÷2=10。点越多越要靠「任取两点」，一条条数一定会漏。",
    ),
    dict(
        n=3, diff="进阶",
        question="下图是一个直角折线，横线上有 4 个点、竖线上有 3 个点（拐角那个点算在两条线上），图中一共有多少条线段？",
        alt="一条横线和一条竖线组成直角，横线上标 4 个点，竖线上标 3 个点，拐角处共用 1 个点",
        segs=[hline(250, 40, 360), vline(40, 60, 250)],
        dots=[(40, 250), (140, 250), (240, 250), (360, 250), (40, 60), (40, 150)],
        distract="6,7,10",
        how="横线 4 个点：4×3÷2=6 条；竖线 3 个点：3×2÷2=3 条。"
            "跨过拐角的两个点不共线，连不成线段，所以是 6+3=9 条。",
    ),
]

def rays(vertex, length, angles):
    """
    从顶点按角度（度，逆时针为正）画等长射线。

    为什么要等长：手写端点时长短差三倍，图看起来像"三条射线 + 一条短线"，
    孩子第一反应是"这算一个角吗"。等长等角距才是一道干净的数角题。
    SVG 的 y 轴朝下，所以纵向取负。
    """
    vx, vy = vertex
    out = []
    for a in angles:
        rad = math.radians(a)
        out.append(((vx, vy), (round(vx + length * math.cos(rad)), round(vy - length * math.sin(rad)))))
    return out


# --- 单元 2：数角 ---
ANGLE_Q = [
    dict(
        n=4, diff="基础",
        question="下图中从同一个点引出 4 条射线，图中一共有多少个角？",
        alt="一个点向右上方引出 4 条等长射线，方向各不相同",
        vertex=(70, 280),
        segs=rays((70, 280), 260, [0, 30, 60, 80]),
        dots=[(70, 280)],
        distract="4,5,8",
        how="每两条射线夹出一个角：4×3÷2=6 个。"
            "按「只隔 1 条射线的有几个、隔 2 条的…」数也是 3+2+1=6。",
    ),
    dict(
        n=5, diff="进阶",
        question="下图中从同一个点引出 5 条射线，图中一共有多少个角？",
        alt="一个点向右上方引出 5 条等长射线，方向由低到高依次排开",
        vertex=(70, 285),
        segs=rays((70, 285), 250, [0, 25, 45, 65, 85]),
        dots=[(70, 285)],
        distract="5,8,12",
        how="5×4÷2=10 个。射线越多越要按「任取两条」算，不要逐个四边形去数。",
    ),
]

# --- 单元 3：数三角形 ---
TRI_Q = [
    dict(
        n=6, diff="基础",
        question="下图是一个三角形，从顶点向底边画了一条线。图中一共有多少个三角形？",
        alt="一个三角形，从上方顶点向底边中点画了一条竖线",
        segs=[((210, 60), (70, 260)), ((210, 60), (350, 260)),
              ((70, 260), (350, 260)), ((210, 60), (210, 260))],
        dots=[],
        distract="2,4,6",
        how="先数小的：左右各 1 个，共 2 个；再数两个小三角形合起来的大三角形 1 个。"
            "2+1=3 个。",
    ),
    dict(
        n=7, diff="进阶",
        question="下图是一个三角形，从顶点向底边画了两条线，把底边分成 3 段。图中一共有多少个三角形？",
        alt="一个三角形，从上方顶点向底边画了两条线，底边被分成三段",
        segs=[((210, 60), (60, 260)), ((210, 60), (360, 260)),
              ((60, 260), (360, 260)),
              ((210, 60), (160, 260)), ((210, 60), (260, 260))],
        dots=[],
        distract="3,5,8",
        how="底边被分成 3 段，每个「底边线段」都对应一个三角形："
            "单段 3 个、两段合起来 2 个、三段合起来 1 个，3+2+1=6 个。",
    ),
    dict(
        n=8, diff="进阶",
        question="下图三角形中，三条边的中点两两相连。图中一共有多少个三角形？",
        alt="一个三角形，三条边的中点两两用线连接，中间形成一个小三角形",
        segs=[((210, 50), (60, 270)), ((210, 50), (360, 270)), ((60, 270), (360, 270)),
              ((135, 160), (285, 160)),   # 中位线 MN
              ((135, 160), (210, 270)),   # 中位线 MP
              ((285, 160), (210, 270))],  # 中位线 NP
        dots=[],
        distract="4,6,9",
        how="三条中位线把大三角形分成 4 个同样的小三角形，再加上整个大三角形 1 个，"
            "4+1=5 个。注意：两个小三角形拼成的平行四边形不是三角形。",
    ),
    dict(
        n=9, diff="挑战",
        question="下图是一个正方形，画了两条对角线。图中一共有多少个三角形？",
        alt="一个正方形，两条对角线交叉，把正方形分成四个小三角形",
        segs=[((90, 60), (330, 60)), ((330, 60), (330, 280)),
              ((330, 280), (90, 280)), ((90, 280), (90, 60)),
              ((90, 60), (330, 280)), ((330, 60), (90, 280))],
        dots=[],
        distract="4,6,10",
        how="两条对角线交出中心点。单个小三角形 4 个；由两个小三角形拼成的"
            "（以正方形一条边为底的）4 个。4+4=8 个。",
    ),
]

# --- 单元 4：数长方形与正方形 ---
def grid(xs, ys):
    segs = [hline(y, xs[0], xs[-1]) for y in ys]
    segs += [vline(x, ys[0], ys[-1]) for x in xs]
    return segs


RECT_Q = [
    dict(
        n=10, diff="基础", mode="rect",
        question="下图由 2 行 3 列的小方格组成，图中一共有多少个长方形？（正方形也算长方形）",
        alt="两行三列共六个小方格组成的网格",
        segs=grid([60, 160, 260, 360], [100, 200, 300]),
        dots=[],
        distract="6,12,24",
        how="先数横边上的线段数：4 个点 → 4×3÷2=6 条；再数竖边：3 个点 → 3 条。"
            "每条横边配每条竖边都确定一个长方形，6×3=18 个。",
    ),
    dict(
        n=11, diff="进阶", mode="rect",
        question="下图由 3 行 3 列的小方格组成，图中一共有多少个长方形？（正方形也算长方形）",
        alt="三行三列共九个小方格组成的网格",
        segs=grid([90, 170, 250, 330], [60, 140, 220, 300]),
        dots=[],
        distract="9,18,40",
        how="横边 4 个点 → 6 条线段，竖边同样 6 条，6×6=36 个。"
            "用「横边取两条、竖边取两条」来算，比一个一个数可靠得多。",
    ),
    dict(
        n=12, diff="基础", mode="square",
        question="下图由 2 行 3 列的小方格组成，图中一共有多少个正方形？",
        alt="两行三列共六个小方格组成的网格",
        segs=grid([60, 160, 260, 360], [100, 200, 300]),
        dots=[],
        distract="6,9,12",
        how="按边长分类：边长 1 格的有 2×3=6 个；边长 2 格的有 1×2=2 个。"
            "6+2=8 个。边长超过 2 格就放不下了。",
    ),
    dict(
        n=13, diff="挑战", mode="square",
        question="下图由 3 行 3 列的小方格组成，图中一共有多少个正方形？",
        alt="三行三列共九个小方格组成的网格",
        segs=grid([90, 170, 250, 330], [60, 140, 220, 300]),
        dots=[],
        distract="9,12,18",
        how="按边长分类：1 格 3×3=9 个；2 格 2×2=4 个；3 格 1×1=1 个。"
            "9+4+1=14 个。",
    ),
]

UNITS = [
    dict(id="u1", name="数线段", kp="kp-seg", qs=SEG_Q, mode="segment"),
    dict(id="u2", name="数角", kp="kp-angle", qs=ANGLE_Q, mode="angle"),
    dict(id="u3", name="数三角形", kp="kp-tri", qs=TRI_Q, mode="triangle"),
    dict(id="u4", name="数长方形和正方形", kp="kp-rect", qs=RECT_Q, mode="rect"),
]

KPS = {
    "kp-seg": ("数线段：任取两个点", "一条线上有 n 个点，线段总数 = n×(n−1)÷2。"
               "也可以按间隔分类：相邻两点 n−1 条，隔一个点 n−2 条……一直到首尾相连 1 条。"
               "两条不共线的线（比如直角折线）要分开算再相加。"),
    "kp-angle": ("数角：由射线决定", "从同一个点引出的角，完全由「取哪两条射线」决定：n 条射线 → n×(n−1)÷2 个角。"
                 "注意平角、钝角也要算，只要两条射线不重合就是一个角。"),
    "kp-tri": ("数三角形：先小后大，按大小分类", "先把最小的三角形数清楚，再看几个小三角形能拼成一个大三角形。"
               "关键是「每一条底边线段对应一个三角形」——底边被分成几段，就从这些段里任取连续几段。"),
    "kp-rect": ("数长方形：横边 × 竖边", "长方形由「两条横线 + 两条竖线」确定。"
                "先数出所有横线之间的线段数，再数竖线之间的线段数，两者相乘就是长方形总数。"
                "数正方形要按边长分类：1 格、2 格、3 格……分别数完再相加。"),
}


# ===========================================================================
# 四、生成
# ===========================================================================


def build():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for old in ASSET_DIR.glob("*.svg"):
        old.unlink()

    kps, units, all_ex = [], [], []
    for kp_id, (title, content) in KPS.items():
        kps.append({"id": kp_id, "type": "concept", "title": title, "content": content})

    total = 0
    for u in UNITS:
        exercises = []
        for q in u["qs"]:
            mode = question_kind(q, u)
            answer = evaluate(q, mode)
            distract = [int(x) for x in q["distract"].split(",")]

            # 干扰项必须合法：不等于答案、互不相同、都是正整数
            assert answer not in distract, f"{PKG_ID}-{u['id']}-{q['n']:02d} 干扰项里混进了正确答案 {answer}"
            assert len(set(distract)) == len(distract), f"第 {q['n']} 题干扰项重复"
            assert all(d > 0 for d in distract), f"第 {q['n']} 题干扰项必须为正数"

            pos = (q["n"] - 1) % 4
            pool = distract[:3]
            pool.insert(pos, answer)
            options = [f"{chr(65 + i)}. {v}" for i, v in enumerate(pool)]

            asset_name = f"q{q['n']:02d}.svg"
            svg = render_svg(q["segs"], q.get("dots", []))

            # 自检：图形不允许退化（裁 viewBox 后，退化图会变成一条看不见的细带）
            degenerate = 'viewBox="' not in svg or ("<line" not in svg and not q.get("dots"))
            if degenerate:
                raise SystemExit(f"q{q['n']:02d} 图形为空或退化")

            (ASSET_DIR / asset_name).write_text(svg, encoding="utf-8")

            exercises.append({
                "id": f"shape-q{q['n']:02d}",
                "type": "single",
                "question": q["question"],
                "options": options,
                "answer": chr(65 + pos),
                "explanation": q["how"] + f"正确答案是 {answer}。",
                "knowledgePointIds": [u["kp"]],
                "image": f"assets/{asset_name}",
                "imageAlt": q["alt"],
                "metadata": {"difficulty": q["diff"]},
            })
            total += 1

        units.append({
            "id": u["id"],
            "name": u["name"],
            "topics": [{
                "id": f"{u['id']}-t1",
                "title": f"{u['name']}（{len(exercises)} 题）",
                "knowledgePointIds": [u["kp"]],
                "exercises": exercises,
            }],
        })

    pkg = {
        "manifest": {
            "schemaVersion": "1.0",
            "packageId": PKG_ID,
            "title": "四年级思维训练 · 巧数图形",
            "subject": "math",
            "grade": 4,
            "term": "up",
            "edition": "通用",
            "packageType": "special",
            # 必须 false：考试模式关掉逐题反馈，孩子看不到错在哪、为什么漏数
            "examMode": False,
            "dependencies": [],
        },
        "knowledgePoints": kps,
        "units": units,
        "exercises": [e for u in units for t in u["topics"] for e in t["exercises"]],
    }

    OUT_JSON.write_text(json.dumps(pkg, ensure_ascii=False, indent=1), encoding="utf-8")

    # 自检：每张图都被引用、每个引用都有图、每题都有 alt
    refs = {e["image"] for e in pkg["exercises"]}
    files = {f"assets/{p.name}" for p in ASSET_DIR.glob("*.svg")}
    assert refs == files, f"图片引用与文件不一致：多 {refs - files} / 缺 {files - refs}"
    assert all(e.get("imageAlt") for e in pkg["exercises"]), "有题缺 imageAlt"

    print(f"✅ {PKG_ID}: {total} 题 / {len(units)} 单元 / {len(kps)} 知识点 / {len(files)} 张图")
    for u in UNITS:
        counts = [evaluate(q, question_kind(q, u)) for q in u["qs"]]
        print(f"   {u['name']}: " + ", ".join(str(c) for c in counts))
    return 0


if __name__ == "__main__":
    sys.exit(build())
