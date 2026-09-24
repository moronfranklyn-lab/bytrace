/**
 * 环境变量统一读取层（方案二 · ByTrace 分组命名）
 *
 * 设计原则：**三档兜底，永不破坏现有可用状态**。
 *
 *   新名 BYTRACE_*  →  旧名 AUTOARTICLE_*  →  更旧名 OPENAI_*  →  内置默认值
 *
 * 这样你可以：
 *   - 只填新的 BYTRACE_AGENT_* / BYTRACE_SEARCH_*，不管旧的；
 *   - 或者完全不填，继续走本机 Claude / Codex CLI 订阅；
 *   - 老的 .env.local 一个字不改也照常运行。
 *
 * 重要：本文件不 import React、不 import Next，任何服务端/脚本都能用。
 */

// ---------------------------------------------------------------------------
// 通用取值器
// ---------------------------------------------------------------------------

/** 返回第一个「非空且非纯空白」的候选值；全空返回 undefined。 */
export function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

/** 带默认值的字符串读取。 */
export function envStr(...keys: string[]): string | undefined {
  return firstNonEmpty(...keys.map((k) => process.env[k]));
}

/** 布尔读取：'1'/'true'/'on'/'yes' → true；'0'/'false'/'off'/'no' → false；其余返回 fallback。 */
export function envBool(fallback: boolean, ...keys: string[]): boolean {
  const raw = envStr(...keys);
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase();
  if (['1', 'true', 'on', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'off', 'no', 'n'].includes(v)) return false;
  return fallback;
}

/** 数值读取，非法值返回 fallback。 */
export function envNum(fallback: number, ...keys: string[]): number {
  const raw = envStr(...keys);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 去掉结尾斜杠。 */
export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// ① 主 Agent（大纲 / 正文 / 润色 / 指纹拆解 / critic / 配图打标）
// ---------------------------------------------------------------------------

export type LlmProvider = 'claude-cli' | 'codex-cli' | 'openai-compatible' | 'openai-responses';

/** BYTRACE_AGENT_* → AUTOARTICLE_LLM_* → OPENAI_* */
export const AGENT_PROVIDER_KEYS = [
  'BYTRACE_AGENT_PROVIDER',
  'AUTOARTICLE_LLM_PROVIDER',
] as const;

export const AGENT_BASE_URL_KEYS = [
  'BYTRACE_AGENT_BASE_URL',
  'AUTOARTICLE_LLM_BASE_URL',
  'OPENAI_BASE_URL',
] as const;

export const AGENT_API_KEY_KEYS = [
  'BYTRACE_AGENT_API_KEY',
  'AUTOARTICLE_LLM_API_KEY',
  'OPENAI_API_KEY',
] as const;

/** 分析类模型（指纹 / 大纲 / critic） */
export const AGENT_MODEL_KEYS = [
  'BYTRACE_AGENT_MODEL',
  'AUTOARTICLE_LLM_MODEL',
  'OPENAI_MODEL',
] as const;

/** 正文类模型（降 AI 味；不填回退到分析类模型） */
export const AGENT_ARTICLE_MODEL_KEYS = [
  'BYTRACE_AGENT_ARTICLE_MODEL',
  'AUTOARTICLE_LLM_ARTICLE_MODEL',
  'AUTOARTICLE_ARTICLE_MODEL',
] as const;

/** 本机 Claude CLI 可执行文件（留空走 PATH）。 */
export const CLAUDE_BIN_KEYS = ['BYTRACE_CLAUDE_BIN', 'CLAUDE_BIN'] as const;

/** 本机 Codex CLI 可执行文件（留空走 PATH）。 */
export const CODEX_BIN_KEYS = ['BYTRACE_CODEX_BIN', 'AUTOARTICLE_CODEX_BIN'] as const;

export const CODEX_CWD_KEYS = ['BYTRACE_CODEX_CWD', 'AUTOARTICLE_CODEX_CWD'] as const;

export const CODEX_MODEL_KEYS = [
  'BYTRACE_CODEX_MODEL',
  'AUTOARTICLE_CODEX_MODEL',
] as const;

export const CODEX_ARTICLE_MODEL_KEYS = [
  'BYTRACE_CODEX_ARTICLE_MODEL',
  'AUTOARTICLE_CODEX_ARTICLE_MODEL',
] as const;

// ---------------------------------------------------------------------------
// ①b 审查 / 调研模型（critic 评分、事实审查）
//
// 为什么要单独一组：**审稿和写作不该是同一个模型**。
// 同模型自审容易认同自己的输出；换个模型挑刺会狠很多。
// 典型配置：写作走 MiMo，审查走 DeepSeek。
//
// 兜底规则（重要）：这一组**默认继承主 Agent**。
// 也就是说你不填任何 BYTRACE_REVIEW_*，行为与改造前完全一致（critic 走主 Agent）。
// ---------------------------------------------------------------------------

export const REVIEW_PROVIDER_KEYS = [
  'BYTRACE_REVIEW_PROVIDER',
  // 故意也读 AGENT_*：允许「只换模型不换端点」
  ...AGENT_PROVIDER_KEYS,
] as const;

export const REVIEW_BASE_URL_KEYS = [
  'BYTRACE_REVIEW_BASE_URL',
  ...AGENT_BASE_URL_KEYS,
] as const;

export const REVIEW_API_KEY_KEYS = [
  'BYTRACE_REVIEW_API_KEY',
  ...AGENT_API_KEY_KEYS,
] as const;

export const REVIEW_MODEL_KEYS = [
  'BYTRACE_REVIEW_MODEL',
  ...AGENT_MODEL_KEYS,
] as const;

/** 审查组是否真的用了「另一个」模型（用于 health 提示与日志） */
export function resolveReviewConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 是否配了独立的审查端点/key/模型（false = 继承主 Agent，等同改造前） */
  isSeparate: boolean;
} {
  const dedicatedBase = envStr('BYTRACE_REVIEW_BASE_URL');
  const dedicatedKey = envStr('BYTRACE_REVIEW_API_KEY');
  const dedicatedModel = envStr('BYTRACE_REVIEW_MODEL');

  const agentBase = envStr(...AGENT_BASE_URL_KEYS) ?? '';
  const agentKey = envStr(...AGENT_API_KEY_KEYS) ?? '';
  const agentModel = envStr(...AGENT_MODEL_KEYS) ?? '';

  // 只有「审查端点与主 Agent 相同」时才允许复用它那把 key，
  // 避免把 A 家的 key 发到 B 家去。
  const effectiveBase = dedicatedBase ?? agentBase;
  const reuseAgentKey = dedicatedBase === undefined || dedicatedBase === agentBase;
  const effectiveKey = dedicatedKey ?? (reuseAgentKey ? agentKey : '');

  return {
    baseUrl: effectiveBase,
    apiKey: effectiveKey,
    model: dedicatedModel ?? agentModel,
    isSeparate: Boolean(dedicatedBase || dedicatedKey || dedicatedModel),
  };
}

