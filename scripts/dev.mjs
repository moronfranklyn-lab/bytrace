#!/usr/bin/env node
/**
 * 开发/生产启动包装器
 *
 * 目的：让端口可配置。
 *   BYTRACE_PORT=3200 npm run dev
 *
 * 未配置时默认 3100。命令行显式传入的 -p / --port 优先级最高，
 * 这样既有默认值，又不影响临时换端口。
 *
 * 为什么需要包装器：package.json 的 script 里不能可靠地读 .env.local
 * （它是 Next 加载的，不是 shell 加载的），所以用一层 Node 脚本读环境变量。
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 3100;

/** 从 .env.local / .env 里读一个变量（不覆盖已存在的真实环境变量）。 */
function readFromEnvFiles(key) {
  for (const file of ['.env.local', '.env']) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      if (k !== key) continue;
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  }
  return undefined;
}

function resolvePort() {
  const cliArgs = process.argv.slice(2);
  const cliPortIdx = cliArgs.findIndex((a) => a === '-p' || a === '--port');
  if (cliPortIdx !== -1 && cliArgs[cliPortIdx + 1]) return cliArgs[cliPortIdx + 1];

  const fromEnv = process.env.BYTRACE_PORT || readFromEnvFiles('BYTRACE_PORT');
  const port = Number(fromEnv);
  return Number.isInteger(port) && port > 0 && port < 65536 ? String(port) : String(DEFAULT_PORT);
}

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = resolvePort();

const nextBin = join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const args = [nextBin, mode, '-p', port];

// 把用户额外传的参数透传（去掉我们已处理的 mode 和第 2 个位置参数）
const passthrough = process.argv.slice(3).filter((a, i, arr) => {
  const prev = arr[i - 1];
  return prev !== '-p' && prev !== '--port' && a !== '-p' && a !== '--port';
});

const child = spawn(process.execPath, [...args, ...passthrough], {
  stdio: 'inherit',
  cwd: projectRoot,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
