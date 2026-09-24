#!/usr/bin/env python3
"""
图标设计方案对比稿。

一次生成多个候选并排放在一张图里，用于横向比较，而不是盲改单稿。
跑法：python3 scripts/icon-variants.py
产出：build/icon-variants.png
"""

from PIL import Image, ImageDraw, ImageFilter
import math
import os

PAPER_TOP = (243, 237, 226)
PAPER_BOTTOM = (232, 222, 203)
INK = (42, 36, 27)
VERMILION = (194, 59, 34)
S = 512
SS = 3
CELL = 1024


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def paper(size):
    grad = Image.new('RGB', (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        t = t * t * (3 - 2 * t)
        grad.putpixel((0, y), tuple(
            round(PAPER_TOP[i] + (PAPER_BOTTOM[i] - PAPER_TOP[i]) * t) for i in range(3)))
    img = grad.resize((size, size), Image.BILINEAR)
    import random
    random.seed(7)
    n = Image.new('L', (size, size))
    px = n.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = random.randint(118, 138)
    n = n.filter(ImageFilter.GaussianBlur(size / 300))
    return Image.blend(img, Image.merge('RGB', (n, n, n)), 0.04)


def base_canvas():
    return paper(CELL).convert('RGBA')


def finish(img):
    m = rounded_mask(CELL, int(CELL * 0.2237))
    out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out.resize((S, S), Image.LANCZOS)


# ---------------------------------------------------------------------------
# 方案 A：密集横排笔画（当前方案）
# ---------------------------------------------------------------------------
def variant_a():
    img = base_canvas()
    d = ImageDraw.Draw(img)
    n, band, pitch = 9, 52, 59
    top = 512 - (n - 1) * pitch / 2
    prof = [0.30, 0.58, 0.80, 0.92, 0.86, 1.00, 0.78, 0.55, 0.26]
    for i in range(n):
        x1 = 512 + 252 * prof[i]
        y = top + i * pitch
        d.rounded_rectangle([268, y - band / 2, x1, y + band / 2],
                            radius=band * 0.42 / 2, fill=INK)
        if i in (2, 6):
            d.rounded_rectangle([268 + (x1 - 268) * 0.55, y - band / 2, x1, y + band / 2],
                                radius=band * 0.42 / 2, fill=VERMILION)
    return finish(img)


# ---------------------------------------------------------------------------
# 方案 B：指纹弧线（脊线成组，向上开口，整体居中）
# ---------------------------------------------------------------------------
def variant_b():
    img = base_canvas()
    d = ImageDraw.Draw(img)
    cx, cy = 512, 610
    radii = [318, 250, 182, 114]
    band = 46
    spans = [(200, 340), (192, 348), (204, 336), (212, 328)]
    for idx, (r, (a0, a1)) in enumerate(zip(radii, spans)):
        outer, inner = r + band / 2, r - band / 2
        pts = []
        for i in range(160):
            a = math.radians(a0 + (a1 - a0) * i / 159)
            pts.append((cx + outer * math.cos(a), cy - outer * math.sin(a)))
        for i in range(159, -1, -1):
            a = math.radians(a0 + (a1 - a0) * i / 159)
            pts.append((cx + inner * math.cos(a), cy - inner * math.sin(a)))
        if idx == 0:
            d.polygon(pts, outline=VERMILION, width=16)
        else:
            d.polygon(pts, fill=INK)
        # 端头圆点
        for a in (a0, a1):
            rad = math.radians(a)
            x, y = cx + r * math.cos(rad), cy - r * math.sin(rad)
            box = [x - band / 2, y - band / 2, x + band / 2, y + band / 2]
            if idx == 0:
                d.ellipse(box, outline=VERMILION, width=16)
            else:
                d.ellipse(box, fill=INK)
    return finish(img)


# ---------------------------------------------------------------------------
# 方案 C：一笔贯穿（单条粗笔画，中部断开成层次）
# ---------------------------------------------------------------------------
def variant_c():
    img = base_canvas()
    d = ImageDraw.Draw(img)
    # 三道粗细递减的短笔画叠成"下钻"的层次，整体保持一个动势
    specs = [
        (300, 760, 392, 74, INK),
        (300, 700, 512, 62, INK),
        (300, 640, 632, 50, VERMILION),
    ]
    for x0, x1, y, band, color in specs:
        d.rounded_rectangle([x0, y - band / 2, x1, y + band / 2],
                            radius=band * 0.42 / 2, fill=color)
    return finish(img)


# ---------------------------------------------------------------------------
# 方案 D：笔画成"指纹"轮廓 —— 横排但整体外轮廓是指腹形，且行端不规则
# ---------------------------------------------------------------------------
def variant_d():
    img = base_canvas()
    d = ImageDraw.Draw(img)
    rd = CELL * SS
    # 用高分辨率画不规则笔画
    hi = Image.new('RGBA', (rd, rd), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)

    n, band, pitch = 8, 56, 66
    top = rd / 2 - (n - 1) * pitch / 2
    # 每行左右端都不规则：整体像指腹，也像自然断句
    lefts = [0.10, 0.05, 0.02, 0.00, 0.01, 0.03, 0.07, 0.15]
    rights = [0.42, 0.74, 0.92, 1.00, 0.96, 0.80, 0.58, 0.34]
    x_l, x_r = rd * 0.26, rd * 0.78
    for i in range(n):
        y = top + i * pitch
        x0 = x_l + (x_r - x_l) * lefts[i]
        x1 = x_l + (x_r - x_l) * rights[i]
        hd.rounded_rectangle([x0, y - band / 2, x1, y + band / 2],
                             radius=band * 0.45 / 2, fill=INK)
        if i in (1, 5):
            hd.rounded_rectangle([x1 - (x1 - x0) * 0.34, y - band / 2, x1, y + band / 2],
                                 radius=band * 0.45 / 2, fill=VERMILION)
    hi = hi.resize((CELL, CELL), Image.LANCZOS)
    img = Image.alpha_composite(img, hi)
    return finish(img)


def main():
    variants = [
        ('A 密集横排笔画', variant_a()),
        ('B 指纹弧线', variant_b()),
        ('C 三层递减', variant_c()),
        ('D 指腹轮廓', variant_d()),
    ]
    gap = 28
    total_w = S * len(variants) + gap * (len(variants) + 1)
    sheet = Image.new('RGB', (total_w, S + gap * 2), (250, 249, 246))
    x = gap
    for _, im in variants:
        sheet.paste(im, (x, gap), im)
        x += S + gap
    os.makedirs('build', exist_ok=True)
    sheet.save('build/icon-variants.png')
    print('build/icon-variants.png')
    print('顺序：', ' | '.join(n for n, _ in variants))


if __name__ == '__main__':
    main()
