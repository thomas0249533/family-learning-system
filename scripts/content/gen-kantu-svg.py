#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
二上看图写话 · 12 篇课文插图生成器
==================================
把 12 道 essay 题的「画面」描述画成 SVG 插图，挂到题目的 image / imageAlt 上。

为什么用脚本而不是手绘 12 个文件：
  · 统一画风（同一套调色板 / 线宽 / 人物比例）手绘必然走样；
  · 12 幅里有 3 幅是多格连环画，格子坐标要算，手写坐标更容易错；
  · 以后改配色、改人物姿势只改一处。

绘制纪律（踩过的坑写在这里）：
  · 只许用 path / circle / rect / ellipse / line / polygon / text + linearGradient；
    不许 foreignObject（`sanitizeSvg` 会剥掉）、不许 on* 属性、不许外链 <image>。
  · `<img>` 加载 SVG 时不执行脚本、也不加载外部字体 —— 所以文字只用 digits，
    font-family 给 sans-serif 兜底。
  · 画布长宽比按「显示端 max-height: 320px」选：单幅 1000×640、四格 1200×700、
    三格 1500×500，这样在题卡里缩下来格子里的小动物还看得清。
  · 每幅自带 #fffdf7 底，与 App 的 $bg-color 同色，不靠 CSS 兜底。

用法：
    python scripts/content/gen-kantu-svg.py            # 生成 SVG
    python scripts/content/gen-kantu-svg.py --patch    # 生成 + 写回包 JSON
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SET_DIR = ROOT / "content" / "chinese-2-up-rjb"
PKG_ID = "special-chinese-2-up-kantu"
PKG_FILE = SET_DIR / f"{PKG_ID}.json"
ASSET_DIR = SET_DIR / "assets" / PKG_ID

# ============================ 调色板 ============================
BG = "#fffdf7"
SKY_DAY = ("#dff2fa", "#bfe6f4")
SKY_DUSK = ("#ffdca8", "#ffab74")
SKY_NIGHT = ("#2f3b57", "#1d2537")
GRASS = "#8ecb70"
GRASS_DARK = "#6fb457"
SOIL = "#c9a06a"
TRUNK = "#a5714a"
TRUNK_DARK = "#8a5a38"
CANOPY = "#5aa85e"
CANOPY_DARK = "#479450"
AUTUMN = ["#e0603c", "#e8894a", "#d94f4f", "#e8b13f"]
SKIN = "#f7d3b4"
HAIR = "#3b2a22"
RED = "#d94f4f"
BLUE = "#4a7ec0"
YELLOW = "#ffd35c"
WHITE = "#ffffff"
WATER = "#8ecae6"
WATER_DARK = "#6fb3d2"
STONE = "#b9b3a8"
STONE_DARK = "#8f897e"


def esc(s: str) -> str:
    return s


