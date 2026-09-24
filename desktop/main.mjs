/**
 * 笔迹 ByTrace · 桌面应用主进程
 *
 * 形态：Electron 外壳 + 本机 Next 服务。
 *
 * 为什么不直接把界面打包进 Electron：本项目的后端依赖原生模块
 * （better-sqlite3）与 Node 专属能力（child_process、文件系统），
 * 且页面用 App Router 的服务端渲染。Electron 的渲染进程跑不了这些。
 * 因此保留「本机 Next 服务 + 原生窗口」的结构：外壳负责窗口与服务生命周期，
 * 业务逻辑仍跑在 Node 侧。
 *
 * 职责：
 *   1. 挑一个能加载原生模块的 Node（复用 scripts/pick-node.mjs 的判定逻辑）
 *   2. 起 Next 服务，等它就绪
 *   3. 开原生窗口加载页面
 *   4. 退出时回收服务进程
 *
 * 失败处理：任一步失败都在窗口里显示可操作的中文说明，不静默白屏。
 */

// Electron 是 CommonJS 模块，在 ESM 下具名导入与默认导入都拿不到导出
// （`import { app }` 报 no export named；`import electron from 'electron'` 得到 undefined）。
// 用 createRequire 走 CommonJS 加载是唯一可靠的写法。
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);

// 目录常量与日志工具必须定义在 require('electron') 之前：
// 下面的启动参数与路径设置会立即用到它们（const 有暂时性死区，不能提前引用）。
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

/** 调试日志开关：BYTRACE_DESKTOP_DEBUG=1 */
const DEBUG = process.env.BYTRACE_DESKTOP_DEBUG === '1';
const log = (...a) => {
  if (DEBUG) console.log('[bytrace-desktop]', ...a);
};

const { app, BrowserWindow, Menu, shell } = require('electron');

// 受限环境下 Chromium 的 GPU 进程会反复崩溃并刷权限错误。
// 本应用只渲染本机回环地址的界面，用不到 GPU 加速，直接关掉更稳。
try {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} catch (err) {
  log('启动参数设置失败（忽略）:', err.message);
}

// 把 Electron 的数据与缓存目录引到项目内。
// 必须在 app ready 之前调用；macOS 不认 XDG_* 变量，只能用 API。
try {
  const userData = join(PROJECT_ROOT, '.cache', 'electron-userdata');
  const sessionData = join(PROJECT_ROOT, '.cache', 'electron-session');
  mkdirSync(userData, { recursive: true });
  mkdirSync(sessionData, { recursive: true });
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);
  app.setPath('cache', join(PROJECT_ROOT, '.cache', 'electron-cache'));
  log('userData →', userData);
} catch (err) {
  log('设置数据目录失败（忽略）:', err.message);
}

const DEFAULT_PORT = 3100;
let mainWindow = null;
let serverProcess = null;
let serverPort = null;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 读 .env.local / .env，不覆盖真实环境变量。 */
function readEnvFile() {
  const env = {};
  for (const f of ['.env.local', '.env']) {
    const p = join(PROJECT_ROOT, f);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

function pickFrom(...names) {
  for (const n of names) {
    const v = process.env[n] || readEnvFile()[n];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/**
 * 找一个能加载 better-sqlite3 的 Node 解释器。
 * 判定方式与 scripts/pick-node.mjs 一致：真的执行一次 require + 建表。
 */
function findUsableNode() {
  const PROBE =
    "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(a)');d.prepare('insert into t values(1)').run();";

  const candidates = [];
  const seen = new Set();
  const add = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    candidates.push(p);
  };

  // Electron 自带的 Node 与 ABI 与系统 Node 不同，通常不能加载外部原生模块，
  // 因此这里只考虑真正的系统/版本管理器 Node。
  const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvmDir)) {
    let versions = [];
    try {
      versions = readdirSync(nvmDir);
    } catch {
      /* ignore */
    }
    versions.sort((a, b) => {
      const pa = a.replace(/^v/, '').split('.').map(Number);
      const pb = b.replace(/^v/, '').split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    });
    for (const v of versions) add(join(nvmDir, v, 'bin', 'node'));
  }

  for (const p of [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    join(homedir(), '.local', 'bin', 'node'),
    '/usr/bin/node',
  ]) {
    add(p);
  }

  for (const bin of candidates) {
    if (!existsSync(bin)) continue;
    const r = spawnSync(bin, ['-e', PROBE], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 20000 });
    if (r.status === 0) return bin;
  }
  return null;
}

function isPortFree(port) {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return r.status !== 0;
}

function pickPort() {
  const desired = Number(pickFrom('BYTRACE_PORT')) || DEFAULT_PORT;
  if (isPortFree(desired)) return desired;
  for (let p = desired + 1; p <= desired + 30; p++) {
    if (isPortFree(p)) return p;
  }
  return desired;
}

// ---------------------------------------------------------------------------
// 服务生命周期
// ---------------------------------------------------------------------------

