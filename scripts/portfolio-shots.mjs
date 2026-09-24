/**
 * 作品集截图生成器
 *
 * 用法（服务需已在 PORT 上运行）：
 *   BYTRACE_PORT=3100 node scripts/portfolio-shots.mjs
 *
 * 做法：复用项目已装的 Electron 所带的 Chromium 驱动截图，
 * 不额外安装 Playwright/Puppeteer（省一次大体积下载）。
 *
 * 产出：build/portfolio/<名称>.png（1440 宽，整页）
 *
 * 工程细节：
 *   - 关闭硬件加速与沙箱：受限环境下 GPU 进程会崩溃
 *   - 注入 CSS 隐藏 Next 的开发指示器：截图里不该出现调试痕迹
 *   - 等字体与首屏数据就绪再截，避免截到骨架态
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require('electron');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.BYTRACE_PORT || '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(root, 'build', 'portfolio');
const WIDTH = 1440;
const VIEWPORT_H = 900;

/** 截图清单。height 为 null 表示整页长图。 */
const SHOTS = [
  { name: '01-工作台', path: '/', height: null, desc: '首页：选题推荐 + 最近用过的风格' },
  { name: '02-风格指纹列表', path: '/fingerprints', height: null, desc: '已拆解的博主指纹库' },
  { name: '03-指纹详情-思敏学姐', path: '/fingerprints/x6xiH7pG20ytvU', height: null, desc: '四象限 + 论证骨架' },
  { name: '04-指纹详情-半佛仙人', path: '/fingerprints/mO6-NkOF3u6Jwo', height: null, desc: '结构能力与物件类比库' },
  { name: '05-写作流程', path: '/compose', height: null, desc: '七步流程入口' },
  { name: '06-选题中心', path: '/topics', height: null, desc: '风格推荐 + 热点聚合' },
  { name: '07-历史文章', path: '/articles', height: null, desc: '按文章分组，平台版本切换' },
  { name: '08-文章详情', path: '/articles/KpMRUHGLPc-QLt', height: null, desc: '成稿与平台版本差异' },
  { name: '09-站点画像', path: '/sites', height: null, desc: '平台板块口味拆解' },
  { name: '10-站点详情', path: '/sites/PlTIcTCzV8B5Xr', height: null, desc: '板块级 + 编辑级画像' },
  { name: '11-风格配方', path: '/recipes', height: null, desc: '跨博主碎片组合' },
  { name: '12-策略侦察', path: '/strategies', height: null, desc: '跨博主策略碎片检索' },
];

const HIDE_DEV_CHROME = `
  nextjs-portal { display: none !important; }
  [data-nextjs-toast] { display: none !important; }
  [data-next-badge-root] { display: none !important; }
  #__next-build-watcher { display: none !important; }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(win, shot) {
  const url = BASE + shot.path;

  // 关键：每张截图前把窗口恢复成基准视口。
  // 否则上一张为了整页图调高过窗口，下一张量到的高度会建立在放大后的布局上，
  // 逐张累积，最后全被顶到上限（实测出现过全是 3992 / 6000 的情况）。
  win.setContentSize(WIDTH, VIEWPORT_H);

  await win.loadURL(url);
  await sleep(2200);
  await win.webContents.insertCSS(HIDE_DEV_CHROME);

  if (shot.height === null) {
    // 整页：量文档真实高度，再按该高度调整窗口后截图
    const full = await win.webContents.executeJavaScript(
      'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight)',
    );
    const height = Math.min(Math.max(full, VIEWPORT_H), 12000);
    win.setContentSize(WIDTH, height);
    await sleep(800);
  } else {
    win.setContentSize(WIDTH, shot.height);
    await sleep(500);
  }

  const image = await win.webContents.capturePage();
  const file = join(OUT, `${shot.name}.png`);
  writeFileSync(file, image.toPNG());
  const size = image.getSize();
  console.log(`  ✓ ${shot.name}  ${size.width}×${size.height}`);
  return file;
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: WIDTH,
    height: VIEWPORT_H,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });

  console.log(`\n截图目标：${BASE}\n输出目录：${OUT}\n`);

  const done = [];
  for (const shot of SHOTS) {
    try {
      await capture(win, shot);
      done.push(shot);
    } catch (err) {
      console.error(`  ✗ ${shot.name}  失败：${err.message}`);
    }
  }

  console.log(`\n完成 ${done.length}/${SHOTS.length}`);
  app.quit();
});