# ============================ 基础图元 ============================
class Canvas:
    """极简 SVG 拼装器：只管顺序追加，最后一次性拼成字符串。"""

    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.parts: list[str] = []
        self.defs: list[str] = []

    def add(self, s: str) -> "Canvas":
        self.parts.append(s)
        return self

    # ---------- 背景 ----------
    def sky(self, top: str, bottom: str) -> "Canvas":
        gid = f"sky{len(self.defs)}"
        self.defs.append(
            f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>'
        )
        return self.add(f'<rect x="0" y="0" width="{self.w}" height="{self.h}" fill="url(#{gid})"/>')

    def ground(self, y: float, color: str = GRASS) -> "Canvas":
        return self.add(f'<rect x="0" y="{y}" width="{self.w}" height="{self.h - y}" fill="{color}"/>')

    def hill(self, cx: float, cy: float, rx: float, ry: float, color: str) -> "Canvas":
        return self.add(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}"/>')

    def sun(self, cx: float, cy: float, r: float, color: str = YELLOW) -> "Canvas":
        return self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/>')

    def cloud(self, cx: float, cy: float, s: float, color: str = WHITE, op: float = 0.92) -> "Canvas":
        return self.add(
            f'<g fill="{color}" opacity="{op}">'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{s}" ry="{s * 0.55}"/>'
            f'<ellipse cx="{cx - s * 0.55}" cy="{cy + s * 0.12}" rx="{s * 0.55}" ry="{s * 0.4}"/>'
            f'<ellipse cx="{cx + s * 0.6}" cy="{cy + s * 0.14}" rx="{s * 0.5}" ry="{s * 0.36}"/>'
            f"</g>"
        )

    # ---------- 植物 ----------
    def tree(self, x: float, base_y: float, s: float, canopy: str = CANOPY, trunk: str = TRUNK) -> "Canvas":
        """圆形树冠的阔叶树；s ≈ 树高/200"""
        tw = 12 * s
        self.add(
            f'<path d="M{x - tw} {base_y} L{x - tw * 0.62} {base_y - 96 * s} '
            f'L{x + tw * 0.62} {base_y - 96 * s} L{x + tw} {base_y} Z" fill="{trunk}"/>'
        )
        self.add(
            f'<g fill="{canopy}">'
            f'<circle cx="{x}" cy="{base_y - 128 * s}" r="{46 * s}"/>'
            f'<circle cx="{x - 38 * s}" cy="{base_y - 104 * s}" r="{34 * s}"/>'
            f'<circle cx="{x + 38 * s}" cy="{base_y - 104 * s}" r="{34 * s}"/>'
            f"</g>"
        )
        return self

    def autumn_tree(self, x: float, base_y: float, s: float, i: int = 0) -> "Canvas":
        c = AUTUMN[i % len(AUTUMN)]
        return self.tree(x, base_y, s, canopy=c)

    def grass_tuft(self, x: float, y: float, s: float = 1.0, color: str = GRASS_DARK) -> "Canvas":
        return self.add(
            f'<g stroke="{color}" stroke-width="{3 * s}" stroke-linecap="round" fill="none">'
            f'<path d="M{x} {y} l{-6 * s} {-16 * s}"/>'
            f'<path d="M{x} {y} l{1 * s} {-20 * s}"/>'
            f'<path d="M{x} {y} l{8 * s} {-14 * s}"/>'
            f"</g>"
        )

    def leaf(self, x: float, y: float, s: float = 1.0, color: str = RED, rot: float = 0) -> "Canvas":
        return self.add(
            f'<path transform="rotate({rot} {x} {y})" fill="{color}" '
            f'd="M{x} {y - 9 * s} q{9 * s} {5 * s} {9 * s} {9 * s} q{-9 * s} {4 * s} {-9 * s} {9 * s} '
            f'q{-9 * s} {-5 * s} {-9 * s} {-9 * s} q0 {-4 * s} {9 * s} {-9 * s} Z"/>'
        )

    def flower(self, x: float, y: float, s: float = 1.0, color: str = "#f2a0c0") -> "Canvas":
        pet = "".join(
            f'<circle cx="{x + 5.5 * s * math.cos(a * math.pi / 4)}" cy="{y + 5.5 * s * math.sin(a * math.pi / 4)}" '
            f'r="{3.6 * s}"/>'
            for a in range(8)
        )
        return self.add(
            f'<g fill="{color}">{pet}<circle cx="{x}" cy="{y}" r="{3.2 * s}" fill="{YELLOW}"/></g>'
        )

    # ---------- 小动物 ----------
    def ant(self, x: float, y: float, s: float = 1.0, color: str = "#5a3a26", flip: bool = False) -> "Canvas":
        """x,y = 中间那只触角/背部高度处；flip 让头朝左"""
        d = -1 if flip else 1
        return self.add(
            f'<g fill="{color}" stroke="{color}" stroke-linecap="round">'
            f'<ellipse cx="{x}" cy="{y}" rx="{10 * s}" ry="{7.5 * s}"/>'
            f'<ellipse cx="{x + 11 * s * d}" cy="{y - 1 * s}" rx="{6 * s}" ry="{5.5 * s}"/>'
            f'<circle cx="{x + 19 * s * d}" cy="{y - 2 * s}" r="{4.6 * s}"/>'
            f'<g stroke-width="{1.8 * s}" fill="none">'
            f'<path d="M{x + 4 * s * d} {y + 6 * s} l{-4 * s} {7 * s}"/>'
            f'<path d="M{x + 10 * s * d} {y + 6 * s} l{1 * s} {7 * s}"/>'
            f'<path d="M{x + 16 * s * d} {y + 5 * s} l{5 * s} {6 * s}"/>'
            f'<path d="M{x + 21 * s * d} {y - 5 * s} l{4 * s * d} {-7 * s}"/>'
            f'<path d="M{x + 17 * s * d} {y - 5 * s} l{-2 * s * d} {-7 * s}"/>'
            f"</g></g>"
        )

    def bird(self, x: float, y: float, s: float = 1.0, color: str = "#4a4a4a") -> "Canvas":
        return self.add(
            f'<path d="M{x - 12 * s} {y} q{6 * s} {-8 * s} {12 * s} 0 q{6 * s} {-8 * s} {12 * s} 0" '
            f'stroke="{color}" stroke-width="{3.4 * s}" fill="none" stroke-linecap="round"/>'
        )

    def goose(self, x: float, y: float, s: float = 1.0, color: str = "#3f3f46") -> "Canvas":
        """大雁：身体 + 展开的双翼 + 前伸的脖子"""
        return self.add(
            f'<g fill="{color}">'
            f'<ellipse cx="{x}" cy="{y}" rx="{11 * s}" ry="{6 * s}"/>'
            f'<path d="M{x - 2 * s} {y - 3 * s} q{14 * s} {-9 * s} {20 * s} {-1 * s} q{-12 * s} {3 * s} {-20 * s} {1 * s} Z"/>'
            f'<path d="M{x - 8 * s} {y + 1 * s} q{-16 * s} {-6 * s} {-20 * s} {2 * s} q{12 * s} {3 * s} {20 * s} {-2 * s} Z"/>'
            f'<path d="M{x + 10 * s} {y - 2 * s} l{10 * s} {-4 * s} l{2 * s} {3 * s} l{-10 * s} {4 * s} Z"/>'
            f"</g>"
        )

    def butterfly(self, x: float, y: float, s: float = 1.0, color: str = "#f2a0c0") -> "Canvas":
        return self.add(
            f'<g fill="{color}" opacity="0.95">'
            f'<ellipse cx="{x - 5 * s}" cy="{y - 3 * s}" rx="{5.5 * s}" ry="{4.5 * s}" transform="rotate(-25 {x - 5 * s} {y - 3 * s})"/>'
            f'<ellipse cx="{x + 5 * s}" cy="{y - 3 * s}" rx="{5.5 * s}" ry="{4.5 * s}" transform="rotate(25 {x + 5 * s} {y - 3 * s})"/>'
            f'<ellipse cx="{x - 4 * s}" cy="{y + 3 * s}" rx="{4 * s}" ry="{3.4 * s}" transform="rotate(-15 {x - 4 * s} {y + 3 * s})"/>'
            f'<ellipse cx="{x + 4 * s}" cy="{y + 3 * s}" rx="{4 * s}" ry="{3.4 * s}" transform="rotate(15 {x + 4 * s} {y + 3 * s})"/>'
            f'<rect x="{x - 1 * s}" y="{y - 6 * s}" width="{2 * s}" height="{12 * s}" rx="{1 * s}" fill="#5a4a3a"/>'
            f"</g>"
        )

    def rabbit(self, x: float, foot_y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<g fill="#f4f1ec" stroke="#d8d2c8" stroke-width="{1.4 * s}">'
            f'<ellipse cx="{x}" cy="{foot_y - 14 * s}" rx="{17 * s}" ry="{14 * s}"/>'
            f'<circle cx="{x + 9 * s}" cy="{foot_y - 32 * s}" r="{11 * s}"/>'
            f'<ellipse cx="{x + 5 * s}" cy="{foot_y - 50 * s}" rx="{3.4 * s}" ry="{11 * s}"/>'
            f'<ellipse cx="{x + 13 * s}" cy="{foot_y - 50 * s}" rx="{3.4 * s}" ry="{11 * s}"/>'
            f"</g>"
            f'<circle cx="{x + 12 * s}" cy="{foot_y - 34 * s}" r="{1.8 * s}" fill="#3b2a22"/>'
        )

    def chick(self, x: float, foot_y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<g fill="{YELLOW}">'
            f'<ellipse cx="{x}" cy="{foot_y - 15 * s}" rx="{16 * s}" ry="{15 * s}"/>'
            f'<circle cx="{x + 10 * s}" cy="{foot_y - 33 * s}" r="{10 * s}"/>'
            f'<path d="M{x - 6 * s} {foot_y - 14 * s} q{-6 * s} {4 * s} {0} {8 * s}" fill="{YELLOW}"/>'
            f"</g>"
            f'<polygon points="{x + 19 * s},{foot_y - 33 * s} {x + 29 * s},{foot_y - 29 * s} {x + 19 * s},{foot_y - 25 * s}" fill="#f08a2e"/>'
            f'<circle cx="{x + 13 * s}" cy="{foot_y - 36 * s}" r="{1.5 * s}" fill="#3b2a22"/>'
            f'<g stroke="#e08a2e" stroke-width="{2.6 * s}" stroke-linecap="round">'
            f'<path d="M{x - 4 * s} {foot_y - 1 * s} l0 {4 * s}"/><path d="M{x + 5 * s} {foot_y - 1 * s} l0 {4 * s}"/></g>'
        )

    def squirrel(self, x: float, foot_y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<g fill="#c98a4b">'
            f'<ellipse cx="{x}" cy="{foot_y - 13 * s}" rx="{13 * s}" ry="{13 * s}"/>'
            f'<circle cx="{x + 8 * s}" cy="{foot_y - 30 * s}" r="{9 * s}"/>'
            f'<path d="M{x - 10 * s} {foot_y - 12 * s} q{-16 * s} {-14 * s} {-8 * s} {-30 * s} '
            f'q{6 * s} {12 * s} {14 * s} {13 * s} Z"/>'
            f"</g>"
            f'<circle cx="{x + 11 * s}" cy="{foot_y - 32 * s}" r="{1.7 * s}" fill="#3b2a22"/>'
        )

    def mouse(self, x: float, foot_y: float, s: float = 1.0, color: str = "#9a9aa5") -> "Canvas":
        return self.add(
            f'<g fill="{color}">'
            f'<ellipse cx="{x}" cy="{foot_y - 12 * s}" rx="{14 * s}" ry="{12 * s}"/>'
            f'<circle cx="{x + 9 * s}" cy="{foot_y - 26 * s}" r="{8 * s}"/>'
            f'<circle cx="{x + 4 * s}" cy="{foot_y - 33 * s}" r="{5 * s}"/>'
            f'<circle cx="{x + 13 * s}" cy="{foot_y - 33 * s}" r="{5 * s}"/>'
            f"</g>"
            f'<path d="M{x - 13 * s} {foot_y - 10 * s} q{-12 * s} {2 * s} {-16 * s} {-8 * s}" '
            f'stroke="{color}" stroke-width="{2.6 * s}" fill="none" stroke-linecap="round"/>'
            f'<circle cx="{x + 12 * s}" cy="{foot_y - 27 * s}" r="{1.6 * s}" fill="#2b2b2b"/>'
        )

    def dog(self, x: float, foot_y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<g fill="#c98a4b">'
            f'<ellipse cx="{x}" cy="{foot_y - 16 * s}" rx="{20 * s}" ry="{13 * s}"/>'
            f'<circle cx="{x + 17 * s}" cy="{foot_y - 30 * s}" r="{10 * s}"/>'
            f'<ellipse cx="{x + 12 * s}" cy="{foot_y - 38 * s}" rx="{3.4 * s}" ry="{7 * s}" fill="#a86f39"/>'
            f"</g>"
            f'<path d="M{x - 20 * s} {foot_y - 20 * s} q{-10 * s} {-10 * s} {-4 * s} {-16 * s}" '
            f'stroke="#c98a4b" stroke-width="{4 * s}" fill="none" stroke-linecap="round"/>'
            f'<circle cx="{x + 21 * s}" cy="{foot_y - 32 * s}" r="{1.8 * s}" fill="#2b2b2b"/>'
            f'<path d="M{x + 22 * s} {foot_y - 24 * s} q{5 * s} {2 * s} {1 * s} {5 * s}" stroke="#8a5a38" stroke-width="{2 * s}" fill="none"/>'
        )

    def crane(self, x: float, foot_y: float, s: float = 1.0) -> "Canvas":
        """白鹤：细长腿 + 椭圆身体 + S 形长颈 + 尖喙，头顶一点红"""
        return self.add(
            f'<g stroke="#e8a86a" stroke-width="{3 * s}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="M{x - 4 * s} {foot_y - 44 * s} l0 {44 * s}"/>'
            f'<path d="M{x + 7 * s} {foot_y - 44 * s} l0 {44 * s}"/>'
            f'<path d="M{x - 9 * s} {foot_y} l10 0"/><path d="M{x + 2 * s} {foot_y} l10 0"/>'
            f"</g>"
            f'<ellipse cx="{x + 2 * s}" cy="{foot_y - 56 * s}" rx="{26 * s}" ry="{15 * s}" fill="#ffffff"/>'
            f'<path d="M{x + 22 * s} {foot_y - 62 * s} q{16 * s} {-10 * s} {10 * s} {-30 * s} '
            f'q{-4 * s} {-14 * s} {10 * s} {-16 * s}" stroke="#ffffff" stroke-width="{9 * s}" '
            f'fill="none" stroke-linecap="round"/>'
            f'<circle cx="{x + 42 * s}" cy="{foot_y - 108 * s}" r="{8 * s}" fill="#ffffff"/>'
            f'<polygon points="{x + 49 * s},{foot_y - 108 * s} {x + 66 * s},{foot_y - 104 * s} {x + 49 * s},{foot_y - 101 * s}" fill="#e8a13f"/>'
            f'<circle cx="{x + 44 * s}" cy="{foot_y - 112 * s}" r="{2.6 * s}" fill="{RED}"/>'
            f'<circle cx="{x + 44 * s}" cy="{foot_y - 108 * s}" r="{1.8 * s}" fill="#2b2b2b"/>'
        )

    def wasp(self, x: float, y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<g>'
            f'<ellipse cx="{x}" cy="{y}" rx="{6 * s}" ry="{4 * s}" fill="#2b2b2b"/>'
            f'<ellipse cx="{x - 2 * s}" cy="{y}" rx="{3 * s}" ry="{3.6 * s}" fill="{YELLOW}"/>'
            f'<ellipse cx="{x + 3 * s}" cy="{y}" rx="{2.4 * s}" ry="{3 * s}" fill="{YELLOW}"/>'
            f'<ellipse cx="{x - 2 * s}" cy="{y - 5 * s}" rx="{4 * s}" ry="{2.4 * s}" fill="#ffffff" opacity="0.85"/>'
            f'<ellipse cx="{x + 3 * s}" cy="{y - 5 * s}" rx="{4 * s}" ry="{2.4 * s}" fill="#ffffff" opacity="0.85"/>'
            f"</g>"
        )

    # ---------- 人物 ----------
    def person(
        self,
        x: float,
        foot_y: float,
        h: float = 150,
        *,
        cloth: str = "#e8734a",
        cloth2: str | None = None,
        skin: str = SKIN,
        hair: str = HAIR,
        style: str = "boy",
        pose: str = "stand",
        arm_l: str = "down",
        arm_r: str = "down",
        scarf: bool = False,
        hat: str | None = None,
        backpack: str | None = None,
        face: str = "smile",
    ) -> "Canvas":
        """
        style: boy | girl（girl 有裙子/辫子）
        pose:  stand | sit | run | jump | lie
        arm:   down | up | point | salute | hold | pour | cover_face
        """
        hr = h * 0.078
        head_cy = foot_y - h * 0.885
        shoulder_y = foot_y - h * 0.70
        hip_y = foot_y - h * 0.42
        if pose in ("sit", "lie"):
            hip_y = foot_y - h * 0.20
            head_cy = foot_y - h * 0.62
            shoulder_y = foot_y - h * 0.48

        lw = h * 0.062  # 四肢粗细

        # ---- 腿 ----
        if pose == "run":
            legs = (
                f'<path d="M{x - h * 0.02} {hip_y} l{-h * 0.13} {h * 0.24}" />'
                f'<path d="M{x + h * 0.02} {hip_y} l{h * 0.14} {h * 0.20}" />'
            )
        elif pose == "jump":
            legs = (
                f'<path d="M{x - h * 0.03} {hip_y} l{-h * 0.11} {h * 0.16}" />'
                f'<path d="M{x + h * 0.03} {hip_y} l{h * 0.11} {h * 0.16}" />'
            )
        elif pose == "sit":
            legs = (
                f'<path d="M{x - h * 0.02} {hip_y} l{-h * 0.10} {h * 0.14} l{h * 0.16} {h * 0.03}" />'
                f'<path d="M{x + h * 0.02} {hip_y} l{h * 0.09} {h * 0.15} l{h * 0.16} {h * 0.02}" />'
            )
        elif pose == "lie":
            legs = (
                f'<path d="M{x - h * 0.02} {hip_y} l{-h * 0.20} {h * 0.04}" />'
                f'<path d="M{x + h * 0.02} {hip_y} l{h * 0.19} {-h * 0.02}" />'
            )
        else:
            legs = (
                f'<path d="M{x - h * 0.035} {hip_y} l0 {foot_y - hip_y}" />'
                f'<path d="M{x + h * 0.035} {hip_y} l0 {foot_y - hip_y}" />'
            )
        self.add(f'<g stroke="{cloth2 or cloth}" stroke-width="{lw}" stroke-linecap="round" fill="none">{legs}</g>')
        # 鞋：跑/跳时脚的位置不等于 foot_y（第一版统一画在 foot_y 上，
        # 结果是两只鞋脱在身体下面单独飘着），这里按姿势给出真实落点。
        if pose == "run":
            feet = [(x - h * 0.15, hip_y + h * 0.24), (x + h * 0.16, hip_y + h * 0.20)]
        elif pose == "jump":
            feet = [(x - h * 0.14, hip_y + h * 0.16), (x + h * 0.14, hip_y + h * 0.16)]
        elif pose == "sit":
            feet = [(x - h * 0.11, hip_y + h * 0.18), (x + h * 0.13, hip_y + h * 0.18)]
        else:
            feet = [(x - h * 0.045, foot_y), (x + h * 0.045, foot_y)]
        self.add(
            f'<g fill="#4a4a55">'
            + "".join(f'<ellipse cx="{fx:.1f}" cy="{fy:.1f}" rx="{h * 0.045}" ry="{h * 0.022}"/>'
                      for fx, fy in feet)
            + "</g>"
        )

        # ---- 躯干 ----
        if style == "girl":
            self.add(
                f'<path d="M{x - h * 0.075} {shoulder_y} L{x + h * 0.075} {shoulder_y} '
                f'L{x + h * 0.115} {hip_y + h * 0.06} L{x - h * 0.115} {hip_y + h * 0.06} Z" fill="{cloth}"/>'
            )
        else:
            self.add(
                f'<path d="M{x - h * 0.075} {shoulder_y} L{x + h * 0.075} {shoulder_y} '
                f'L{x + h * 0.06} {hip_y} L{x - h * 0.06} {hip_y} Z" fill="{cloth}"/>'
            )

        # ---- 书包（挂在背后）----
        if backpack:
            bx = x - h * 0.14 if pose != "run" else x - h * 0.15
            self.add(
                f'<rect x="{bx}" y="{shoulder_y + h * 0.03}" width="{h * 0.11}" height="{h * 0.19}" '
                f'rx="{h * 0.03}" fill="{backpack}"/>'
            )

        # ---- 手臂 ----
        def arm(side: str, mode: str) -> str:
            sgn = -1 if side == "l" else 1
            sx = x + sgn * h * 0.075
            sy = shoulder_y + h * 0.02
            if mode == "down":
                return f'<path d="M{sx} {sy} l{sgn * h * 0.02} {h * 0.22}"/>'
            if mode == "up":
                # 举手：斜上外扩，别贴着脑袋（贴着头会被看成"挠头"）
                return f'<path d="M{sx} {sy} l{sgn * h * 0.09} {-h * 0.26}"/>'
            if mode == "raise":
                # 举过头顶（举石头 / 举牌子）：手臂几乎竖直，手要到头顶以上
                return f'<path d="M{sx} {sy} l{sgn * h * 0.04} {-h * 0.52}"/>'
            if mode == "point":
                # 指：手要伸到脑袋外，否则看起来像摸耳朵
                return f'<path d="M{sx} {sy} l{sgn * h * 0.14} {-h * 0.20}"/>'
            if mode == "salute":
                # 敬礼：肘外展 → 手回到太阳穴高度（两段折线，末端贴头侧）
                return (
                    f'<path d="M{sx} {sy} l{sgn * h * 0.13} {-h * 0.10} '
                    f'l{-sgn * h * 0.07} {-h * 0.16}"/>'
                )
            if mode == "hold":
                return (
                    f'<path d="M{sx} {sy} l{sgn * h * 0.05} {h * 0.14} '
                    f'l{sgn * h * 0.07} {h * 0.02}"/>'
                )
            if mode == "lift":
                # 双手把东西举起来：肘弯、手在肩前上方
                return f'<path d="M{sx} {sy} l{sgn * h * 0.10} {-h * 0.12} l{sgn * h * 0.04} {-h * 0.10}"/>'
            if mode == "pour":
                return (
                    f'<path d="M{sx} {sy} l{sgn * h * 0.06} {h * 0.10} '
                    f'l{sgn * h * 0.10} {-h * 0.04}"/>'
                )
            if mode == "cover_face":
                return (
                    f'<path d="M{sx} {sy} l{sgn * h * 0.03} {-h * 0.12} '
                    f'l{-sgn * h * 0.03} {-h * 0.06}"/>'
                )
            return ""
        self.add(
            f'<g stroke="{skin}" stroke-width="{lw * 0.9}" stroke-linecap="round" fill="none">'
            f"{arm('l', arm_l)}{arm('r', arm_r)}</g>"
        )

        # ---- 红领巾 ----
        if scarf:
            self.add(
                f'<path d="M{x - h * 0.06} {shoulder_y + h * 0.005} L{x + h * 0.06} {shoulder_y + h * 0.005} '
                f'L{x + h * 0.015} {shoulder_y + h * 0.085} Z" fill="{RED}"/>'
            )

        # ---- 头 ----
        self.add(f'<circle cx="{x}" cy="{head_cy}" r="{hr}" fill="{skin}"/>')

        # ---- 头发 ----
        if style == "girl":
            self.add(
                f'<path d="M{x - hr} {head_cy - hr * 0.15} a{hr} {hr} 0 0 1 {hr * 2} 0 '
                f'q{-hr} {-hr * 0.55} {-hr * 2} 0 Z" fill="{hair}"/>'
                f'<circle cx="{x - hr * 1.15}" cy="{head_cy + hr * 0.6}" r="{hr * 0.42}" fill="{hair}"/>'
                f'<circle cx="{x + hr * 1.15}" cy="{head_cy + hr * 0.6}" r="{hr * 0.42}" fill="{hair}"/>'
            )
        else:
            self.add(
                f'<path d="M{x - hr} {head_cy - hr * 0.2} a{hr} {hr} 0 0 1 {hr * 2} 0 '
                f'q{-hr * 0.2} {-hr * 0.5} {-hr} {-hr * 0.35} q{-hr * 0.8} {-hr * 0.15} {-hr} {hr * 0.35} Z" fill="{hair}"/>'
            )

        # ---- 帽子 ----
        if hat:
            self.add(
                f'<path d="M{x - hr} {head_cy - hr * 0.35} a{hr} {hr} 0 0 1 {hr * 2} 0 Z" fill="{hat}"/>'
                f'<rect x="{x - hr * 1.35}" y="{head_cy - hr * 0.45}" width="{hr * 2.7}" height="{hr * 0.30}" '
                f'rx="{hr * 0.15}" fill="{hat}"/>'
            )

        # ---- 五官 ----
        ey = head_cy + hr * 0.12
        if face == "happy":
            self.add(
                f'<g stroke="#3b2a22" stroke-width="{hr * 0.16}" fill="none" stroke-linecap="round">'
                f'<path d="M{x - hr * 0.42} {ey} q{hr * 0.16} {-hr * 0.22} {hr * 0.32} 0"/>'
                f'<path d="M{x + hr * 0.10} {ey} q{hr * 0.16} {-hr * 0.22} {hr * 0.32} 0"/>'
                f'<path d="M{x - hr * 0.26} {ey + hr * 0.42} q{hr * 0.26} {hr * 0.26} {hr * 0.52} 0"/>'
                f"</g>"
            )
        elif face == "sad":
            self.add(
                f'<g stroke="#3b2a22" stroke-width="{hr * 0.16}" fill="none" stroke-linecap="round">'
                f'<path d="M{x - hr * 0.45} {ey - hr * 0.1} l{hr * 0.32} {hr * 0.14}"/>'
                f'<path d="M{x + hr * 0.13} {ey + hr * 0.04} l{hr * 0.32} {-hr * 0.14}"/>'
                f'<path d="M{x - hr * 0.22} {ey + hr * 0.5} q{hr * 0.22} {-hr * 0.22} {hr * 0.44} 0"/>'
                f"</g>"
            )
        else:
            self.add(
                f'<g fill="#3b2a22">'
                f'<circle cx="{x - hr * 0.34}" cy="{ey}" r="{hr * 0.13}"/>'
                f'<circle cx="{x + hr * 0.34}" cy="{ey}" r="{hr * 0.13}"/>'
                f"</g>"
                f'<path d="M{x - hr * 0.22} {ey + hr * 0.42} q{hr * 0.22} {hr * 0.22} {hr * 0.44} 0" '
                f'stroke="#3b2a22" stroke-width="{hr * 0.13}" fill="none" stroke-linecap="round"/>'
            )
        return self

    def fallen(self, x: float, gy: float, h: float = 140, cloth: str = "#4a7ec0") -> "Canvas":
        """
        摔倒的人（趴在地上、双手捂脸）。
        为什么单独一个方法：`person(pose='lie')` 是把站姿旋转过来的近似，膝盖和手肘的
        方向全错，渲染出来像在做体操（第一版就是这样）。躺姿的骨架方向和站姿正交，
        硬套只会得到畸形，不如按躺姿重新摆点位。
        x = 身体中心，gy = 地面线；头在右侧。
        """
        hip = (x - h * 0.34, gy - h * 0.10)
        shoulder = (x + h * 0.06, gy - h * 0.13)
        head = (x + h * 0.30, gy - h * 0.17)
        hr = h * 0.078
        lw = h * 0.058
        # 腿：一条伸直一条屈起
        self.add(
            f'<g stroke="{cloth}" stroke-width="{lw}" stroke-linecap="round" fill="none">'
            f'<path d="M{hip[0]} {hip[1]} L{x - h * 0.58} {gy - h * 0.05} L{x - h * 0.66} {gy - h * 0.02}"/>'
            f'<path d="M{hip[0]} {hip[1]} L{x - h * 0.52} {gy - h * 0.16} L{x - h * 0.36} {gy - h * 0.09}"/>'
            f"</g>"
        )
        # 躯干：粗线代替衣服体块
        self.add(
            f'<path d="M{hip[0]} {hip[1]} L{shoulder[0]} {shoulder[1]}" stroke="{cloth}" '
            f'stroke-width="{h * 0.15}" stroke-linecap="round" fill="none"/>'
        )
        # 双臂捂住脸（手要落在脸两侧，不是举在头顶）
        self.add(
            f'<g stroke="{SKIN}" stroke-width="{lw * 0.9}" stroke-linecap="round" stroke-linejoin="round" fill="none">'
            f'<path d="M{shoulder[0]} {shoulder[1]} L{x + h * 0.16} {gy - h * 0.28} L{x + h * 0.30} {gy - h * 0.225}"/>'
            f'<path d="M{shoulder[0]} {shoulder[1] + h * 0.03} L{x + h * 0.20} {gy - h * 0.20} L{x + h * 0.33} {gy - h * 0.185}"/>'
            f"</g>"
        )
        # 头
        self.add(f'<circle cx="{head[0]}" cy="{head[1]}" r="{hr}" fill="{SKIN}"/>')
        self.add(
            f'<path d="M{head[0] - hr} {head[1] - hr * 0.25} a{hr} {hr} 0 0 1 {hr * 2 * 0.96} {hr * 0.1} '
            f'q{-hr * 0.9} {-hr * 0.5} {-hr * 1.9} {-hr * 0.1} Z" fill="{HAIR}"/>'
        )
        # 被蜇的包 + 皱眉
        self.add(f'<circle cx="{head[0] + hr * 0.45}" cy="{head[1] + hr * 0.35}" r="{hr * 0.26}" fill="#e8807a" opacity="0.85"/>')
        self.add(
            f'<g stroke="#3b2a22" stroke-width="{hr * 0.15}" fill="none" stroke-linecap="round">'
            f'<path d="M{head[0] - hr * 0.55} {head[1] - hr * 0.12} l{hr * 0.36} {hr * 0.12}"/>'
            f'<path d="M{head[0] + hr * 0.05} {head[1] - hr * 0.02} l{hr * 0.34} {-hr * 0.12}"/>'
            f'<path d="M{head[0] - hr * 0.18} {head[1] + hr * 0.45} q{hr * 0.22} {-hr * 0.2} {hr * 0.44} 0"/>'
            f"</g>"
        )
        return self

    # ---------- 道具 ----------
    def football(self, x: float, y: float, r: float = 16) -> "Canvas":
        return self.add(
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="{WHITE}" stroke="#3b3b3b" stroke-width="{r * 0.14}"/>'
            f'<polygon points="{x},{y - r * 0.45} {x + r * 0.43},{y - r * 0.14} {x + r * 0.27},{y + r * 0.38} '
            f'{x - r * 0.27},{y + r * 0.38} {x - r * 0.43},{y - r * 0.14}" fill="#3b3b3b"/>'
        )

    def vat(self, x: float, base_y: float, s: float = 1.0, inside: str = "") -> "Canvas":
        """
        大水缸：上口宽、肚圆、底略收。
        inside 画在「缸身之后、缸口之前」——要让球看起来沉在缸里，
        必须让缸口把它压住，而不是浮在缸口上方（第一版就错在这里）。
        水缸口径一半 42s、总高 96s。
        """
        body = (
            f'<path d="M{x - 42 * s} {base_y - 96 * s} '
            f'C{x - 54 * s} {base_y - 62 * s} {x - 52 * s} {base_y - 22 * s} {x - 32 * s} {base_y} '
            f'L{x + 32 * s} {base_y} '
            f'C{x + 52 * s} {base_y - 22 * s} {x + 54 * s} {base_y - 62 * s} {x + 42 * s} {base_y - 96 * s} Z" '
            f'fill="#9aa7b0"/>'
        )
        bands = (
            f'<path d="M{x - 47 * s} {base_y - 60 * s} q{47 * s} {14 * s} {94 * s} 0" '
            f'stroke="#7d8a94" stroke-width="{3.4 * s}" fill="none"/>'
            f'<path d="M{x - 45 * s} {base_y - 28 * s} q{45 * s} {12 * s} {90 * s} 0" '
            f'stroke="#7d8a94" stroke-width="{3.4 * s}" fill="none"/>'
        )
        rim = (
            f'<ellipse cx="{x}" cy="{base_y - 96 * s}" rx="{44 * s}" ry="{12 * s}" fill="#8d99a3"/>'
            f'<ellipse cx="{x}" cy="{base_y - 94 * s}" rx="{35 * s}" ry="{8 * s}" fill="{WATER}"/>'
        )
        return self.add(body + bands + inside + rim)

    def kettle(self, x: float, y: float, s: float = 1.0, flip: bool = False) -> "Canvas":
        """
        浇水壶（不是茶壶）：圆桶身 + 上方提手 + 斜出的壶嘴。
        x,y = 壶身**底面中心**。flip=True 时壶嘴朝左。
        """
        d = -1 if flip else 1
        spout_x = x + 34 * s * d
        return self.add(
            f'<g fill="#8d9aa5">'
            f'<rect x="{x - 18 * s}" y="{y - 30 * s}" width="{36 * s}" height="{30 * s}" rx="{7 * s}"/>'
            f'<path d="M{x + 14 * s * d} {y - 22 * s} L{spout_x} {y - 38 * s} '
            f'l{9 * s * d} {5 * s} L{x + 18 * s * d} {y - 12 * s} Z"/>'
            f'<path d="M{x - 12 * s} {y - 30 * s} q{12 * s} {-20 * s} {24 * s} 0" '
            f'stroke="#7d8a94" stroke-width="{4 * s}" fill="none"/>'
            f"</g>"
        )

    def watermelon(self, x: float, y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<g>'
            f'<ellipse cx="{x}" cy="{y}" rx="{34 * s}" ry="{26 * s}" fill="#4f9e4a"/>'
            f'<ellipse cx="{x}" cy="{y}" rx="{28 * s}" ry="{21 * s}" fill="#e8605c"/>'
            f'<g fill="#2b2b2b">'
            f'<ellipse cx="{x - 9 * s}" cy="{y - 5 * s}" rx="{3 * s}" ry="{4 * s}"/>'
            f'<ellipse cx="{x + 4 * s}" cy="{y + 6 * s}" rx="{3 * s}" ry="{4 * s}"/>'
            f'<ellipse cx="{x + 13 * s}" cy="{y - 6 * s}" rx="{2.6 * s}" ry="{3.6 * s}"/>'
            f"</g></g>"
        )

    def rind_boat(self, x: float, y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<path d="M{x - 46 * s} {y - 12 * s} q{46 * s} {40 * s} {92 * s} 0 Z" fill="#4f9e4a"/>'
            f'<path d="M{x - 40 * s} {y - 10 * s} q{40 * s} {30 * s} {80 * s} 0 Z" fill="#f2f6ea"/>'
        )

    def flag(self, x: float, base_y: float, top_y: float, s: float = 1.0) -> "Canvas":
        return self.add(
            f'<rect x="{x - 3 * s}" y="{top_y}" width="{6 * s}" height="{base_y - top_y}" rx="{3 * s}" fill="#c9ccd1"/>'
            f'<rect x="{x - 4 * s}" y="{base_y - 8 * s}" width="{30 * s}" height="{10 * s}" rx="{4 * s}" fill="#b9bcc1"/>'
            f'<rect x="{x + 3 * s}" y="{top_y + 8 * s}" width="{78 * s}" height="{52 * s}" fill="{RED}"/>'
            f'<g fill="{YELLOW}">'
            f'<polygon points="{x + 20 * s},{top_y + 20 * s} {x + 23 * s},{top_y + 27 * s} {x + 30 * s},{top_y + 28 * s} '
            f'{x + 25 * s},{top_y + 32 * s} {x + 27 * s},{top_y + 39 * s} {x + 20 * s},{top_y + 35 * s} '
            f'{x + 13 * s},{top_y + 39 * s} {x + 15 * s},{top_y + 32 * s} {x + 10 * s},{top_y + 28 * s} '
            f'{x + 17 * s},{top_y + 27 * s}"/>'
            f'<circle cx="{x + 36 * s}" cy="{top_y + 20 * s}" r="{2.6 * s}"/>'
            f'<circle cx="{x + 43 * s}" cy="{top_y + 26 * s}" r="{2.6 * s}"/>'
            f'<circle cx="{x + 43 * s}" cy="{top_y + 35 * s}" r="{2.6 * s}"/>'
            f'<circle cx="{x + 36 * s}" cy="{top_y + 41 * s}" r="{2.6 * s}"/>'
            f"</g>"
        )

    def window_grid(self, x: float, y: float, w: float, h: float, rows: int, cols: int, frame: str = "#f7f3ea") -> "Canvas":
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{frame}"/>')
        cw, ch = w / cols, h / rows
        for r in range(rows):
            for c in range(cols):
                self.add(
                    f'<rect x="{x + c * cw + cw * 0.15}" y="{y + r * ch + ch * 0.15}" '
                    f'width="{cw * 0.7}" height="{ch * 0.7}" fill="#bcd7e8"/>'
                )
        return self

    def panel(self, x: float, y: float, w: float, h: float, idx: int | None = None) -> "Canvas":
        """连环画分格：白底 + 圆角描边 + 左上角序号"""
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{BG}" stroke="#e2d9cc" stroke-width="3"/>'
        )
        if idx is not None:
            self.add(
                f'<circle cx="{x + 26}" cy="{y + 26}" r="15" fill="#2d6a4f"/>'
                f'<text x="{x + 26}" y="{y + 32}" font-family="sans-serif" font-size="18" font-weight="700" '
                f'fill="#ffffff" text-anchor="middle">{idx}</text>'
            )
        return self

    def clip_def(self, x: float, y: float, w: float, h: float) -> str:
        """登记一个圆角分格裁剪区，**返回 id**（必须用它拼 clip-path，别自己猜编号）"""
        gid = f"c{len(self.defs)}"
        self.defs.append(
            f'<clipPath id="{gid}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14"/></clipPath>'
        )
        return gid

    # ---------- 输出 ----------
    def render(self) -> str:
        defs = f"<defs>{''.join(self.defs)}</defs>" if self.defs else ""
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}">'
            f'<rect x="0" y="0" width="{self.w}" height="{self.h}" fill="{BG}"/>{defs}{"".join(self.parts)}</svg>'
        )


