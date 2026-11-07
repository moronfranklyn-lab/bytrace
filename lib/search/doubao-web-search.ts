/**
 * 火山方舟（豆包）联网内容插件搜索
 *
 * 走方舟 **Responses API**：POST {baseUrl}/responses
 *   - baseUrl 默认 https://ark.cn-beijing.volces.com/api/v3
 *   - 认证：Authorization: Bearer <ARK key>
 *   - 请求体 tools: [{ type: 'web_search', max_keyword, sources? }]
 *   - 联网内容插件需在方舟控制台「服务组件库 → 联网内容插件」开通（免费开通，按搜索次数计费）
 *
 * 为什么不用 Chat Completions：方舟的 web_search 插件只挂在 Responses API 上
 * （Chat Completions 的 tools 只支持自定义函数）。
 *
 * 设计对齐 lib/search/mimo-web-search.ts：
 *   - fail-open：任何一步失败都返回 { ok:false }，不抛异常打断写作主流程
 *   - 「原料」而非「成稿」：system prompt 约束内层模型只列来源，真正的写作由主 Agent 做
 */

import type { WebFactHit } from './web-facts';
import {
  envNum,
  envStr,
  resolveDoubaoSearchConfig,
  SEARCH_MAX_KEYWORD_KEYS,
  SEARCH_MAX_RESULTS_KEYS,
  isDoubaoSearchUsable,
} from '@/lib/env';

export interface DoubaoSearchResult {
  ok: boolean;
  results: WebFactHit[];
  /** 内层模型整理的来源列表文本（可直接作素材片段） */
  answer: string;
  /** 内层模型实际执行了几轮搜索 */
  searchCount?: number;
  error?: string;
  /** 是否疑似未开通联网插件 */
  pluginDisabled?: boolean;
}

export { isDoubaoSearchUsable };

/** 可选的垂类来源。默认只搜全网。 */
const DEFAULT_SOURCES: string[] = [];

function buildWebSearchTool() {
  const maxKeyword = envNum(5, ...SEARCH_MAX_KEYWORD_KEYS);
  const sources = envStr('BYTRACE_SEARCH_SOURCES', 'AUTOARTICLE_SEARCH_SOURCES');
  const sourceList = sources
    ? sources
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_SOURCES;

  const tool: Record<string, unknown> = {
    type: 'web_search',
    max_keyword: Math.min(Math.max(1, Math.round(maxKeyword)), 50),
  };
  if (sourceList.length > 0) tool.sources = sourceList;
  return tool;
}

/**
 * 从方舟 Responses API 的返回体里抽取：
 *   - output_text（模型整理文本）
 *   - url_citation 注解（真实来源）
 *   - web_search_call 次数
 *
 * 方舟的注解形状在 Chat Completions 下是 message.annotations[].url_citation；
 * Responses 下可能出现在 output[] 的 message.content[].annotations，或顶层 output 项。
 * 这里做宽容遍历，不假设单一形状。
 */
function extractFromPayload(payload: unknown): {
  text: string;
  hits: WebFactHit[];
  searchCount: number;
} {
  const hits: WebFactHit[] = [];
  const seen = new Set<string>();
  const texts: string[] = [];
  let searchCount = 0;

  const pushHit = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const a = raw as Record<string, unknown>;
    const citation =
      (a.url_citation as Record<string, unknown> | undefined) ||
      (a.web_search as Record<string, unknown> | undefined) ||
      a;
    const url = String(citation.url || citation.link || a.url || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    hits.push({
      title: String(citation.title || citation.name || a.title || url).trim() || url,
      url,
      content: String(
        citation.summary || citation.snippet || citation.content || a.summary || a.snippet || '',
      ).trim(),
      score: 0.9,
      source: 'doubao',
    });
  };

  const walk = (node: unknown, depth = 0) => {
    if (node == null || depth > 6) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const o = node as Record<string, unknown>;

    // 搜索调用计数
    if (o.type === 'web_search_call') searchCount += 1;

    // 文本片段
    if (typeof o.output_text === 'string' && o.output_text.trim()) texts.push(o.output_text);
    if (typeof o.text === 'string' && o.text.trim() && o.type !== 'web_search_call') {
      texts.push(o.text);
    }
    // 方舟把整理好的文本放在 content[].text
    if (o.type === 'output_text' && typeof o.text === 'string') texts.push(o.text);

    // 引用
    if (Array.isArray(o.annotations)) for (const a of o.annotations) pushHit(a);
    if (o.url_citation) pushHit(o.url_citation);

    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };

  walk(payload);

  // 去重文本片段（方舟会同时给 output_text 顶层与 content 内层）
  const text = Array.from(new Set(texts.map((t) => t.trim()).filter(Boolean))).join('\n\n');
  return { text, hits, searchCount };
}

