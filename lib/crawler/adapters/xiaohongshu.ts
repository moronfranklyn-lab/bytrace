/**
 * 小红书适配器（v2 · OpenCLI 接入后）。
 *
 * 优先级：OpenCLI xiaohongshu note/user → blocked。
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
    // OpenCLI
    const openCliResult = await crawlNoteViaOpenCli(url);
    if (openCliResult) return openCliResult;

    return {
      reason: 'blocked',
      message: '小红书没拿下来。常见原因：URL 缺 xsec_token / 浏览器没登录小红书 / 笔记被删',
    };
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    // OpenCLI creator-notes / creator-notes-summary
    const openCliResult = await crawlUserViaOpenCli(url);
    if (openCliResult) return openCliResult;

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
 * 小红书用户主页的 OpenCLI 通道——语义不成立，直接返回 null。
 *
 * 原实现调 `xiaohongshu creator-notes-summary`，但那是**创作者中心**命令，
 * 返回的是「当前登录账号自己」的笔记列表，跟 URL 里的目标博主毫无关系——
 * 拆解任意博主时会静默把自己账号的笔记灌成别人的样本。
 * OpenCLI 目前没有「按 user_id 拉任意博主笔记列表」的命令，所以这条通道
 * 直接返回 null。
 */
async function crawlUserViaOpenCli(url: URL): Promise<CrawledAuthorIndex | null> {
  void url;
  return null;
}