# ============================ 12 幅场景 ============================
def scene_01() -> Canvas:
    """蚂蚁搬粮食：秋林 · 两只蚂蚁抬大树叶 · 叶上站一只 · 树洞口堆粮食"""
    c = Canvas(1000, 640)
    c.sky(SKY_DAY[0], SKY_DAY[1])
    c.sun(880, 84, 46)
    c.cloud(250, 96, 58)
    c.cloud(620, 70, 42)
    c.hill(120, 388, 280, 96, "#a8d98b")
    c.hill(880, 396, 320, 110, "#9ed47f")
    c.ground(400, GRASS)

    # 树：左边两棵小秋树，右边一棵大树（树洞开在树干中段，别和树冠混在一起）
    c.autumn_tree(120, 424, 1.0, 0)
    c.autumn_tree(330, 412, 0.78, 1)
    c.tree(800, 440, 1.7, canopy="#d9663f", trunk=TRUNK_DARK)
    # 树洞
    c.add('<ellipse cx="800" cy="368" rx="19" ry="24" fill="#5b3a24"/>')
    c.add('<ellipse cx="800" cy="368" rx="13" ry="18" fill="#3f2715"/>')
    # 洞口粮食堆（小米粒 + 一株麦穗）
    for (dx, dy, r) in [(-46, 2, 5), (-30, 8, 5), (-14, 11, 5), (2, 12, 5), (18, 11, 5), (34, 7, 5),
                        (-38, -4, 4), (-6, 0, 4), (26, -3, 4)]:
        c.add(f'<circle cx="{800 + dx}" cy="{440 + dy - 6}" r="{r}" fill="#e8b13f"/>')
    c.add(f'<path d="M838 440 q10 -26 26 -36" stroke="#8a6b2f" stroke-width="3.4" fill="none" stroke-linecap="round"/>')
    c.add(f'<ellipse cx="866" cy="400" rx="9" ry="6" fill="#c99a3a" transform="rotate(-30 866 400)"/>')

    # 落叶
    for (x, y, col, rot) in [(180, 470, AUTUMN[0], -20), (250, 545, AUTUMN[1], 30),
                             (690, 500, AUTUMN[2], -10), (930, 560, AUTUMN[3], 45),
                             (520, 588, AUTUMN[0], 15), (600, 470, AUTUMN[1], -35)]:
        c.leaf(x, y, 1.5, col, rot)

    # 被抬着的大树叶（整体倾斜，两端正好落在两只蚂蚁肩上）
    c.add('<g transform="rotate(-10 420 470)">')
    c.add('<path d="M300 470 q120 -58 240 0 q-120 58 -240 0 Z" fill="#7ab648"/>')
    c.add('<path d="M312 470 h216" stroke="#5b8f34" stroke-width="3"/>')
    for i in range(7):
        x = 336 + i * 30
        c.add(f'<path d="M{x} 470 l{-9} {-15}" stroke="#5b8f34" stroke-width="2.4"/>')
        c.add(f'<path d="M{x} 470 l{-9} {15}" stroke="#5b8f34" stroke-width="2.4"/>')
    c.add("</g>")

    # 站在树叶上的小蚂蚁（站在叶面上，别叠到树干）
    c.ant(424, 444, 1.0, flip=True)
    # 抬树叶的两只蚂蚁：略低于叶端，看上去是托着走
    c.ant(292, 496, 1.55, flip=False)
    c.ant(556, 486, 1.55, flip=True)
    return c


