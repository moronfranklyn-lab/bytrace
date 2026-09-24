#!/usr/bin/env node
/**
 * 笔迹 ByTrace · 环境自检
 *
 * 用法：npm run doctor
 *
 * 逐项体检并给出「能不能跑、哪儿没配、怎么修」。不修改任何东西，只读。
 *
 * 为什么需要它：本产品依赖原生模块（better-sqlite3）与本机 CLI，
 * 这两类依赖出问题时报错信息很难懂。自检把常见坑翻译成人话。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE_MAJOR = 22;

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const results = [];
function record(level, label, detail, fix) {
  results.push({ level, label, detail, fix });
}

function section(title) {
  console.log(`\n${C.bold}${C.cyan}${title}${C.reset}`);
}

// ---------------------------------------------------------------------------
// 0. 读 .env.local（Next 会读，自检脚本要自己读）
// ---------------------------------------------------------------------------
function loadEnvFile() {
  const env = {};
  for (const f of ['.env.local', '.env']) {
    const path = join(root, f);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      env[line.slice(0, eq).trim()] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const fileEnv = loadEnvFile();
/** 环境变量优先于文件；再依次回落旧名。 */
function pick(...names) {
  for (const n of names) {
    const v = process.env[n] || fileEnv[n];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// 1. Node 版本
// ---------------------------------------------------------------------------
section('① Node.js 运行时');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= MIN_NODE_MAJOR) {
  record('ok', `Node.js ${process.version}`, `ABI ${process.versions.modules}`);
} else {
  record(
    'fail',
    `Node.js ${process.version} 版本过低`,
    `需要 ≥ ${MIN_NODE_MAJOR}`,
    `用 nvm 安装并切换：nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}`,
  );
}

// ---------------------------------------------------------------------------
// 2. 原生模块能否加载（最容易踩的坑）
// ---------------------------------------------------------------------------
section('② 原生模块 better-sqlite3');

const nativeProbe = spawnSync(
  process.execPath,
  [
    '-e',
    "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(a)');d.prepare('insert into t values(1)').run();console.log('ok');",
  ],
  { cwd: root, encoding: 'utf8' },
);

if (nativeProbe.status === 0 && (nativeProbe.stdout || '').includes('ok')) {
  record('ok', '原生模块可正常加载', `Node ABI ${process.versions.modules}`);
} else {
  const err = `${nativeProbe.stderr || ''}${nativeProbe.stdout || ''}`;
  const abiMatch = err.match(/NODE_MODULE_VERSION (\d+)[\s\S]*?requires\s+NODE_MODULE_VERSION (\d+)/i);
  const detail = abiMatch
    ? `编译时的 ABI 是 ${abiMatch[1]}，当前 Node 需要 ${abiMatch[2]}`
    : err.split('\n').filter(Boolean).slice(0, 2).join(' ') || '加载失败';
  record(
    'fail',
    '原生模块无法加载',
    detail,
    [
      '当前 Node 与编译该模块时的 Node 不是同一个大版本。两个办法：',
      '  a) 用当前 Node 重新编译：npm rebuild better-sqlite3',
      '  b) 换成与模块匹配的 Node 版本（见下方「可用 Node 列表」）',
    ].join('\n'),
  );
}

// 顺带列出机器上其它可用的 Node，方便换版本
const nodeCandidates = [];
const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
if (existsSync(nvmDir)) {
  try {
    for (const d of readdirSafe(nvmDir)) {
      const bin = join(nvmDir, d, 'bin', 'node');
      if (existsSync(bin)) nodeCandidates.push(bin);
    }
  } catch {
    /* ignore */
  }
}
if (nodeCandidates.length > 0) {
  const usable = [];
  for (const bin of nodeCandidates) {
    const probe = spawnSync(
      bin,
      ['-e', "require('better-sqlite3');console.log(process.version+' ABI '+process.versions.modules)"],
      { cwd: root, encoding: 'utf8' },
    );
    if (probe.status === 0) usable.push(probe.stdout.trim());
  }
  record(
    usable.length > 0 ? 'ok' : 'warn',
    '其它可用的 Node 版本',
    usable.length > 0 ? usable.join(' | ') : 'nvm 里有其它版本，但都不能加载当前原生模块',
    usable.length > 0 ? `如需切换：export PATH="$(dirname $(dirname ${nodeCandidates[0]}))/bin:$PATH"` : undefined,
  );
}

function readdirSafe(p) {
  // 避免顶层 import fs 的 readdirSync 与其它用法混淆
  const { readdirSync } = require('node:fs');
  return readdirSync(p);
}

// ---------------------------------------------------------------------------
// 3. 数据库
// ---------------------------------------------------------------------------
section('③ 数据库');

const dataDir = pick('BYTRACE_DATA_DIR') || join(root, 'data');
const dbPath = join(dataDir, 'autoarticle.db');

if (existsSync(dbPath)) {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `const D=require('better-sqlite3');const db=new D(${JSON.stringify(dbPath)},{readonly:true});
       const r=db.prepare("SELECT (SELECT COUNT(*) FROM authors) a,(SELECT COUNT(*) FROM fingerprints) f,(SELECT COUNT(*) FROM articles) ar").get();
       console.log(JSON.stringify(r));`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (probe.status === 0) {
    const r = JSON.parse(probe.stdout.trim());
    record('ok', '数据库可读', `${r.a} 位作者 · ${r.f} 份指纹 · ${r.ar} 篇文章`);
  } else {
    record('fail', '数据库打不开', (probe.stderr || '').split('\n')[0], '检查文件权限，或确认没有旧进程占用');
  }
} else {
  record('info', '数据库尚未创建', dbPath, '首次启动时会自动创建，无需手动处理');
}
record('info', '数据目录', dataDir + (pick('BYTRACE_DATA_DIR') ? '（来自 BYTRACE_DATA_DIR）' : '（默认）'));

// ---------------------------------------------------------------------------
// 4. 主 Agent
// ---------------------------------------------------------------------------
section('④ 主 Agent（写作）');

const provider = (pick('BYTRACE_AGENT_PROVIDER', 'AUTOARTICLE_LLM_PROVIDER') || 'claude-cli').toLowerCase();
const agentBase = pick('BYTRACE_AGENT_BASE_URL', 'AUTOARTICLE_LLM_BASE_URL', 'OPENAI_BASE_URL');
const agentKey = pick('BYTRACE_AGENT_API_KEY', 'AUTOARTICLE_LLM_API_KEY', 'OPENAI_API_KEY');
const agentModel = pick('BYTRACE_AGENT_MODEL', 'AUTOARTICLE_LLM_MODEL', 'OPENAI_MODEL');
const agentArticleModel = pick('BYTRACE_AGENT_ARTICLE_MODEL', 'AUTOARTICLE_LLM_ARTICLE_MODEL', 'AUTOARTICLE_ARTICLE_MODEL');

if (provider === 'claude-cli' || provider === 'codex-cli') {
  const binName = provider === 'codex-cli' ? 'codex' : 'claude';
  const explicit = pick(provider === 'codex-cli' ? 'BYTRACE_CODEX_BIN' : 'BYTRACE_CLAUDE_BIN', provider === 'codex-cli' ? 'AUTOARTICLE_CODEX_BIN' : 'CLAUDE_BIN');
  const which = spawnSync('which', [explicit || binName], { encoding: 'utf8' });
  const found = which.status === 0 && which.stdout.trim();
  if (found) {
    record('ok', `主 Agent：本机 ${binName} CLI`, `${which.stdout.trim()}（无需 API key）`);
  } else {
    record(
      'warn',
      `主 Agent：找不到 ${binName} CLI`,
      `provider = ${provider}，但 PATH 里没有 ${binName}`,
      `安装 ${binName} CLI，或在 .env.local 里设 BYTRACE_${provider === 'codex-cli' ? 'CODEX' : 'CLAUDE'}_BIN 指向完整路径；\n也可以改用 API：把 BYTRACE_AGENT_PROVIDER 设为 openai-compatible 并填 BASE_URL / API_KEY / MODEL`,
    );
  }
} else {
  const missing = [];
  if (!agentBase) missing.push('BYTRACE_AGENT_BASE_URL');
  if (!agentKey) missing.push('BYTRACE_AGENT_API_KEY');
  if (!agentModel) missing.push('BYTRACE_AGENT_MODEL');
  if (missing.length === 0) {
    record('ok', `主 Agent：${provider}`, `${agentBase} · 模型 ${agentModel}${agentArticleModel ? ` · 正文 ${agentArticleModel}` : ''}`);
  } else {
    record(
      'fail',
      `主 Agent：${provider} 配置不全`,
      `缺少 ${missing.join(' / ')}`,
      '在 .env.local 补齐上面列出的变量；什么都不填则回退本机 CLI 订阅',
    );
  }
}

// ---------------------------------------------------------------------------
// 5. 审查模型（可选）
// ---------------------------------------------------------------------------
section('⑤ 审查模型（critic 评分）');

const reviewBase = pick('BYTRACE_REVIEW_BASE_URL');
const reviewKey = pick('BYTRACE_REVIEW_API_KEY');
const reviewModel = pick('BYTRACE_REVIEW_MODEL');

if (!reviewBase && !reviewKey && !reviewModel) {
  record('info', '未单独配置，继承主 Agent', '写作与审查是同一个模型（同模型自审偏松）', '想跨模型审查就填 BYTRACE_REVIEW_BASE_URL / API_KEY / MODEL');
} else if (reviewBase && reviewKey && reviewModel) {
  record('ok', '审查模型独立配置', `${reviewBase} · ${reviewModel}（跨模型审查）`);
} else {
  record(
    'warn',
    '审查模型配置不完整',
    `base=${reviewBase || '未配'} key=${reviewKey ? '已配' : '未配'} model=${reviewModel || '未配'}`,
    '三项都填，或全部留空让它继承主 Agent',
  );
}

// ---------------------------------------------------------------------------
// 6. 联网搜索（可选）
// ---------------------------------------------------------------------------
section('⑥ 联网事实搜索');

const searchProvider = pick('BYTRACE_SEARCH_PROVIDER', 'AUTOARTICLE_SEARCH_PROVIDER') || 'auto';
const doubaoKey = pick('BYTRACE_SEARCH_API_KEY', 'AUTOARTICLE_SEARCH_API_KEY');
const mimoOk =
  (pick('BYTRACE_MIMO_WEB_SEARCH', 'AUTOARTICLE_MIMO_WEB_SEARCH') || 'auto').toLowerCase() !== 'off' &&
  agentBase.includes('xiaomimimo.com') &&
  agentKey.startsWith('sk-');

if (mimoOk || doubaoKey) {
  const channels = [];
  if (mimoOk) channels.push('MiMo 自带联网插件');
  if (doubaoKey) channels.push('豆包（火山方舟）');
  record('ok', `联网搜索（provider=${searchProvider}）`, channels.join(' → ') + ' → DuckDuckGo 免密钥兜底');
} else {
  record(
    'info',
    `联网搜索：仅免密钥兜底（provider=${searchProvider}）`,
    '未配置独立搜索通道',
    '可选。用 MiMo 时去控制台开启「联网搜索」插件即可复用主 Agent 的 key；或填 BYTRACE_SEARCH_API_KEY 用豆包',
  );
}

// ---------------------------------------------------------------------------
// 7. 其它可选依赖
// ---------------------------------------------------------------------------
section('⑦ 可选依赖');

const opencli = spawnSync('which', ['opencli'], { encoding: 'utf8' });
record(
  opencli.status === 0 && opencli.stdout.trim() ? 'ok' : 'info',
  'OpenCLI（借登录浏览器抓取）',
  opencli.status === 0 && opencli.stdout.trim() ? opencli.stdout.trim() : '未安装',
  '可选。装上后抓公众号/知乎等反爬平台质量更好；不装则用本地解析或手动粘贴',
);

record(
  pick('BYTRACE_UNSPLASH_ACCESS_KEY', 'UNSPLASH_ACCESS_KEY') ? 'ok' : 'info',
  'Unsplash（免费图库补图）',
  pick('BYTRACE_UNSPLASH_ACCESS_KEY', 'UNSPLASH_ACCESS_KEY') ? '已配置' : '未配置（仅用本地素材库）',
);

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
console.log(`\n${C.bold}================ 自检结果 ================${C.reset}\n`);

const ICON = { ok: `${C.green}✓${C.reset}`, warn: `${C.yellow}!${C.reset}`, fail: `${C.red}✗${C.reset}`, info: `${C.dim}·${C.reset}` };

for (const r of results) {
  if (r.level === 'info') continue;
  console.log(`${ICON[r.level]} ${C.bold}${r.label}${C.reset}`);
  if (r.detail) console.log(`    ${C.dim}${r.detail}${C.reset}`);
  if (r.fix) {
    for (const line of r.fix.split('\n')) console.log(`    ${C.yellow}→ ${line}${C.reset}`);
  }
  console.log('');
}

const fails = results.filter((r) => r.level === 'fail').length;
const warns = results.filter((r) => r.level === 'warn').length;

if (fails === 0 && warns === 0) {
  console.log(`${C.green}${C.bold}全部就绪，可以开始写作。${C.reset}\n`);
} else if (fails === 0) {
  console.log(`${C.yellow}${C.bold}可以运行，但有 ${warns} 项建议处理。${C.reset}\n`);
} else {
  console.log(`${C.red}${C.bold}有 ${fails} 项必须先解决，否则跑不起来。${C.reset}\n`);
}

console.log(`${C.dim}详细配置状态也可以直接访问：http://127.0.0.1:3100/api/health${C.reset}\n`);

process.exit(fails > 0 ? 1 : 0);
