#!/usr/bin/env python3
"""
从最终图标稿生成 macOS .icns。

做法：
  1. 调用 icon-round2.py 的 variant_e() 取 1024 母稿
  2. 按 macOS 要求的尺寸生成 .iconset 目录
  3. 用 iconutil 打包成 .icns

产出：build/AppIcon.icns
"""
import importlib.util
import os
import subprocess
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('r2', os.path.join(ROOT, 'scripts', 'icon-round2.py'))
r2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r2)

# macOS .iconset 需要的尺寸（含 @2x 视网膜版本）
SPECS = [
    (16,   'icon_16x16.png'),
    (32,   'icon_16x16@2x.png'),
    (32,   'icon_32x32.png'),
    (64,   'icon_32x32@2x.png'),
    (128,  'icon_128x128.png'),
    (256,  'icon_128x128@2x.png'),
    (256,  'icon_256x256.png'),
    (512,  'icon_256x256@2x.png'),
    (512,  'icon_512x512.png'),
    (1024, 'icon_512x512@2x.png'),
]


def main():
    build = os.path.join(ROOT, 'build')
    iconset = os.path.join(build, 'AppIcon.iconset')
    os.makedirs(iconset, exist_ok=True)

    master = r2.variant_e()          # 512×512 的成品稿
    # 母稿是 512，先放大到 1024 再下采样，保证 @2x 清晰度
    big = master.resize((1024, 1024), Image.LANCZOS)
    big.save(os.path.join(build, 'icon-1024.png'))

    for px, name in SPECS:
        src = big if px > 512 else master
        img = src.resize((px, px), Image.LANCZOS)
        img.save(os.path.join(iconset, name))

    icns = os.path.join(build, 'AppIcon.icns')

    # iconutil 在含非 ASCII 字符的路径下会报 "Failed to generate ICNS"
    # （本项目路径含中文），因此先复制到临时目录打包，再移回。
    import shutil
    import tempfile

    with tempfile.TemporaryDirectory(prefix='bytrace-icns-') as tmp:
        tmp_set = os.path.join(tmp, 'AppIcon.iconset')
        shutil.copytree(iconset, tmp_set)
        tmp_icns = os.path.join(tmp, 'AppIcon.icns')
        subprocess.run(['iconutil', '-c', 'icns', tmp_set, '-o', tmp_icns], check=True)
        shutil.copyfile(tmp_icns, icns)

    print(icns)


if __name__ == '__main__':
    main()