// ---------------------------------------------------------------------------
// ② 联网事实搜索（compose 事实底座 + 博主名搜索）
// ---------------------------------------------------------------------------

/**
 * 搜索供应商。
 * - 'auto'（默认）：按 豆包 → MiMo → Tavily → Google CSE / DuckDuckGo 顺序，谁能用谁上
 * - 'doubao'      ：火山方舟 Responses API + web_search（推荐）
 * - 'mimo'        ：小米 MiMo web_search（复用主 Agent 的 key）
 * - 'tavily'      ：Tavily
 * - 'web-facts'   ：Google CSE / DuckDuckGo（免 key 兜底）
 */
export type SearchProvider = 'auto' | 'doubao' | 'mimo' | 'tavily' | 'web-facts';

export const SEARCH_PROVIDER_KEYS = [
  'BYTRACE_SEARCH_PROVIDER',
  'AUTOARTICLE_SEARCH_PROVIDER',
] as const;

export const SEARCH_API_KEY_KEYS = [
  'BYTRACE_SEARCH_API_KEY',
  'AUTOARTICLE_SEARCH_API_KEY',
] as const;

export const SEARCH_BASE_URL_KEYS = [
  'BYTRACE_SEARCH_BASE_URL',
  'AUTOARTICLE_SEARCH_BASE_URL',
] as const;

export const SEARCH_MODEL_KEYS = [
  'BYTRACE_SEARCH_MODEL',
  'AUTOARTICLE_SEARCH_MODEL',
] as const;

export const SEARCH_MAX_RESULTS_KEYS = [
  'BYTRACE_SEARCH_MAX_RESULTS',
  'AUTOARTICLE_SEARCH_MAX_RESULTS',
] as const;

