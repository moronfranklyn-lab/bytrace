import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  crawlAuthorIndex,
  isCrawlError,
} from '@/lib/crawler';
import {
  fetchArticlesWithDedupe,
  loadHistorySamples,
  runProfileExtraction,
  MAX_ARTICLES_FOR_PROFILE,
  MIN_ARTICLES_FOR_PROFILE,
} from '@/lib/sites/profile-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

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

/** GET /api/sites/[id] */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return jsonError('id 不能为空');
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, site_name, section, url_pattern, profile_json,
                source_url, source_article_count, created_at, updated_at
         FROM sites
         WHERE id = ?`,
      )
      .get(id) as SiteRow | undefined;
    if (!row) return jsonError('找不到这个站点画像', 404);
    let profile: Record<string, unknown> = {};
    try {
      profile = JSON.parse(row.profile_json);
    } catch {
      profile = {};
    }
    return jsonOk({
      id: row.id,
      site_name: row.site_name,
      section: row.section,
      url_pattern: row.url_pattern,
      source_url: row.source_url,
      source_article_count: row.source_article_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      profile,
    });
  } catch (err) {
    return jsonError(`读取失败：${(err as Error).message}`, 500);
  }
}

/** DELETE /api/sites/[id] —— 同时清理关联的 site_articles 行 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return jsonError('id 不能为空');
  try {
    const db = getDb();
    db.prepare(`DELETE FROM site_articles WHERE site_id = ?`).run(id);
    const info = db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    if (info.changes === 0) return jsonError('找不到这个站点画像', 404);
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(`删除失败：${(err as Error).message}`, 500);
  }
}

/**
 * PATCH /api/sites/[id] —— 加样本并重提炼画像
 *
 * Body 三选一（其实可同时给）：
 *   { mode: 'recrawl' }                  → 用 source_url 重跑 crawlAuthorIndex
 *   { mode: 'paste', article_urls: [] }  → 用户粘的额外 URL
 *   { mode: 'recrawl', article_urls: [] }→ 两者合并
 *
 * 行为：
 * - 候选 URL 跟 site_articles 比对去重
 * - 新文章逐篇 crawl + 入库
 * - 累计取所有历史样本（最近 MAX 篇）→ 调 Claude 重提炼画像
 * - 更新 sites.profile_json、iteration_count++、source_article_count = 累计有效样本数
 * - 返回 { newly_added_count, skipped_count, failed, total_samples, profile }
 *
 * 没有新样本（全是重复 / 全部爬失败）→ 不调 Claude，返回 200 + 报告
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return jsonError('id 不能为空');

  let body: { mode?: 'recrawl' | 'paste'; article_urls?: string[] };
  try {
    body = await req.json();
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const mode = body.mode ?? 'paste';
  const pastedUrls = Array.isArray(body.article_urls)
    ? body.article_urls.map((u) => u.trim()).filter(Boolean)
    : [];

  if (mode !== 'recrawl' && mode !== 'paste') {
    return jsonError('mode 必须是 recrawl 或 paste');
  }
  if (mode === 'paste' && pastedUrls.length === 0) {
    return jsonError('paste 模式下 article_urls 不能为空');
  }

  const db = getDb();
  const site = db
    .prepare(
      `SELECT id, site_name, section, url_pattern, source_url, iteration_count
       FROM sites WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        site_name: string;
        section: string | null;
        url_pattern: string | null;
        source_url: string | null;
        iteration_count: number | null;
      }
    | undefined;
  if (!site) return jsonError('找不到这个站点画像', 404);

  // 收候选 URL：mode=recrawl → 从 source_url 拉一次 index；可叠加 paste
  const candidateUrls: string[] = [];
  if (mode === 'recrawl') {
    if (!site.source_url) {
      return jsonError('这个站点没有 source_url，无法 recrawl，请用 paste 模式');
    }
    // 把已分析过的 url_hash 喂给 crawlAuthorIndex，让翻页直到拿到足够多「新」URL 才停
    const existingHashes = new Set(
      (
        db
          .prepare(`SELECT url_hash FROM site_articles WHERE site_id = ?`)
          .all(id) as { url_hash: string }[]
      ).map((r) => r.url_hash),
    );
    const index = await crawlAuthorIndex(site.source_url, {
      skipHashes: existingHashes,
      maxArticles: MAX_ARTICLES_FOR_PROFILE,
    });
    if (isCrawlError(index)) {
      return jsonError(
        `从原 URL 拉文章列表失败：${index.message}。可以试试 paste 模式手贴 URL。`,
        502,
      );
    }
    candidateUrls.push(...index.article_urls);
  }
  candidateUrls.push(...pastedUrls);

  if (candidateUrls.length === 0) {
    return jsonError('没收到任何候选 URL');
  }

  const nextIteration = (site.iteration_count ?? 1) + 1;

  let fetchResult;
  try {
    fetchResult = await fetchArticlesWithDedupe(
      id,
      candidateUrls,
      nextIteration,
      MAX_ARTICLES_FOR_PROFILE,
    );
  } catch (err) {
    return jsonError(`爬文章失败：${(err as Error).message}`, 502);
  }

  // 全是重复 / 爬不到 → 不调模型，但报告状态
  if (fetchResult.newly_added.length === 0) {
    const totalSamples = db
      .prepare(`SELECT COUNT(*) AS n FROM site_articles WHERE site_id = ?`)
      .get(id) as { n: number };
    return jsonOk({
      newly_added_count: 0,
      skipped_count: fetchResult.skipped_duplicate.length,
      skipped_samples: fetchResult.skipped_duplicate.slice(0, 8),
      failed: fetchResult.failed.slice(0, 8),
      total_samples: totalSamples.n,
      profile: null,
      reextracted: false,
      message:
        fetchResult.skipped_duplicate.length > 0
          ? `这一轮全是已分析过的文章（跳过 ${fetchResult.skipped_duplicate.length} 篇），画像没变。换条新 URL 再来一次？`
          : '这一轮一篇都没爬到。看看 failed 里说的是什么原因。',
    });
  }

  // 取全部累计样本（包含刚加进去的）重新提炼
  const allSamples = loadHistorySamples(id, MAX_ARTICLES_FOR_PROFILE);
  if (allSamples.length < MIN_ARTICLES_FOR_PROFILE) {
    return jsonError(
      `累计样本只有 ${allSamples.length} 篇，至少要 ${MIN_ARTICLES_FOR_PROFILE} 篇`,
      400,
    );
  }

  let host = site.url_pattern ?? '';
  try {
    if (site.source_url) host = new URL(site.source_url).hostname || host;
  } catch {/* ignore */}

  let profile: Record<string, unknown>;
  try {
    profile = await runProfileExtraction(allSamples, {
      siteHost: host,
      sectionHint: site.section ?? undefined,
    });
  } catch (err) {
    // 模型失败但样本已存——下次再点也能基于现有样本重提炼
    return jsonError(
      `这次没成。${(err as Error).message}。样本已经存进去了，下次点「重新提炼」可以直接重试。`,
      502,
    );
  }

  const siteName =
    typeof profile.site_name === 'string' && profile.site_name
      ? (profile.site_name as string)
      : site.site_name;
  const sectionFinal =
    (typeof profile.section === 'string' && profile.section) ||
    site.section ||
    null;
  const urlPattern =
    typeof profile.url_pattern === 'string' && profile.url_pattern
      ? (profile.url_pattern as string)
      : site.url_pattern;

  // 累计样本总数 = COUNT(site_articles)，跟「这一轮喂 Claude 的样本数」(allSamples.length, ≤ 20) 区分
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM site_articles WHERE site_id = ?`)
    .get(id) as { n: number };
  const totalCount = totalRow.n;

  db.prepare(
    `UPDATE sites SET
       site_name = ?, section = ?, url_pattern = ?, profile_json = ?,
       source_article_count = ?, iteration_count = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    siteName,
    sectionFinal,
    urlPattern,
    JSON.stringify(profile),
    totalCount,
    nextIteration,
    Date.now(),
    id,
  );

  return jsonOk({
    newly_added_count: fetchResult.newly_added.length,
    skipped_count: fetchResult.skipped_duplicate.length,
    skipped_samples: fetchResult.skipped_duplicate.slice(0, 8),
    failed: fetchResult.failed.slice(0, 8),
    total_samples: totalCount,
    used_for_extraction: allSamples.length,
    iteration: nextIteration,
    profile,
    reextracted: true,
  });
}
