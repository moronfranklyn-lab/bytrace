/**
 * 小红书适配器（v2 · OpenCLI 接入后）。
 *
 * 优先级：OpenCLI xiaohongshu note/user → Apify zhorex（兜底）→ blocked。
 *
 * 风险等级（CLAUDE.md「反爬与账号边界 v2」）：
 * - 小红书风控强；OpenCLI 借登录会话能用，但「短时连续 > 20 篇」会触发风控
 * - 调用方（profile-engine / fingerprint flow）天然单次 ≤ 20 篇，在安全区内
 * - adapter 自身不做"今日累计"统计——靠 UI 层防止用户串号批量
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
import {
  runOpenCliJson,
  OpenCliNotAvailable,
  OpenCliError,
} from '../opencli';

export const adapter: SiteAdapter = {
  id: 'xiaohongshu',
  platform: '小红书',
  matches(url: URL): boolean {
    return /(^|\.)(xiaohongshu\.com|xhslink\.com)$/i.test(url.hostname);
  },
  urlKind(url: URL): 'article' | 'index' | 'unknown' {
    // 笔记详情：/explore/<id> 或 /discovery/item/<id>
    if (/^\/(explore|discovery\/item)\/[a-z0-9]+/i.test(url.pathname)) return 'article';
    // 用户主页：/user/profile/<id>
    if (/^\/user\/profile\//i.test(url.pathname)) return 'index';
    return 'unknown';
  },

  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    // Tier 1: OpenCLI
    const openCliResult = await crawlNoteViaOpenCli(url);
    if (openCliResult) return openCliResult;

    // Tier 2: Apify 兜底
    if (isApifyEnabled()) {
      const r = await fetchXiaohongshuPost(url.toString());
      if (r) {
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
      }
    }

    return {
      reason: 'blocked',
      message: '小红书没拿下来。常见原因：URL 缺 xsec_token / 浏览器没登录小红书 / 笔记被删',
    };
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    // Tier 1: OpenCLI creator-notes / creator-notes-summary
    const openCliResult = await crawlUserViaOpenCli(url);
    if (openCliResult) return openCliResult;

    // Tier 2: Apify 兜底
    if (isApifyEnabled()) {
      const r = await fetchXiaohongshuUserPosts(url.toString(), 30);
      if (r) {
        return {
          author_name: r.authorName,
          platform: '小红书',
          article_urls: r.postUrls,
        };
      }
    }

    return {
      reason: 'blocked',
      message: '小红书用户主页没拿下来。可能浏览器未登录或主页 URL 不合法',
    };
  },
};

/**
 * OpenCLI xiaohongshu note 输出（field/value table 形态）：
 *   [{ field: 'note_id', value: '...' }, { field: 'title', value: '...' },
 *    { field: 'content', value: '...' }, { field: 'images', value: '...' }, ...]
 */
async function crawlNoteViaOpenCli(url: URL): Promise<CrawledArticle | null> {
  let fields: { field: string; value: string }[];
  try {
    fields = await runOpenCliJson<{ field: string; value: string }[]>(
      ['xiaohongshu', 'note', url.toString()],
      { timeoutMs: 90_000 },
    );
  } catch (err) {
    if (err instanceof OpenCliNotAvailable) return null;
    if (err instanceof OpenCliError) {
      console.warn('OpenCLI xhs note 失败：' + err.message.slice(0, 200));
      return null;
    }
    return null;
  }

  if (!Array.isArray(fields) || fields.length === 0) return null;

  const map = new Map(fields.map((f) => [f.field, f.value]));
  const title = (map.get('title') || '').trim() || null;
  const content = (map.get('content') || map.get('description') || map.get('body') || '').trim();

  if (!content || content.length < 30) return null;

  // 图片可能是 'url1,url2,url3' 或 JSON 串；尽力解析
  const imagesField = map.get('images') || map.get('image_urls') || '';
  const images: { url: string; alt: string | null }[] = [];
  if (imagesField) {
    let candidates: string[] = [];
    try {
      const parsed = JSON.parse(imagesField);
      if (Array.isArray(parsed)) candidates = parsed.filter((x) => typeof x === 'string');
    } catch {
      candidates = imagesField.split(/[,\s]+/).filter(Boolean);
    }
    for (const u of candidates) {
      if (/^https?:\/\//i.test(u)) images.push({ url: u, alt: null });
    }
  }

  return {
    url: url.toString(),
    url_hash: hashUrl(url.toString()),
    title,
    content,
    images,
    source: 'cheerio',
    host: url.hostname,
  };
}

/**
 * OpenCLI xiaohongshu creator-notes 输出：
 *   [{ rank, note_id, title, post_url, views, likes, ... }, ...]
 */
async function crawlUserViaOpenCli(url: URL): Promise<CrawledAuthorIndex | null> {
  // 从 URL 提 user_id：/user/profile/<id>
  const m = url.pathname.match(/^\/user\/profile\/([a-z0-9]+)/i);
  if (!m) return null;

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await runOpenCliJson<Array<Record<string, unknown>>>(
      ['xiaohongshu', 'creator-notes-summary'],
      { timeoutMs: 90_000 },
    );
  } catch (err) {
    if (err instanceof OpenCliNotAvailable) return null;
    if (err instanceof OpenCliError) {
      console.warn('OpenCLI xhs creator-notes 失败：' + err.message.slice(0, 200));
      return null;
    }
    return null;
  }

  if (!Array.isArray(rows) || rows.length === 0) return null;

  const urls: string[] = [];
  for (const r of rows) {
    const u = (r.post_url || r.url || r.note_url) as string | undefined;
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.push(u);
  }
  if (urls.length === 0) return null;

  return {
    author_name: null, // OpenCLI 这条命令不直接返作者名，调用方可能要再查 creator-profile
    platform: '小红书',
    article_urls: urls,
  };
}