export const SEARCH_MAX_KEYWORD_KEYS = [
  'BYTRACE_SEARCH_MAX_KEYWORD',
  'AUTOARTICLE_SEARCH_MAX_KEYWORD',
] as const;

/** 火山方舟默认端点与默认搜索模型 */
export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const ARK_DEFAULT_MODEL = 'doubao-seed-2-1-pro-260628';

// ---------------------------------------------------------------------------
// ③ 抓取 / 配图（保持原样，只是集中到这里）
// ---------------------------------------------------------------------------

export const YOUTUBE_KEY_KEYS = ['BYTRACE_YOUTUBE_API_KEY', 'YOUTUBE_DATA_API_KEY'] as const;
export const UNSPLASH_KEY_KEYS = ['BYTRACE_UNSPLASH_ACCESS_KEY', 'UNSPLASH_ACCESS_KEY'] as const;
export const TAVILY_KEY_KEYS = ['BYTRACE_TAVILY_API_KEY', 'TAVILY_API_KEY'] as const;
export const GOOGLE_CSE_KEY_KEYS = ['BYTRACE_GOOGLE_CSE_KEY', 'GOOGLE_CSE_KEY'] as const;
export const GOOGLE_CSE_ID_KEYS = ['BYTRACE_GOOGLE_CSE_ID', 'GOOGLE_CSE_ID'] as const;

// ---------------------------------------------------------------------------
// ④ 客户端化（方案三预留）
// ---------------------------------------------------------------------------

/** 数据目录。留空 → 回退 <cwd>/data（保持现状）。方案三会把它默认指向 ~/Library/Application Support/ByTrace */
export const DATA_DIR_KEYS = ['BYTRACE_DATA_DIR'] as const;

/** 服务端口。留空 → 3100 */
export const PORT_KEYS = ['BYTRACE_PORT'] as const;

// ---------------------------------------------------------------------------
// 派生视图（给 /api/health 与 doctor 自检用）
// ---------------------------------------------------------------------------

export interface AgentConfigView {
  provider: LlmProvider | 'unknown';
  baseUrl: string | undefined;
  hasApiKey: boolean;
  model: string | undefined;
  articleModel: string | undefined;
  /** 是否走本机 CLI（无需 key） */
  isLocalCli: boolean;
  /** 是否指向小米 MiMo（决定 web_search 插件能否复用主 Agent 的 key） */
  isMimo: boolean;
  /** 审查/调研模型端点 */
  reviewBaseUrl: string | undefined;
  /** 审查模型名 */
  reviewModel: string | undefined;
  /** 审查模型是否独立于主 Agent（true = 跨模型互审） */
  reviewIsSeparate: boolean;
  /** 审查模型是否具备可用 key */
  reviewHasApiKey: boolean;
}

export interface SearchConfigView {
  provider: SearchProvider;
  baseUrl: string | undefined;
  hasApiKey: boolean;
  model: string | undefined;
  maxResults: number;
  /** 豆包（火山方舟）是否具备可用配置 */
  doubaoReady: boolean;
  /** MiMo 是否具备可用配置 */
  mimoReady: boolean;
  /** Tavily 是否配了 key */
  tavilyReady: boolean;
  /** Google CSE 是否配齐 */
  googleCseReady: boolean;
  /** 免 key 兜底是否可用（永远可用） */
  webFactsFallbackReady: boolean;
}

function readProvider(): LlmProvider | 'unknown' {
  const raw = (envStr(...AGENT_PROVIDER_KEYS) ?? 'claude-cli').toLowerCase();
  if (!raw || raw === 'claude' || raw === 'claude-cli') return 'claude-cli';
  if (raw === 'codex' || raw === 'codex-cli') return 'codex-cli';
  if (
    ['api', 'local-api', 'local-openai', 'openai-compatible', 'lmstudio', 'lm-studio', 'ollama'].includes(
      raw,
    )
  ) {
    return 'openai-compatible';
  }
  if (['openai', 'responses', 'openai-responses', 'responses-api'].includes(raw)) {
    return 'openai-responses';
  }
  return 'unknown';
}

function readSearchProvider(): SearchProvider {
  const raw = (envStr(...SEARCH_PROVIDER_KEYS) ?? 'auto').toLowerCase();
  if (['auto', 'doubao', 'mimo', 'tavily', 'web-facts'].includes(raw)) {
    return raw as SearchProvider;
  }
  return 'auto';
}

