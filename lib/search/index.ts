/**
 * 博主名搜索层（Agent I）。
 *
 * 入口：`searchAuthor(query)`。
 * - 默认走 DuckDuckGo HTML 搜索（无 key 即可用）；
 * - 若 .env 配了 GOOGLE_CSE_KEY + GOOGLE_CSE_ID，自动切到 Google Custom Search API（精度更高）。
 *
 * 设计目的：把用户输入的「博主名」翻译成一组可点的主页 URL，
 * 后续由 lib/crawler 的 crawlAuthorIndex 拉文章列表。
 *
 * 真实网络调用：12s 超时；DuckDuckGo 抓完 sleep 1.5s 让 IP 不被 ban。
 * 同一 query 1 小时内复用结果（进程内 Map 缓存，重启即清）。
 */

import got from 'got';
import * as cheerio from 'cheerio';
import { DESKTOP_UA } from '../crawler/http';
import { isWechatHost } from '../crawler/wechat';
import { isApifyEnabled } from '../crawler/apify';
import type { AuthorCandidate, SearchError } from './types';

export type { AuthorCandidate, SearchError } from './types';
export { isSearchError } from './types';

/**
 * 给搜索结果做平台分类的 host 表。
 * 后续新增平台只在这里加一行即可。
 */
const PLATFORM_RULES: Array<{
  test: (host: string, url: string) => boolean;
  platform: string;
  medium: 'text' | 'video' | 'mixed';
  confidenceBonus: number;
}> = [
  {
    test: (h) => /(^|\.)zhihu\.com$/i.test(h),
    platform: '知乎',
    medium: 'text',
    confidenceBonus: 0.3,
  },
  {
    test: (h) => /(^|\.)bilibili\.com$/i.test(h),
    platform: 'B站',
    medium: 'video',
    confidenceBonus: 0.3,
  },
  {
    test: (h) => /(^|\.)sspai\.com$/i.test(h),
    platform: '少数派',
    medium: 'text',
    confidenceBonus: 0.3,
  },
  {
    test: (h) => /(^|\.)uisdc\.com$/i.test(h),
    platform: '优设',
    medium: 'text',
    confidenceBonus: 0.3,
  },
  {
    test: (h) => /(^|\.)(youtube\.com|youtu\.be)$/i.test(h),
    platform: 'YouTube',
    medium: 'video',
    confidenceBonus: 0.3,
  },
  {
    test: (h) => /(^|\.)jianshu\.com$/i.test(h),
    platform: '简书',
    medium: 'text',
    confidenceBonus: 0.25,
  },
  {
    test: (h) => /(^|\.)medium\.com$/i.test(h),
    platform: 'Medium',
    medium: 'text',
    confidenceBonus: 0.25,
  },
  {
    test: (h) => isWechatHost(h),
    platform: '公众号',
    medium: 'text',
    confidenceBonus: 0.15,
  },
];

/** 站点限定串：避免被搜索结果污染。 */
const SITE_FILTER =
  'site:zhihu.com OR site:sspai.com OR site:uisdc.com OR ' +
  'site:bilibili.com OR site:youtube.com OR site:jianshu.com OR site:medium.com';

/** 进程内 1 小时缓存。重启即丢，简单就好。 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: AuthorCandidate[] | SearchError }>();

/** DuckDuckGo 抓完限速。 */
const DDG_COOLDOWN_MS = 1500;
let lastDdgCallAt = 0;

/**
 * 入口：按博主名搜，返回候选数组或错误对象。
 *
 * - 若 query 含「公众号 / 微信」关键字 → 直接返回 wechat-only 错误
 *   （后续 UI 引导用户切到正文模式，毕竟公众号没公开主页可爬）
 * - 否则按 Google CSE > DuckDuckGo 的顺序尝试；
 * - 同一 query 1 小时内命中缓存。
 */
