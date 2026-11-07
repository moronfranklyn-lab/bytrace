import { adapter as zhihu } from './adapters/zhihu';
import { adapter as sspai } from './adapters/sspai';
import { adapter as uisdc } from './adapters/uisdc';
import { adapter as bilibili } from './adapters/bilibili';
import { adapter as youtube } from './adapters/youtube';
import { adapter as xiaohongshu } from './adapters/xiaohongshu';
import { adapter as woshipm } from './adapters/woshipm';
import { adapter as generic } from './adapters/generic';
import {
  isWechatHost,
  wechatRejection,
  wechatUrlTypeInfo,
  crawlWechatViaApify,
} from './wechat';
import { hashUrl, normalizeUrl } from './dedupe';
import { fetchHtml } from './http';
import { findNextPageUrl } from './pagination';
import type {
  CrawledArticle,
  CrawledAuthorIndex,
  CrawlError,
  SiteAdapter,
  UrlTypeInfo,
} from './types';

export type { CrawledArticle, CrawledAuthorIndex, CrawlError, UrlTypeInfo, SiteAdapter };
export { isCrawlError } from './types';
export { hashUrl, normalizeUrl };

/**
 * 站点适配器路由表。
 * 顺序：先专门适配器（命中 host 才走），再 generic 兜底。
 * Agent I 加入 bilibili / youtube 两个视频站。
 */
const SPECIFIC_ADAPTERS: SiteAdapter[] = [zhihu, sspai, uisdc, bilibili, youtube, xiaohongshu, woshipm];

/** host → medium 推断表，detectUrlType 用。 */
function inferMediumByHost(host: string): 'text' | 'video' | 'mixed' {
  if (/(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be)$/i.test(host)) {
    return 'video';
  }
  return 'text';
}