export interface DoubaoSearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖关键词上限 */
  maxKeyword?: number;
}

/**
 * 用豆包（火山方舟）联网插件搜一批真实来源。
 * fail-open：配置缺失 / 插件未开 / 超时 / 网络错，统一返回 { ok:false, error }。
 */
export async function searchWithDoubao(
  query: string,
  options: DoubaoSearchOptions = {},
): Promise<DoubaoSearchResult> {
  if (!isDoubaoSearchUsable()) {
    return {
      ok: false,
      results: [],
      answer: '',
      error:
        '豆包联网搜索未配置：请在 .env.local 填 BYTRACE_SEARCH_API_KEY（火山方舟 API Key），并到方舟控制台开通「联网内容插件」',
    };
  }

  const { baseUrl, apiKey, model } = resolveDoubaoSearchConfig();
  const maxResults = envNum(5, ...SEARCH_MAX_RESULTS_KEYS);
  const timeoutMs = options.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  const tool = buildWebSearchTool();
  if (typeof options.maxKeyword === 'number' && Number.isFinite(options.maxKeyword)) {
    tool.max_keyword = Math.min(Math.max(1, Math.round(options.maxKeyword)), 50);
  }

  const body = {
    model,
    // 内层只负责「检索 + 列来源」，成稿交给主 Agent，避免两层 AI 重复总结
    instructions:
      '你是检索执行器。只做一件事：用联网搜索找出与该主题相关的公开来源，逐条列出标题、发布时间、URL 与摘要。不要写文章，不要下结论，不要编造。找不到就写「未检索到」。',
    input: [
      {
        role: 'user',
        content: `搜索主题：${query}\n\n请列出最多 ${maxResults} 条最相关的来源。`,
      },
    ],
    tools: [tool],
    stream: false,
  };

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();

    if (!response.ok) {
      const lower = rawText.toLowerCase();
      const pluginDisabled =
        lower.includes('web_search') ||
        lower.includes('websearch') ||
        lower.includes('plugin') ||
        lower.includes('not activated') ||
        lower.includes('未开通');
      return {
        ok: false,
        results: [],
        answer: '',
        pluginDisabled,
        error: pluginDisabled
          ? `豆包联网搜索不可用：请到方舟控制台 → 服务组件库 → 联网内容插件 开通后重试。原始响应：HTTP ${response.status} ${rawText.slice(0, 300)}`
          : `豆包搜索失败：HTTP ${response.status} ${rawText.slice(0, 300)}`,
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      return { ok: false, results: [], answer: '', error: '豆包返回非 JSON' };
    }

    const { text, hits, searchCount } = extractFromPayload(payload);

    // 兜底：注解没抽到来源时，把整理文本包成一条伪来源，保证素材不丢
    if (hits.length === 0 && text) {
      hits.push({
        title: `豆包联网检索：${query}`,
        url: '',
        content: text,
        score: 0.7,
        source: 'doubao',
      });
    }

    return {
      ok: hits.length > 0,
      results: hits.slice(0, Math.max(1, maxResults)),
      answer: text,
      searchCount,
      error: hits.length === 0 ? '豆包联网检索没有返回可用来源' : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      results: [],
      answer: '',
      error: msg.includes('abort') ? '豆包搜索超时或被取消' : `豆包搜索异常：${msg}`,
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 把豆包结果折算成事实底座用的纯文本片段。
 * 与 gather 的既有素材格式保持一致（标题 / 时间 / URL / 摘要）。
 */
export function formatDoubaoHits(hits: WebFactHit[]): string {
  return hits
    .map((h, i) => {
      const lines = [`[${i + 1}] ${h.title}`];
      if (h.url) lines.push(`URL: ${h.url}`);
      if (h.content) lines.push(`摘要: ${h.content}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
