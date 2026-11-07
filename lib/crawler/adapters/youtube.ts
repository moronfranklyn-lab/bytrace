/**
 * YouTube 适配器（Agent I）框架版。
 *
 * 设计：
 * - 无 YOUTUBE_DATA_API_KEY → 优雅返回 unsupported，引导用户去申请
 * - 有 key → 使用 YouTube Data API v3：
 *     videos.list   拿 title / description / channel
 *     channels.list 拿频道信息
 *     search.list   按 channelId 拿最近视频
 *     字幕（caption track）：
 *       1) captions.list → 拿 caption track id（OAuth 才能下载实际内容，免费 key 不行）
 *       2) 退路：直接调 https://www.youtube.com/api/timedtext?v=<vid>&lang=...
 *          这个端点不需要 key，但需要视频本身有字幕；少数视频也会返回空
 *
 * 真实视频抓取 + 字幕能力放 key 存在时才启用；否则只返回标题/描述兜底。
 * 这一轮先把骨架搭好；用户填完 key 之后立刻可用。
 */

import got from 'got';
import type {
  SiteAdapter,
  CrawledArticle,
  CrawledAuthorIndex,
  CrawlError,
} from '../types';
import { hashUrl } from '../dedupe';
import { envStr, YOUTUBE_KEY_KEYS } from '@/lib/env';
import { DESKTOP_UA } from '../http';

const YT_KEY = () => envStr(...YOUTUBE_KEY_KEYS) || '';

const YT_DATA_BASE = 'https://www.googleapis.com/youtube/v3';

/** YouTube URL 识别。 */
export const adapter: SiteAdapter = {
  id: 'youtube',
  platform: 'YouTube',
  matches(url: URL): boolean {
    return /(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname);
  },

  async crawlArticle(url: URL): Promise<CrawledArticle | CrawlError> {
    const key = YT_KEY();
    if (!key) {
      return {
        reason: 'unsupported',
        message:
          'YouTube 需要 API key 才能抓字幕。到 https://console.cloud.google.com 申请 YouTube Data API v3 key，填入 .env.local 的 YOUTUBE_DATA_API_KEY 后重启 dev。',
      };
    }
    const vid = extractVideoId(url);
    if (!vid) {
      return {
        reason: 'unsupported',
        message: '这个 YouTube 链接不像视频页，找一个 watch?v=... 的链接试试',
      };
    }
    return crawlYouTubeVideo(vid, url, key);
  },

  async crawlAuthorIndex(url: URL): Promise<CrawledAuthorIndex | CrawlError> {
    const key = YT_KEY();
    if (!key) {
      return {
        reason: 'unsupported',
        message:
          'YouTube 频道抓取需要 API key。到 https://console.cloud.google.com 申请 YouTube Data API v3 key，填入 .env.local 后重启 dev。',
      };
    }
    const channelRef = extractChannelRef(url);
    if (!channelRef) {
      return {
        reason: 'unsupported',
        message: '这个 YouTube 链接看不出是哪个频道，试试 /channel/UCxxxx 或 /@handle 形式',
      };
    }
    return crawlYouTubeChannel(channelRef, key);
  },
};

function extractVideoId(url: URL): string | null {
  // youtu.be/<id>
  if (/(^|\.)youtu\.be$/i.test(url.hostname)) {
    const m = url.pathname.match(/^\/([\w-]{6,})/);
    if (m) return m[1];
  }
  // youtube.com/watch?v=<id>
  const v = url.searchParams.get('v');
  if (v) return v;
  // youtube.com/shorts/<id> 或 /embed/<id>
  const m2 = url.pathname.match(/\/(?:shorts|embed)\/([\w-]{6,})/);
  if (m2) return m2[1];
  return null;
}

function extractChannelRef(url: URL): { kind: 'id' | 'handle' | 'user'; value: string } | null {
  const p = url.pathname;
  let m = p.match(/^\/channel\/(UC[\w-]+)/);
  if (m) return { kind: 'id', value: m[1] };
  m = p.match(/^\/@([\w.\-]+)/);
  if (m) return { kind: 'handle', value: m[1] };
  m = p.match(/^\/user\/([\w.\-]+)/);
  if (m) return { kind: 'user', value: m[1] };
  return null;
}