/** 解析 URL，失败返回 null。 */
function safeParse(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/**
 * URL 类型识别（只看 host，不发请求）。
 */
export function detectUrlType(url: string): UrlTypeInfo {
  const parsed = safeParse(url);
  if (!parsed) {
    return {
      platform: 'unknown',
      is_wechat: false,
      is_supported_for_crawl: false,
      hint: '这个链接不太对劲，再检查一下？',
    };
  }
  if (isWechatHost(parsed.hostname)) {
    return wechatUrlTypeInfo();
  }
  for (const ad of SPECIFIC_ADAPTERS) {
    if (ad.matches(parsed)) {
      return {
        platform: ad.platform,
        is_wechat: false,
        is_supported_for_crawl: true,
        hint: null,
        medium: inferMediumByHost(parsed.hostname),
      };
    }
  }
  return {
    platform: 'unknown',
    is_wechat: false,
    is_supported_for_crawl: true,
    hint: '这个站点没有专门适配，会用通用正文提取，可能漏点东西',
    medium: inferMediumByHost(parsed.hostname),
  };
}

/**
 * 单篇文章爬取，失败时返回 CrawlError。
 * 路由顺序：公众号拒绝 → 专门适配器 → generic 兜底。
 */
export async function crawlArticle(url: string): Promise<CrawledArticle | CrawlError> {
  const parsed = safeParse(url);
  if (!parsed) {
    return { reason: 'unsupported', message: '这个链接格式不对，我读不出来' };
  }
  if (isWechatHost(parsed.hostname)) {
    const r = await crawlWechatViaApify(parsed);
    return attachMedium(r, parsed.hostname);
  }
  for (const ad of SPECIFIC_ADAPTERS) {
    if (ad.matches(parsed)) {
      const r = await ad.crawlArticle(parsed);
      return attachMedium(r, parsed.hostname);
    }
  }
  const r = await generic.crawlArticle(parsed);
  return attachMedium(r, parsed.hostname);
}

/** 给 crawlArticle 的结果补上 medium 字段（如适配器没设置）。 */
function attachMedium(
  r: CrawledArticle | CrawlError,
  host: string,
): CrawledArticle | CrawlError {
  if ('reason' in r) return r;
  if (!r.medium) {
    r.medium = inferMediumByHost(host);
  }
  return r;
}

/**
 * 判断一个 URL 是「单篇文章」还是「主页/板块/作者页」。
 *
 * 决策顺序：
 *   1. 命中 adapter.urlKind() 返回 article/index 时直接采纳
 *   2. 通用启发式兜底：
 *      - path 末尾 `.html` / `.htm` → article
 *      - path 含 `/post/数字`、`/p/数字`、`/article/数字`、`/video/BV` → article
 *      - host 是 space.<x>.com 或 path 是 /u/数字、/people/<slug>、/author/<slug>、/column/<slug> → index
 *      - 其余返回 'unknown'
 *
 * 返回 unknown 时调用方应让用户自己选——别瞎猜。
 */
export function detectUrlKind(urlStr: string): 'article' | 'index' | 'unknown' {
  const parsed = safeParse(urlStr);
  if (!parsed) return 'unknown';

  // adapter 优先
  for (const ad of SPECIFIC_ADAPTERS) {
    if (ad.matches(parsed) && ad.urlKind) {
      const kind = ad.urlKind(parsed);
      if (kind !== 'unknown') return kind;
    }
  }

  // 通用启发式
  const path = parsed.pathname;
  if (/\.html?$/i.test(path)) return 'article';
  if (/\/(post|p|article)\/\d+/i.test(path)) return 'article';
  if (/\/video\/(BV|AV)/i.test(path)) return 'article';
  if (/(^|\.)space\./i.test(parsed.hostname)) return 'index';
  if (/^\/u\/\d+/.test(path)) return 'index';
  if (/^\/(people|author|column|user|profile)\//i.test(path)) return 'index';
  if (path === '/' || path === '') return 'index';
  return 'unknown';
}

/**
 * 作者主页文章列表爬取。
 * 仅在专门适配器实现了 crawlAuthorIndex 时支持；否则返回 unsupported。
 *
 * 翻页：拿到第 1 页后，用 lib/crawler/pagination.ts 嗅探下一页 URL，
 * 跟进继续调同一个 adapter 的 crawlAuthorIndex。护栏：最多 5 页、
 * 累计 20 条 article_urls 就停、嗅不到下一页就停、本页没新 URL 就停。
 * 翻页只对 HTTP 类站点生效；Apify 类的 adapter（小红书 / B 站）已在内部
 * 一次性返回大批结果，跳过外层翻页。
 */
export async function crawlAuthorIndex(
  url: string,
  options: {
    maxPages?: number;
    maxArticles?: number;
    /**
     * 已知 url_hash 集合（PATCH 加样本时传入）。翻页时把这些 URL 当"已见"，
     * 不计入 maxArticles 配额——确保拿到足够多的**新** URL 才停。
     */
    skipHashes?: Set<string>;
  } = {},
): Promise<CrawledAuthorIndex | CrawlError> {
  const parsed = safeParse(url);
  if (!parsed) {
    return { reason: 'unsupported', message: '这个链接格式不对，我读不出来' };
  }
  if (isWechatHost(parsed.hostname)) {
    return wechatRejection();
  }

  const adapter = SPECIFIC_ADAPTERS.find((ad) => ad.matches(parsed) && ad.crawlAuthorIndex);
  if (!adapter || !adapter.crawlAuthorIndex) {
    return {
      reason: 'unsupported',
      message: '这个站点的作者页我还不会爬，先一篇一篇贴吧',
    };
  }

  const maxPages = options.maxPages ?? 5;
  const maxArticles = options.maxArticles ?? 20;
  const skipHashes = options.skipHashes ?? new Set<string>();

  // Apify / 内部一次性 API 的 adapter 不再外层翻页
  // youtube 的 crawlAuthorIndex 是一次性 Data API 返回，翻页只会白烧一轮配额
  const skipPagination =
    adapter.id === 'xiaohongshu' || adapter.id === 'bilibili' || adapter.id === 'youtube';

  const first = await adapter.crawlAuthorIndex(parsed);
  if ('reason' in first) return first;

  // 全量收集到的 URL（保留顺序，便于稳定性）
  const collectedAll: string[] = [];
  const collectedSet = new Set<string>();
  // 真正算"新"的 URL 数——跳过 skipHashes 的不计
  const countNew = (): number => {
    let n = 0;
    for (const u of collectedAll) {
      if (!skipHashes.has(hashUrl(u))) n++;
    }
    return n;
  };
  const addAll = (urls: string[]): number => {
    let added = 0;
    for (const u of urls) {
      if (collectedSet.has(u)) continue;
      collectedSet.add(u);
      collectedAll.push(u);
      added++;
    }
    return added;
  };
  // 返回前按"新 URL 计数到上限"截断：maxArticles 不只控制停止翻页，
  // 也约束返回值——超额的新 URL 丢掉；skipHashes 里的旧 URL 不占配额、原样保留
  const truncateToMax = (urls: string[]): string[] => {
    const out: string[] = [];
    let newCount = 0;
    for (const u of urls) {
      const isNew = !skipHashes.has(hashUrl(u));
      if (isNew && newCount >= maxArticles) continue;
      out.push(u);
      if (isNew) newCount++;
    }
    return out;
  };

  addAll(first.article_urls);
  let lastPageUrl = url;

  if (skipPagination || countNew() >= maxArticles) {
    return { ...first, article_urls: truncateToMax(collectedAll) };
  }

  for (let page = 2; page <= maxPages; page++) {
    if (countNew() >= maxArticles) break;

    let html: string | null = null;
    try {
      const res = await fetchHtml(lastPageUrl);
      if (typeof res === 'string') html = res;
    } catch {/* ignore */}
    if (!html) break;

    const nextUrl = findNextPageUrl(html, lastPageUrl);
    if (!nextUrl || nextUrl === lastPageUrl) break;

    const nextParsed = safeParse(nextUrl);
    if (!nextParsed || !adapter.matches(nextParsed)) break;

    const nextResult = await adapter.crawlAuthorIndex(nextParsed);
    if ('reason' in nextResult) break;

    const added = addAll(nextResult.article_urls);
    // 翻了一页但一个新 URL 都没拿到 → 末页或死循环，停
    if (added === 0) break;

    lastPageUrl = nextUrl;
  }

  return {
    ...first,
    article_urls: truncateToMax(collectedAll),
  };
}
