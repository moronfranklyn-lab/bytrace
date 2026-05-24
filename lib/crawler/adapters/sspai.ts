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
 * 少数派适配器：sspai.com/post/<id> 与 sspai.com/u/<slug> 作者页。
 * 站点结构相对稳定，正文在 .article 或 .content 区块。
 */
export const adapter: SiteAdapter = {
  id: 'sspai',
  platform: '少数派',
  matches(url: URL): boolean {
    return /(^|\.)sspai\.com$/i.test(url.hostname);
  },
  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    const html = await fetchHtml(url.toString());
    if (typeof html !== 'string') return html;

    const $ = cheerio.load(html);
    const $container = findContainerBySelectors($, [
      'div.article-body',
      'article .article-body',
      'div.content.minHeight',
      'div.wangEditor-txt',
      'main article',
      'article',
    ]);

    if (!$container) return crawlGeneric(url);

    const title =
      $('h1.title').first().text().trim() ||
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
      const m = href.match(/sspai\.com\/post\/(\d+)/);
      if (m) {
        urls.add('https://sspai.com/post/' + m[1]);
        return;
      }
      const m2 = href.match(/^\/post\/(\d+)/);
      if (m2) urls.add('https://sspai.com/post/' + m2[1]);
    });

    const author_name =
      $('h1.nickname').first().text().trim() ||
      $('div.nickname').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      null;

    return {
      author_name,
      platform: '少数派',
      article_urls: Array.from(urls),
    };
  },
};
