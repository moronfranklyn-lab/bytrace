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
 * 优设网（UISDC）适配器：www.uisdc.com/<slug> 文章页，作者页 /author/<id>。
 * 站点用 WordPress，正文容器为 .content / .post-content / article。
 */
export const adapter: SiteAdapter = {
  id: 'uisdc',
  platform: '优设',
  matches(url: URL): boolean {
    return /(^|\.)uisdc\.com$/i.test(url.hostname);
  },
  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    const html = await fetchHtml(url.toString());
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);
    const $container = findContainerBySelectors($, [
      'div.content.themeNB',
      'div.post-content',
      'div.entry-content',
      'article .content',
      'article',
    ]);

    if (!$container) return crawlGeneric(url);

    const title =
      $('h1.title-article').first().text().trim() ||
      $('h1.entry-title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      null;

    const content = extractTextFromContainer($, $container);
    const images = extractImagesFromContainer($, $container, url.toString());

    if (!content || content.length < 60) return crawlGeneric(url);

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
    const html = await fetchHtml(url.toString());
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);
    const urls = new Set<string>();

    $('a').each((_i, el) => {
      const href = $(el).attr('href') || '';
      // 优设文章是 /<digits>.html 或 /<slug>.html
      const m = href.match(/^https?:\/\/(?:www\.)?uisdc\.com\/([^\/?#]+)\.html$/);
      if (m) {
        urls.add('https://www.uisdc.com/' + m[1] + '.html');
      }
    });

    const author_name =
      $('h1.author-name').first().text().trim() ||
      $('div.author-info h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      null;

    return {
      author_name,
      platform: '优设',
      article_urls: Array.from(urls),
    };
  },
};