def scene_02() -> Canvas:
    """草地上的傍晚：晚霞 · 两个孩子坐在花毯上 · 女孩指天边 · 大树"""
    c = Canvas(1000, 640)
    c.sky(SKY_DUSK[0], SKY_DUSK[1])
    c.sun(760, 200, 62, "#ff9e5c")
    c.cloud(220, 120, 66, "#ffc98f")
    c.cloud(560, 90, 48, "#ffd2a4")
    c.cloud(880, 110, 40, "#ffc98f")
    c.hill(120, 380, 320, 90, "#8fc47a")
    c.hill(860, 392, 300, 100, "#84bb70")
    c.ground(410, GRASS)
    c.tree(150, 430, 1.35, canopy="#4e9a52")

    # 花毯（斜放的圆角方块）
    c.add('<g transform="rotate(-8 520 520)">')
    c.add(f'<rect x="360" y="470" width="330" height="120" rx="16" fill="#f4e0c0" stroke="#d9b98d" stroke-width="4"/>')
    for (dx, dy, col) in [(30, 24, "#e0603c"), (90, 40, "#e8b13f"), (150, 22, "#f2a0c0"),
                          (210, 46, "#8ecae6"), (270, 26, "#e0603c"), (60, 78, "#f2a0c0"),
                          (180, 84, "#e8b13f"), (250, 82, "#8ecae6")]:
        c.flower(360 + dx, 470 + dy, 0.8, col)
    c.add("</g>")

    # 男孩（左，盘腿坐）+ 女孩（右，坐着指天边）
    c.person(450, 560, 165, cloth="#4a7ec0", cloth2="#3d6aa5", pose="sit",
             arm_l="down", arm_r="hold", style="boy", face="happy")
    c.person(600, 556, 160, cloth="#e8607a", pose="sit",
             arm_l="down", arm_r="point", style="girl", face="happy")
    return c


