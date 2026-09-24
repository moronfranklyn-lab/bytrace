/**
 * 站点画像通用引擎：被 POST /api/sites（新建）和 PATCH /api/sites/[id]（加样本）共用。
 *
 * 三个能力：
 * 1. fetchArticlesWithDedupe —— 给一批候选 URL，按 site_id 去重，逐篇 crawlArticle，写 site_articles
 * 2. loadHistorySamples     —— 从 site_articles + crawled_articles 拿出某 site 已有样本（最新 N 篇）
 * 3. buildAndRunProfile     —— 拼 prompt、调 Claude、解析 JSON
 */

import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { streamClaude } from '@/lib/claude';
import {
  buildSiteProfilePrompt,
  type SiteProfileArticle,
} from '@/lib/prompts/siteprofile';
import {
  crawlArticle,
  hashUrl,
  isCrawlError,
  type CrawledArticle,
} from '@/lib/crawler';

export const MIN_ARTICLES_FOR_PROFILE = 3;
export const MAX_ARTICLES_FOR_PROFILE = 20;
/** 加样本时按时间线尽量抓最近一个月；上限只是防死循环/异常页面。 */
export const MAX_NEW_ARTICLES_PER_PATCH = 50;
export const RECENT_ARTICLE_WINDOW_DAYS = 31;
const PER_FETCH_SLEEP_MS = 1000;
const MIN_CONTENT_LENGTH = 200;