async function startServer(nodeBin, port) {
  const nextBin = join(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

  const useProd = process.env.BYTRACE_DESKTOP_MODE === 'prod' && existsSync(join(PROJECT_ROOT, '.next'));

  const args = useProd
    ? [nextBin, 'start', '-p', String(port)]
    : [nextBin, 'dev', '-p', String(port)];

  return new Promise((resolve, reject) => {
    serverProcess = spawn(nodeBin, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PATH: `${dirname(nodeBin)}:${process.env.PATH}`, BYTRACE_DESKTOP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let log = '';

    const onData = (chunk) => {
      log += chunk.toString();
      if (log.length > 20000) log = log.slice(-10000);
      if (!settled && /Ready in|started server/i.test(log)) {
        settled = true;
        resolve({ port, mode: useProd ? 'production' : 'development' });
      }
    };

    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);

    serverProcess.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`无法启动服务进程：${err.message}`));
      }
    });

    serverProcess.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`服务进程提前退出（code=${code}）\n\n${log.slice(-1500)}`));
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`服务启动超时（90 秒）。\n\n${log.slice(-1500)}`));
      }
    }, 90_000);
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 4000);
    } catch {
      /* ignore */
    }
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function errorPage(title, detail) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:48px; font: 15px/1.7 -apple-system, "PingFang SC", sans-serif;
         background:#faf8f4; color:#2a2622; }
  @media (prefers-color-scheme: dark) { body { background:#1c1a18; color:#e8e3dc; } }
  h1 { font-size:20px; margin:0 0 8px; font-weight:600; }
  .sub { opacity:.65; margin-bottom:24px; }
  pre { background:rgba(127,127,127,.12); padding:16px; border-radius:8px;
        overflow:auto; font-size:12.5px; line-height:1.6; white-space:pre-wrap; }
  .box { border:1px solid rgba(127,127,127,.3); border-radius:10px; padding:20px; margin:20px 0; }
  code { background:rgba(127,127,127,.15); padding:1px 5px; border-radius:4px; font-size:13px; }
</style></head><body>
<h1>${title}</h1>
<div class="sub">笔迹 ByTrace 启动时遇到问题</div>
<div class="box"><pre>${detail}</pre></div>
<p>按 <code>Cmd+R</code> 重试，或关闭窗口后在项目目录执行 <code>npm run doctor</code> 做完整体检。</p>
</body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    title: '笔迹 ByTrace',
    backgroundColor: '#faf8f4',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      // 界面不需要 Node 能力，保持默认的安全设置
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: '笔迹 ByTrace',
            submenu: [
              { role: 'about', label: '关于笔迹 ByTrace' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(process.env.BYTRACE_DESKTOP_DEVTOOLS
          ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }]
          : []),
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// 启动流程
// ---------------------------------------------------------------------------

async function boot() {
  log('boot 开始');
  const win = createWindow();
  buildMenu();
  log('窗口已创建，检查依赖');

  // 1. 依赖检查
  if (!existsSync(join(PROJECT_ROOT, 'node_modules'))) {
    await win.loadURL(
      errorPage(
        '还没有安装依赖',
        `请先完成一次安装：\n\n  双击项目目录里的「安装笔迹.command」\n\n或在终端执行：\n  cd "${PROJECT_ROOT}"\n  npm install`,
      ),
    );
    return;
  }

  // 2. 挑 Node
  log('开始挑选 Node 解释器…');
  const nodeBin = findUsableNode();
  log('选中 Node:', nodeBin);
  if (!nodeBin) {
    await win.loadURL(
      errorPage(
        '没有可用的 Node 运行时',
        [
          '项目依赖的原生模块（better-sqlite3）是按某个固定的 Node ABI 编译的，',
          '当前机器上找不到能加载它的 Node。',
          '',
          '两个解决办法（任选一个）：',
          '',
          '  a) 用当前 Node 重新编译原生模块：',
          `     cd "${PROJECT_ROOT}" && npm rebuild better-sqlite3`,
          '',
          '  b) 安装一个匹配的 Node 版本：',
          '     nvm install 22 && nvm use 22',
          '',
          `体检命令：cd "${PROJECT_ROOT}" && npm run doctor`,
        ].join('\n'),
      ),
    );
    return;
  }

  // 3. 起服务
  serverPort = pickPort();
  log('选中端口:', serverPort);
  try {
    log('正在启动后端服务…');
    await startServer(nodeBin, serverPort);
    log('后端服务就绪');
  } catch (err) {
    log('后端启动失败:', err.message);
    await win.loadURL(errorPage('服务启动失败', String(err.message || err)));
    return;
  }

  // 4. 加载界面
  log('加载界面…');
  await win.loadURL(`http://127.0.0.1:${serverPort}`);
  log('界面已加载');

  // 服务意外挂掉时提示，而不是白屏
  if (serverProcess) {
    serverProcess.on('exit', (code) => {
      if (mainWindow && !mainWindow.isDestroyed() && code !== 0 && code !== null) {
        mainWindow.loadURL(
          errorPage('服务已停止', `后端服务意外退出（code=${code}）。\n\n重启应用即可恢复。`),
        );
      }
    });
  }
}

// 单实例：重复启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() =>
    boot().catch(async (err) => {
      // 兜底：boot 内部未捕获的异常也要显示在窗口里，不能白屏
      console.error('[bytrace-desktop] boot 异常:', err);
      try {
        const wins = BrowserWindow.getAllWindows();
        const target = wins[0] ?? createWindow();
        await target.loadURL(errorPage('启动时发生意外错误', String(err && err.stack ? err.stack : err)));
        target.show();
      } catch {
        /* ignore */
      }
    }),
  );

  app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });

  app.on('before-quit', stopServer);
  process.on('exit', stopServer);
  process.on('SIGINT', () => {
    stopServer();
    process.exit(0);
  });
}