export async function searchAuthor(
  query: string,
): Promise<AuthorCandidate[] | SearchError> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { reason: 'no-results', message: '搜啥呢，名字总得给一个' };
  }

  // 1) 公众号短路：用户问的是公众号，提前告知没主页可爬
  if (/(公众号|微信)/.test(trimmed)) {
    return {
      reason: 'wechat-only',
      message:
        '公众号没有公开的作者主页，工具爬不到。直接到「拆解新博主」页用「正文模式」贴文章吧。',
    };
  }

  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  // 2) 优先 Google CSE（若有 key）
  const gKey = process.env.GOOGLE_CSE_KEY;
  const gCx = process.env.GOOGLE_CSE_ID;
  let result: AuthorCandidate[] | SearchError;
  if (gKey && gCx) {
    result = await searchViaGoogleCSE(trimmed, gKey, gCx);
    if (
      'reason' in (result as SearchError) &&
      (result as SearchError).reason === 'engine-error'
    ) {
      // CSE 挂了就退回 DDG
      result = await searchViaDuckDuckGo(trimmed);
    }
  } else {
    result = await searchViaDuckDuckGo(trimmed);
  }

  // 3) 公众号 host 兜底：如果候选里只有 mp.weixin.qq.com，也提示 wechat-only
  if (Array.isArray(result)) {
    const allWechat =
      result.length > 0 && result.every((c) => c.platform === '公众号');
    if (allWechat) {
      const fallback: SearchError = {
        reason: 'wechat-only',
        message:
          '只搜到了公众号文章。公众号没有可爬的作者主页，请到「拆解新博主」用正文模式贴。',
      };
      cache.set(trimmed, { at: Date.now(), result: fallback });
      return fallback;
    }
  }

  cache.set(trimmed, { at: Date.now(), result });
  return result;
}

/** 给 query 加站点限定，并对 OR 做编码。 */
function withSiteFilter(q: string): string {
  return `${q} (${SITE_FILTER})`;
}

/**
 * DuckDuckGo HTML 搜索：免 key、抗用。
 * 端点：https://html.duckduckgo.com/html/
 *
 * 注意 DDG 偶尔会 302 到 "no JS" 页或 challenge 页；本实现:
 * - 12s 超时
 * - User-Agent 用桌面 Chrome
 * - 抓完冷却 1.5s 防止 IP 被识别为爬虫
 */
async function searchViaDuckDuckGo(
  query: string,
): Promise<AuthorCandidate[] | SearchError> {
  // 冷却：和上次调用的间隔不到 1.5s 就 sleep 一下
  const since = Date.now() - lastDdgCallAt;
  if (since < DDG_COOLDOWN_MS) {
    await sleep(DDG_COOLDOWN_MS - since);
  }
  lastDdgCallAt = Date.now();

  const q = withSiteFilter(query);
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);

  let html: string;
  try {
    const res = await got(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
    if (res.statusCode === 429 || res.statusCode === 403) {
      return {
        reason: 'rate-limited',
        message: 'DuckDuckGo 暂时不给我结果了，等 1-2 分钟再试',
      };
    }
    if (res.statusCode >= 400) {
      return {
        reason: 'engine-error',
        message: `DuckDuckGo 返回了 ${res.statusCode}`,
      };
    }
    html = res.body ?? '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(msg)) {
      return { reason: 'timeout', message: '搜了 12 秒没结果，先放着吧' };
    }
    return { reason: 'engine-error', message: '搜索引擎抽风：' + truncate(msg, 80) };
  }

  return parseDuckDuckGoHtml(html, query);
}