async function ytGet<T>(
  url: string,
): Promise<T | CrawlError> {
  try {
    const res = await got(url, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
      timeout: { request: 12_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'json',
    });
    if (res.statusCode === 403) {
      return { reason: 'blocked', message: 'YouTube API 403：key 无效或配额耗尽' };
    }
    if (res.statusCode === 404) {
      return { reason: 'not-found', message: 'YouTube 资源不存在' };
    }
    if (res.statusCode >= 400) {
      return { reason: 'parse-failed', message: `YouTube API 返回 ${res.statusCode}` };
    }
    return res.body as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(msg)) return { reason: 'timeout', message: 'YouTube 12 秒没回应' };
    return { reason: 'parse-failed', message: 'YouTube 抽风：' + truncate(msg, 80) };
  }
}

async function crawlYouTubeVideo(
  vid: string,
  url: URL,
  key: string,
): Promise<CrawledArticle | CrawlError> {
  const videoUrl =
    `${YT_DATA_BASE}/videos?part=snippet,contentDetails&id=${encodeURIComponent(vid)}&key=${encodeURIComponent(key)}`;
  const videoRes = await ytGet<YtVideoListResp>(videoUrl);
  if ('reason' in videoRes) return videoRes;
  const item = videoRes.items?.[0];
  if (!item) {
    return { reason: 'not-found', message: '这个 YouTube 视频拿不到，可能被删/私有了' };
  }
  const title = item.snippet?.title || null;
  const desc = item.snippet?.description || '';
  const channelTitle = item.snippet?.channelTitle || '';
  const thumb =
    item.snippet?.thumbnails?.maxres?.url ||
    item.snippet?.thumbnails?.high?.url ||
    item.snippet?.thumbnails?.medium?.url ||
    '';

  // 字幕：先试 timedtext 端点
  const subtitleText = await fetchYouTubeTimedText(vid);
  let content: string;
  if (subtitleText) {
    content = composeYouTubeBody({ title, channelTitle, desc, subtitleText });
  } else {
    content = composeYouTubeBody({
      title,
      channelTitle,
      desc,
      subtitleText: '',
      note: '（此视频没有可下载的字幕轨，仅含标题和简介）',
    });
  }

  const images: { url: string; alt: string | null }[] = [];
  if (thumb) images.push({ url: thumb, alt: title });

  return {
    url: url.toString(),
    url_hash: hashUrl(url.toString()),
    title,
    content,
    images,
    source: 'cheerio',
    host: url.hostname,
  };
}

function composeYouTubeBody(opts: {
  title: string | null;
  channelTitle: string;
  desc: string;
  subtitleText: string;
  note?: string;
}): string {
  const lines: string[] = [];
  if (opts.title) lines.push(`# ${opts.title}`);
  if (opts.channelTitle) lines.push(`频道：${opts.channelTitle}`);
  if (opts.desc) {
    lines.push('');
    lines.push('## 视频简介');
    lines.push(opts.desc);
  }
  lines.push('');
  lines.push('## 字幕');
  lines.push(opts.subtitleText || opts.note || '（此视频未提供字幕）');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 尝试拉取 timedtext（无需 API key 的字幕端点）。
 * 常见 lang：zh-Hans / zh-CN / en；先按 zh-Hans → zh-CN → en 顺序试。
 * 拿到的是 XML（<transcript><text start="..." dur="...">...</text>...</transcript>）。
 * 拉不到就返回空字符串，由调用方决定怎么提示。
 */
async function fetchYouTubeTimedText(vid: string): Promise<string> {
  const langs = ['zh-Hans', 'zh-CN', 'zh', 'en'];
  for (const lang of langs) {
    const url =
      `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(vid)}&lang=${encodeURIComponent(lang)}`;
    try {
      const res = await got(url, {
        headers: { 'User-Agent': DESKTOP_UA },
        timeout: { request: 12_000 },
        retry: { limit: 0 },
        throwHttpErrors: false,
        responseType: 'text',
      });
      if (res.statusCode === 200 && res.body && res.body.includes('<text')) {
        const merged = mergeTimedText(res.body);
        if (merged) return merged;
      }
    } catch {
      // 跳过这个 lang
    }
  }
  return '';
}

/** timedtext XML → 段落文本（用换行间隔做段落判断）。 */
function mergeTimedText(xml: string): string {
  const out: string[] = [];
  let current = '';
  const re = /<text[^>]*start="([^"]+)"[^>]*(?:dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const start = Number(m[1]);
    const dur = Number(m[2] || '0');
    const raw = m[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n/g, ' ')
      .trim();
    if (!raw) continue;
    const gap = start - lastEnd;
    if (current && (gap > 1.5 || /[.。!？?…]$/.test(current))) {
      out.push(current.trim());
      current = raw;
    } else {
      current = current ? current + ' ' + raw : raw;
    }
    lastEnd = start + dur;
  }
  if (current.trim()) out.push(current.trim());
  return out.join('\n\n');
}

