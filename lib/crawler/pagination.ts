/**
 * 通用「下一页 URL」嗅探器。
 *
 * 不依赖任何 adapter——只看 HTML 里的链接结构。命中策略按优先级：
 *
 *   1. <link rel="next" href="..."> （HTML 标准，少见但最可靠）
 *   2. <a rel="next" href="..."> （WordPress / 大量博客系统约定）
 *   3. <a href="..."> 且 textContent 含「下一页 / 下页 / Next / › / »」
 *   4. 当前 URL 末尾有 /page/N → 试 /page/N+1（不验证，由调用方再请求确认）
 *   5. 当前 URL query 有 page=N / paged=N → 试 +1
 *
 * 返回的 URL 是绝对 URL；都没命中返回 null。
 *
 * 注意：这是「猜测下一页」，不保证下一页真存在。调用方拿到 URL 后再发请求，
 * 如果 404 / 内容为空，停止翻页。
 */

import * as cheerio from 'cheerio';

const NEXT_TEXT_RE = /^\s*(?:下一页|下页|后一页|next page|next ›|next »|next|›|»|→)\s*$/i;
const NEXT_TEXT_CONTAINS_RE = /(?:下一页|下页|后一页|next page)/i;

export function findNextPageUrl(html: string, currentUrl: string): string | null {
  // 先用 cheerio 找 rel=next / 含「下一页」文本的 <a>
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return tryIncrementPath(currentUrl);
  }

  // 1. <link rel="next">
  const linkRel = $('link[rel="next"]').attr('href');
  if (linkRel) {
    const abs = absolutize(linkRel, currentUrl);
    if (abs && abs !== currentUrl) return abs;
  }

  // 2. <a rel="next">
  const aRel = $('a[rel="next"]').attr('href');
  if (aRel) {
    const abs = absolutize(aRel, currentUrl);
    if (abs && abs !== currentUrl) return abs;
  }

  // 3. <a> 文本命中
  let matched: string | null = null;
  $('a[href]').each((_i, el) => {
    if (matched) return;
    const href = $(el).attr('href') || '';
    if (!href) return;
    const text = $(el).text().trim();
    if (NEXT_TEXT_RE.test(text) || NEXT_TEXT_CONTAINS_RE.test(text)) {
      const abs = absolutize(href, currentUrl);
      if (abs && abs !== currentUrl) {
        matched = abs;
      }
    }
  });
  if (matched) return matched;

  // 4 / 5. URL 递增兜底
  return tryIncrementPath(currentUrl);
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * 没找到链接时的兜底：尝试 path 里的 /page/N 或 query 里的 page=N / paged=N。
 * 没匹配返回 null，调用方应停止翻页。
 */
function tryIncrementPath(currentUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(currentUrl);
  } catch {
    return null;
  }

  // /page/N 形式（WordPress 风格）
  const pathMatch = u.pathname.match(/^(.*\/page\/)(\d+)\/?$/);
  if (pathMatch) {
    const n = parseInt(pathMatch[2], 10);
    if (Number.isFinite(n) && n < 999) {
      u.pathname = `${pathMatch[1]}${n + 1}`;
      return u.toString();
    }
  }

  // 路径末尾没 /page/N，但 pathname 不是根 → 试着追加 /page/2（首次进入分页）
  // 仅当当前 URL 没有 page query 且 path 看起来像板块/作者页（不是末尾带 .html 的详情页）
  if (
    !u.searchParams.has('page') &&
    !u.searchParams.has('paged') &&
    !/\.html?$/i.test(u.pathname) &&
    u.pathname !== '/' &&
    u.pathname.length > 1
  ) {
    const trimmed = u.pathname.replace(/\/+$/, '');
    u.pathname = `${trimmed}/page/2`;
    return u.toString();
  }

  // ?page=N
  const pageQ = u.searchParams.get('page');
  if (pageQ) {
    const n = parseInt(pageQ, 10);
    if (Number.isFinite(n) && n < 999) {
      u.searchParams.set('page', String(n + 1));
      return u.toString();
    }
  }
  // ?paged=N（WordPress 另一种）
  const pagedQ = u.searchParams.get('paged');
  if (pagedQ) {
    const n = parseInt(pagedQ, 10);
    if (Number.isFinite(n) && n < 999) {
      u.searchParams.set('paged', String(n + 1));
      return u.toString();
    }
  }

  return null;
}