/** 解析 DDG HTML 页面，转候选数组。 */
export function parseDuckDuckGoHtml(html: string, query: string): AuthorCandidate[] | SearchError {
  const $ = cheerio.load(html);
  const out: AuthorCandidate[] = [];
  const seen = new Set<string>();

  // DDG HTML 版的结构：div.result -> a.result__a + a.result__snippet
  $('div.result, div.results_links, div.web-result').each((_i, el) => {
    const $el = $(el);
    const $a = $el.find('a.result__a').first();
    const href = ($a.attr('href') || '').trim();
    const titleText = $a.text().trim();
    const snippet =
      $el.find('a.result__snippet, .result__snippet').first().text().trim() ||
      $el.find('.result__body').first().text().trim();
    if (!href || !titleText) return;

    const real = unwrapDdgRedirect(href);
    if (!real) return;
    let parsed: URL;
    try {
      parsed = new URL(real);
    } catch {
      return;
    }
    if (seen.has(parsed.toString())) return;

    const platformInfo = matchPlatform(parsed);
    if (!platformInfo) return; // 不在 7 个目标站点内的丢掉

    seen.add(parsed.toString());

    const conf = computeConfidence(query, titleText, snippet, platformInfo.confidenceBonus);
    const kind = classifyUrlKind(parsed);
    const r = assessRisk(parsed, kind);
    out.push({
      name: cleanAuthorName(titleText),
      url: parsed.toString(),
      platform: platformInfo.platform,
      medium: platformInfo.medium,
      snippet: truncate(snippet, 160),
      confidence: conf,
      source: 'duckduckgo',
      kind,
      risk: r.risk,
      risk_hint: r.hint,
    });
  });

  if (out.length === 0) {
    return {
      reason: 'no-results',
      message: '一个候选都没搜到。换个写法（加平台名 / 真名 / 笔名）试试',
    };
  }

  // 按 confidence 倒排
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 20);
}

/** DDG 偶尔包一层 /l/?uddg=...&rut=...；提取真实 URL。 */
function unwrapDdgRedirect(href: string): string | null {
  if (!href) return null;
  if (href.startsWith('//')) href = 'https:' + href;
  if (/^https?:\/\//.test(href)) {
    try {
      const u = new URL(href);
      if (u.pathname.startsWith('/l/') && u.searchParams.has('uddg')) {
        return decodeURIComponent(u.searchParams.get('uddg') || '');
      }
      return u.toString();
    } catch {
      return null;
    }
  }
  if (href.startsWith('/l/?')) {
    const inner = href.slice(3);
    const u = new URL('https://duckduckgo.com/l/?' + inner.split('?').pop());
    if (u.searchParams.has('uddg')) {
      return decodeURIComponent(u.searchParams.get('uddg') || '');
    }
  }
  return null;
}

/**
 * Google Custom Search API：精度高得多，但要 key + cx。
 * 文档：https://developers.google.com/custom-search/v1/using_rest
 */