def scene_03() -> Canvas:
    """吹蒲公英：白天 · 房前草地 · 双辫女孩吹蒲公英 · 种子飘"""
    c = Canvas(1000, 640)
    c.sky(SKY_DAY[0], SKY_DAY[1])
    c.sun(150, 100, 44)
    c.cloud(520, 96, 56)
    c.cloud(820, 150, 40)
    c.ground(400, GRASS)

    # 房子
    c.add('<rect x="620" y="300" width="260" height="120" fill="#f7e7cf"/>')
    c.add('<polygon points="600,300 890,300 745,232" fill="#d9705a"/>')
    c.add('<rect x="690" y="344" width="60" height="76" rx="4" fill="#a5714a"/>')
    c.window_grid(770, 330, 60, 50, 1, 1, "#fbf5ea")
    c.add('<rect x="770" y="330" width="60" height="50" fill="#bcd7e8"/>')

    # 草地小花
    for (x, y, col) in [(120, 470, "#f2a0c0"), (200, 520, "#e8b13f"), (860, 500, "#f2a0c0"),
                        (930, 560, "#8ecae6"), (80, 590, "#e8b13f")]:
        c.flower(x, y, 1.0, col)
    for x in (60, 260, 900, 960):
        c.grass_tuft(x, 620, 1.4)

    # 女孩（双辫）
    c.person(400, 560, 210, cloth="#f2a0c0", style="girl", arm_l="down", arm_r="down", face="happy")
    # 手动画一条「把蒲公英举到嘴边」的手臂：默认 up 的手在头顶侧，凑不到嘴
    c.add(f'<path d="M416 418 L438 386" stroke="{SKIN}" stroke-width="13" stroke-linecap="round" fill="none"/>')
    c.add(f'<circle cx="438" cy="384" r="7" fill="{SKIN}"/>')
    # 蒲公英：茎从手伸到绒球，绒球正好在嘴边
    c.add('<path d="M438 380 l4 -26" stroke="#5b8f34" stroke-width="4" stroke-linecap="round"/>')
    c.add('<circle cx="444" cy="346" r="12" fill="#ffffff" stroke="#e6e2d8" stroke-width="2"/>')
    for a in range(10):
        ang = a * math.pi / 5
        c.add(
            f'<circle cx="{444 + 15 * math.cos(ang)}" cy="{346 + 15 * math.sin(ang)}" r="3" fill="#ffffff"/>'
        )
    # 被吹散的种子（从嘴边往右上飘）
    for (x, y, s) in [(486, 300, 1.0), (546, 262, 0.88), (612, 226, 0.76), (682, 196, 0.64),
                      (748, 168, 0.54), (806, 146, 0.46)]:
        c.add(f'<g opacity="0.92"><circle cx="{x}" cy="{y}" r="{5 * s}" fill="#ffffff"/>'
              f'<path d="M{x} {y + 5 * s} l0 {11 * s}" stroke="#cfcabf" stroke-width="{1.6 * s}"/></g>')
    return c


