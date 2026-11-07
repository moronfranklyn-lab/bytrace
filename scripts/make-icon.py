#!/usr/bin/env python3
"""
笔迹 ByTrace · 应用图标生成器

设计说明
--------
接现有设计系统的语言（三个主题都围绕书卷气）：
    纸    #efe8d8  牛皮纸底
    墨    #2a241b  正文/标题色
    朱砂  #c23b22  强调色（accent）

图形概念：**一排笔画，既是文字行，也是指纹脊线。**

本产品最独特的东西是「风格指纹」——把一个博主的文章拆成可复用的结构化风格。
而它真正的价值在于把一段思路写成成稿。图标把这两件事画成一件事：
几道横排笔画既读作「正在写的文字」，又因粗细起伏而读作指纹的脊线。

取舍：
- 不用同心圆/圆环：那是靶心，且小尺寸下读作信号图标，没有信息量。
- 不用汉字：32px 下糊成方块。
- 不用印章/毛笔造型：同品类滥用到无法区分，且传达不出「拆解成结构」这件事。
- 朱砂只出现在两处短笔上（且不完全重叠），保证 32px 下墨色仍占主导、红色只负责定调。
- 笔画左端对齐、右端参差：像排印时行尾的自然断句，也像指纹脊线的断续。
"""

from PIL import Image, ImageDraw, ImageFilter
import math
import os
import sys

# ---------------------------------------------------------------------------
# 设计令牌
# ---------------------------------------------------------------------------
PAPER_TOP = (243, 237, 226)     # 牛皮纸（略提亮，用作渐变顶）
PAPER_BOTTOM = (232, 222, 203)  # 牛皮纸（略压暗，用作渐变底）
INK = (42, 36, 27)              # 墨
VERMILION = (194, 59, 34)       # 朱砂

SIZE = 1024
SS = 4                          # 超采样倍数（抗锯齿）
RADIUS_RATIO = 0.2237           # macOS 图标圆角比例（约为边长 22.37%）

# ---------------------------------------------------------------------------
# 笔画条带几何
# ---------------------------------------------------------------------------
# 一叠横排笔画。三个特征让它同时读作「一段文字」与「一枚指纹」：
#   1. 行距很紧（pitch ≈ 1.5 × 笔画厚度），密集排列才有脊线的质感
#   2. 行的长度按椭圆轮廓变化，整体轮廓是柔和的指腹形状，不是矩形段落
#   3. 左端严格对齐（排印的行首），右端由轮廓决定长短（自然的行尾参差）
#
# 如果只做「几根长度不同的横条」，那只是一个列表图标，没有信息量。
LINES = []