async function searchViaGoogleCSE(
  query: string,
  apiKey: string,
  cx: string,
): Promise<AuthorCandidate[] | SearchError> {
  const q = withSiteFilter(query);
  const url =
    'https://www.googleapis.com/customsearch/v1?' +
    'key=' + encodeURIComponent(apiKey) +
    '&cx=' + encodeURIComponent(cx) +
    '&q=' + encodeURIComponent(q) +
    '&num=10';

  try {
    const res = await got(url, {
      timeout: { request: 12_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'json',
    });
    if (res.statusCode === 429) {
      return {
        reason: 'rate-limited',
        message: 'Google CSE 今天的额度用完了，先用 DuckDuckGo 顶顶',
      };
    }
    if (res.statusCode >= 400) {
      return {
        reason: 'engine-error',
        message: `Google CSE 返回了 ${res.statusCode}`,
      };
    }
    const body = res.body as {
      items?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    const items = body.items ?? [];
    if (items.length === 0) {
      return {
        reason: 'no-results',
        message: 'Google 也没搜到。换个写法（加平台名 / 真名 / 笔名）试试',
      };
    }
    const out: AuthorCandidate[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const href = (it.link || '').trim();
      if (!href || seen.has(href)) continue;
      let parsed: URL;
      try {
        parsed = new URL(href);
      } catch {
        continue;
      }
      const platformInfo = matchPlatform(parsed);
      if (!platformInfo) continue;
      seen.add(href);
      out.push({
        name: cleanAuthorName(it.title || ''),
        url: parsed.toString(),
        platform: platformInfo.platform,
        medium: platformInfo.medium,
        snippet: truncate(it.snippet || '', 160),
        confidence: computeConfidence(
          query,
          it.title || '',
          it.snippet || '',
          platformInfo.confidenceBonus + 0.1, // CSE 整体加 10%
        ),
        source: 'google',
        kind: classifyUrlKind(parsed),
        ...(() => {
          const r = assessRisk(parsed, classifyUrlKind(parsed));
          return { risk: r.risk, risk_hint: r.hint };
        })(),
      });
    }
    if (out.length === 0) {
      return {
        reason: 'no-results',
        message: 'Google 给的结果都不是我认识的平台，回 DDG 再试一次',
      };
    }
    out.sort((a, b) => b.confidence - a.confidence);
    return out.slice(0, 20);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(msg)) {
      return { reason: 'timeout', message: 'Google CSE 超时了' };
    }
    return { reason: 'engine-error', message: 'Google CSE 抽风：' + truncate(msg, 80) };
  }
}

/** host 命中平台规则。 */
function matchPlatform(
  url: URL,
): { platform: string; medium: 'text' | 'video' | 'mixed'; confidenceBonus: number } | null {
  for (const r of PLATFORM_RULES) {
    if (r.test(url.hostname, url.toString())) {
      return r;
    }
  }
  return null;
}

/**
 * 评估一个 URL 的爬取风险。和 classifyUrlKind 分开是因为：
 * 知乎专栏文章是 article kind（结构上能爬），但实际上知乎风控会 403，所以是 'blocked'。
 *
 * - 'blocked'：当前已知一定爬失败，UI 默认不勾、给黄警告
 * - 'limited'：能爬到但内容可能不完整（B 站视频常无字幕），UI 默认勾、带提示
 * - null：常规
 */
function assessRisk(url: URL, kind: 'article' | 'index' | 'unknown'): { risk: 'blocked' | 'limited' | null; hint: string | null } {
  const host = url.hostname.toLowerCase();
  // Apify 接入开启时：知乎/B站/小红书/公众号都走 Apify，免去原本的风控问题
  if (isApifyEnabled()) {
    const apifyHint = '走 Apify 抓取，约 $0.005-0.02/篇';
    if (/(^|\.)zhihu\.com$/.test(host)) {
      return { risk: null, hint: apifyHint };
    }
    if (/(^|\.)bilibili\.com$/.test(host)) {
      return { risk: null, hint: apifyHint };
    }
    if (/(^|\.)(xiaohongshu\.com|xhslink\.com)$/.test(host)) {
      return { risk: null, hint: apifyHint };
    }
    if (isWechatHost(host)) {
      return { risk: null, hint: apifyHint };
    }
  }
  // 知乎：2024 年中起全面反爬，cookie 缺失即 403
  if (/(^|\.)zhihu\.com$/.test(host)) {
    return { risk: 'blocked', hint: '知乎反爬较强，建议在浏览器登录后复制正文，工具切「正文模式」用' };
  }
  // B 站视频：很多 UP 主没上传字幕，能拿到的只有标题+简介
  if (/(^|\.)bilibili\.com$/.test(host) && /\/video\//.test(url.pathname)) {
    return { risk: 'limited', hint: '若 UP 主没传字幕，工具只能拿到标题+简介，语料偏少' };
  }
  // B 站 UP 主主页：wbi 签名风控
  if (host === 'space.bilibili.com' || /space\.bilibili\.com/.test(url.toString())) {
    return { risk: 'blocked', hint: 'B 站 UP 主主页有签名风控，工具拿不到视频列表' };
  }
  // YouTube：要 API key
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) {
    return { risk: 'limited', hint: 'YouTube 需要 API key（.env.local 配 YOUTUBE_DATA_API_KEY）' };
  }
  // 主页类（index）通常需要爬列表，多平台不稳
  if (kind === 'index') {
    return { risk: 'limited', hint: '主页/合集页：多数平台反爬，建议直接挑单篇' };
  }
  return { risk: null, hint: null };
}

