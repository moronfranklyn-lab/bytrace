/**
 * 通用联网事实搜索（事实底座用）
 * - 有 GOOGLE_CSE_KEY + GOOGLE_CSE_ID → Google CSE
 * - 否则 DuckDuckGo HTML（免 key）
 * 与 searchAuthor 不同：不做平台白名单过滤，面向公开网页素材。
 */

import got from 'got';
import * as cheerio from 'cheerio';
import { DESKTOP_UA } from '../crawler/http';

export interface WebFactHit {
  title: string;
  url: string;
  content: string;
  score: number;
  /**
   * 来源通道。
   * - google / duckduckgo / bing：web-facts 通用抓取
   * - doubao：火山方舟（豆包）联网内容插件
   * - mimo：小米 MiMo web_search 插件
   * - tavily：Tavily
   */
  source: 'google' | 'duckduckgo' | 'bing' | 'doubao' | 'mimo' | 'tavily';
}

const DDG_COOLDOWN_MS = 1500;
let lastDdgCallAt = 0;
let ddgQueueTail: Promise<void> = Promise.resolve();

function ddgThrottle(): Promise<void> {
  const mine = ddgQueueTail.then(async () => {
    const since = Date.now() - lastDdgCallAt;
    if (since < DDG_COOLDOWN_MS) {
      await new Promise((r) => setTimeout(r, DDG_COOLDOWN_MS - since));
    }
    lastDdgCallAt = Date.now();
  });
  ddgQueueTail = mine.catch(() => undefined);
  return mine;
}

function unwrapDdgRedirect(href: string): string | null {
  try {
    if (href.startsWith('http')) {
      const u = new URL(href);
      if (u.hostname.includes('duckduckgo.com') && u.pathname === '/l/') {
        const uddg = u.searchParams.get('uddg');
        return uddg ? decodeURIComponent(uddg) : null;
      }
      return href;
    }
  } catch {
    return null;
  }
  return null;
}

async function searchViaGoogleCSE(query: string, key: string, cx: string): Promise<WebFactHit[]> {
  const url =
    'https://www.googleapis.com/customsearch/v1?' +
    new URLSearchParams({
      key,
      cx,
      q: query,
      num: '8',
      hl: 'zh-CN',
    }).toString();

  const res = await got(url, {
    timeout: { request: 12_000 },
    retry: { limit: 0 },
    throwHttpErrors: false,
    responseType: 'json',
  });
  if (res.statusCode === 429) return [];
  if (res.statusCode >= 400) {
    throw new Error(`Google CSE HTTP ${res.statusCode}`);
  }
  const data = res.body as {
    items?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return (data.items || [])
    .filter((i) => i.link && i.title)
    .map((i, idx) => ({
      title: i.title || i.link!,
      url: i.link!,
      content: i.snippet || '',
      score: Math.max(0.5, 1 - idx * 0.05),
      source: 'google' as const,
    }));
}

async function searchViaDuckDuckGo(query: string): Promise<WebFactHit[]> {
  await ddgThrottle();
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const res = await got(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://duckduckgo.com/',
    },
    timeout: { request: 12_000 },
    retry: { limit: 0 },
    followRedirect: true,
    maxRedirects: 5,
    throwHttpErrors: false,
    responseType: 'text',
  });
  if (res.statusCode === 429 || res.statusCode === 403 || res.statusCode >= 400) {
    return [];
  }
  const $ = cheerio.load(res.body ?? '');
  const out: WebFactHit[] = [];
  const seen = new Set<string>();
  $('div.result, div.results_links, div.web-result').each((_i, el) => {
    const $el = $(el);
    const $a = $el.find('a.result__a').first();
    const href = ($a.attr('href') || '').trim();
    const title = $a.text().trim();
    const snippet =
      $el.find('a.result__snippet, .result__snippet').first().text().trim() ||
      $el.find('.result__body').first().text().trim();
    if (!href || !title) return;
    const real = unwrapDdgRedirect(href);
    if (!real) return;
    try {
      const parsed = new URL(real);
      if (seen.has(parsed.toString())) return;
      seen.add(parsed.toString());
      out.push({
        title,
        url: parsed.toString(),
        content: snippet,
        score: 0.7,
        source: 'duckduckgo',
      });
    } catch {
      /* skip */
    }
  });
  return out.slice(0, 8);
}


async function searchViaBing(query: string): Promise<WebFactHit[]> {
  const url =
    'https://www.bing.com/search?' +
    new URLSearchParams({ q: query, setlang: 'zh-CN', count: '10' }).toString();
  const res = await got(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    timeout: { request: 12_000 },
    retry: { limit: 0 },
    followRedirect: true,
    throwHttpErrors: false,
    responseType: 'text',
  });
  if (res.statusCode >= 400) return [];
  const $ = cheerio.load(res.body ?? '');
  const out: WebFactHit[] = [];
  const seen = new Set<string>();
  $('li.b_algo').each((_i, el) => {
    const $el = $(el);
    const $a = $el.find('h2 a').first();
    const href = ($a.attr('href') || '').trim();
    const title = $a.text().trim();
    const snippet = $el.find('.b_caption p, .b_algoSlug').first().text().trim();
    if (!href || !title || !href.startsWith('http')) return;
    if (seen.has(href)) return;
    seen.add(href);
    out.push({
      title,
      url: href,
      content: snippet,
      score: 0.65,
      source: 'bing',
    });
  });
  return out.slice(0, 8);
}

/**
 * 通用事实搜索入口。
 */
export async function searchWebFacts(query: string): Promise<WebFactHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const gKey = process.env.GOOGLE_CSE_KEY;
  const gCx = process.env.GOOGLE_CSE_ID;
  if (gKey && gCx) {
    try {
      const hits = await searchViaGoogleCSE(trimmed, gKey, gCx);
      if (hits.length > 0) return hits;
    } catch (err) {
      console.warn('[web-facts] Google CSE 失败，回落 DuckDuckGo:', err);
    }
  }
  try {
    const ddg = await searchViaDuckDuckGo(trimmed);
    if (ddg.length > 0) return ddg;
  } catch (err) {
    console.warn('[web-facts] DuckDuckGo 失败:', err);
  }
  try {
    const bing = await searchViaBing(trimmed);
    if (bing.length > 0) return bing;
  } catch (err) {
    console.error('[web-facts] Bing 失败:', err);
  }
  return [];
}