def rounded_mask(size, radius):
    """生成圆角矩形遮罩。"""
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def paper_background(size):
    """牛皮纸底：垂直渐变 + 极轻的纸纹噪点。

    渐变让底色不是死板的纯色；噪点让它是"纸"而不是"色块"。
    噪点经过模糊后幅值压得很低，避免像电视雪花。
    """
    import random

    grad = Image.new('RGB', (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        t = t * t * (3 - 2 * t)          # smoothstep，比线性自然
        grad.putpixel((0, y), tuple(
            round(PAPER_TOP[i] + (PAPER_BOTTOM[i] - PAPER_TOP[i]) * t) for i in range(3)
        ))
    img = grad.resize((size, size), Image.BILINEAR)

    random.seed(20260524)                 # 固定种子：每次生成结果一致
    noise = Image.new('L', (size, size))
    px = noise.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = random.randint(112, 144)
    noise = noise.filter(ImageFilter.GaussianBlur(size / 320))
    grain = Image.merge('RGB', (noise, noise, noise))
    return Image.blend(img, grain, 0.045)


def _build_lines():
    """按轮廓生成各行。

    两个比例决定它读成"指纹"还是读成"列表"：
      band / pitch 要足够大（笔画厚、行距紧），脊线才是连续的质感；
      整组长度按椭圆轮廓变化，整体轮廓才是柔和的指腹形而不是矩形段落。
    另外右端不严格单调（中间几行反而略短），避免镜像对称造成的机械感。
    """
    count = 9
    band = 52                      # 笔画厚度
    pitch = 59                     # 行距（与厚度接近，形成密集脊线）
    top = 512 - (count - 1) * pitch / 2
    x_left = 268                   # 行首统一对齐
    x_max = 764
    x_min = 512

    # 手工给的右端长度：柔和起伏，不是完美椭圆，也不左右镜像
    shape_profile = [0.30, 0.58, 0.80, 0.92, 0.86, 1.00, 0.78, 0.55, 0.26]

    for i in range(count):
        x_right = x_min + (x_max - x_min) * shape_profile[i]
        LINES.append({
            'y': round(top + i * pitch),
            'x0': x_left,
            'x1': round(x_right),
            'band': band,
            # 朱砂只用在两条，且不相邻，作为重音
            'accent': i in (2, 6),
        })

_build_lines()

def stroke_rect(x0, x1, y, band, scale, radius_ratio=0.42):
    """一条笔画的几何（圆角矩形）。

    之前用「上下两条钟形曲线拼合」会得到中间鼓、两端尖的透镜形，
    那是橄榄球的形状，不像书写的笔画。改用圆角矩形：
    端面是圆的（像运笔的顿点），主体是等宽的，读起来才像一行排印或一道脊线。
    """
    r = band * radius_ratio / 2
    return {
        'box': [
            x0 * scale,
            (y - band / 2) * scale,
            x1 * scale,
            (y + band / 2) * scale,
        ],
        'radius': r * scale,
    }


def draw_strokes(size, scale):
    """画一叠笔画。

    朱砂的处理：让墨色在行尾**渐次过渡**到朱砂，而不是切一段涂红。
    硬边界会把图形读成进度条；渐变读起来像运笔到后段换了墨色。
    """
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    for line in LINES:
        y, x0, x1, band = line['y'], line['x0'], line['x1'], line['band']
        accent = line['accent']
        geom = stroke_rect(x0, x1, y, band, scale)

        base = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        bd = ImageDraw.Draw(base)
        bd.rounded_rectangle(geom['box'], radius=geom['radius'], fill=INK + (255,))

        if accent:
            # 用沿长度方向的 alpha 渐变把行尾"染"成朱砂
            mask = Image.new('L', (size, size), 0)
            ImageDraw.Draw(mask).rounded_rectangle(
                geom['box'], radius=geom['radius'], fill=255
            )

            gradient = Image.new('L', (size, size), 0)
            gp = gradient.load()
            fade_start = int(x0 + (x1 - x0) * 0.55) * scale
            fade_stop = int(x1) * scale
            span = max(1, fade_stop - fade_start)
            width = size
            for px in range(fade_start, min(fade_stop, width)):
                t = (px - fade_start) / span
                # 平滑起步，避免出现一条明显的中线
                a = int(255 * (t ** 1.6))
                for py in range(size):
                    gp[px, py] = a

            mask = Image.composite(gradient, Image.new('L', (size, size), 0), mask)
            vermilion_layer = Image.new('RGBA', (size, size), VERMILION + (255,))
            vermilion_layer.putalpha(mask)
            base = Image.alpha_composite(base, vermilion_layer)

        layer = Image.alpha_composite(layer, base)

    return layer


def render(size=SIZE):
    work = size * SS

    # 1) 底：纸
    bg = paper_background(work).convert('RGBA')

    # 2) 笔画群（几何常量按超采样倍数放大）
    strokes = draw_strokes(work, SS)
    bg = Image.alpha_composite(bg, strokes)

    # 3) 收进圆角矩形
    mask = rounded_mask(work, int(work * RADIUS_RATIO))
    out = Image.new('RGBA', (work, work), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)

    # 4) 顶边一道极淡的高光，模拟纸张受光
    gloss = Image.new('RGBA', (work, work), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.rounded_rectangle(
        [0, 0, work - 1, work - 1],
        radius=int(work * RADIUS_RATIO),
        outline=(255, 255, 255, 42),
        width=max(1, int(work * 0.004)),
    )
    out = Image.alpha_composite(out, gloss)

    # 5) 下采样回目标尺寸
    return out.resize((size, size), Image.LANCZOS)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else 'build'
    os.makedirs(out_dir, exist_ok=True)

    master = render(SIZE)
    master_path = os.path.join(out_dir, 'icon-1024.png')
    master.save(master_path)

    # 预览：在最常用的小尺寸下确认可读性
    previews = [512, 256, 128, 64, 32, 16]
    strip = Image.new('RGBA', (sum(previews) + 20 * len(previews), 512), (245, 245, 245, 255))
    x = 20
    for s in previews:
        small = master.resize((s, s), Image.LANCZOS)
        strip.paste(small, (x, (512 - s) // 2), small)
        x += s + 20
    strip_path = os.path.join(out_dir, 'icon-preview-sizes.png')
    strip.save(strip_path)

    print(master_path)
    print(strip_path)


if __name__ == '__main__':
    main()
