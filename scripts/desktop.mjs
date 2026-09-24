#!/usr/bin/env node
/**
 * 桌面应用启动包装器
 *
 * 用法：npm run desktop  /  npm run desktop:devtools
 *
 * 为什么需要包装器（而不是直接 `electron .`）：
 *
 * 1. **必须清掉 ELECTRON_RUN_AS_NODE**。
 *    某些宿主环境（含把 Electron 用作运行时的开发工具）会导出这个变量，
 *    它会让任意 Electron 二进制退化成普通 Node，表现是启动时报
 *    "Cannot find module 'electron'"，极难排查。这里显式清掉。
 *
 * 2. **把 Electron 的缓存目录引到项目内**。
 *    Electron 默认往 ~/Library/Application Support 写 GPU/持久化缓存。
 *    在受限环境（外置卷、沙箱、只读主目录）下会反复报权限错误。
 *    引到项目内既安静，也便于清理。
 *
 * 3. **校验二进制是否真的装好**，没装好就给出可执行的修复步骤。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m',
};

function die(title, lines) {
  console.error(`\n${C.red}${C.bold}${title}${C.reset}\n`);
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

// --- 1. 依赖检查 -----------------------------------------------------------
if (!existsSync(join(root, 'node_modules'))) {
  die('还没有安装依赖', [
    '先执行一次安装：',
    `  cd "${root}" && npm install`,
    '',
    '或双击项目里的「安装笔迹.command」。',
  ]);
}

const electronPkg = join(root, 'node_modules', 'electron', 'package.json');
if (!existsSync(electronPkg)) {
  die('缺少 Electron', [
    '安装桌面外壳：',
    `  cd "${root}" && npm install`,
  ]);
}

// --- 2. 校验 Electron 二进制 ------------------------------------------------
const pathFile = join(root, 'node_modules', 'electron', 'path.txt');
let binary = null;

if (existsSync(pathFile)) {
  const distDir = join(root, 'node_modules', 'electron', 'dist');
  const exeName = readFileSync(pathFile, 'utf8').trim();
  const p = join(distDir, exeName);
  if (existsSync(p)) binary = p;
}

if (!binary) {
  die('Electron 二进制没有下载完整', [
    '这是 npm 安装时 postinstall 下载被跳过或中断导致的（二进制约 130MB）。',
    '',
    '修复办法（任选一个）：',
    '',
    '  a) 直接重跑下载脚本：',
    `     cd "${root}"`,
    '     node node_modules/electron/install.js',
    '',
    '  b) 网络慢的话走国内镜像：',
    `     cd "${root}"`,
    '     electron_config_cache="$PWD/.cache/electron" \\',
    '       ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" \\',
    '       node node_modules/electron/install.js',
  ]);
}

// --- 3. 准备缓存目录 --------------------------------------------------------
mkdirSync(join(root, '.cache', 'electron-userdata'), { recursive: true });
mkdirSync(join(root, '.cache', 'electron-gpu'), { recursive: true });

// --- 4. 组装环境 ------------------------------------------------------------
const env = { ...process.env };

// 关键修复：清掉会让 Electron 退化成 Node 的变量
delete env.ELECTRON_RUN_AS_NODE;

// Electron 自身认的是这两个变量（不是 ELECTRON_USER_DATA_DIR）。
// 引到项目内可避免往 ~/Library/Application Support 写缓存：
// 在受限环境（外置卷、沙箱、主目录不可写）下，默认路径会反复报权限错误。
// 注意：GPU 缓存仍会尝试默认路径，因此下面还会关掉硬件加速。
env.XDG_CONFIG_HOME = join(root, '.cache', 'electron-config');
env.XDG_CACHE_HOME = join(root, '.cache', 'electron-cache');
mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });
mkdirSync(env.XDG_CACHE_HOME, { recursive: true });

// Chromium 的进程沙箱服务在受限环境下可能初始化失败（报
// "sandbox initialization failed: Operation not permitted"）。
// 桌面外壳本身不加载外部不可信内容（只加载本机回环地址的界面），
// 因此关掉沙箱是安全的，并且是让应用能真正跑起来的必要一步。
env.ELECTRON_DISABLE_SANDBOX = '1';

if (process.argv.includes('--devtools')) {
  env.BYTRACE_DESKTOP_DEVTOOLS = '1';
}

console.log(`\n${C.bold}${C.cyan}  笔迹 ByTrace · 桌面应用${C.reset}`);
console.log(`${C.dim}  正在启动，窗口出现前需要几十秒（后端服务要编译）${C.reset}\n`);

// --no-sandbox：与上面的 ELECTRON_DISABLE_SANDBOX 双重保证
// --disable-gpu：受限环境下 GPU 进程会反复崩溃刷屏，桌面应用用不到它
const electronArgs = [
  '--no-sandbox',
  '--disable-gpu',
  join(root, 'desktop', 'main.mjs'),
  ...process.argv.slice(2).filter((a) => a !== '--devtools'),
];

const child = spawn(binary, electronArgs, {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