/** 豆包搜索：有专用 key，或退回复用主 Agent 的 key（当主 Agent 就在方舟上）。 */
export function resolveDoubaoSearchConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  const baseUrl = trimSlash(envStr(...SEARCH_BASE_URL_KEYS) ?? ARK_DEFAULT_BASE_URL);
  // 专用 key 优先；否则当主 Agent 端点是方舟时复用主 Agent key
  const dedicated = envStr(...SEARCH_API_KEY_KEYS);
  const agentBase = envStr(...AGENT_BASE_URL_KEYS) ?? '';
  const reuseAgent = agentBase.includes('volces.com') || agentBase.includes('ark.cn-beijing');
  const apiKey = dedicated ?? (reuseAgent ? envStr(...AGENT_API_KEY_KEYS) ?? '' : '');
  const model = envStr(...SEARCH_MODEL_KEYS) ?? ARK_DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

/** MiMo 搜索：复用主 Agent 配置（MiMo 的 web_search 挂在对话模型上）。 */
export function resolveMimoSearchConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  const baseUrl = trimSlash(envStr(...AGENT_BASE_URL_KEYS) ?? 'https://api.xiaomimimo.com/v1');
  const apiKey = envStr(...AGENT_API_KEY_KEYS) ?? '';
  const model = envStr(...AGENT_MODEL_KEYS) ?? 'mimo-v2.5-pro';
  return { baseUrl, apiKey, model };
}

/** MiMo web_search 插件开关（auto / 1 / 0） */
export function mimoWebSearchFlag(): 'auto' | 'on' | 'off' {
  const raw = (envStr('BYTRACE_MIMO_WEB_SEARCH', 'AUTOARTICLE_MIMO_WEB_SEARCH') ?? 'auto').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(raw)) return 'off';
  if (['1', 'true', 'on', 'yes'].includes(raw)) return 'on';
  return 'auto';
}

export function isMimoWebSearchUsable(): boolean {
  const flag = mimoWebSearchFlag();
  if (flag === 'off') return false;
  const { baseUrl, apiKey } = resolveMimoSearchConfig();
  if (baseUrl.includes('token-plan')) return false;
  if (!apiKey.startsWith('sk-')) return false;
  return baseUrl.includes('xiaomimimo.com');
}

export function isDoubaoSearchUsable(): boolean {
  const { apiKey } = resolveDoubaoSearchConfig();
  return apiKey.trim().length > 0;
}

export function getAgentConfigView(): AgentConfigView {
  const provider = readProvider();
  const baseUrl = envStr(...AGENT_BASE_URL_KEYS);
  const apiKey = envStr(...AGENT_API_KEY_KEYS);
  const model = envStr(...AGENT_MODEL_KEYS);
  const articleModel = envStr(...AGENT_ARTICLE_MODEL_KEYS);
  const review = resolveReviewConfig();
  return {
    provider,
    baseUrl,
    hasApiKey: Boolean(apiKey),
    model,
    articleModel,
    isLocalCli: provider === 'claude-cli' || provider === 'codex-cli',
    isMimo: Boolean(baseUrl && baseUrl.includes('xiaomimimo.com')),
    reviewBaseUrl: review.baseUrl || undefined,
    reviewModel: review.model || undefined,
    reviewIsSeparate: review.isSeparate,
    reviewHasApiKey: Boolean(review.apiKey),
  };
}

export function getSearchConfigView(): SearchConfigView {
  const doubao = resolveDoubaoSearchConfig();
  const provider = readSearchProvider();
  const baseUrl = envStr(...SEARCH_BASE_URL_KEYS);
  const apiKey = envStr(...SEARCH_API_KEY_KEYS);
  return {
    provider,
    baseUrl,
    hasApiKey: Boolean(apiKey),
    model: envStr(...SEARCH_MODEL_KEYS),
    maxResults: envNum(5, ...SEARCH_MAX_RESULTS_KEYS),
    doubaoReady: isDoubaoSearchUsable(),
    mimoReady: isMimoWebSearchUsable(),
    tavilyReady: Boolean(envStr(...TAVILY_KEY_KEYS)),
    googleCseReady: Boolean(envStr(...GOOGLE_CSE_KEY_KEYS) && envStr(...GOOGLE_CSE_ID_KEYS)),
    webFactsFallbackReady: true,
  };
}
