import type { CrawledArticle, CrawlError, UrlTypeInfo } from './types';
import { hashUrl } from './dedupe';
import { isApifyEnabled, fetchWechatArticle } from './apify';

/** 识别公众号 URL。 */
export function isWechatHost(host: string): boolean {
  return /(^|\.)mp\.weixin\.qq\.com$/i.test(host);
}

/** 公众号文章的"统一拒绝"出口，提示用户改成粘贴正文。 */
export function wechatRejection(): CrawlError {
  return {
    reason: 'wechat',
    message: '公众号反爬较硬，工具不爬，请直接粘贴正文',
  };
}

/** 给 detectUrlType 用：返回公众号专属的 UrlTypeInfo。 */
export function wechatUrlTypeInfo(): UrlTypeInfo {
  if (isApifyEnabled()) {
    return {
      platform: '公众号',
      is_wechat: true,
      is_supported_for_crawl: true,
      hint: '公众号走 Apify 抓取（约 $0.005/篇）',
    };
  }
  return {
    platform: '公众号',
    is_wechat: true,
    is_supported_for_crawl: false,
    hint: '公众号反爬较硬，工具不爬，请直接粘贴正文',
  };
}

/**
 * 公众号文章 → Apify 抓取。
 * 启用 Apify 时尝试抓取，失败/未启用时落到 wechatRejection。
 */
export async function crawlWechatViaApify(
  url: URL,
): Promise<CrawledArticle | CrawlError> {
  if (!isApifyEnabled()) {
    return wechatRejection();
  }
  const r = await fetchWechatArticle(url.toString());
  if (!r) {
    return wechatRejection();
  }
  const urlStr = r.article.url || url.toString();
  return {
    url: urlStr,
    url_hash: hashUrl(urlStr),
    title: r.article.title || null,
    content: r.article.content,
    images: [],
    source: 'cheerio',
    host: url.hostname,
    apify_run_id: r.runId,
    apify_cost_usd: r.costUsd,
    apify_platform: 'wechat',
  };
}