def scene_04() -> Canvas:
    """升国旗：早晨 · 学校操场 · 红色教学楼 · 旗杆 · 国旗升起 · 学生敬礼"""
    c = Canvas(1000, 640)
    c.sky(SKY_DAY[0], "#cfeaf6")
    c.sun(110, 96, 42)
    c.cloud(420, 80, 48)
    c.cloud(760, 130, 36)
    c.ground(440, "#9ed47f")

    # 教学楼（红色）
    c.add('<rect x="560" y="210" width="400" height="240" fill="#c0554a"/>')
    c.add('<polygon points="548,210 972,210 960,186 560,186" fill="#a8443a"/>')
    c.window_grid(596, 240, 330, 170, 3, 5)
    c.add('<rect x="560" y="438" width="400" height="14" fill="#a8443a"/>')

    # 操场跑道
    c.add(f'<rect x="0" y="452" width="1000" height="20" fill="#e8b07a"/>')

    # 旗杆与国旗
    c.flag(250, 520, 130, 1.25)

    # 三个学生敬礼（戴红领巾）
    for i, (x, cloth) in enumerate([(430, "#4a7ec0"), (520, "#5aa85e"), (610, "#e8b13f")]):
        c.person(x, 560 + (0 if i == 1 else -4), 150, cloth=cloth, style="boy",
                 arm_r="salute", scarf=True, face="happy")
    # 女孩一个
    c.person(700, 556, 148, cloth="#e8607a", style="girl", arm_r="salute", scarf=True, face="happy")
    return c


def scene_05() -> Canvas:
    """树林里的发现：秋林 · 男孩指树上鸟窝 · 大人一起抬头"""
    c = Canvas(1000, 640)
    c.sky("#e8f2ea", "#cfe4d4")
    c.hill(160, 400, 300, 100, "#a8d98b")
    c.hill(880, 400, 320, 96, "#9ed47f")
    c.ground(440, GRASS)

    # 大树：树干偏左，向右伸出一根横枝，枝上放鸟窝（窝必须在枝上，不然像个棕色补丁）
    c.tree(560, 450, 1.9, canopy="#d9663f", trunk=TRUNK_DARK)
    c.add('<path d="M572 320 q90 -26 180 -34" stroke="' + TRUNK_DARK + '" stroke-width="13" '
          'stroke-linecap="round" fill="none"/>')
    # 鸟窝
    c.add('<path d="M680 288 q42 -30 84 2 q-42 26 -84 -2 Z" fill="#8a6b3f"/>')
    c.add('<path d="M686 292 q38 16 74 0" stroke="#6d5232" stroke-width="4" fill="none"/>')
    # 窝里的两只小鸟（张嘴要吃的）
    c.add('<g fill="#5a4a3a">'
          '<ellipse cx="706" cy="278" rx="13" ry="11"/><ellipse cx="738" cy="276" rx="12" ry="10"/></g>')
    c.add('<polygon points="700,270 692,258 706,266" fill="#e8b13f"/>'
          '<polygon points="744,268 752,256 746,266" fill="#e8b13f"/>')

    # 树枝上的红果
    for (x, y) in [(770, 330), (800, 366), (742, 372)]:
        c.add(f'<circle cx="{x}" cy="{y}" r="7" fill="{RED}"/>')

    c.autumn_tree(150, 456, 1.15, 2)
    c.autumn_tree(900, 466, 0.95, 1)

    # 落叶（避开人物脚边）
    for (x, y, col, rot) in [(90, 560, AUTUMN[0], 20), (250, 610, AUTUMN[1], -25),
                             (860, 590, AUTUMN[2], 40)]:
        c.leaf(x, y, 1.5, col, rot)

    # 大人（左，抬头看）+ 男孩（右，抬手指鸟窝）
    c.person(300, 580, 215, cloth="#5aa85e", style="girl", arm_l="down", arm_r="down", face="happy")
    c.person(420, 572, 168, cloth="#4a7ec0", style="boy", arm_r="point", scarf=True, face="happy")
    # 视线引导：从男孩的手指向鸟窝
    c.add('<path d="M452 424 q60 -60 210 -128" stroke="#9a9a9a" stroke-width="2.4" '
          'stroke-dasharray="8 8" fill="none" opacity="0.75"/>')
    return c


def scene_06() -> Canvas:
    """大雁南飞：傍晚 · 橘红天空 · 人字队形 · 绿色田野"""
    c = Canvas(1000, 640)
    c.sky(SKY_DUSK[0], SKY_DUSK[1])
    c.sun(820, 150, 58, "#ff9a56")
    c.cloud(180, 110, 62, "#ffc98f")
    c.cloud(520, 86, 44, "#ffd2a4")

    # 田野：横向色带
    c.add('<rect x="0" y="430" width="1000" height="70" fill="#9ed47f"/>')
    c.add('<rect x="0" y="500" width="1000" height="70" fill="#86c66a"/>')
    c.add('<rect x="0" y="570" width="1000" height="70" fill="#b7dd9a"/>')
    for y in (452, 522, 592):
        for x in range(0, 1000, 46):
            c.add(f'<path d="M{x} {y} l10 -14" stroke="#6fb457" stroke-width="2.6" opacity="0.7"/>')

    # 人字队形大雁
    c.goose(500, 210, 1.5)
    for i, (dx, dy) in enumerate([(-70, 40), (-140, 80), (-210, 120)]):
        c.goose(500 + dx, 210 + dy, 1.3)
        c.goose(500 - dx, 210 + dy, 1.3)
    return c


def scene_07() -> Canvas:
    """足球掉进水缸：四格连环画"""
    c = Canvas(1200, 700)
    ids = []
    for i, (x, y) in enumerate([(10, 10), (610, 10), (10, 360), (610, 360)]):
        ids.append(c.clip_def(x, y, 580, 330))
        c.panel(x, y, 580, 330, i + 1)

    # ---------- ① 三个小动物在缸边踢球 ----------
    c.add(f'<g clip-path="url(#{ids[0]})">')
    c.sky(SKY_DAY[0], "#d8eff8")
    c.ground(270, GRASS)
    c.vat(500, 280, 1.0)
    c.rabbit(140, 280, 1.25)
    c.chick(272, 280, 1.15)
    c.squirrel(370, 280, 1.15)
    c.football(196, 256, 14)
    c.add("</g>")

    # ---------- ② 球滚进缸里，小兔探头往里看 ----------
    c.add(f'<g clip-path="url(#{ids[1]})">')
    c.sky(SKY_DAY[0], "#d8eff8")
    c.ground(270, GRASS)
    c.vat(860, 300, 1.15)
    # 球：画在缸口**里面**（裁剪到缸口椭圆），这样看到的是"从缸口望进去的球"，
    # 而不是一个浮在缸口上的白色圆点
    c.defs.append('<clipPath id="vm1"><ellipse cx="860" cy="190.6" rx="40" ry="9"/></clipPath>')
    c.add('<g clip-path="url(#vm1)">'
          '<circle cx="860" cy="186" r="17" fill="#ffffff" stroke="#3b3b3b" stroke-width="3"/>'
          '<polygon points="860,175 874,181 868,193 852,193 846,181" fill="#3b3b3b"/></g>')
    c.rabbit(1040, 280, 1.15)
    c.add('<path d="M1006 250 q-40 -34 -80 -40" stroke="#9a9a9a" stroke-width="2.4" '
          'stroke-dasharray="7 7" fill="none" opacity="0.75"/>')
    c.add("</g>")

    # ---------- ③ 小兔提水壶往缸里倒水 ----------
    c.add(f'<g clip-path="url(#{ids[2]})">')
    c.sky(SKY_DAY[0], "#d8eff8")
    c.ground(598, GRASS)
    c.vat(470, 640, 1.05)
    c.rabbit(250, 618, 1.3)
    # 兔子"手"：前肢搭到水壶提手上
    c.add('<path d="M272 606 L322 598" stroke="#e6e1d8" stroke-width="9" stroke-linecap="round" fill="none"/>')
    # 壶嘴朝右（朝水缸那侧），否则水会从反方向流出来
    c.kettle(346, 616, 1.2)
    # 水流：从壶嘴落进缸口
    c.add('<path d="M387 570 q34 4 62 -22" stroke="#7fc4e0" stroke-width="9" '
          'stroke-linecap="round" fill="none" opacity="0.85"/>')
    c.add("</g>")

    # ---------- ④ 球浮上来，大家跳起来 ----------
    c.add(f'<g clip-path="url(#{ids[3]})">')
    c.sky(SKY_DAY[0], "#d8eff8")
    c.ground(598, GRASS)
    c.vat(900, 640, 1.05)
    c.defs.append('<clipPath id="vm2"><ellipse cx="900" cy="539.2" rx="37" ry="8.4"/></clipPath>')
    c.add('<g clip-path="url(#vm2)">'
          '<circle cx="900" cy="532" r="18" fill="#ffffff" stroke="#3b3b3b" stroke-width="3"/>'
          '<polygon points="900,520 915,526 909,539 891,539 885,526" fill="#3b3b3b"/></g>')
    c.rabbit(700, 612, 1.25)
    c.chick(800, 604, 1.05)
    c.squirrel(1080, 604, 1.05)
    # 跳跃弧线
    for (bx, by) in [(690, 548), (790, 542), (1092, 542)]:
        c.add(f'<path d="M{bx} {by} l-10 -22 m10 22 l2 -24 m-2 24 l12 -20" stroke="#e8b13f" '
              f'stroke-width="4" stroke-linecap="round" fill="none"/>')
    c.add("</g>")
    return c


