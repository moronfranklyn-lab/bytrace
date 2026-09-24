#!/usr/bin/env node
/**
 * 生成 macOS 启动图标（.app 包）。
 *
 * 用法：node scripts/make-app.mjs [输出目录]
 *   默认输出到 <项目根>/dist/笔迹 ByTrace.app
 *
 * 为什么单独抽成脚本：.app 内部要写 Info.plist 和一个含 shell 变量的启动脚本，
 * 用 shell heredoc 生成时引号嵌套极容易出错（曾踩过 osascript 引号错位）。
 * 用 Node 生成可以完全避免转义问题。
 */

import { mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_NAME = '笔迹 ByTrace';
const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist');
const appPath = join(outDir, `${APP_NAME}.app`);

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>local.bytrace.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

/**
 * 启动脚本。三种定位项目目录的策略，逐个尝试：
 *   1. app 包就在项目根下（dist/ 或项目根）
 *   2. 环境变量 BYTRACE_HOME
 *   3. Resources/project-path 里记录的绝对路径（安装时写入）
 */
const LAUNCH = `#!/bin/bash
# 由安装程序生成 · 启动笔迹 ByTrace

APP_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

try_launch() {
  if [ -n "$1" ] && [ -x "$1/启动笔迹.command" ]; then
    exec "$1/启动笔迹.command"
  fi
}

try_launch "$APP_DIR"
try_launch "$APP_DIR/dist"
[ -n "$BYTRACE_HOME" ] && try_launch "$BYTRACE_HOME"

RECORDED="$APP_DIR/Contents/Resources/project-path"
if [ -f "$RECORDED" ]; then
  try_launch "$(cat "$RECORDED")"
fi

MSG='找不到笔迹 ByTrace 的项目目录。请重新运行项目内的「安装笔迹.command」。'
osascript -e "display alert \\"笔迹 ByTrace\\" message \\"$MSG\\" as critical" >/dev/null 2>&1
echo "找不到笔迹 ByTrace 的项目目录。"
echo "请重新运行项目内的「安装笔迹.command」。"
read -n 1 -s -r -p "按任意键关闭…"
exit 1
`;

if (existsSync(appPath)) rmSync(appPath, { recursive: true, force: true });
mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
mkdirSync(join(appPath, 'Contents', 'Resources'), { recursive: true });

writeFileSync(join(appPath, 'Contents', 'Info.plist'), PLIST, 'utf8');

const launchPath = join(appPath, 'Contents', 'MacOS', 'launch');
writeFileSync(launchPath, LAUNCH, 'utf8');
chmodSync(launchPath, 0o755);

writeFileSync(join(appPath, 'Contents', 'Resources', 'project-path'), root, 'utf8');

console.log(appPath);
