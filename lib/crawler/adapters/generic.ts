import * as cheerio from 'cheerio';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { SiteAdapter, CrawledArticle, CrawlError } from '../types';
import { fetchHtml } from '../http';
import { hashUrl } from '../dedupe';
import { extractImagesFromContainer, extractTextFromContainer } from '../html';

/**
 * 通用兜底适配器：先用 Readability 抽正文骨架，再用 cheerio 重新解析得到段落与图片。
 * 适用于 Medium、简书、个人博客等没有专门适配器的站点。
 */
export const adapter: SiteAdapter = {
  id: 'generic',
  platform: 'unknown',
  matches(_url: URL): boolean {
    // 兜底用，主入口最后才调用，这里始终返回 true。
    return true;
  },
  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    return crawlGeneric(url);
  },
};

/** 暴露给其他适配器复用：当站点选择器没命中时退回 Readability。 */
export async function crawlGeneric(url: URL): Promise<CrawledArticle | CrawlError> {
  const html = await fetchHtml(url.toString());
  if (typeof html !== 'string') return html;
  return parseGenericHtml(url, html);
}

export function parseGenericHtml(url: URL, html: string): CrawledArticle | CrawlError {
  // 1) 先用 jsdom + Readability 找正文 HTML 块
  let articleHtml: string | null = null;
  let articleTitle: string | null = null;
  try {
    const virtualConsole = new VirtualConsole(); // 静默 jsdom 的 CSS 警告
    const dom = new JSDOM(html, { url: url.toString(), virtualConsole });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    if (parsed && parsed.content) {
      articleHtml = parsed.content;
      articleTitle = parsed.title || null;
    }
  } catch {
    // Readability 失败就用整页兜底
  }

  // 2) 用 cheerio 解析正文 HTML（或整页）拿段落 + 图片
  const $ = cheerio.load(articleHtml || html);
  const $root = articleHtml ? $('body').length ? $('body') : $.root().children() : $('body, html').first();

  // articleHtml 是片段，cheerio 会自动包 body
  const container = articleHtml ? $('body') : $('body');
  const content = extractTextFromContainer($, container);
  const images = extractImagesFromContainer($, container, url.toString());

  if (!content || content.length < 80) {
    return {
      reason: 'parse-failed',
      message: '这个链接我抓到了页面，但找不到正文，可能是登录墙或动态渲染',
    };
  }

  // 若 Readability 没拿到 title，再用 <title> 兜底
  if (!articleTitle) {
    const $$ = cheerio.load(html);
    articleTitle =
      $$('meta[property="og:title"]').attr('content')?.trim() ||
      $$('title').first().text().trim() ||
      null;
  }

  void $root; // 避免 ts-unused

  return {
    url: url.toString(),
    url_hash: hashUrl(url.toString()),
    title: articleTitle,
    content,
    images,
    source: 'cheerio',
    host: url.hostname,
  };
}