def scene_08() -> Canvas:
    """老鼠搬西瓜：三格连环画"""
    c = Canvas(1500, 520)
    ids = []
    for i, x in enumerate([10, 510, 1010]):
        ids.append(c.clip_def(x, 10, 480, 500))
        c.panel(x, 10, 480, 500, i + 1)

    # ---------- ① 两只老鼠抬西瓜 ----------
    c.add(f'<g clip-path="url(#{ids[0]})">')
    c.add('<rect x="10" y="10" width="480" height="500" fill="#eaf4fb"/>')
    c.ground(400, GRASS)
    c.watermelon(250, 300, 1.5)
    c.mouse(140, 410, 1.5)
    c.mouse(360, 410, 1.5)
    # 前爪托住西瓜（不然西瓜像浮在空中）
    c.add('<path d="M150 380 L206 332" stroke="#9a9aa5" stroke-width="7" stroke-linecap="round" fill="none"/>')
    c.add('<path d="M350 380 L294 332" stroke="#9a9aa5" stroke-width="7" stroke-linecap="round" fill="none"/>')
    c.add('<path d="M180 430 q40 -10 80 -2" stroke="#6fb457" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.6"/>')
    c.add("</g>")

    # ---------- ② 一家围桌吃西瓜 ----------
    c.add(f'<g clip-path="url(#{ids[1]})">')
    c.add('<rect x="510" y="10" width="480" height="500" fill="#fdf0e4"/>')
    c.ground(430, "#e8cba6")
    # 桌子
    c.add('<rect x="600" y="330" width="300" height="18" rx="6" fill="#c98a4b"/>')
    c.add('<rect x="626" y="348" width="16" height="82" fill="#b0763c"/>')
    c.add('<rect x="860" y="348" width="16" height="82" fill="#b0763c"/>')
    c.watermelon(750, 306, 1.2)
    # 两片切好的西瓜
    for (x, y) in [(646, 322), (856, 322)]:
        c.add(f'<path d="M{x - 22} {y} a22 22 0 0 1 44 0 Z" fill="#e8605c"/>')
        c.add(f'<path d="M{x - 22} {y} a22 22 0 0 1 44 0" stroke="#4f9e4a" stroke-width="5" fill="none"/>')
    c.mouse(580, 432, 1.25)
    c.mouse(922, 432, 1.25)
    c.mouse(660, 448, 1.15)
    c.mouse(845, 448, 1.15)
    c.add("</g>")

    # ---------- ③ 西瓜皮小船 ----------
    c.add(f'<g clip-path="url(#{ids[2]})">')
    c.add('<rect x="1010" y="10" width="480" height="500" fill="#eaf4fb"/>')
    c.add('<rect x="1010" y="330" width="480" height="180" fill="#8ecae6"/>')
    for y in (360, 400, 440):
        c.add(f'<path d="M1030 {y} q40 -12 80 0 t80 0 t80 0 t80 0" stroke="#6fb3d2" stroke-width="4" fill="none" opacity="0.7"/>')
    c.rind_boat(1240, 360, 1.9)
    c.mouse(1240, 330, 1.2)
    # 船桨握在手里
    c.add('<path d="M1264 314 L1330 268" stroke="#a5714a" stroke-width="7" stroke-linecap="round"/>')
    c.add('<ellipse cx="1336" cy="262" rx="12" ry="20" fill="#c98a4b" transform="rotate(-34 1336 262)"/>')
    c.add("</g>")
    return c


def scene_09() -> Canvas:
    """灯下缝衣：夜晚 · 油灯 · 蓝裙古人缝衣 · 床上被褥"""
    c = Canvas(1000, 640)
    # 屋子：上墙下地，别用"地平线"画室内（第一版就是拿草地逻辑套的，人像站在室外黑地里）
    c.add('<rect x="0" y="0" width="1000" height="640" fill="#3a3129"/>')
    c.add('<rect x="0" y="470" width="1000" height="170" fill="#2c241c"/>')
    c.add('<rect x="0" y="462" width="1000" height="14" fill="#241d16"/>')
    for x in range(0, 1000, 120):
        c.add(f'<path d="M{x} 476 l0 164" stroke="#241d16" stroke-width="3" opacity="0.7"/>')

    # 窗户（夜色 + 月亮）
    c.add('<rect x="742" y="96" width="170" height="150" rx="8" fill="#1b2436" stroke="#6b5a44" stroke-width="10"/>')
    c.add('<circle cx="828" cy="150" r="24" fill="#f5e6b8"/>')
    for (x, y) in [(770, 118), (866, 126), (886, 196), (790, 200)]:
        c.add(f'<circle cx="{x}" cy="{y}" r="2.6" fill="#f5e6b8" opacity="0.9"/>')
    c.add('<path d="M827 96 l0 150 M742 171 l170 0" stroke="#6b5a44" stroke-width="7"/>')

    # 油灯光晕（径向渐变，别用大圆硬填）
    c.defs.append('<radialGradient id="lampglow"><stop offset="0" stop-color="#ffd35c" stop-opacity="0.55"/>'
                  '<stop offset="1" stop-color="#ffd35c" stop-opacity="0"/></radialGradient>')
    c.add('<circle cx="352" cy="404" r="210" fill="url(#lampglow)"/>')

    # 小桌 + 油灯
    c.add('<rect x="300" y="436" width="110" height="12" rx="4" fill="#7a5a38"/>')
    c.add('<rect x="316" y="448" width="10" height="96" fill="#63472c"/>')
    c.add('<rect x="384" y="448" width="10" height="96" fill="#63472c"/>')
    c.add('<ellipse cx="352" cy="436" rx="26" ry="8" fill="#8a6b45"/>')
    c.add('<path d="M338 436 q14 -16 28 0 Z" fill="#c9a06a"/>')
    c.add('<ellipse cx="352" cy="428" rx="9" ry="4" fill="#f5e6b8"/>')
    c.add('<path d="M352 424 q11 -16 0 -30 q-11 14 0 30 Z" fill="#ffd35c"/>')

    # 床：床板 + 床腿 + 被褥 + 枕头
    c.add('<rect x="612" y="372" width="360" height="20" rx="6" fill="#8a6b45"/>')
    c.add('<rect x="624" y="392" width="16" height="86" fill="#6d5232"/>')
    c.add('<rect x="944" y="392" width="16" height="86" fill="#6d5232"/>')
    c.add('<rect x="626" y="278" width="26" height="112" rx="8" fill="#7a5a38"/>')  # 床头板
    # 被褥
    c.add('<rect x="640" y="300" width="200" height="76" rx="14" fill="#e8e0cf"/>')
    c.add('<rect x="640" y="336" width="200" height="40" rx="12" fill="#c0554a"/>')
    c.add('<path d="M648 348 q40 14 80 0 t80 0" stroke="#a8443a" stroke-width="3" fill="none"/>')
    # 枕头
    c.add('<rect x="856" y="316" width="96" height="58" rx="16" fill="#f2ebdb"/>')

    # 古人（蓝裙，坐在床前的凳子上缝衣）
    c.person(520, 578, 205, cloth="#3f6fa8", cloth2="#2f5a8c", style="girl", pose="sit",
             hair="#2b2b33", arm_l="hold", arm_r="hold", face="sad")
    # 凳子
    c.add('<rect x="486" y="552" width="70" height="12" rx="4" fill="#7a5a38"/>')
    c.add('<rect x="492" y="564" width="9" height="56" fill="#63472c"/>')
    c.add('<rect x="540" y="564" width="9" height="56" fill="#63472c"/>')
    # 膝上的衣服 + 针线
    c.add('<path d="M502 500 q22 -8 44 2 l0 22 q-22 8 -44 -2 Z" fill="#dfe7ee"/>')
    c.add('<path d="M506 508 q18 -6 36 2" stroke="#b9c6d2" stroke-width="2" stroke-dasharray="5 4" fill="none"/>')
    c.add('<path d="M556 486 l14 -8" stroke="#cfd6dd" stroke-width="3.4" stroke-linecap="round"/>')
    c.add('<path d="M570 478 q14 22 2 40" stroke="#e8e2d0" stroke-width="2" fill="none"/>')
    return c


def scene_10() -> Canvas:
    """走在小路上：春天 · 山间小路 · 妈妈牵女儿 · 红帽子 · 书包 · 蝴蝶小鸟"""
    c = Canvas(1000, 640)
    c.sky(SKY_DAY[0], SKY_DAY[1])
    c.sun(880, 100, 44)
    c.cloud(240, 92, 52)
    c.cloud(600, 130, 38)
    c.hill(150, 380, 320, 120, "#a8d98b")
    c.hill(850, 380, 340, 130, "#9ed47f")
    c.ground(400, GRASS)

    # 小路（梯形）
    c.add('<path d="M420 640 L600 640 L540 400 L480 400 Z" fill="#e8d3ac"/>')
    for (x, y, r) in [(500, 470, 4), (530, 540, 5), (470, 600, 5)]:
        c.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#cbb187"/>')

    c.tree(120, 440, 1.3, canopy="#4e9a52")
    c.tree(880, 450, 1.2, canopy="#5aa85e")
    for x in (200, 320, 700, 820):
        c.grass_tuft(x, 620, 1.5)

    # 妈妈（左，戴红帽背包）牵女儿（右）
    c.person(420, 580, 235, cloth="#7a9ac0", style="girl", hat=RED, backpack="#e8b13f",
             arm_l="down", arm_r="hold", face="happy")
    c.person(520, 566, 160, cloth="#f2a0c0", style="girl", hat=RED, backpack="#8ecae6",
             arm_l="hold", arm_r="down", face="happy")
    # 牵着的手（两只手分别在 (466,458) 与 (489,483)，中间补一段手腕，不然看着像各走各的）
    c.add(f'<path d="M466 458 L489 483" stroke="{SKIN}" stroke-width="12" stroke-linecap="round" fill="none"/>')
    c.add(f'<circle cx="478" cy="470" r="7.5" fill="{SKIN}"/>')

    c.butterfly(700, 300, 1.4, "#f2a0c0")
    c.butterfly(790, 236, 1.1, "#e8b13f")
    c.bird(240, 190, 1.3, "#5a5a5a")
    c.bird(300, 160, 1.0, "#5a5a5a")
    return c


