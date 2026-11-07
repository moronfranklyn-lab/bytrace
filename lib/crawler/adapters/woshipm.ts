import * as cheerio from 'cheerio';
import type {
  SiteAdapter,
  CrawledArticle,
  CrawlError,
  CrawledAuthorIndex,
} from '../types';
import { fetchHtml } from '../http';
import { hashUrl } from '../dedupe';
import { extractImagesFromContainer, extractTextFromContainer, findContainerBySelectors } from '../html';
import { crawlGeneric } from './generic';

/**
 * 人人都是产品经理（woshipm.com）适配器。
 *
 * URL 形态：
 *   - 单篇正文：https://www.woshipm.com/<category>/<id>.html
 *     category ∈ ai / pd / it / chuangye / event / marketing / operate / share / zhichang ...
 *   - 板块/首页：https://www.woshipm.com/ 或 https://www.woshipm.com/<category>
 *   - 作者主页：https://www.woshipm.com/u/<uid>
 *
 * 站点没强反爬，纯本地 cheerio。
 * 正文容器是 `.article--content`，标题 `.article--title`。
 */

const ARTICLE_URL_RE = /^https?:\/\/(?:www\.)?woshipm\.com\/[a-z]+\/\d+\.html(?:[?#].*)?$/i;
const ARTICLE_HREF_RE = /(?:https?:)?\/\/(?:www\.)?woshipm\.com\/([a-z]+)\/(\d+)\.html/gi;

function isArticleUrl(url: URL): boolean {
  return ARTICLE_URL_RE.test(url.toString());
}

function collectArticleUrls(html: string): string[] {
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  ARTICLE_HREF_RE.lastIndex = 0;
  while ((m = ARTICLE_HREF_RE.exec(html)) !== null) {
    urls.add(`https://www.woshipm.com/${m[1]}/${m[2]}.html`);
  }
  return Array.from(urls);
}

function extractPublishTime($: cheerio.CheerioAPI): string | null {
  const meta =
    $('meta[property="article:published_time"]').attr('content')?.trim() ||
    $('meta[property="og:article:published_time"]').attr('content')?.trim() ||
    $('meta[itemprop="datePublished"]').attr('content')?.trim() ||
    $('time[datetime]').first().attr('datetime')?.trim();
  if (meta) return meta;

  const candidates = [
    '.article--meta', '.article-meta', '.post-meta', '.meta', '.time', '.date', '.publish-time', '.article-info',
  ];
  for (const sel of candidates) {
    const text = $(sel).first().text().replace(/\s+/g, ' ').trim();
    const match = text.match(/20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?/);
    if (match) return match[0];
  }

  const bodyText = $('body').text().replace(/\s+/g, ' ').slice(0, 2000);
  const match = bodyText.match(/20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?/);
  return match?.[0] ?? null;
}

export const adapter: SiteAdapter = {
  id: 'woshipm',
  platform: '人人都是产品经理',
  matches(url: URL): boolean {
    return /(^|\.)woshipm\.com$/i.test(url.hostname);
  },
  urlKind(url: URL): 'article' | 'index' | 'unknown' {
    if (isArticleUrl(url)) return 'article';
    // 首页 / 板块（/category/xxx 或 /xxx）/ 作者页 /u/N → index
    if (
      url.pathname === '/' ||
      /^\/u\/\d+/.test(url.pathname) ||
      /^\/category\/[a-z]+/i.test(url.pathname) ||
      /^\/[a-z]+\/?$/i.test(url.pathname)
    ) {
      return 'index';
    }
    return 'unknown';
  },

  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    if (!isArticleUrl(url)) {
      return {
        reason: 'unsupported',
        message: '这个链接不像 woshipm 的文章页（应该长这样：woshipm.com/<板块>/<数字>.html）',
      };
    }

    const html = await fetchHtml(url.toString());
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);
    const $container = findContainerBySelectors($, [
      'div.article--content.grap',
      'div.article--content',
      'article .article--content',
      'main article',
      'article',
    ]);

    if (!$container) return crawlGeneric(url);

    const title =
      $('h2.article--title').first().text().trim() ||
      $('h1.article--title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim().replace(/\s*[–—-]\s*人人都是产品经理\s*$/, '') ||
      $('title').first().text().trim().replace(/\s*[–—-]\s*人人都是产品经理\s*$/, '') ||
      null;

    const content = extractTextFromContainer($, $container);
    const images = extractImagesFromContainer($, $container, url.toString());
    const publishTime = extractPublishTime($);

    if (!content || content.length < 60) return crawlGeneric(url);

    return {
      url: url.toString(),
      url_hash: hashUrl(url.toString()),
      title,
      content,
      images,
      source: 'cheerio',
      host: url.hostname,
      publish_time: publishTime,
    };
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    const html = await fetchHtml(url.toString());
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);

    // 作者主页 /u/<uid> 取 .name；首页/板块页没作者，返回 null
    const author_name = /^\/u\/\d+/.test(url.pathname)
      ? $('.name').first().text().trim() ||
        $('meta[property="og:title"]').attr('content')?.trim() ||
        null
      : null;

    const article_urls = collectArticleUrls(html);

    if (article_urls.length === 0) {
      return {
        reason: 'parse-failed',
        message: '这个 woshipm 页面里没找到文章链接（首页/板块页/作者主页应该都能列出来）',
      };
    }

    return {
      author_name,
      platform: '人人都是产品经理',
      article_urls,
    };
  },
};
