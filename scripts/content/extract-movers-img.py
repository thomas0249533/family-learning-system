"""
extract-movers-img.py —— 从 Cambridge Movers 素材里抠出「看图题」用的两张插图
================================================================================
生成包要用的图只有两张，各自需要不同的手法：

1. **U1 沙滩图**：整张插图就是 PDF 里的一枚 JPEG（xref 26，968×1105）。
   直接 `extract_image` 拿原始字节，零重采样、最清晰。

2. **模拟卷 Part 6 海盗图**：这一页 `get_images()` 返回 0 —— 插图是**矢量绘制**的
   （778 条 drawing 指令）。只能按页渲染再裁剪。裁剪矩形不是猜的：
   先读文本块拿到「Look and read and write.」的底边（y1）和「Examples」的顶边（y0），
   两条之间的区域就是插图；左右边界用 72dpi 渲染后扫描非白像素求得。
   实测 (42, 148) → (553, 678)。

两处都需要一个前置事实：内层 zip 里 **测试卷与答案卷是两个 PDF**，
带 `_answers` 的那个不含图，取的时候要排除，否则会拿到答案页的空白区域。

用法：`python scripts/content/extract-movers-img.py`
输出：`.tmp-l3/img/u1_p1_26.jpeg`、`.tmp-l3/img/mock_p6_scene.png`
（`.tmp-l3/` 是临时目录，生成完可以删；`assets/` 下的副本才是包的一部分）
"""
import io
import os
import sys
import zipfile

import pymupdf

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

RES = r"D:\study\content\资料"
OUT = r"D:\study\.tmp-l3\img"


def open_inner(outer_zip: str, inner_name: str) -> zipfile.ZipFile:
    """外层 zip 里套着内层 zip，内层 zip 里才是 PDF。返回内层 ZipFile。"""
    with zipfile.ZipFile(os.path.join(RES, outer_zip)) as z:
        return zipfile.ZipFile(io.BytesIO(z.read(inner_name)))


def test_pdf(inner: zipfile.ZipFile) -> pymupdf.Document:
    """取测试卷 PDF（排除 *_answers.pdf，那一份没有插图）"""
    names = [
        n for n in inner.namelist()
        if n.lower().endswith(".pdf") and "answer" not in n.lower()
    ]
    if len(names) != 1:
        raise SystemExit(f"期望恰好 1 份测试卷，实际 {names}")
    return pymupdf.open(stream=inner.read(names[0]), filetype="pdf")


def extract_unit1() -> None:
    doc = test_pdf(open_inner("L3单元测试.zip", "PU3-CEP-U1.zip"))
    page = doc[0]
    imgs = page.get_images(full=True)
    if not imgs:
        raise SystemExit("U1 第 1 页没有内嵌位图，排版可能变了")
    xref = imgs[0][0]
    info = doc.extract_image(xref)
    path = os.path.join(OUT, f"u1_p1_{xref}.{info['ext']}")
    with open(path, "wb") as f:
        f.write(info["image"])
    print(f"  沙滩图 {info['width']}×{info['height']} → {path}")


def crop_pirate() -> None:
    doc = test_pdf(open_inner("L3单元测试2.zip", "PU3-CEP-A1MO.zip"))
    page = doc[29]  # 第 30 页 = Part 6 Look and read and write
    blocks = page.get_text("blocks")
    instr = [b for b in blocks if "Look and read and write" in b[4]]
    examples = [b for b in blocks if b[4].strip().startswith("Examples")]
    if not instr or not examples:
        raise SystemExit("Part 6 页面的文本块位置变了，裁剪范围需要重新测量")

    top = instr[0][3] + 6          # 指令行底边往下留 6pt
    bottom = examples[0][1] - 4    # Examples 顶边往上留 4pt

    # 左右边界：72dpi 渲染（1px = 1pt），扫描该横带内的非白像素
    pix = page.get_pixmap(dpi=72)
    n, stride, samples = pix.n, pix.stride, pix.samples
    left, right = 10 ** 9, -1
    for y in range(int(top), int(bottom)):
        row = y * stride
        for x in range(pix.width):
            i = row + x * n
            if abs(samples[i] - 255) > 8 or abs(samples[i + 1] - 255) > 8 or abs(samples[i + 2] - 255) > 8:
                left = min(left, x)
                right = max(right, x)
    if right <= 0:
        raise SystemExit("扫描不到插图区域")

    clip = pymupdf.Rect(left, top, right + 1, bottom)
    out = page.get_pixmap(dpi=170, clip=clip)
    path = os.path.join(OUT, "mock_p6_scene.png")
    out.save(path)
    print(f"  海盗图 clip={[round(v) for v in clip]} → {out.width}×{out.height} {path}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("抠图：")
    extract_unit1()
    crop_pirate()
    print("完成")
