import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import {
  crawlAuthorIndex,
  detectUrlType,
  isCrawlError,
} from '@/lib/crawler';
import {
  fetchArticlesWithDedupe,
  runProfileExtraction,
  MIN_ARTICLES_FOR_PROFILE,
  MAX_ARTICLES_FOR_PROFILE,
} from '@/lib/sites/profile-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SiteRow {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  profile_json: string;
  source_url: string | null;
  source_article_count: number | null;
  created_at: number;
  updated_at: number | null;
  iteration_count: number | null;
}

interface SiteListItem {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  source_article_count: number | null;
  created_at: number;
  preferred_topics: string[];
  word_count_range: [number, number] | null;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function jsonOk(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function toListItem(row: SiteRow): SiteListItem {
  let preferred: string[] = [];
  let range: [number, number] | null = null;
  try {
    const profile = JSON.parse(row.profile_json) as Record<string, unknown>;
    if (Array.isArray(profile.preferred_topics)) {
      preferred = (profile.preferred_topics as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .slice(0, 6);
    }
    if (
      Array.isArray(profile.word_count_range) &&
      profile.word_count_range.length === 2 &&
      typeof profile.word_count_range[0] === 'number' &&
      typeof profile.word_count_range[1] === 'number'
    ) {
      range = [
        profile.word_count_range[0] as number,
        profile.word_count_range[1] as number,
      ];
    }
  } catch {
    // 容错
  }
  return {
    id: row.id,
    site_name: row.site_name,
    section: row.section,
    url_pattern: row.url_pattern,
    source_article_count: row.source_article_count,
    created_at: row.created_at,
    preferred_topics: preferred,
    word_count_range: range,
  };
}

/** GET /api/sites */
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, site_name, section, url_pattern, profile_json,
                source_url, source_article_count, created_at, updated_at,
                iteration_count
         FROM sites
         ORDER BY COALESCE(updated_at, created_at) DESC`,
      )
      .all() as SiteRow[];
    return jsonOk({ items: rows.map(toListItem) });
  } catch (err) {
    return jsonError(`读取站点列表失败：${(err as Error).message}`, 500);
  }
}

/**
 * POST /api/sites —— 新建站点画像
 *
 * Body: { url: string, section?: string, article_urls?: string[] }
 *
 * 流程：
 * 1. detectUrlType 拦公众号
 * 2. 收集候选 URL（explicit > crawlAuthorIndex）
 * 3. 先建 site 行（拿到 id 后才能写 site_articles）→ profile_json 占位空对象
 * 4. fetchArticlesWithDedupe(siteId, urls, iteration=1)
 * 5. runProfileExtraction(newly_added) → 解析 profile
 * 6. UPDATE sites 写真正的 profile_json
 */
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    section?: string;
    article_urls?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const url = (body.url ?? '').trim();
  const section = (body.section ?? '').trim() || null;
  const explicitUrls = Array.isArray(body.article_urls)
    ? body.article_urls.map((u) => u.trim()).filter(Boolean)
    : [];

  if (!url) {
    return jsonError('站点 URL 不能为空');
  }

  const urlType = detectUrlType(url);
  if (urlType.is_wechat) {
    return jsonError(
      urlType.hint || '公众号反爬较硬，工具不爬，请直接粘贴正文',
      400,
    );
  }

  let candidateUrls: string[] = [];
  let sourceAuthorName: string | null = null;

  if (explicitUrls.length > 0) {
    candidateUrls = explicitUrls.slice(0, MAX_ARTICLES_FOR_PROFILE);
  } else {
    const index = await crawlAuthorIndex(url);
    if (isCrawlError(index)) {
      return jsonError(
        `没爬到这个站点的文章列表：${index.message}。可以试试直接传 article_urls 数组。`,
        400,
      );
    }
    sourceAuthorName = index.author_name;
    candidateUrls = index.article_urls.slice(0, MAX_ARTICLES_FOR_PROFILE);
  }

  if (candidateUrls.length < MIN_ARTICLES_FOR_PROFILE) {
    return jsonError(
      `这个站点只找到 ${candidateUrls.length} 篇可爬文章，至少需要 ${MIN_ARTICLES_FOR_PROFILE} 篇才能提画像。`,
      400,
    );
  }

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {/* ignore */}

  // 先插一行占位 site，拿到 id 才能写 site_articles
  const db = getDb();
  const id = nanoid(14);
  const now = Date.now();
  const placeholderName =
    sourceAuthorName || host || '提炼中…';
  db.prepare(
    `INSERT INTO sites
       (id, site_name, section, url_pattern, profile_json,
        source_url, source_article_count, created_at, updated_at, iteration_count)
     VALUES (?, ?, ?, ?, '{}', ?, 0, ?, ?, 1)`,
  ).run(id, placeholderName, section, host, url, now, now);

  let fetchResult;
  try {
    fetchResult = await fetchArticlesWithDedupe(id, candidateUrls, 1);
  } catch (err) {
    db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    return jsonError(`爬文章失败：${(err as Error).message}`, 502);
  }

  if (fetchResult.newly_added.length < MIN_ARTICLES_FOR_PROFILE) {
    db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM site_articles WHERE site_id = ?`).run(id);
    return jsonError(
      `这一轮只爬到了 ${fetchResult.newly_added.length} 篇可用的文章（目标 ${MIN_ARTICLES_FOR_PROFILE} 篇起步）。失败：${fetchResult.failed
        .slice(0, 3)
        .map((f) => f.reason)
        .join('；')}`,
      502,
    );
  }

  let profile: Record<string, unknown>;
  try {
    profile = await runProfileExtraction(fetchResult.newly_added, {
      siteHost: host,
      sectionHint: section ?? undefined,
    });
  } catch (err) {
    db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM site_articles WHERE site_id = ?`).run(id);
    return jsonError(
      `调模型失败：${(err as Error).message}`,
      502,
    );
  }

  const siteName =
    typeof profile.site_name === 'string' && profile.site_name
      ? (profile.site_name as string)
      : sourceAuthorName || host || '未命名站点';
  const sectionFinal =
    (typeof profile.section === 'string' && profile.section) ||
    section ||
    null;
  const urlPattern =
    typeof profile.url_pattern === 'string' && profile.url_pattern
      ? (profile.url_pattern as string)
      : host;

  // 跟 PATCH 对齐：source_article_count 永远是 COUNT(site_articles) 累计值
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM site_articles WHERE site_id = ?`)
    .get(id) as { n: number };
  const totalCount = totalRow.n;

  db.prepare(
    `UPDATE sites SET
       site_name = ?, section = ?, url_pattern = ?, profile_json = ?,
       source_article_count = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    siteName,
    sectionFinal,
    urlPattern,
    JSON.stringify(profile),
    totalCount,
    Date.now(),
    id,
  );

  return jsonOk({
    id,
    site_name: siteName,
    section: sectionFinal,
    url_pattern: urlPattern,
    source_article_count: totalCount,
    failed_count: fetchResult.failed.length,
    skipped_count: fetchResult.skipped_duplicate.length,
    profile,
  });
}
