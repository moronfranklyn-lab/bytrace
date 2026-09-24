import { existsSync } from 'node:fs';
import { getAgentConfigView, getSearchConfigView, envStr, DATA_DIR_KEYS } from '@/lib/env';
import { CLAUDE_BIN, CLAUDE_BIN_CANDIDATES } from '@/lib/claude';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * 一条请求回答「现在到底配好了没有、哪儿没配」。
 * 设计原则：
 *   - **只报告状态，不回显任何密钥**（只给 true/false 与变量名）
 *   - 永远返回 200：即使某项不可用，也是「可诊断的信息」而不是请求失败
 *   - `ok` 表示「主 Agent 通道可用」，这是工具能不能干活的最低门槛
 *
 * 供前端首次运行向导 / doctor 脚本 / 排错使用。
 */

type Status = 'ready' | 'missing' | 'unavailable' | 'not-needed';

interface CheckItem {
  key: string;
  label: string;
  status: Status;
  /** 人类可读的当前值（绝不包含密钥本体） */
  detail: string;
  /** 没配好时：怎么修 */
  fix?: string;
}

function cliExists(cmd: string): boolean {
  if (cmd === 'claude' || cmd === 'codex') return true; // 交给 PATH 判断
  return existsSync(cmd);
}

export async function GET() {
  const agent = getAgentConfigView();
  const search = getSearchConfigView();

  const checks: CheckItem[] = [];

  // ---- ① 主 Agent ----
  if (agent.isLocalCli) {
    const cliPath = agent.provider === 'codex-cli'
      ? (envStr('BYTRACE_CODEX_BIN', 'AUTOARTICLE_CODEX_BIN') || 'codex')
      : CLAUDE_BIN;
    const exists = cliExists(cliPath);
    checks.push({
      key: 'agent',
      label: `主 Agent（${agent.provider}）`,
      status: exists ? 'ready' : 'unavailable',
      detail: exists
        ? `走本机 CLI：${cliPath}（无需 API key）`
        : `找不到可执行文件：${cliPath}`,
      fix: exists
        ? undefined
        : `安装对应 CLI，或在 .env.local 设 BYTRACE_${agent.provider === 'codex-cli' ? 'CODEX' : 'CLAUDE'}_BIN 指向完整路径`,
    });
  } else {
    const ready = Boolean(agent.baseUrl && agent.hasApiKey && agent.model);
    const missing: string[] = [];
    if (!agent.baseUrl) missing.push('BYTRACE_AGENT_BASE_URL');
    if (!agent.hasApiKey) missing.push('BYTRACE_AGENT_API_KEY');
    if (!agent.model) missing.push('BYTRACE_AGENT_MODEL');
    checks.push({
      key: 'agent',
      label: `主 Agent（${agent.provider}）`,
      status: ready ? 'ready' : 'missing',
      detail: ready
        ? `${agent.baseUrl} · 模型 ${agent.model}${agent.articleModel ? ` · 正文模型 ${agent.articleModel}` : ''}`
        : `缺少：${missing.join(' / ')}`,
      fix: ready ? undefined : '在 .env.local 补齐上面列出的变量（不填则回退本机 CLI 订阅）',
    });
  }

  // ---- ② 联网事实搜索 ----
  // 有效供应商：BYTRACE_SEARCH_PROVIDER 若为具体值就直接用；若为 auto 则按
  // MiMo（复用主 Agent key，无需额外账号）→ 豆包 → Tavily → 免 key 兜底 推导。
  const searchCandidates: string[] = [];
  if (search.mimoReady) searchCandidates.push('MiMo');
  if (search.doubaoReady) searchCandidates.push('豆包（火山方舟）');
  if (search.tavilyReady) searchCandidates.push('Tavily');
  if (search.googleCseReady) searchCandidates.push('Google CSE');
  searchCandidates.push('DuckDuckGo（免 key 兜底）');

  const effectiveProvider =
    search.provider !== 'auto'
      ? search.provider
      : search.mimoReady
        ? 'mimo'
        : search.doubaoReady
          ? 'doubao'
          : search.tavilyReady
            ? 'tavily'
            : 'web-facts';

  const hasRealSearch = search.mimoReady || search.doubaoReady || search.tavilyReady;

  checks.push({
    key: 'search',
    label: `联网事实搜索（provider=${effectiveProvider}）`,
    status: hasRealSearch ? 'ready' : 'not-needed',
    detail: hasRealSearch
      ? `可用通道：${searchCandidates.join(' → ')} · 实际走 ${effectiveProvider}`
      : `可用通道：${searchCandidates.join(' → ')}`,
    fix: hasRealSearch
      ? undefined
      : '可选。不配会走免 key 的 DuckDuckGo。' +
        (agent.isMimo
          ? '你用的是 MiMo —— 去 https://platform.xiaomimimo.com/#/console/plugin 开启「联网搜索」插件即可，无需额外 key'
          : '想用豆包请填 BYTRACE_SEARCH_API_KEY 并到方舟控制台开通「联网内容插件」'),
  });

  // ---- ③ 数据库 ----
  let dbDetail = '未检查';
  let dbStatus: Status = 'unavailable';
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM authors)        AS authors,
           (SELECT COUNT(*) FROM fingerprints)   AS fingerprints,
           (SELECT COUNT(*) FROM articles)       AS articles`,
      )
      .get() as { authors: number; fingerprints: number; articles: number } | undefined;
    dbStatus = 'ready';
    dbDetail = row
      ? `作者 ${row.authors} · 指纹 ${row.fingerprints} · 文章 ${row.articles}`
      : '已连接';
  } catch (err) {
    dbDetail = `打不开：${(err as Error).message}`;
  }
  checks.push({
    key: 'database',
    label: 'SQLite 数据库',
    status: dbStatus,
    detail: dbDetail,
    fix: dbStatus === 'ready' ? undefined : '检查 data/ 目录写权限；数据库会在首次 getDb() 时自动创建',
  });

  // ---- ④ 数据目录位置 ----
  const dataDirOverride = envStr(...DATA_DIR_KEYS);
  checks.push({
    key: 'data_dir',
    label: '数据目录',
    status: 'ready',
    detail: dataDirOverride
      ? `${dataDirOverride}（来自 BYTRACE_DATA_DIR）`
      : `${process.cwd()}/data（默认；可在 .env.local 用 BYTRACE_DATA_DIR 改到标准位置）`,
  });

  // ---- ⑤ 配图（可选） ----
  checks.push({
    key: 'images',
    label: '配图（可选）',
    status: searchCandidates.length > 0 ? 'ready' : 'not-needed',
    detail: envStr('BYTRACE_UNSPLASH_ACCESS_KEY', 'UNSPLASH_ACCESS_KEY')
      ? '本地素材库 + Unsplash 已启用'
      : '仅本地素材库（未配 Unsplash，免费图库来源自动禁用）',
    fix: envStr('BYTRACE_UNSPLASH_ACCESS_KEY', 'UNSPLASH_ACCESS_KEY')
      ? undefined
      : '可选。想用免费图库请填 BYTRACE_UNSPLASH_ACCESS_KEY',
  });

  const agentCheck = checks.find((c) => c.key === 'agent');
  const dbCheck = checks.find((c) => c.key === 'database');
  const ok = agentCheck?.status === 'ready' && dbCheck?.status === 'ready';

  return Response.json({
    ok,
    checked_at: new Date().toISOString(),
    summary: ok
      ? '主 Agent 与数据库均就绪，可以开始写作'
      : '有必填项未就绪，见 checks 里的 fix 提示',
    checks,
    debug: {
      cwd: process.cwd(),
      node: process.version,
      claude_bin_resolved: CLAUDE_BIN,
      claude_bin_candidates: CLAUDE_BIN_CANDIDATES,
      agent_provider: agent.provider,
      agent_is_local_cli: agent.isLocalCli,
      agent_is_mimo: agent.isMimo,
      search_provider: search.provider,
      search_doubao_ready: search.doubaoReady,
      search_mimo_ready: search.mimoReady,
    },
  });
}