export interface DedupeFetchResult {
  /** 本轮成功爬到且未重复的新文章（已写入 site_articles + crawled_articles） */
  newly_added: SiteProfileArticle[];
  /** 因为已在 site_articles 而跳过的 URL */
  skipped_duplicate: { url: string; existing_title: string | null }[];
  /** 爬失败的 URL 与原因 */
  failed: { url: string; reason: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把一批候选 URL 跟现有 site_articles 比对：
 *   - 已存在 → 跳过
 *   - 新的    → 逐篇 crawl，成功的写入 site_articles + crawled_articles
 */
function parsePublishTimeMs(raw?: string | null): number | null {
  if (!raw) return null;
  const normalized = raw
    .trim()
    .replace(/年|\//g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\s+/g, ' ');
  const direct = Date.parse(normalized);
  if (!Number.isNaN(direct)) return direct;
  const m = normalized.match(/(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0,
  ).getTime();
}

export async function fetchArticlesWithDedupe(
  siteId: string,
  candidateUrls: string[],
  iteration: number,
  maxNewArticles: number = MAX_ARTICLES_FOR_PROFILE,
  options: { recentDays?: number } = {},
): Promise<DedupeFetchResult> {
  const db = getDb();
  const result: DedupeFetchResult = {
    newly_added: [],
    skipped_duplicate: [],
    failed: [],
  };

  // 一次性查出 site_articles 已有的 url_hash 集合
  const existingHashes = new Set(
    (
      db
        .prepare(
          `SELECT url_hash, url, title FROM site_articles WHERE site_id = ?`,
        )
        .all(siteId) as { url_hash: string; url: string; title: string | null }[]
    ).map((r) => r.url_hash),
  );

  // 记录已存在的 title 便于报告
  const existingMeta = new Map<string, string | null>(
    (
      db
        .prepare(
          `SELECT url_hash, title FROM site_articles WHERE site_id = ?`,
        )
        .all(siteId) as { url_hash: string; title: string | null }[]
    ).map((r) => [r.url_hash, r.title]),
  );

  const linkStmt = db.prepare(
    `INSERT OR IGNORE INTO site_articles (site_id, url_hash, url, title, added_at, iteration, publish_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const crawledStmt = db.prepare(
    `INSERT OR IGNORE INTO crawled_articles
       (id, author_id, url, url_hash, title, content, category, images_json,
        source_type, used_in_fingerprint_id, crawled_at, medium, publish_time)
     VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
  );

  for (let i = 0; i < candidateUrls.length; i++) {
    if (result.newly_added.length >= maxNewArticles) break;
    const url = candidateUrls[i].trim();
    if (!url) continue;
    const hash = hashUrl(url);

    if (existingHashes.has(hash)) {
      result.skipped_duplicate.push({
        url,
        existing_title: existingMeta.get(hash) ?? null,
      });
      continue;
    }

    if (i > 0 && result.newly_added.length > 0) await sleep(PER_FETCH_SLEEP_MS);

    const a = await crawlArticle(url);
    if (isCrawlError(a)) {
      result.failed.push({ url, reason: a.message });
      continue;
    }
    const ca = a as CrawledArticle;
    if (!ca.content || ca.content.length < MIN_CONTENT_LENGTH) {
      result.failed.push({ url, reason: '正文太短' });
      continue;
    }

    const now = Date.now();
    if (options.recentDays) {
      const publishMs = parsePublishTimeMs(ca.publish_time);
      const cutoff = now - options.recentDays * 24 * 60 * 60 * 1000;
      // 抓不到发布时间时保守保留；抓到且早于窗口则跳过，不进入样本库。
      if (publishMs && publishMs < cutoff) {
        result.failed.push({
          url,
          reason: `发布时间 ${ca.publish_time} 早于最近 ${options.recentDays} 天，已按时间线跳过`,
        });
        continue;
      }
    }

    try {
      // 两条 insert 必须同进同退：site_articles 先成功、crawled_articles 再失败
      // 会让这条 URL 永远被判"已存在"却取不到正文，所以包进同一个事务
      db.transaction(() => {
        linkStmt.run(siteId, hash, ca.url, ca.title ?? null, now, iteration, ca.publish_time ?? null);
        crawledStmt.run(
          nanoid(14),
          ca.url,
          hash,
          ca.title ?? null,
          ca.content,
          ca.images ? JSON.stringify(ca.images) : null,
          ca.source,
          now,
          ca.medium ?? 'text',
          ca.publish_time ?? null,
        );
      })();
    } catch (err) {
      result.failed.push({
        url,
        reason: '入库失败：' + (err as Error).message,
      });
      continue;
    }

    existingHashes.add(hash);
    result.newly_added.push({
      title: ca.title ?? undefined,
      url: ca.url,
      content: ca.content,
    });
  }

  return result;
}

/**
 * 取该 site 已经入库的样本（按 added_at 倒序，最新最多 maxN 篇）。
 * 用于「累计重跑」prompt 输入。
 */
export function loadHistorySamples(
  siteId: string,
  maxN: number = MAX_ARTICLES_FOR_PROFILE,
): SiteProfileArticle[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT sa.url, sa.title, COALESCE(sa.publish_time, ca.publish_time) AS publish_time, ca.content
       FROM site_articles sa
       JOIN crawled_articles ca ON ca.url_hash = sa.url_hash
       WHERE sa.site_id = ?
       ORDER BY sa.added_at DESC
       LIMIT ?`,
    )
    .all(siteId, maxN) as { url: string; title: string | null; publish_time: string | null; content: string | null }[];
  return rows
    .filter((r) => r.content && r.content.length >= MIN_CONTENT_LENGTH)
    .map((r) => ({
      title: r.title ?? undefined,
      url: r.url,
      publish_time: r.publish_time ?? undefined,
      content: r.content as string,
    }));
}

/**
 * 拼 prompt → 调 Claude → 剥 fence → JSON.parse。
 * 出错抛 Error，调用方决定怎么转 4xx/5xx。
 */
export async function runProfileExtraction(
  articles: SiteProfileArticle[],
  hint: { siteHost?: string; sectionHint?: string },
): Promise<Record<string, unknown>> {
  if (articles.length < MIN_ARTICLES_FOR_PROFILE) {
    throw new Error(
      `样本不够（只有 ${articles.length} 篇，至少要 ${MIN_ARTICLES_FOR_PROFILE} 篇）`,
    );
  }
  const prompt = buildSiteProfilePrompt(articles, hint);
  const raw = await streamClaude(prompt, { timeoutMs: 240_000 });
  const cleaned = stripJsonFence(raw);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      '模型输出了一段不太像 JSON 的东西：' + (err as Error).message,
    );
  }
}

function stripJsonFence(raw: string): string {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return raw.trim();
}
