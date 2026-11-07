import { NextRequest } from 'next/server';
import { searchWithMimo, isMimoWebSearchConfigured } from '@/lib/search/mimo-web-search';
import { searchWithDoubao, isDoubaoSearchUsable } from '@/lib/search/doubao-web-search';
import { searchWebFacts } from '@/lib/search/web-facts';
import { envStr, getSearchConfigView } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/health/search?q=关键词
 *
 * 联通性自检：**真的去打一次联网搜索**，把每条通道的结果数量与耗时回报给你。
 * 用途：填完 key 之后确认「联网搜索到底通没通」，不用等到写文章时才发现不行。
 *
 * 与 /api/health 的区别：
 *   /api/health        只检查「配了没有」（不发网络请求，秒回）
 *   /api/health/search 真的发请求（会花掉一次搜索额度，十几秒）
 *
 * 设计：逐条通道独立试，任一通就返回；不会因为一条失败而整体报错。
 * 输出**不含任何密钥**。
 */

interface ProbeResult {
  provider: string;
  label: string;
  attempted: boolean;
  ok: boolean;
  hitCount: number;
  elapsedMs: number;
  /** 失败原因（已脱敏） */
  error?: string;
  /** 是否命中"插件没开"这类可操作的原因 */
  pluginDisabled?: boolean;
  /** 前几条来源标题（只给标题与域名，不给全文） */
  samples: Array<{ title: string; host: string }>;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url ? '(非标准 URL)' : '';
  }
}

function samplesOf(hits: Array<{ title: string; url: string }>): Array<{ title: string; host: string }> {
  return hits.slice(0, 3).map((h) => ({
    title: h.title.slice(0, 60),
    host: safeHost(h.url),
  }));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim() || '2026 年 AI 产品经理 行业趋势';
  const view = getSearchConfigView();

  const preferred = (
    envStr('BYTRACE_SEARCH_PROVIDER', 'AUTOARTICLE_SEARCH_PROVIDER') || 'auto'
  ).toLowerCase();

  const probes: ProbeResult[] = [];

  const run = async (
    provider: string,
    label: string,
    configured: boolean,
    fn: () => Promise<{ ok: boolean; hits: Array<{ title: string; url: string }>; error?: string; pluginDisabled?: boolean }>,
  ) => {
    if (!configured) {
      probes.push({
        provider,
        label,
        attempted: false,
        ok: false,
        hitCount: 0,
        elapsedMs: 0,
        error: '未配置：缺 key 或未满足启用条件',
        samples: [],
      });
      return;
    }
    const t0 = Date.now();
    try {
      const r = await fn();
      probes.push({
        provider,
        label,
        attempted: true,
        ok: r.ok,
        hitCount: r.hits.length,
        elapsedMs: Date.now() - t0,
        error: r.error,
        pluginDisabled: r.pluginDisabled,
        samples: samplesOf(r.hits),
      });
    } catch (err) {
      probes.push({
        provider,
        label,
        attempted: true,
        ok: false,
        hitCount: 0,
        elapsedMs: Date.now() - t0,
        error: (err as Error).message,
        samples: [],
      });
    }
  };

  // ① MiMo（复用主 Agent 的 key，默认首选）
  await run('mimo', 'MiMo web_search（复用主 Agent key）', isMimoWebSearchConfigured(), async () => {
    const r = await searchWithMimo(q, { timeoutMs: 100_000 });
    return { ok: r.ok, hits: r.results, error: r.error, pluginDisabled: r.pluginDisabled };
  });

  // ② 豆包（火山方舟）
  await run('doubao', '豆包（火山方舟联网内容插件）', isDoubaoSearchUsable(), async () => {
    const r = await searchWithDoubao(q, { timeoutMs: 100_000 });
    return { ok: r.ok, hits: r.results, error: r.error, pluginDisabled: r.pluginDisabled };
  });

  // ③ 免 key 兜底
  await run('web-facts', 'Google CSE / DuckDuckGo（免 key）', true, async () => {
    const hits = await searchWebFacts(q);
    return { ok: hits.length > 0, hits, error: hits.length === 0 ? '没搜到结果' : undefined };
  });

  const firstOk = probes.find((p) => p.ok);
  const anyConfigured = probes.some((p) => p.attempted);

  return Response.json({
    ok: Boolean(firstOk),
    query: q,
    preferred_provider: preferred,
    /** 实际会用的那条通道（第一个探测成功的） */
    effective_provider: firstOk?.provider ?? null,
    summary: firstOk
      ? `联网搜索可用，走「${firstOk.label}」，命中 ${firstOk.hitCount} 条`
      : anyConfigured
        ? '所有已配置的通道都没搜到结果，见 probes 里的 error'
        : '没有任何联网搜索通道处于已配置状态',
    config: {
      doubao_ready: view.doubaoReady,
      mimo_ready: view.mimoReady,
      tavily_ready: view.tavilyReady,
      google_cse_ready: view.googleCseReady,
      web_facts_fallback_ready: view.webFactsFallbackReady,
    },
    probes,
    note:
      'MiMo 与豆包都是「模型自带联网工具」，返回的是整理后的结果加引用；' +
      'web-facts 走的是传统搜索引擎抓取。三条通道互相独立，任一可用即可。',
  });
}
