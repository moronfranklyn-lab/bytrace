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
import { isApifyEnabled, fetchZhihuArticle } from '../apify';

/** 从 zhuanlan URL 抽 articleId（pattern: zhuanlan.zhihu.com/p/{ID}）。 */
function extractZhihuArticleId(url: URL): string | null {
  if (!/(^|\.)zhihu\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/p\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * 知乎适配器：覆盖 zhuanlan.zhihu.com/p/xxx 文章页 + zhihu.com/people/xxx/posts 列表页。
 * 知乎反爬一般，UA + Accept 通常够用；遇到 403 退回 generic。
 */
export const adapter: SiteAdapter = {
  id: 'zhihu',
  platform: '知乎',
  matches(url: URL): boolean {
    return /(^|\.)zhihu\.com$/i.test(url.hostname);
  },
  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    // 优先走 Apify：能拿到完整 HTML 正文，比 cheerio 抗反爬强
    const articleId = extractZhihuArticleId(url);
    if (articleId && isApifyEnabled()) {
      const r = await fetchZhihuArticle(articleId);
      if (r) {
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
          apify_platform: 'zhihu',
        };
      }
      // Apify 拿不到，落到 cheerio 兜底
    }

    const html = await fetchHtml(url.toString(), {
      Referer: 'https://www.zhihu.com/',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      // 知乎对完全没 cookie 的请求会 403；带一个占位让它走 anonymous 路径
      Cookie: 'KLBRSID=' + Math.random().toString(36).slice(2),
    });
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);
    const $container = findContainerBySelectors($, [
      'article .Post-RichTextContainer .RichText',
      'article .Post-RichText',
      '.Post-RichTextContainer',
      'div.RichText.ztext',
      'article',
    ]);

    if (!$container) {
      // 退回 generic 通用解析
      return crawlGeneric(url);
    }

    const title =
      $('h1.Post-Title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      null;

    const content = extractTextFromContainer($, $container);
    const images = extractImagesFromContainer($, $container, url.toString());

    if (!content || content.length < 60) {
      return crawlGeneric(url);
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
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    const html = await fetchHtml(url.toString(), {
      Referer: 'https://www.zhihu.com/',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Upgrade-Insecure-Requests': '1',
      Cookie: 'KLBRSID=' + Math.random().toString(36).slice(2),
    });
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);
    const urls = new Set<string>();

    // 知乎主页 / posts 页常见结构
    $('a').each((_i, el) => {
      const href = $(el).attr('href') || '';
      if (!href) return;
      // 专栏文章
      const m1 = href.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/);
      if (m1) {
        urls.add('https://zhuanlan.zhihu.com/p/' + m1[1]);
        return;
      }
      // /p/xxx 直链
      const m2 = href.match(/^\/?p\/(\d+)/);
      if (m2) urls.add('https://zhuanlan.zhihu.com/p/' + m2[1]);
    });

    const author_name =
      $('h1.ProfileHeader-name').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      null;

    return {
      author_name,
      platform: '知乎',
      article_urls: Array.from(urls),
    };
  },
};
