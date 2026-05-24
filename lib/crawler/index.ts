import { adapter as zhihu } from './adapters/zhihu';
import { adapter as sspai } from './adapters/sspai';
import { adapter as uisdc } from './adapters/uisdc';
import { adapter as bilibili } from './adapters/bilibili';
import { adapter as youtube } from './adapters/youtube';
import { adapter as xiaohongshu } from './adapters/xiaohongshu';
import { adapter as generic } from './adapters/generic';
import {
  isWechatHost,
  wechatRejection,
  wechatUrlTypeInfo,
  crawlWechatViaApify,
} from './wechat';
import { hashUrl, normalizeUrl } from './dedupe';
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
const SPECIFIC_ADAPTERS: SiteAdapter[] = [zhihu, sspai, uisdc, bilibili, youtube, xiaohongshu];

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
 * 作者主页文章列表爬取。
 * 仅在专门适配器实现了 crawlAuthorIndex 时支持；否则返回 unsupported。
 */
export async function crawlAuthorIndex(
  url: string,
): Promise<CrawledAuthorIndex | CrawlError> {
  const parsed = safeParse(url);
  if (!parsed) {
    return { reason: 'unsupported', message: '这个链接格式不对，我读不出来' };
  }
  if (isWechatHost(parsed.hostname)) {
    return wechatRejection();
  }
  for (const ad of SPECIFIC_ADAPTERS) {
    if (ad.matches(parsed) && ad.crawlAuthorIndex) {
      return ad.crawlAuthorIndex(parsed);
    }
  }
  return {
    reason: 'unsupported',
    message: '这个站点的作者页我还不会爬，先一篇一篇贴吧',
  };
}
