/**
 * B 站适配器（Agent I）。
 *
 * 覆盖两种 URL：
 *   - 视频页：https://www.bilibili.com/video/BV...   →  crawlArticle 抽字幕作为 content
 *   - UP 主主页：https://space.bilibili.com/<mid>     →  crawlAuthorIndex 取最近 30 个视频
 *
 * 关键点：
 * - 所有 B 站 API 必须带 Referer: https://www.bilibili.com/，否则 403/-352
 * - 字幕来源：x/player/v2 拿到 subtitle.subtitles 列表 → 选最优 → 拉 .json 字幕文件
 * - 字幕优先级：中文（zh-CN > zh）> 自动生成（ai-）> 任意第一个
 * - 没字幕时 content = 「（此视频未提供字幕）」+ 标题 + 简介，保证 LLM 有上下文
 * - UP 主视频列表先用新接口（wbi/arc/search），失败降级到老接口（space/arc/search）
 */

import got from 'got';
import type {
  SiteAdapter,
  CrawledArticle,
  CrawledAuthorIndex,
  CrawlError,
} from '../types';
import { hashUrl } from '../dedupe';
import { DESKTOP_UA } from '../http';
import {
  runOpenCliJson,
  OpenCliNotAvailable,
  OpenCliError,
} from '../opencli';

/** B 站接口统一 headers：Referer 是关键。 */
function bilibiliHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    ...extra,
  };
}

/**
 * 第一次访问 b 站会被发一份 Buvid3 cookie；UP 主接口 -799「请求过于频繁」常常是
 * 没 buvid 触发的风控。先 GET 一次主页吸 set-cookie。模块内缓存，进程级单次。
 */
