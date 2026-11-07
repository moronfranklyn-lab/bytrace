import got, { type Response } from 'got';
import type { CrawlError } from './types';

/** 仿真桌面 Chrome 的 UA，避免被简单反爬识别。 */
export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB

/** 标准 headers：桌面 UA + Accept + 中文偏好。 */
export function defaultHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    ...extra,
  };
}

/**
 * 抓取一个 URL 的 HTML 文本。返回 string 或统一格式 CrawlError。
 * 12s 超时，最多 5 次重定向，HTML >5MB 拒绝。
 */
export async function fetchHtml(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<string | CrawlError> {
  let res: Response<string>;
  // 边下边控体积：超过 5MB 立即 abort，不等整页下完才检查
  // （got 15 没有 downloadLimit 选项，用 signal + downloadProgress 事件实现）
  const sizeController = new AbortController();
  let tooLarge = false;
  try {
    const promise = got(url, {
      headers: defaultHeaders(extraHeaders),
      timeout: { request: 12_000 },
      followRedirect: true,
      maxRedirects: 5,
      retry: { limit: 0 },
      throwHttpErrors: false,
      // got 默认会自动解码；保险起见显式响应类型
      responseType: 'text',
      signal: sizeController.signal,
    });
    promise.on('downloadProgress', (p: { transferred: number }) => {
      if (!tooLarge && p.transferred > MAX_HTML_BYTES) {
        tooLarge = true;
        sizeController.abort();
      }
    });
    res = await promise;
  } catch (e) {
    if (tooLarge) {
      return { reason: 'parse-failed', message: '页面太大了（>5MB），不像文章页，先放着吧' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout/i.test(msg)) {
      return { reason: 'timeout', message: '这个链接我没爬动，等了 12 秒还没回应' };
    }
    return { reason: 'parse-failed', message: '这个链接我没爬动：' + truncate(msg, 80) };
  }

  if (res.statusCode === 404) {
    return { reason: 'not-found', message: '这个链接打不开了（404），可能被删了' };
  }
  if (res.statusCode === 403 || res.statusCode === 429) {
    return { reason: 'blocked', message: '这个站点把我拦住了，可能需要登录或被反爬' };
  }
  if (res.statusCode >= 400) {
    return { reason: 'parse-failed', message: `这个链接返回了 ${res.statusCode}，我读不动` };
  }

  const body = res.body ?? '';
  if (body.length > MAX_HTML_BYTES) {
    return { reason: 'parse-failed', message: '页面太大了（>5MB），不像文章页，先放着吧' };
  }

  return body;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
