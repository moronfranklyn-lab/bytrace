import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

/** 把段落抽成纯文本数组，再用 \n\n 拼接。会保留代码块行内换行。 */
export function extractTextFromContainer($: CheerioAPI, $container: Cheerio<Element>): string {
  // 删除常见噪声节点
  $container
    .find('script,style,noscript,iframe,header,footer,nav,aside,form,button')
    .remove();

  // 把 <br> 转成换行符占位
  $container.find('br').replaceWith('\n');

  const blocks: string[] = [];

  const blockSel =
    'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td, .ztext-empty-paragraph';

  // 先收全部命中节点，用于判断"祖先是否也命中了 blockSel"。
  // 嵌套块级元素（li>p / blockquote>p / td>p 等）若不跳过会重复取文：
  // 祖先取 text() 时已包含子块内容，子块再单独出一条就是两遍。
  // 只认容器内的祖先（Set 里都是容器内节点），页面外层布局元素不会误伤。
  const matchedEls = new Set<Element>();
  const $blocks = $container.find(blockSel);
  $blocks.each((_i, el) => {
    matchedEls.add(el);
  });
  const hasMatchedAncestor = (el: Element): boolean => {
    let node = el.parent;
    while (node) {
      if (matchedEls.has(node as Element)) return true;
      node = node.parent;
    }
    return false;
  };

  $blocks.each((_i, el) => {
    // 祖先块已经把这个节点的文本收进去了（含 pre 内部的节点），跳过防重复
    if (hasMatchedAncestor(el)) return;
    const $el = $(el);
    // pre/code 块单独保留
    if (el.tagName === 'pre') {
      const code = $el.text();
      if (code.trim()) blocks.push('```\n' + code.replace(/\s+$/g, '') + '\n```');
      return;
    }
    let text = $el.text().replace(/ /g, ' ');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
    if (!text) return;
    // 标题加 ## 标记，便于后续 LLM 识别
    if (/^h[1-6]$/.test(el.tagName)) {
      const level = Number(el.tagName.slice(1));
      blocks.push('#'.repeat(Math.min(level, 6)) + ' ' + text);
    } else if (el.tagName === 'li') {
      blocks.push('- ' + text);
    } else if (el.tagName === 'blockquote') {
      blocks.push('> ' + text.replace(/\n/g, '\n> '));
    } else {
      blocks.push(text);
    }
  });

  if (blocks.length === 0) {
    // 兜底：直接 text()
    const raw = $container.text().replace(/ /g, ' ');
    return raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 从一个容器里抽 <img>，补 protocol，过滤无意义占位图。 */
export function extractImagesFromContainer(
  $: CheerioAPI,
  $container: Cheerio<Element>,
  baseUrl: string,
): { url: string; alt: string | null }[] {
  const out: { url: string; alt: string | null }[] = [];
  const seen = new Set<string>();
  $container.find('img').each((_i, el) => {
    const $el = $(el);
    const candidate =
      $el.attr('data-original') ||
      $el.attr('data-src') ||
      $el.attr('data-actualsrc') ||
      $el.attr('data-default-watermark-src') ||
      $el.attr('src') ||
      '';
    if (!candidate) return;
    const normalized = normalizeImageUrl(candidate, baseUrl);
    if (!normalized) return;
    if (isJunkImage(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const alt = $el.attr('alt')?.trim() || null;
    out.push({ url: normalized, alt: alt && alt.length > 0 ? alt : null });
  });
  return out;
}

function normalizeImageUrl(raw: string, baseUrl: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('data:')) return null;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  try {
    return new URL(s, baseUrl).toString();
  } catch {
    return null;
  }
}

function isJunkImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg')) return true;
  if (lower.endsWith('.gif')) return true;
  if (/\b1x1\b|spacer|blank|placeholder|loading\./i.test(lower)) return true;
  return false;
}

/** 用一组候选 CSS 选择器找正文容器；返回第一个非空命中。 */
export function findContainerBySelectors(
  $: CheerioAPI,
  selectors: string[],
): Cheerio<Element> | null {
  for (const sel of selectors) {
    const $c = $(sel).first();
    if ($c.length > 0 && $c.text().trim().length > 50) {
      return $c as Cheerio<Element>;
    }
  }
  return null;
}
