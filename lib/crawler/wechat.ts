import type { CrawledArticle, CrawlError, UrlTypeInfo } from './types';
import { hashUrl } from './dedupe';
import {
  runOpenCliJson,
  OpenCliNotAvailable,
  OpenCliError,
} from './opencli';

/**
 * 公众号通道（v2 · OpenCLI 接入后）。
 *
 * 优先级：OpenCLI weixin download → 手贴拒绝。
 * 跟 CLAUDE.md「反爬与账号边界 v2」对齐：OpenCLI 是默认通道。
 */

export function isWechatHost(host: string): boolean {
  return /(^|\.)mp\.weixin\.qq\.com$/i.test(host);
}

export function wechatRejection(): CrawlError {
  return {
    reason: 'wechat',
    message: '这次没拿下来。OpenCLI 没接住，请直接粘贴正文兜个底。',
  };
}

export function wechatUrlTypeInfo(): UrlTypeInfo {
  return {
    platform: '公众号',
    is_wechat: true,
    is_supported_for_crawl: true,
    hint: 'OpenCLI 抓取公众号文章',
  };
}

/**
 * OpenCLI weixin download 返回的 JSON 结构（实测，v1.8.0）：
 *   [{
 *     "title": "...", "author": "...", "publish_time": "...",
 *     "status": "success", "size": "33.8 KB",
 *     "saved": "weixin-articles/.../xxx.md"
 *   }]
 * 注意：saved 是 markdown 文件路径——正文要再读这个文件。
 */
interface OpenCliWeixinDownloadEntry {
  title?: string;
  author?: string;
  publish_time?: string;
  status?: string;
  size?: string;
  saved?: string;
}

/**
 * 剥掉 OpenCLI 落盘 markdown 的头部：# 标题 / > 元数据行（公众号、发布时间、原文链接）/ --- 分隔线。
 * 只处理文件头部区域（前 20 行内连续的头部行）：标题前有别的行也能剥干净，
 * 且正文里合法的 # 标题、> 引用、--- 水平线不受影响。
 */
function stripOpenCliHeader(content: string): string {
  const lines = content.split('\n');
  let i = 0;
  let titleSeen = false;
  let sepSeen = false;
  while (i < lines.length && i < 20) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (sepSeen) break; // --- 之后就是正文
    if (!titleSeen && /^# /.test(line)) { titleSeen = true; i++; continue; }
    if (/^> /.test(line)) { i++; continue; }
    if (/^---\s*$/.test(line)) { sepSeen = true; i++; continue; }
    break;
  }
  return lines.slice(i).join('\n').trim();
}

async function crawlWechatViaOpenCli(url: URL): Promise<CrawledArticle | CrawlError | null> {
  let result: OpenCliWeixinDownloadEntry[];
  try {
    result = await runOpenCliJson<OpenCliWeixinDownloadEntry[]>(
      [
        'weixin', 'download',
        '--url', url.toString(),
        '--download-images', 'false', // 我们不需要本地图片副本，markdown 里 URL 留着够用
      ],
      { timeoutMs: 90_000 },
    );
  } catch (err) {
    if (err instanceof OpenCliNotAvailable) {
      return null; // 没装 → 走下一通道
    }
    if (err instanceof OpenCliError) {
      // 失败时 OpenCLI 会返回 ok:false JSON 解析不出来，stderr 里有原因。
      // 部分场景是 article 404/被删，部分是 daemon/extension 没连——都走兜底
      console.warn('OpenCLI weixin download 失败：' + err.message.slice(0, 200));
      return null;
    }
    // OpenCliTimeout 等其它异常也不上抛——上抛会击穿 Apify / 手贴的三级兜底链
    console.warn(
      'OpenCLI weixin download 异常：' +
        (err instanceof Error ? err.message.slice(0, 200) : String(err)),
    );
    return null;
  }

  const entry = result[0];
  if (!entry || entry.status !== 'success' || !entry.saved) {
    return null;
  }

  // 读 OpenCLI 写的 markdown 文件
  const { readFile, unlink } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  // saved 是相对当前 cwd 的路径（默认 ./weixin-articles/...）
  const absPath = resolve(process.cwd(), entry.saved);
  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch (err) {
    console.warn('OpenCLI 报成功但读不到 markdown 文件：' + absPath);
    return null;
  }

  // 清理 OpenCLI 留下的文件（我们入库后不需要本地副本）
  // 只删本文件不删目录：目录可能按公众号共享，并发抓同号两篇时删目录会互删对方文件
  try {
    await unlink(absPath).catch(() => undefined);
  } catch {/* 清理失败不致命 */}

  // 提取正文（剥掉 OpenCLI 加的头：# 标题 / > 元数据行 / --- 分隔线）
  const bodyOnly = stripOpenCliHeader(content);

  if (bodyOnly.length < 80) {
    console.warn('OpenCLI 拿到的公众号正文过短：' + bodyOnly.length + ' 字');
    return null;
  }

  // 从 markdown 里抽图片 URL
  const imageRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  const images: { url: string; alt: string | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = imageRe.exec(bodyOnly)) !== null) {
    images.push({ url: m[1], alt: null });
  }

  const urlStr = url.toString();
  return {
    url: urlStr,
    url_hash: hashUrl(urlStr),
    title: entry.title?.trim() || null,
    content: bodyOnly,
    images,
    source: 'cheerio', // 不引入新 source 枚举值，沿用现有
    host: url.hostname,
  };
}

/**
 * crawlWechatViaApify（历史函数名保留以兼容 lib/crawler/index.ts）
 * 现在只走 OpenCLI，不再调用 Apify。
 */
export async function crawlWechatViaApify(
  url: URL,
): Promise<CrawledArticle | CrawlError> {
  // OpenCLI
  const openCliResult = await crawlWechatViaOpenCli(url);
  if (openCliResult && !('reason' in openCliResult)) {
    return openCliResult;
  }

  // 让用户手贴
  return wechatRejection();
}
