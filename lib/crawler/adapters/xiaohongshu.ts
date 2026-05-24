/**
 * 小红书适配器：只能走 Apify（zhorex/rednote-xiaohongshu-scraper）。
 * 没 Apify token 直接返回 unsupported；Apify 调用失败转 blocked，
 * 提示 URL 可能缺 xsec_token 参数（小红书分享链接的强制鉴权字段）。
 */

import type {
  SiteAdapter,
  CrawledArticle,
  CrawledAuthorIndex,
  CrawlError,
} from '../types';
import { hashUrl } from '../dedupe';
import {
  isApifyEnabled,
  fetchXiaohongshuPost,
  fetchXiaohongshuUserPosts,
} from '../apify';

export const adapter: SiteAdapter = {
  id: 'xiaohongshu',
  platform: '小红书',
  matches(url: URL): boolean {
    return /(^|\.)(xiaohongshu\.com|xhslink\.com)$/i.test(url.hostname);
  },

  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    if (!isApifyEnabled()) {
      return {
        reason: 'unsupported',
        message: '小红书需要开启 Apify 接入，去设置页填入 token',
      };
    }
    const r = await fetchXiaohongshuPost(url.toString());
    if (!r) {
      return {
        reason: 'blocked',
        message: '小红书内容拿不到，可能 URL 缺 xsec_token 参数',
      };
    }
    const urlStr = r.post.postUrl || url.toString();
    return {
      url: urlStr,
      url_hash: hashUrl(urlStr),
      title: r.post.title || null,
      content: r.post.content,
      images: [],
      source: 'cheerio',
      host: url.hostname,
      apify_run_id: r.runId,
      apify_cost_usd: r.costUsd,
      apify_platform: 'xiaohongshu',
    };
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    if (!isApifyEnabled()) {
      return {
        reason: 'unsupported',
        message: '小红书需要开启 Apify 接入，去设置页填入 token',
      };
    }
    const r = await fetchXiaohongshuUserPosts(url.toString(), 30);
    if (!r) {
      return {
        reason: 'blocked',
        message: '小红书内容拿不到，可能 URL 缺 xsec_token 参数',
      };
    }
    return {
      author_name: r.authorName,
      platform: '小红书',
      article_urls: r.postUrls,
    };
  },
};