let _cookieCache: string | null = null;
async function getBilibiliCookie(): Promise<string> {
  if (_cookieCache !== null) return _cookieCache;
  try {
    const res = await got('https://www.bilibili.com/', {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: { request: 12_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      followRedirect: true,
    });
    const setCookies = res.headers['set-cookie'] || [];
    const parts = setCookies
      .map((c) => c.split(';')[0])
      .filter((kv) => /^(buvid3|b_nut|b_lsid|_uuid|buvid_fp)=/i.test(kv));
    _cookieCache = parts.join('; ');
  } catch {
    _cookieCache = '';
  }
  return _cookieCache;
}

/** got 包装：12s 超时；非 2xx 转为 CrawlError；JSON 体直接 parse。 */
async function fetchJson<T = unknown>(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<T | CrawlError> {
  try {
    const res = await got(url, {
      headers: bilibiliHeaders(extraHeaders),
      timeout: { request: 12_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      followRedirect: true,
      maxRedirects: 5,
      responseType: 'json',
    });
    if (res.statusCode === 404) {
      return { reason: 'not-found', message: '这个 B 站链接打不开了（404）' };
    }
    if (res.statusCode === 403 || res.statusCode === 412 || res.statusCode === 429) {
      return { reason: 'blocked', message: 'B 站把请求拦下来了（' + res.statusCode + '），稍后再试' };
    }
    if (res.statusCode >= 400) {
      return { reason: 'parse-failed', message: `B 站接口返回了 ${res.statusCode}` };
    }
    return res.body as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(msg)) {
      return { reason: 'timeout', message: 'B 站 12 秒没回应，先放着' };
    }
    return { reason: 'parse-failed', message: 'B 站接口抽风：' + truncate(msg, 80) };
  }
}

/** 从 URL 抽 BV 号。 */
function extractBvid(url: URL): string | null {
  const m = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/);
  return m ? m[1] : null;
}

/**
 * 展开 b23.tv 短链：跟随重定向拿最终 URL（got 的 res.url 是重定向后的地址）。
 * 展开失败或最终还是 b23.tv（异常场景）返回 null，调用方保持 unsupported 提示。
 */
async function expandB23ShortLink(url: URL): Promise<URL | null> {
  try {
    const res = await got(url.toString(), {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: { request: 12_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      followRedirect: true,
      maxRedirects: 5,
    });
    if (!res.url) return null;
    const final = new URL(res.url);
    if (/(^|\.)b23\.tv$/i.test(final.hostname)) return null;
    return final;
  } catch {
    return null;
  }
}

/** 从 URL 抽 UP 主 mid。 */
function extractSpaceMid(url: URL): string | null {
  // host 形如 space.bilibili.com/<mid>
  if (/(^|\.)space\.bilibili\.com$/i.test(url.hostname)) {
    const m = url.pathname.match(/^\/(\d+)/);
    if (m) return m[1];
  }
  // 也支持 www.bilibili.com/space/<mid>（少见）
  const m2 = url.pathname.match(/\/space\/(\d+)/);
  if (m2) return m2[1];
  return null;
}

export const adapter: SiteAdapter = {
  id: 'bilibili',
  platform: 'B站',
  matches(url: URL): boolean {
    return /(^|\.)(bilibili\.com|b23\.tv)$/i.test(url.hostname);
  },
  urlKind(url: URL): 'article' | 'index' | 'unknown' {
    // 视频详情：/video/BV...
    if (/^\/video\/BV/i.test(url.pathname)) return 'article';
    // UP 主主页：space.bilibili.com/<mid>
    if (/(^|\.)space\.bilibili\.com$/i.test(url.hostname)) return 'index';
    return 'unknown';
  },

  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    let target = url;
    let bvid = extractBvid(target);
    // b23.tv 短链没有 /video/BV... 路径，先跟重定向展开成真实 URL 再走正常流程
    if (!bvid && /(^|\.)b23\.tv$/i.test(url.hostname)) {
      const expanded = await expandB23ShortLink(url);
      if (expanded) {
        target = expanded;
        bvid = extractBvid(target);
      }
    }
    if (!bvid) {
      return {
        reason: 'unsupported',
        message: '这个 B 站链接不像视频页，找个 /video/BV... 的链接试试',
      };
    }
    return crawlBilibiliVideo(bvid, target);
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    const mid = extractSpaceMid(url);
    if (!mid) {
      return {
        reason: 'unsupported',
        message: '这个 B 站 UP 主链接看不懂，应该长这样：space.bilibili.com/<数字>',
      };
    }
    return crawlBilibiliSpace(mid);
  },
};

/** 视频页：取标题 + 简介 + 封面 + 字幕。 */
async function crawlBilibiliVideo(
  bvid: string,
  url: URL,
): Promise<CrawledArticle | CrawlError> {
  // OpenCLI bilibili video + subtitle（v2 反爬约束）
  // 元数据无需登录；字幕需要 Chrome 登录 B 站，没登录就只拿元数据
  const openCliResult = await crawlBilibiliViaOpenCli(bvid, url);
  if (openCliResult) return openCliResult;

  // 1) view 接口拿基础信息
  const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const view = await fetchJson<BilibiliViewResp>(viewUrl);
  if ('reason' in view) return view;
  if (view.code !== 0 || !view.data) {
    return {
      reason: 'parse-failed',
      message: 'B 站 view 接口报错：' + (view.message || `code=${view.code}`),
    };
  }
  const v = view.data;
  const title = v.title || null;
  const desc = (v.desc || '').trim();
  const upName = v.owner?.name || '';
  const pic = v.pic ? normalizeBiliImage(v.pic) : '';
  const faceUrl = v.owner?.face ? normalizeBiliImage(v.owner.face) : '';
  const cid = v.cid;

  // 2) player/v2 拿字幕索引（带 cid 才能拿到对应分 P 的字幕）
  let subtitleText = '';
  let subtitleNote = '';
  if (cid) {
    const playerUrl =
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`;
    const player = await fetchJson<BilibiliPlayerResp>(playerUrl);
    if ('reason' in player) {
      // 字幕拉不到不算致命，正文兜底
      subtitleNote = `（字幕拉取失败：${player.message}）`;
    } else if (player.code === 0 && player.data?.subtitle?.subtitles) {
      const list = player.data.subtitle.subtitles;
      const chosen = chooseSubtitle(list);
      if (chosen) {
        const subUrl = normalizeBiliSubtitleUrl(chosen.subtitle_url);
        const subRes = await fetchJson<BilibiliSubtitleFile>(subUrl);
        if (!('reason' in subRes) && Array.isArray(subRes.body)) {
          subtitleText = mergeSubtitleLines(subRes.body);
        } else if ('reason' in subRes) {
          subtitleNote = `（字幕文件拉取失败：${subRes.message}）`;
        }
      }
    }
  }

  let content: string;
  if (subtitleText) {
    content = composeArticleBody({ title, upName, desc, subtitleText });
  } else {
    content = composeArticleBody({
      title,
      upName,
      desc,
      subtitleText: '',
      note: subtitleNote || '（此视频未提供字幕，仅含标题和简介）',
    });
  }

  const images: { url: string; alt: string | null }[] = [];
  if (pic) images.push({ url: pic, alt: title });
  if (faceUrl) images.push({ url: faceUrl, alt: upName || null });

  return {
    url: url.toString(),
    url_hash: hashUrl(url.toString()),
    title,
    content,
    images,
    source: 'cheerio', // 没有视频专属枚举，沿用 cheerio 表示「非粘贴」
    host: url.hostname,
  };
}

/**
 * 拼装最终 content：
 *   标题
 *   UP 主
 *   简介
 *   ----
 *   字幕全文 / 备注
 */
function composeArticleBody(opts: {
  title: string | null;
  upName: string;
  desc: string;
  subtitleText: string;
  note?: string;
}): string {
  const lines: string[] = [];
  if (opts.title) lines.push(`# ${opts.title}`);
  if (opts.upName) lines.push(`UP 主：${opts.upName}`);
  if (opts.desc) {
    lines.push('');
    lines.push('## 视频简介');
    lines.push(opts.desc);
  }
  lines.push('');
  lines.push('## 字幕');
  if (opts.subtitleText) {
    lines.push(opts.subtitleText);
  } else {
    lines.push(opts.note || '（此视频未提供字幕，仅含标题和简介）');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * OpenCLI 通道：bilibili video（元数据，无需登录）+ subtitle（字幕，需登录 B 站）。
 *
 * 行为：
 * - 元数据拿不到（命令挂、daemon 断）→ 返回 null，让 Apify / 原生 API 兜底
 * - 字幕拿不到（用户没登 B 站或视频无字幕）→ 仅返回元数据，content = 标题+简介
 *
 * OpenCLI bilibili video -f json 输出（实测，field/value 两列 table）：
 *   [{ field: 'bvid', value: '...' }, { field: 'title', value: '...' }, ...]
 *
 * OpenCLI bilibili subtitle -f json 输出（待实测格式，按通用约定预期为字幕段数组）。
 */
async function crawlBilibiliViaOpenCli(
  bvid: string,
  url: URL,
): Promise<CrawledArticle | null> {
  let videoFields: { field: string; value: string }[];
  try {
    videoFields = await runOpenCliJson<{ field: string; value: string }[]>(
      ['bilibili', 'video', bvid],
      { timeoutMs: 60_000 },
    );
  } catch (err) {
    if (err instanceof OpenCliNotAvailable) return null;
    if (err instanceof OpenCliError) {
      console.warn('OpenCLI bilibili video 失败：' + err.message.slice(0, 200));
      return null;
    }
    return null;
  }
  if (!Array.isArray(videoFields) || videoFields.length === 0) return null;

  const map = new Map(videoFields.map((f) => [f.field, f.value]));
  const title = map.get('title') || null;
  const upName = (map.get('author') || '').replace(/\s*\(mid:.*\)/, '').trim();
  const desc = (map.get('description') || map.get('desc') || '').trim();
  const pic = map.get('cover') || map.get('pic') || '';

  // Tier 1.5: 尝试字幕
  let subtitleText = '';
  let subtitleNote = '';
  try {
    const sub = await runOpenCliJson<unknown>(
      ['bilibili', 'subtitle', bvid],
      { timeoutMs: 60_000 },
    );
    subtitleText = extractSubtitleText(sub);
    if (!subtitleText) {
      subtitleNote = '（OpenCLI 返回了字幕响应但解析为空，可能视频本身无字幕）';
    }
  } catch (err) {
    if (err instanceof OpenCliError && err.authRequired) {
      subtitleNote = '（B 站字幕需要 Chrome 登录 B 站才能拿。仅含标题和简介）';
    } else {
      subtitleNote = '（这次没拿到字幕，仅含标题和简介）';
    }
  }

  const content = composeArticleBody({
    title,
    upName,
    desc,
    subtitleText,
    note: subtitleText ? undefined : subtitleNote,
  });

  const images: { url: string; alt: string | null }[] = [];
  if (pic) images.push({ url: pic.startsWith('//') ? 'https:' + pic : pic, alt: title });

  return {
    url: url.toString(),
    url_hash: hashUrl(url.toString()),
    title,
    content,
    images,
    source: 'cheerio',
    host: url.hostname,
    medium: 'video',
  };
}

/** OpenCLI bilibili subtitle 输出格式比较自由——这里支持几种常见结构。 */
function extractSubtitleText(raw: unknown): string {
  if (!raw) return '';
  // 数组：[{ from, to, content }, ...] 或 [{ text: ... }]
  if (Array.isArray(raw)) {
    const lines = raw
      .map((seg) => {
        if (typeof seg === 'string') return seg;
        if (seg && typeof seg === 'object') {
          const r = seg as Record<string, unknown>;
          return (r.content ?? r.text ?? r.value ?? '') as string;
        }
        return '';
      })
      .filter((s) => typeof s === 'string' && s.trim().length > 0);
    return lines.join('\n').trim();
  }
  // 对象：{ subtitle: '...' } 或 { body: [...] }
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.subtitle === 'string') return r.subtitle;
    if (typeof r.text === 'string') return r.text;
    if (Array.isArray(r.body)) return extractSubtitleText(r.body);
    if (Array.isArray(r.subtitles)) return extractSubtitleText(r.subtitles);
  }
  return '';
}

/** 字幕选择优先级：中文 > 自动生成 > 任意第一个。 */
function chooseSubtitle(list: BilibiliSubtitleEntry[]): BilibiliSubtitleEntry | null {
  if (!list.length) return null;
  const cn = list.find((s) => /^zh(-|$)/i.test(s.lan));
  if (cn) return cn;
  const ai = list.find((s) => /^ai-/i.test(s.lan));
  if (ai) return ai;
  return list[0];
}

/**
 * 字幕分秒 JSON → 段落文本。
 * 规则：
 * - 拼接 content 字段
 * - 句尾遇到中文句号 / ?！或时间间隔 > 1.5s → 换段
 * - 整理空白
 */
function mergeSubtitleLines(lines: BilibiliSubtitleLine[]): string {
  const paragraphs: string[] = [];
  let current = '';
  let lastTo = 0;
  for (const line of lines) {
    const text = (line.content || '').trim();
    if (!text) continue;
    const gap = line.from - lastTo;
    if (current && (gap > 1.5 || /[。！？!?\.…]$/.test(current))) {
      paragraphs.push(current.trim());
      current = text;
    } else {
      current = current ? current + (needsSpace(current, text) ? ' ' : '') + text : text;
    }
    lastTo = line.to;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs.join('\n\n');
}

/** 两段中英衔接时加空格；纯中文不加。 */
function needsSpace(prev: string, next: string): boolean {
  const a = prev.slice(-1);
  const b = next.slice(0, 1);
  const isCjk = (ch: string) => /[一-鿿]/.test(ch);
  return !(isCjk(a) && isCjk(b));
}

/** B 站接口偶尔返回 // 起头的 URL；统一加 https:。 */
function normalizeBiliImage(s: string): string {
  if (!s) return s;
  if (s.startsWith('//')) return 'https:' + s;
  return s;
}

function normalizeBiliSubtitleUrl(s: string): string {
  if (!s) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return 'https://i0.hdslb.com' + s;
  return s;
}

/**
 * UP 主主页 → 最近 30 个视频。
 * 先尝试新接口 wbi/arc/search（需要 wbi 签名，简化处理：直接拼参数试一次），
 * 失败则用老接口 /x/space/arc/search 兜底。
 */
async function crawlBilibiliSpace(mid: string): Promise<CrawledAuthorIndex | CrawlError> {
  // 先把 buvid 拿到，UP 主接口对无 cookie 请求触发 -799 风控
  const cookie = await getBilibiliCookie();
  const cookieHeader = cookie ? { Cookie: cookie } : undefined;

  // 拿 UP 主名字（顺便用 view 之类的轻接口；用 acc/info 即可）
  let upName: string | null = null;
  const info = await fetchJson<BilibiliUserCardResp>(
    `https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(mid)}`,
    cookieHeader,
  );
  if (!('reason' in info) && info.code === 0 && info.data?.card?.name) {
    upName = info.data.card.name;
  }

  // 1) 新接口（不带 wbi 签名先试一次；多数情况下直接 412 被挡，是预期）
  const newUrl =
    `https://api.bilibili.com/x/space/wbi/arc/search?mid=${encodeURIComponent(mid)}&ps=30&pn=1&order=pubdate`;
  const newRes = await fetchJson<BilibiliArcSearchResp>(newUrl, cookieHeader);
  let vlist: BilibiliVlistItem[] | null = null;
  // 注意：newRes 可能是 CrawlError（412/-352）；只在拿到 ok 数据时记录，否则继续降级
  if (!('reason' in newRes) && newRes.code === 0 && newRes.data?.list?.vlist) {
    vlist = newRes.data.list.vlist;
  }

  // 2) 老接口降级（不需要 wbi 签名，但有更严的频次风控；带 buvid cookie 可缓解）
  if (!vlist || vlist.length === 0) {
    const oldUrl =
      `https://api.bilibili.com/x/space/arc/search?mid=${encodeURIComponent(mid)}&ps=30&pn=1&order=pubdate`;
    const oldRes = await fetchJson<BilibiliArcSearchResp>(oldUrl, cookieHeader);
    if ('reason' in oldRes) {
      // 老接口也挂了，告诉用户原因（可能 412 / 429 / 网络）
      return {
        reason: oldRes.reason,
        message: 'B 站 UP 主列表拉不动：' + oldRes.message,
      };
    }
    if (oldRes.code !== 0 || !oldRes.data?.list?.vlist) {
      return {
        reason: 'blocked',
        message:
          'B 站 UP 主视频列表拿不到（' +
          (oldRes.message || `code=${oldRes.code}`) +
          '），可能需要登录或被风控',
      };
    }
    vlist = oldRes.data.list.vlist;
  }

  const urls = vlist
    .map((it) => (it.bvid ? `https://www.bilibili.com/video/${it.bvid}` : null))
    .filter((x): x is string => !!x);

  return {
    author_name: upName,
    platform: 'B站',
    article_urls: urls,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ============================================================================
// B 站接口响应类型（局部，只覆盖用到的字段）
// ============================================================================

interface BilibiliViewResp {
  code: number;
  message?: string;
  data?: {
    title: string;
    desc: string;
    pic: string;
    cid: number;
    owner?: { name: string; face: string };
  };
}

interface BilibiliPlayerResp {
  code: number;
  message?: string;
  data?: {
    subtitle?: {
      subtitles?: BilibiliSubtitleEntry[];
    };
  };
}

interface BilibiliSubtitleEntry {
  lan: string;          // zh-CN / zh / ai-zh / en
  lan_doc?: string;     // 中文（中国） / 自动生成的中文
  subtitle_url: string; // // 开头
}

interface BilibiliSubtitleFile {
  body?: BilibiliSubtitleLine[];
}

interface BilibiliSubtitleLine {
  from: number;
  to: number;
  content: string;
}

interface BilibiliUserCardResp {
  code: number;
  data?: { card?: { name?: string } };
}

interface BilibiliArcSearchResp {
  code: number;
  message?: string;
  data?: {
    list?: { vlist?: BilibiliVlistItem[] };
  };
}

interface BilibiliVlistItem {
  bvid?: string;
  title?: string;
}
