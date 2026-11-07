#!/usr/bin/env node
/**
 * 挑选一个「能加载本项目原生模块」的 Node 解释器。
 *
 * 背景：机器上可能同时存在多个来源的 Node（系统包管理器、nvm、各类工具内置），
 * 它们的 ABI 版本号不一定与 `--version` 一致，而 better-sqlite3 是按某个具体
 * ABI 编译的原生模块。选错解释器的表现是启动即崩，且报错信息难懂。
 *
 * 做法：对每个候选 Node 真的执行一次「require + 建内存表」，
 * 能通过的就是可用解释器。这是唯一可靠的判定方式。
 *
 * 输出：可用解释器的绝对路径（stdout 单行）；没有则输出空并返回非 0。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execPath } from 'node:process';

const root = process.argv[2] || process.cwd();

const PROBE = "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(a)');d.prepare('insert into t values(1)').run();";

function usable(bin) {
  try {
    const r = spawnSync(bin, ['-e', PROBE], { cwd: root, encoding: 'utf8', timeout: 20000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

const candidates = [];
const seen = new Set();
function add(p) {
  if (!p || seen.has(p)) return;
  seen.add(p);
  if (p.includes('/') && !existsSync(p)) return;
  candidates.push(p);
}

// 1) 当前解释器优先（如果它可用，说明用户环境本来就是对的）
add(execPath);

// 2) nvm 下所有版本（从新到旧，优先新版本）
const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
if (existsSync(nvmDir)) {
  const versions = [];
  try {
    for (const d of readdirSync(nvmDir)) versions.push(d);
  } catch {
    /* ignore */
  }
  versions.sort((a, b) => {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  });
  for (const v of versions) add(join(nvmDir, v, 'bin', 'node'));
}

// 3) 常见全局位置
for (const p of [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
  join(homedir(), '.local', 'bin', 'node'),
  join(homedir(), '.volta', 'bin', 'node'),
]) {
  add(p);
}

for (const bin of candidates) {
  if (usable(bin)) {
    process.stdout.write(bin);
    process.exit(0);
  }
}

// 都不行：把当前解释器路径吐出去，让调用方决定怎么报错
process.stdout.write('');
process.exit(1);
