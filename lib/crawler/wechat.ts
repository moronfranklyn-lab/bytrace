import type { CrawledArticle, CrawlError, UrlTypeInfo } from './types';
import { hashUrl } from './dedupe';
import { isApifyEnabled, fetchWechatArticle } from './apify';
import {
  runOpenCliJson,
  OpenCliNotAvailable,
  OpenCliError,
} from './opencli';

/**
 * 公众号通道（v2 · OpenCLI 接入后）。
 *
 * 优先级：OpenCLI weixin download → Apify wechat scraper（兜底）→ 手贴拒绝。
 * 跟 CLAUDE.md「反爬与账号边界 v2」对齐：OpenCLI 是默认通道，Apify 退到最后手段。
 */

export function isWechatHost(host: string): boolean {
  return /(^|\.)mp\.weixin\.qq\.com$/i.test(host);
}

export function wechatRejection(): CrawlError {
  return {
    reason: 'wechat',
    message: '这次没拿下来。OpenCLI 和 Apify 都没接住，请直接粘贴正文兜个底。',
  };
}

export function wechatUrlTypeInfo(): UrlTypeInfo {
  return {
    platform: '公众号',
    is_wechat: true,
    is_supported_for_crawl: true,
    hint: 'OpenCLI 抓取公众号文章 · 无需 Apify',
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
    throw err;
  }

  const entry = result[0];
  if (!entry || entry.status !== 'success' || !entry.saved) {
    return null;
  }

  // 读 OpenCLI 写的 markdown 文件
  const { readFile, unlink, rm } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
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
  // 整个父目录都是这一篇专属的，直接 rm -rf 父目录
  try {
    await unlink(absPath).catch(() => undefined);
    await rm(dirname(absPath), { recursive: true, force: true }).catch(() => undefined);
  } catch {/* 清理失败不致命 */}

  // 提取正文（剥掉 OpenCLI 加的 frontmatter 头：> 公众号 / > 发布时间 / > 原文链接 / ---）
  const bodyOnly = content
    .replace(/^# .+\n/, '')                    // 去 # 标题（标题字段单独存）
    .replace(/^> .+\n/gm, '')                  // 去 > 元数据行
    .replace(/^---\s*\n/m, '')                 // 去分隔线
    .trim();

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
 * 公众号文章统一入口：OpenCLI 优先 → Apify 兜底 → 手贴拒绝。
 *
 * 注：保留函数名 crawlWechatViaApify 以免破坏 lib/crawler/index.ts 的 import。
 * 内部实现已升级为多通道。
 */
export async function crawlWechatViaApify(
  url: URL,
): Promise<CrawledArticle | CrawlError> {
  // Tier 1: OpenCLI
  const openCliResult = await crawlWechatViaOpenCli(url);
  if (openCliResult && !('reason' in openCliResult)) {
    return openCliResult;
  }

  // Tier 2: Apify 兜底（仅在用户配置了 token 时）
  if (isApifyEnabled()) {
    const r = await fetchWechatArticle(url.toString());
    if (r) {
      const urlStr = r.article.url || url.toString();
      return {
        url: urlStr,
        url_hash: hashUrl(urlStr),
        title: r.article.title || null,
        content: r.article.content,
        images: [],
        source: 'cheerio',
        host: url.hostname,
        apify_run_id: r.runId,
        apify_cost_usd: r.costUsd,
        apify_platform: 'wechat',
      };
    }
  }

  // Tier 3: 让用户手贴
  return wechatRejection();
}