/**
 * 判断一个搜到的 URL 是「单篇文章」还是「主页/合集页」。
 *
 * 为什么要这一步：DuckDuckGo / Google 搜出来的多数是文章详情页（zhihu.com/p/xxx、
 * bilibili.com/video/BV...），少数才是主页（zhihu.com/people/xxx、space.bilibili.com/123）。
 * 之前的 UI 误把所有候选当主页去 crawlAuthorIndex，结果全失败。
 *
 * - article：UI 可以直接灌进卡片走 URL 模式爬正文
 * - index：UI 需要先调 crawlAuthorIndex（注意：部分平台被反爬，要给用户温暖提示）
 * - unknown：摸不准，按 article 试，失败再 fallback
 */
function classifyUrlKind(url: URL): 'article' | 'index' | 'unknown' {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // 知乎
  if (/(^|\.)zhihu\.com$/.test(host)) {
    if (/^\/p\/\d+/.test(path)) return 'article';                  // 专栏文章
    if (/^\/question\/\d+\/answer\/\d+/.test(path)) return 'article'; // 单条回答
    if (/^\/people\//.test(path)) return 'index';                  // 用户主页
    if (/^\/column\/[^/]+\/?$/.test(path)) return 'index';         // 专栏首页
    if (/^\/question\/\d+\/?$/.test(path)) return 'index';         // 问题页（多个回答）
    return 'unknown';
  }
  // B 站
  if (/(^|\.)bilibili\.com$/.test(host)) {
    if (/^\/video\/(BV|av)/i.test(path)) return 'article';         // 单视频
    if (/^space\.bilibili\.com$/.test(host)) return 'index';       // UP 主页
    if (/^\/medialist\/|^\/festival\//i.test(path)) return 'index';
    return 'unknown';
  }
  // YouTube
  if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) {
    if (url.searchParams.has('v') || /youtu\.be\/[A-Za-z0-9_-]+/.test(url.toString())) return 'article';
    if (/^\/(channel|c|user|@)/i.test(path) || url.searchParams.has('list')) return 'index';
    return 'unknown';
  }
  // 少数派
  if (/(^|\.)sspai\.com$/.test(host)) {
    if (/^\/post\/\d+/.test(path)) return 'article';
    if (/^\/u\//.test(path)) return 'index';
    if (/^\/(matrix|column)/.test(path)) return 'index';
    return 'unknown';
  }
  // 优设
  if (/(^|\.)uisdc\.com$/.test(host)) {
    if (/^\/[\w-]+\.html?$/.test(path) || /^\/\d{4,}/.test(path)) return 'article';
    if (/^\/author\//.test(path) || /^\/category\//.test(path)) return 'index';
    return 'unknown';
  }
  // 简书
  if (/(^|\.)jianshu\.com$/.test(host)) {
    if (/^\/p\/[a-z0-9]+/i.test(path)) return 'article';
    if (/^\/u\//.test(path)) return 'index';
    return 'unknown';
  }
  // Medium
  if (/(^|\.)medium\.com$/.test(host)) {
    if (/^\/@[^/]+\/.+/.test(path)) return 'article';              // @user/post-slug
    if (/^\/@[^/]+\/?$/.test(path)) return 'index';                // @user/
    return 'unknown';
  }
  return 'unknown';
}

/** title 含 query → +0.4；snippet 含 → +0.2；再加 platform bonus，截到 [0,1]。 */
function computeConfidence(query: string, title: string, snippet: string, bonus: number): number {
  let c = 0.2 + bonus;
  const q = query.toLowerCase();
  if (title.toLowerCase().includes(q)) c += 0.4;
  if (snippet.toLowerCase().includes(q)) c += 0.2;
  return Math.max(0, Math.min(1, c));
}

/** 去掉常见后缀 "- 知乎"、"_哔哩哔哩"、"- YouTube" 等。 */
function cleanAuthorName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/[\-_·|—–]\s*(知乎|哔哩哔哩|bilibili|youtube|少数派|sspai|优设网|jianshu|简书|medium).*$/i, '');
  s = s.replace(/\s*-\s*知乎专栏.*$/i, '');
  s = s.replace(/的个人空间.*$/i, '');
  s = s.replace(/的主页.*$/i, '');
  return s.trim() || raw.trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