async function crawlYouTubeChannel(
  ref: { kind: 'id' | 'handle' | 'user'; value: string },
  key: string,
): Promise<CrawledAuthorIndex | CrawlError> {
  // 1) 先把 ref 解析成 channelId
  let channelId: string;
  let channelTitle: string | null = null;
  if (ref.kind === 'id') {
    channelId = ref.value;
    // 顺便拿 title
    const ci = await ytGet<YtChannelListResp>(
      `${YT_DATA_BASE}/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(key)}`,
    );
    if (!('reason' in ci)) channelTitle = ci.items?.[0]?.snippet?.title ?? null;
  } else if (ref.kind === 'handle') {
    const ci = await ytGet<YtChannelListResp>(
      `${YT_DATA_BASE}/channels?part=snippet&forHandle=@${encodeURIComponent(ref.value)}&key=${encodeURIComponent(key)}`,
    );
    if ('reason' in ci) return ci;
    const item = ci.items?.[0];
    if (!item) return { reason: 'not-found', message: `找不到 @${ref.value} 频道` };
    channelId = item.id;
    channelTitle = item.snippet?.title ?? null;
  } else {
    const ci = await ytGet<YtChannelListResp>(
      `${YT_DATA_BASE}/channels?part=snippet&forUsername=${encodeURIComponent(ref.value)}&key=${encodeURIComponent(key)}`,
    );
    if ('reason' in ci) return ci;
    const item = ci.items?.[0];
    if (!item) return { reason: 'not-found', message: `找不到用户 ${ref.value} 的频道` };
    channelId = item.id;
    channelTitle = item.snippet?.title ?? null;
  }

  // 2) search.list 按 channelId 取最近 30 个视频
  const searchUrl =
    `${YT_DATA_BASE}/search?part=snippet&channelId=${encodeURIComponent(channelId)}` +
    `&order=date&type=video&maxResults=30&key=${encodeURIComponent(key)}`;
  const sr = await ytGet<YtSearchListResp>(searchUrl);
  if ('reason' in sr) return sr;
  const urls = (sr.items || [])
    .map((it) => (it.id?.videoId ? `https://www.youtube.com/watch?v=${it.id.videoId}` : null))
    .filter((x): x is string => !!x);

  return {
    author_name: channelTitle,
    platform: 'YouTube',
    article_urls: urls,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ============================================================================
// YouTube Data API v3 局部类型
// ============================================================================

interface YtVideoListResp {
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      thumbnails?: {
        default?: { url?: string };
        medium?: { url?: string };
        high?: { url?: string };
        maxres?: { url?: string };
      };
    };
  }>;
}

interface YtChannelListResp {
  items?: Array<{
    id: string;
    snippet?: { title?: string };
  }>;
}

interface YtSearchListResp {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: { title?: string };
  }>;
}