def scene_11() -> Canvas:
    """桥上的白鹤：傍晚 · 夕阳红天 · 石拱桥 · 白鹤 · 河面荷叶"""
    c = Canvas(1000, 640)
    c.sky("#ffb98a", "#ff7f5f")
    c.sun(210, 210, 66, "#ff6f4a")
    c.cloud(620, 110, 58, "#ffcdb0")
    c.cloud(880, 160, 40, "#ffcdb0")

    # 远山
    c.hill(760, 330, 320, 90, "#c98a7a")
    c.hill(980, 340, 240, 80, "#b87a6c")

    # 河
    c.add('<rect x="0" y="400" width="1000" height="240" fill="#7fb8d6"/>')
    c.add('<rect x="0" y="400" width="1000" height="26" fill="#9ccde4"/>')
    for y in (450, 500, 560, 610):
        c.add(f'<path d="M40 {y} q50 -12 100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0" '
              f'stroke="#a8d6ea" stroke-width="4" fill="none" opacity="0.65"/>')
    # 夕阳倒影
    c.add('<ellipse cx="210" cy="470" rx="70" ry="16" fill="#ff9a6a" opacity="0.55"/>')

    # 石拱桥（横跨，桥墩在水里）
    c.add('<path d="M180 400 q320 -180 640 0 l0 26 q-320 -160 -640 0 Z" fill="#c9c3b6"/>')
    c.add('<path d="M180 400 q320 -180 640 0" stroke="#a8a294" stroke-width="6" fill="none"/>')
    c.add('<rect x="150" y="380" width="36" height="120" fill="#c9c3b6"/>')
    c.add('<rect x="814" y="380" width="36" height="120" fill="#c9c3b6"/>')

    # 桥栏立柱：必须落在拱线上（第一版是等距硬编码，越靠中间越悬空）
    def arch(t: float) -> tuple[float, float]:
        x = 180 * (1 - t) ** 2 + 2 * t * (1 - t) * 500 + 820 * t ** 2
        y = 400 * (1 - t) ** 2 + 2 * t * (1 - t) * 220 + 400 * t ** 2
        return x, y

    for i in range(9):
        px, py = arch(0.06 + i * 0.11)
        c.add(f'<rect x="{px - 4:.1f}" y="{py - 42:.1f}" width="8" height="42" rx="3" fill="#b5afa2"/>')
    c.add('<path d="M180 400 q320 -180 640 0" stroke="#b5afa2" stroke-width="7" fill="none" '
          'transform="translate(0 -42)"/>')

    # 白鹤站在桥面上（foot_y 必须等于该处的拱线高度）
    cx, cy = arch(0.66)
    c.crane(cx, cy + 4, 1.5)

    # 荷叶
    for (x, y, r) in [(140, 560, 44), (250, 596, 36), (880, 540, 40), (930, 610, 32)]:
        c.add(f'<ellipse cx="{x}" cy="{y}" rx="{r}" ry="{r * 0.42}" fill="#5aa85e"/>')
        c.add(f'<path d="M{x} {y} l{r * 0.7} {-r * 0.1}" stroke="#479450" stroke-width="3"/>')
    return c


def scene_12() -> Canvas:
    """捅马蜂窝：四格连环画"""
    c = Canvas(1200, 700)
    ids = []
    for i, (x, y) in enumerate([(10, 10), (610, 10), (10, 360), (610, 360)]):
        ids.append(c.clip_def(x, y, 580, 330))
        c.panel(x, y, 580, 330, i + 1)

    # ---------- ① 树下有马蜂窝，男孩拿着石头抬头看 ----------
    c.add(f'<g clip-path="url(#{ids[0]})">')
    c.add('<rect x="10" y="10" width="580" height="330" fill="#e8f2ea"/>')
    c.ground(268, GRASS)
    c.tree(430, 268, 1.25, canopy="#4e9a52")
    # 横枝 + 挂在枝下的马蜂窝（蜂窝要有层次，纯椭圆会被看成石头）
    c.add('<path d="M418 196 q-46 -14 -78 -8" stroke="' + TRUNK_DARK + '" stroke-width="9" '
          'stroke-linecap="round" fill="none"/>')
    c.add('<path d="M352 190 q-4 46 16 62 q20 -16 16 -62 Z" fill="#c9a06a"/>')
    for y in (206, 222, 238):
        c.add(f'<path d="M{350} {y} q18 8 36 0" stroke="#a8823f" stroke-width="3" fill="none"/>')
    c.add('<ellipse cx="368" cy="256" rx="9" ry="5" fill="#8a6b3f"/>')
    c.wasp(392, 246, 1.0)
    c.wasp(404, 214, 0.9)
    # 男孩：把石头举过头顶（raise 的手在头顶以上，石头才压得住手）
    c.person(200, 264, 155, cloth="#4a7ec0", style="boy", arm_r="raise", face="happy")
    c.add('<circle cx="221" cy="72" r="12" fill="#9aa5ad"/>')
    c.add('<path d="M236 76 q62 44 116 96" stroke="#9a9a9a" stroke-width="2.2" '
          'stroke-dasharray="7 7" fill="none" opacity="0.7"/>')
    c.add("</g>")

    # ---------- ② 马蜂追，男孩边跑边躲 ----------
    c.add(f'<g clip-path="url(#{ids[1]})">')
    c.add('<rect x="610" y="10" width="580" height="330" fill="#e8f2ea"/>')
    c.ground(268, GRASS)
    c.person(760, 268, 155, cloth="#4a7ec0", style="boy", pose="run", arm_l="up", arm_r="up", face="sad")
    for (x, y, s) in [(660, 150, 1.1), (700, 190, 1.0), (640, 210, 0.95), (720, 130, 0.85)]:
        c.wasp(x, y, s)
    # 逃跑方向的速度线
    c.add('<path d="M810 210 q40 -6 70 -2 M812 236 q44 -4 74 2" stroke="#c9cfd4" '
          'stroke-width="3" stroke-linecap="round" fill="none"/>')
    c.add("</g>")

    # ---------- ③ 躲到树后，狗在旁边叫 ----------
    c.add(f'<g clip-path="url(#{ids[2]})">')
    c.add('<rect x="10" y="360" width="580" height="330" fill="#e8f2ea"/>')
    c.ground(622, GRASS)
    # 先画人、再画树 → 树干把他挡掉一半（"躲在树后"的关键顺序）；
    # 人要比树冠矮一截，否则整颗脑袋被树冠吃掉，看起来像只有下半身
    c.person(292, 638, 132, cloth="#4a7ec0", style="boy", arm_l="up", face="sad")
    c.tree(268, 640, 1.45, canopy="#4e9a52")
    c.dog(470, 640, 1.25)
    c.add('<path d="M512 566 q18 -16 6 -34" stroke="#8a8a8a" stroke-width="3" fill="none"/>')
    c.add('<text x="528" y="556" font-family="sans-serif" font-size="24" font-weight="700" fill="#8a5a38">汪</text>')
    c.add('<text x="536" y="600" font-family="sans-serif" font-size="20" font-weight="700" fill="#8a5a38">汪</text>')
    c.add("</g>")

    # ---------- ④ 摔倒在地，捂被蜇的脸 ----------
    c.add(f'<g clip-path="url(#{ids[3]})">')
    c.add('<rect x="610" y="360" width="580" height="330" fill="#e8f2ea"/>')
    c.ground(622, GRASS)
    c.fallen(830, 616, 150, cloth="#4a7ec0")
    for (x, y) in [(1010, 520), (1050, 552), (980, 566)]:
        c.wasp(x, y, 0.95)
    c.add("</g>")
    return c


SCENES = {
    "kt2-01": (scene_01, "秋天树林里，两只蚂蚁抬着一片大树叶往前走，树叶上站着一只小蚂蚁，树洞口堆着过冬的粮食"),
    "kt2-02": (scene_02, "傍晚，草地上铺着花毯子，一男一女两个孩子坐着，女孩抬手指着晚霞，旁边有一棵大树"),
    "kt2-03": (scene_03, "晴朗的白天，房前草地上，扎着两条辫子的小女孩举着蒲公英吹，白色种子飘向天空"),
    "kt2-04": (scene_04, "早晨的学校操场，红色教学楼前，五星红旗正在升起，四个戴红领巾的小学生举手敬礼"),
    "kt2-05": (scene_05, "秋天的树林里，戴红领巾的小男孩抬手指着树上的鸟窝，身边的大人一起抬头看"),
    "kt2-06": (scene_06, "傍晚橘红色的天空中，一群大雁排成人字形飞过，下面是一望无际的绿色田野"),
    "kt2-07": (scene_07, "四幅连环画：三个小动物在缸边踢球、球滚进缸里、小兔提壶往缸里倒水、球浮上来大家跳起来"),
    "kt2-08": (scene_08, "三幅连环画：两只老鼠抬西瓜、老鼠一家围桌吃西瓜、西瓜皮当小船"),
    "kt2-09": (scene_09, "夜晚屋里点着油灯，穿蓝裙的古人坐在床边低头缝补衣服，床上放着叠好的被褥"),
    "kt2-10": (scene_10, "春天的山间小路上，戴红帽子的妈妈牵着背书包的女儿往前走，路边有绿树和蝴蝶小鸟"),
    "kt2-11": (scene_11, "傍晚夕阳把天染红，公园石拱桥横跨小河，桥边站着一只又高又大的白鹤，河面浮着荷叶"),
    "kt2-12": (scene_12, "四幅连环画：男孩拿石头抬头看树上的马蜂窝、马蜂追着男孩跑、男孩躲到大树后狗在旁边叫、男孩摔倒在地捂着被蜇的脸"),
}


def write_svgs() -> int:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for eid, (fn, _alt) in SCENES.items():
        svg = fn().render()
        # 生成期自检：sanitizeSvg 会剥掉的东西一律不许出现
        for bad in ("foreignObject", "<script", " onerror=", " onclick="):
            if bad in svg:
                raise SystemExit(f"{eid}: 含被清洗的内容 {bad}")
        (ASSET_DIR / f"{eid}.svg").write_text(svg, encoding="utf-8")
        n += 1
    return n


def patch_package() -> int:
    data = json.loads(PKG_FILE.read_text(encoding="utf-8"))
    exs = data["units"][0]["topics"][0]["exercises"]
    patched = 0
    for ex in exs:
        eid = ex["id"]
        if eid not in SCENES:
            continue
        _fn, alt = SCENES[eid]
        ex["image"] = f"assets/{eid}.svg"
        ex["imageAlt"] = alt
        patched += 1
    PKG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return patched


if __name__ == "__main__":
    total = write_svgs()
    print(f"已生成 {total} 张 SVG → {ASSET_DIR}")
    if "--patch" in sys.argv:
        print(f"已给 {patch_package()} 道题写入 image / imageAlt")
