#!/usr/bin/env python3
"""
第二轮图标方案对比：以「朱砂印章」为骨架。

第一轮的结论（记录下来避免重走）：
  A 密集横排笔画 → 读成"菜单列表"，没有书写感
  B 指纹弧线     → 读成 wifi / 信号图标，且重心偏低
  C 三层递减     → 太空，读成"列表项"
  D 指腹轮廓     → 居中与尺度没控制好

共同问题：都在用"几根横线"表达写作，而这个形状在图标尺度上太通用。
本轮换骨架：**印章**。朱砂 + 牛皮纸是这套设计系统自己的语言，印章天生属于它。

跑法：python3 scripts/icon-round2.py
产出：build/icon-round2.png
"""

from PIL import Image, ImageDraw, ImageFilter
import math
import os
import random

PAPER_TOP = (243, 237, 226)
PAPER_BOTTOM = (232, 222, 203)
INK = (42, 36, 27)
VERMILION = (194, 59, 34)
DEEP_VERMILION = (166, 44, 24)
S = 512
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
    random.seed(11)
    n = Image.new('L', (size, size))
    px = n.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = random.randint(118, 138)
    n = n.filter(ImageFilter.GaussianBlur(size / 300))
    return Image.blend(img, Image.merge('RGB', (n, n, n)), 0.04)


def finish(img):
    m = rounded_mask(CELL, int(CELL * 0.2237))
    out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out.resize((S, S), Image.LANCZOS)


# ---------------------------------------------------------------------------
# E：朱砂印章 + 内刻横排笔画（阳刻：纸色笔画挖在朱砂印面上）
#
# 这是最终采用的方向，理由记录在此：
#   - 1px 级缩放下最稳：实心朱砂块 + 纸色笔画是高对比的 notan 结构，
#     缩到 16px 仍能认出"红色方块里有几道浅色槽"；
#     描边式方案（F）在 16px 时描边几乎消失，整体垮掉。
#   - 与设计系统同源：朱砂 #c23b22 + 牛皮纸，本来就是这套主题的用色关系。
#   - 印章的方框给出"这是一枚印记"的语义，内部的横槽给出"文字"的语义，
#     合起来正好是本产品在做的事：把风格拆成可辨识的印记。
#
# 笔画数与厚度是为小尺寸服务而反复调过的：
#   笔画太多太细 → 1024 下糊成噪点，16px 下消失；
#   4 道、厚度约印面宽度的 9% 是两端都还能读的折中。
# ---------------------------------------------------------------------------
def variant_e():
    img = paper(CELL).convert('RGBA')
    d = ImageDraw.Draw(img)
    pad, size = 262, 500
    box = [pad, pad, pad + size, pad + size]
    d.rounded_rectangle(box, radius=52, fill=VERMILION)

    # 内刻笔画：4 道，左端对齐、右端参差，等宽偏厚
    n = 4
    band = int(size * 0.090)          # ≈45px
    pitch = int(size * 0.185)         # ≈92px
    top = pad + size / 2 - (n - 1) * pitch / 2
    x_l = pad + size * 0.185
    x_r = pad + size * 0.815
    prof = [0.62, 0.88, 1.00, 0.58]
    for i in range(n):
        x1 = x_l + (x_r - x_l) * prof[i]
        y = top + i * pitch
        d.rounded_rectangle([x_l, y - band / 2, x1, y + band / 2],
                            radius=band * 0.36 / 2, fill=PAPER_TOP)
    return finish(img)


# ---------------------------------------------------------------------------
# F：朱砂印章（描边式）+ 内刻笔画，笔画为墨（阴刻）
# ---------------------------------------------------------------------------
def variant_f():
    img = paper(CELL).convert('RGBA')
    d = ImageDraw.Draw(img)
    pad, size = 268, 488
    box = [pad, pad, pad + size, pad + size]
    # 描边式印章：更轻，留白更多
    d.rounded_rectangle(box, radius=54, outline=VERMILION, width=26)

    n, band, pitch = 5, 40, 78
    top = pad + size / 2 - (n - 1) * pitch / 2
    x_l = pad + size * 0.20
    prof = [0.52, 0.80, 1.00, 0.74, 0.46]
    for i in range(n):
        x1 = x_l + (pad + size * 0.80 - x_l) * prof[i]
        y = top + i * pitch
        color = VERMILION if i == 2 else INK
        d.rounded_rectangle([x_l, y - band / 2, x1, y + band / 2],
                            radius=band * 0.4 / 2, fill=color)
    return finish(img)


# ---------------------------------------------------------------------------
# G：朱砂方形 + 一个大留白缺口 —— 极简，靠比例说话
# ---------------------------------------------------------------------------
def variant_g():
    img = paper(CELL).convert('RGBA')
    d = ImageDraw.Draw(img)
    pad, size = 246, 532
    box = [pad, pad, pad + size, pad + size]
    d.rounded_rectangle(box, radius=58, fill=VERMILION)
    # 用纸色挖一条斜向缺口：像印面的一刀，也像"思路被打通"
    d.polygon([
        (pad + size * 0.18, pad + size * 0.62),
        (pad + size * 0.62, pad + size * 0.18),
        (pad + size * 0.82, pad + size * 0.38),
        (pad + size * 0.38, pad + size * 0.82),
    ], fill=PAPER_BOTTOM)
    return finish(img)


# ---------------------------------------------------------------------------
# H：印章 + 指纹弧线（把上一轮的指纹装进章里）
# ---------------------------------------------------------------------------
def variant_h():
    img = paper(CELL).convert('RGBA')
    d = ImageDraw.Draw(img)
    pad, size = 258, 508
    box = [pad, pad, pad + size, pad + size]
    d.rounded_rectangle(box, radius=56, fill=VERMILION)

    cx, cy = pad + size / 2, pad + size * 0.66
    radii = [168, 122, 76, 34]
    band = 26
    for idx, r in enumerate(radii):
        outer, inner = r + band / 2, r - band / 2
        pts = []
        for i in range(140):
            a = math.radians(200 + 140 * i / 139)
            pts.append((cx + outer * math.cos(a), cy - outer * math.sin(a)))
        for i in range(139, -1, -1):
            a = math.radians(200 + 140 * i / 139)
            pts.append((cx + inner * math.cos(a), cy - inner * math.sin(a)))
        d.polygon(pts, fill=PAPER_BOTTOM)
    return finish(img)


def main():
    variants = [
        ('E 阳刻印章', variant_e()),
        ('F 描边印章', variant_f()),
        ('G 印章缺口', variant_g()),
        ('H 印章指纹', variant_h()),
    ]
    gap = 28
    total_w = S * len(variants) + gap * (len(variants) + 1)
    sheet = Image.new('RGB', (total_w, S + gap * 2), (250, 249, 246))
    x = gap
    for _, im in variants:
        sheet.paste(im, (x, gap), im)
        x += S + gap
    os.makedirs('build', exist_ok=True)
    sheet.save('build/icon-round2.png')
    print('build/icon-round2.png')
    print('顺序：', ' | '.join(n for n, _ in variants))


if __name__ == '__main__':
    main()
