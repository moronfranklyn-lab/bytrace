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
export async function fetchArticlesWithDedupe(
  siteId: string,
  candidateUrls: string[],
  iteration: number,
  maxNewArticles: number = MAX_ARTICLES_FOR_PROFILE,
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
    `INSERT OR IGNORE INTO site_articles (site_id, url_hash, url, title, added_at, iteration)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const crawledStmt = db.prepare(
    `INSERT OR IGNORE INTO crawled_articles
       (id, author_id, url, url_hash, title, content, category, images_json,
        source_type, used_in_fingerprint_id, crawled_at, medium)
     VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
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
    try {
      linkStmt.run(siteId, hash, ca.url, ca.title ?? null, now, iteration);
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
      );
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
      `SELECT sa.url, sa.title, ca.content
       FROM site_articles sa
       JOIN crawled_articles ca ON ca.url_hash = sa.url_hash
       WHERE sa.site_id = ?
       ORDER BY sa.added_at DESC
       LIMIT ?`,
    )
    .all(siteId, maxN) as { url: string; title: string | null; content: string | null }[];
  return rows
    .filter((r) => r.content && r.content.length >= MIN_CONTENT_LENGTH)
    .map((r) => ({
      title: r.title ?? undefined,
      url: r.url,
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
