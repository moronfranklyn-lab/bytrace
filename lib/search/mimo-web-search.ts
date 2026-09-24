/**
 * 小米 MiMo 联网搜索（事实底座）
 *
 * 文档：https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/tool-calling/web-search
 * 前置：控制台开启「联网搜索插件」https://platform.xiaomimimo.com/#/console/plugin
 * 仅按量计费 sk- key + https://api.xiaomimimo.com/v1 可用；Token Plan (tp-) 通常不可用。
 */

export interface MimoSearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
  source: 'mimo';
}

export interface MimoWebSearchResult {
  ok: boolean;
  results: MimoSearchHit[];
  /** 模型结合搜索给出的整理文本（可直接作素材片段） */
  answer: string;
  /** 用量明细（若有） */
  usage?: { tool_usage?: number; page_usage?: number };
  error?: string;
  /** 是否因账号未开插件而失败 */
  pluginDisabled?: boolean;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 当前 LLM 配置是否指向 MiMo 直连 API（可挂 web_search） */
export function isMimoWebSearchConfigured(): boolean {
  const flag = (process.env.AUTOARTICLE_MIMO_WEB_SEARCH || 'auto').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'on') return true;

  const base = (
    process.env.AUTOARTICLE_LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    ''
  ).toLowerCase();
  const key = process.env.AUTOARTICLE_LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  // Token Plan 端点通常不支持 web_search
  if (base.includes('token-plan')) return false;
  if (!key.startsWith('sk-')) return false;
  return base.includes('xiaomimimo.com');
}

export function buildMimoWebSearchTool() {
  const maxKeyword = Number(process.env.AUTOARTICLE_MIMO_MAX_KEYWORD || 3) || 3;
  const limit = Number(process.env.AUTOARTICLE_MIMO_SEARCH_LIMIT || 5) || 5;
  const force =
    (process.env.AUTOARTICLE_MIMO_FORCE_SEARCH || 'true').trim().toLowerCase() !== 'false';

  return {
    type: 'web_search' as const,
    max_keyword: maxKeyword,
    force_search: force,
    limit,
    user_location: {
      type: 'approximate' as const,
      country: process.env.AUTOARTICLE_MIMO_SEARCH_COUNTRY || 'China',
      region: process.env.AUTOARTICLE_MIMO_SEARCH_REGION || 'Beijing',
      city: process.env.AUTOARTICLE_MIMO_SEARCH_CITY || 'Beijing',
    },
  };
}

function resolveMimoEndpoint(): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = trimSlash(
    process.env.AUTOARTICLE_LLM_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.xiaomimimo.com/v1',
  );
  const apiKey = process.env.AUTOARTICLE_LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  const model =
    process.env.AUTOARTICLE_LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    'mimo-v2.5-pro';
  return { baseUrl, apiKey, model };
}

function extractHitsFromAnnotations(annotations: unknown): MimoSearchHit[] {
  if (!Array.isArray(annotations)) return [];
  const hits: MimoSearchHit[] = [];
  for (const raw of annotations) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    // 兼容多种 annotation 形状：url_citation / web_search / 扁平字段
    const citation =
      (a.url_citation as Record<string, unknown> | undefined) ||
      (a.web_search as Record<string, unknown> | undefined) ||
      a;
    const url = String(citation.url || citation.link || a.url || '').trim();
    if (!url) continue;
    const title = String(citation.title || citation.name || a.title || url).trim();
    const content = String(
      citation.content ||
        citation.snippet ||
        citation.summary ||
        a.content ||
        a.snippet ||
        '',
    ).trim();
    hits.push({
      title: title || url,
      url,
      content,
      score: 0.9,
      source: 'mimo',
    });
  }
  // 按 URL 去重
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (seen.has(h.url)) return false;
    seen.add(h.url);
    return true;
  });
}

/**
 * 用 MiMo web_search 拉一批评实来源，并拿一段带引用的整理文本。
 */
export async function searchWithMimo(
  query: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<MimoWebSearchResult> {
  if (!isMimoWebSearchConfigured()) {
    return {
      ok: false,
      results: [],
      answer: '',
      error: 'MiMo 联网搜索未启用或未配置（需 sk- key + api.xiaomimimo.com）',
    };
  }

  const { baseUrl, apiKey, model } = resolveMimoEndpoint();
  if (!apiKey) {
    return { ok: false, results: [], answer: '', error: '缺少 AUTOARTICLE_LLM_API_KEY' };
  }

  const timeoutMs = options?.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是写作研究助手。请基于联网搜索结果，只输出可核验的事实、数据、案例与来源，不要编造。',
      },
      {
        role: 'user',
        content: `请联网搜索并整理与下列主题相关的硬事实素材（优先近 1-2 年公开信息）。\n\n主题：${query}\n\n输出要求：\n1. 分条列出事实/数据/案例，每条尽量带来源标题与 URL\n2. 标清时间与口径\n3. 找不到就写「未检索到」，禁止编造`,
      },
    ],
    max_completion_tokens: 2048,
    stream: false,
    thinking: { type: 'disabled' },
    tools: [buildMimoWebSearchTool()],
    tool_choice: 'auto',
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      const pluginDisabled =
        rawText.includes('webSearchEnabled is false') ||
        rawText.toLowerCase().includes('web search') && rawText.includes('false');
      return {
        ok: false,
        results: [],
        answer: '',
        pluginDisabled,
        error: pluginDisabled
          ? 'MiMo 联网搜索插件未开启：请到 https://platform.xiaomimimo.com/#/console/plugin 打开「联网搜索」，等待约 5 分钟生效'
          : `MiMo 搜索失败：HTTP ${response.status} ${rawText.slice(0, 300)}`,
      };
    }

    let data: {
      choices?: Array<{
        message?: {
          content?: string | null;
          annotations?: unknown;
          error_message?: string;
        };
      }>;
      usage?: { web_search_usage?: { tool_usage?: number; page_usage?: number } };
    };
    try {
      data = JSON.parse(rawText) as typeof data;
    } catch {
      return { ok: false, results: [], answer: '', error: 'MiMo 返回非 JSON' };
    }

    const message = data.choices?.[0]?.message;
    const answer = (message?.content || '').trim();
    const results = extractHitsFromAnnotations(message?.annotations);
    const usage = data.usage?.web_search_usage;

    if (message?.error_message) {
      console.warn('[mimo-web-search] error_message:', message.error_message);
    }

    return {
      ok: results.length > 0 || answer.length > 0,
      results,
      answer,
      usage,
      error: message?.error_message,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      results: [],
      answer: '',
      error: msg.includes('abort') ? 'MiMo 搜索超时或被取消' : `MiMo 搜索异常：${msg}`,
    };
  } finally {
    clearTimeout(timer);
    if (options?.signal) options.signal.removeEventListener('abort', onAbort);
  }
}
