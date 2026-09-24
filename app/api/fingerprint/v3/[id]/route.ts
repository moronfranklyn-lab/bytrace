import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import { crawlAuthorIndex, hashUrl, isCrawlError } from '@/lib/crawler';
import {
  prepareSampleArticle,
  runV3Extraction,
  runCategoryProfiles,
  MAX_ARTICLES,
  MIN_ARTICLES,
  type IncomingArticleInput,
  type PreparedArticle,
} from '@/lib/fingerprints/v3-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/fingerprint/v3/:id —— 加样本并重提炼指纹（v3 主版本专用）
 *
 * Body:
 *   { articles: IncomingArticleInput[] }
 *
 * 行为：
 * 1. 校验指纹存在
 * 2. 逐篇 prepareSampleArticle（URL → crawl，paste → 校验长度）
 * 3. 用 url_hash 跟 fingerprint_articles 去重，重复的不算"新增"
 * 4. 全部历史样本（最近 20 篇，含新增）累计喂 stage1 + stage2 + stage3 重跑
 * 5. UPDATE fingerprints 的所有 v3 JSON 列；新增样本写入 fingerprint_articles
 *    并标记 iteration = 上一轮 + 1
 *
 * 无新增样本（全是重复 / 全失败）→ 不调模型，返回报告
 * 非流式响应（用户在详情页等结果）
 */

interface ReqBody {
  articles?: IncomingArticleInput[];
  /** 作者主页 / 专栏 / 板块 URL：自动扒文章列表后追加到 articles。 */
  author_url?: string;
  /** v3.3：不加样本、只用现有库重跑（升级 prompt 后回填新字段用） */
  force_rerun?: boolean;
}

interface FingerprintRow {
  id: string;
  author_id: string;
  iteration_count: number | null;
  fingerprint_json: string;
}

interface AuthorRow {
  id: string;
  name: string;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function sampleHash(p: { url?: string | null; content: string }): string {
  if (p.url) return hashUrl(p.url);
  return 'paste:' + createHash('sha1').update(p.content.slice(0, 200)).digest('hex').slice(0, 16);
}

function inferPlatformFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname;
    if (/zhihu\.com$/i.test(h)) return 'zhihu';
    if (/sspai\.com$/i.test(h)) return 'sspai';
    if (/uisdc\.com$/i.test(h)) return 'uisdc';
    if (/woshipm\.com$/i.test(h)) return 'wechat';
    if (/(bilibili\.com|b23\.tv)$/i.test(h)) return 'bilibili';
    if (/(youtube\.com|youtu\.be)$/i.test(h)) return 'youtube';
    if (/xiaohongshu\.com$/i.test(h)) return 'xhs';
    if (/douyin\.com$/i.test(h)) return 'douyin';
  } catch {/* ignore */}
  return 'wechat';
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return jsonError('缺少指纹 id');

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const incomingFromBody = Array.isArray(body.articles) ? body.articles : [];
  const authorUrl = (body.author_url ?? '').trim();
  const forceRerun = body.force_rerun === true;
  if (incomingFromBody.length === 0 && !authorUrl && !forceRerun) {
    return jsonError('articles 不能为空；也可以传 author_url 自动扒作者文章，或设置 force_rerun: true 不加样本只重跑');
  }

  const db = getDb();
  const fp = db
    .prepare(
      `SELECT id, author_id, iteration_count, fingerprint_json
       FROM fingerprints WHERE id = ?`,
    )
    .get(id) as FingerprintRow | undefined;
  if (!fp) return jsonError('找不到这个指纹', 404);

  const author = db
    .prepare(`SELECT id, name FROM authors WHERE id = ?`)
    .get(fp.author_id) as AuthorRow | undefined;
  if (!author) return jsonError('指纹关联的博主不存在', 500);

  // 已有 url_hash 集合 → 用于跳过重复
  const existingHashes = new Set(
    (
      db
        .prepare(`SELECT url_hash FROM fingerprint_articles WHERE fingerprint_id = ?`)
        .all(id) as { url_hash: string }[]
    ).map((r) => r.url_hash),
  );

  let incoming = incomingFromBody;
  if (authorUrl) {
    const index = await crawlAuthorIndex(authorUrl, {
      skipHashes: existingHashes,
      maxArticles: MAX_ARTICLES,
      maxPages: 10,
    });
    if (isCrawlError(index)) {
      return jsonError(`自动扒作者文章失败：${index.message}`, 502);
    }
    const scrapedArticles: IncomingArticleInput[] = index.article_urls.map((url) => ({
      mode: 'url' as const,
      url,
      platform: inferPlatformFromUrl(url),
    }));
    incoming = [...incomingFromBody, ...scrapedArticles];
  }

  // 逐篇 prepare（带 URL 抓取）+ 即时去重
  const newlyPrepared: PreparedArticle[] = [];
  const skipped: { url: string | null; reason: string }[] = [];
  const failed: { url: string | null; reason: string }[] = [];

  for (let i = 0; i < incoming.length; i++) {
    const input = incoming[i];
    try {
      const p = await prepareSampleArticle(input, i);
      const h = sampleHash(p);
      if (existingHashes.has(h)) {
        skipped.push({ url: p.url ?? null, reason: '已分析过' });
        continue;
      }
      existingHashes.add(h);
      newlyPrepared.push(p);
    } catch (err) {
      failed.push({
        url: input.url ?? null,
        reason: (err as Error).message,
      });
    }
  }

  const nextIteration = (fp.iteration_count ?? 1) + 1;

  // 全是重复 / 失败 → 不调模型，报告退出（force_rerun 跳过这一段，往下走重跑）
  if (newlyPrepared.length === 0 && !forceRerun) {
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM fingerprint_articles WHERE fingerprint_id = ?`)
      .get(id) as { n: number };
    return Response.json({
      newly_added_count: 0,
      skipped_count: skipped.length,
      skipped,
      failed,
      total_samples: totalRow.n,
      reextracted: false,
      message:
        skipped.length > 0
          ? `这一轮全是已分析过的文章（跳过 ${skipped.length} 篇），指纹没变。换条新 URL 再来一次？`
          : '这一轮一篇都没爬到。看看 failed 里说的是什么原因。',
    });
  }

  // Stage 0：给新样本打类别（user_specified 跳过）
  // 注意：runV3Extraction 内部也会跑 Stage 0，但那是基于 historyRows 重建出来的副本，
  // 写不回 newlyPrepared。这里单独跑一次，确保入库带分类。
  const { runStage0OnPrepared } = await import('@/lib/fingerprints/v3-engine');
  await runStage0OnPrepared(newlyPrepared, req.signal);

  // 先把新样本写进 fingerprint_articles（即便后面模型挂了，样本也留住）
  const now = Date.now();
  const insertSample = db.prepare(
    `INSERT OR IGNORE INTO fingerprint_articles
      (fingerprint_id, url_hash, url, title, content, platform, medium,
       domain, source_mode, added_at, iteration,
       primary_category, secondary_category, category_confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTx = db.transaction(() => {
    for (const p of newlyPrepared) {
      insertSample.run(
        id,
        sampleHash(p),
        p.url ?? null,
        p.title ?? null,
        p.content,
        p.platform,
        p.medium,
        p.domain,
        p.source_mode,
        now,
        nextIteration,
        p.primary_category ?? null,
        p.secondary_category ?? null,
        p.category_confidence ?? null,
      );
    }
  });
  insertTx();

  // 取累计样本（最近 20 篇）重提炼
  const historyRows = db
    .prepare(
      `SELECT url_hash, url, title, content, platform, medium, domain, source_mode,
              primary_category, secondary_category, category_confidence
       FROM fingerprint_articles WHERE fingerprint_id = ?
       ORDER BY added_at DESC LIMIT ?`,
    )
    .all(id, MAX_ARTICLES) as Array<{
      url_hash: string;
      url: string | null;
      title: string | null;
      content: string;
      platform: string;
      medium: string;
      domain: string;
      source_mode: string;
      primary_category: string | null;
      secondary_category: string | null;
      category_confidence: string | null;
    }>;

  if (historyRows.length < MIN_ARTICLES) {
    return jsonError(
      `累计样本只有 ${historyRows.length} 篇，至少要 ${MIN_ARTICLES} 篇`,
      400,
    );
  }

  const allPrepared: PreparedArticle[] = historyRows.map((r) => ({
    title: r.title ?? undefined,
    content: r.content,
    url: r.url ?? undefined,
    platform: r.platform,
    medium: (r.medium ?? 'text') as 'text' | 'video' | 'mixed',
    domain: r.domain || '未指定',
    source_mode: r.source_mode === 'paste' ? 'paste' : 'url',
    // 让 runV3Extraction 跳过 Stage 0 重跑（DB 里已经有分类的样本视作 user_specified）
    primary_category: (r.primary_category as PreparedArticle['primary_category']) ?? null,
    secondary_category: (r.secondary_category as PreparedArticle['secondary_category']) ?? null,
    category_confidence: (r.category_confidence as PreparedArticle['category_confidence']) ?? null,
    user_specified_category: !!r.primary_category,
  }));

  let result;
  let categoryProfiles: Awaited<ReturnType<typeof runCategoryProfiles>> = [];
  try {
    result = await runV3Extraction(allPrepared, author.name, req.signal);
    // 按类别细分（每类 ≥ 3 篇才跑，单类失败不影响主流程）
    categoryProfiles = await runCategoryProfiles(
      author.name,
      result.prepared,
      result.stage1Outputs,
      req.signal,
    );
  } catch (err) {
    return Response.json(
      {
        newly_added_count: newlyPrepared.length,
        skipped_count: skipped.length,
        skipped,
        failed,
        total_samples: historyRows.length,
        reextracted: false,
        error: `这次没成：${(err as Error).message}。样本已经存进去了，下次再点重提炼就能直接重试。`,
      },
      { status: 502 },
    );
  }

  // 落库：更新 fingerprints + 重写 strategies
  const strategyFragments = Array.isArray(
    (result.fingerprint as { strategy_fragments?: unknown[] }).strategy_fragments,
  )
    ? ((result.fingerprint as { strategy_fragments: unknown[] }).strategy_fragments as Record<string, unknown>[])
    : [];

  const platformFingerprints =
    (result.fingerprint as { platform_fingerprints?: unknown }).platform_fingerprints ?? null;
  const domainVariations =
    (result.fingerprint as { domain_variations?: unknown }).domain_variations ?? null;
  const crossPlatformReport =
    (result.fingerprint as { cross_platform_report?: unknown }).cross_platform_report ?? null;

  const sourceArticlesSummary = allPrepared.map((p) => ({
    title: p.title,
    platform: p.platform,
    domain: p.domain,
    medium: p.medium,
    url: p.url,
    chars: p.content.length,
  }));

  const checkFpExists = db.prepare(`SELECT id FROM fingerprints WHERE id = ?`);
  const updateFp = db.prepare(
    `UPDATE fingerprints SET
       source_articles_json = ?,
       fingerprint_json = ?,
       raw_response = ?,
       model_version = ?,
       article_count = ?,
       version_schema = 'v3',
       platform_fingerprints_json = ?,
       domain_variations_json = ?,
       cross_platform_report_json = ?,
       strategy_fragments_json = ?,
       iteration_count = COALESCE(iteration_count, 1) + 1
     WHERE id = ?`,
  );
  // Stage 0 重跑出的分类回写样本行：不回写的话每次重提炼都会对同一批
  // 老样本重复烧 Stage 0，UI 上的类别分布也对不上
  const updateSampleCategory = db.prepare(
    `UPDATE fingerprint_articles SET
       primary_category = ?, secondary_category = ?, category_confidence = ?
     WHERE fingerprint_id = ? AND url_hash = ?`,
  );
  const deleteStrategies = db.prepare(`DELETE FROM strategies WHERE fingerprint_id = ?`);
  const insertStrategy = db.prepare(
    `INSERT INTO strategies
      (id, fingerprint_id, tag, scope_json, description, example, when_to_use,
       created_at, platform_scope_json, domain_scope_json, why_works, title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // 类别配方只 REPLACE 本次成功合成的类（PK = fingerprint_id + category）。
  // 不做无条件全删：runCategoryProfiles 单类失败会静默跳过，全删再插会把
  // 失败 / 本轮没跑的类别的既有配方清空。
  const insertCategoryProfile = db.prepare(
    `INSERT OR REPLACE INTO fingerprint_category_profiles
      (fingerprint_id, category, profile_json, sample_count, iteration, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // 碎片索引同理：全局碎片（category IS NULL）整组覆盖，
  // 类别碎片只删本次成功合成的类，其余类保留旧行
  const deleteGlobalFragments = db.prepare(
    `DELETE FROM strategy_fragments_indexed WHERE fingerprint_id = ? AND category IS NULL`,
  );
  const deleteCategoryFragments = db.prepare(
    `DELETE FROM strategy_fragments_indexed WHERE fingerprint_id = ? AND category = ?`,
  );
  const insertFragmentIndexed = db.prepare(
    `INSERT INTO strategy_fragments_indexed
      (id, fingerprint_id, author_name, category, tag, title, description,
       example, when_to_use, why_works, platform_scope_json, domain_scope_json,
       created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    // 复核指纹还在：重提炼要跑好几分钟，期间可能被列表页快捷删除。
    // 不复核就写会裸 500，早插入的样本还会变孤儿行。
    if (!checkFpExists.get(id)) {
      throw new Error('这份指纹在重提炼期间被删掉了，这次的结果就不写回了');
    }
    updateFp.run(
      JSON.stringify(sourceArticlesSummary),
      JSON.stringify(result.fingerprint),
      result.stage2Raw,
      'claude-code-cli-v3',
      allPrepared.length,
      platformFingerprints ? JSON.stringify(platformFingerprints) : null,
      domainVariations ? JSON.stringify(domainVariations) : null,
      crossPlatformReport ? JSON.stringify(crossPlatformReport) : null,
      strategyFragments.length ? JSON.stringify(strategyFragments) : null,
      id,
    );
    // Stage 0 重跑给老样本补出的分类写回 DB（allPrepared 与 historyRows 按下标一一对应）
    for (let i = 0; i < historyRows.length; i++) {
      const p = allPrepared[i];
      if (!historyRows[i].primary_category && p.primary_category) {
        updateSampleCategory.run(
          p.primary_category,
          p.secondary_category ?? null,
          p.category_confidence ?? null,
          id,
          historyRows[i].url_hash,
        );
      }
    }
    deleteStrategies.run(id);
    deleteGlobalFragments.run(id);
    for (const cp of categoryProfiles) {
      deleteCategoryFragments.run(id, cp.category);
    }
    const stratNow = Date.now();
    for (const s of strategyFragments) {
      insertStrategy.run(
        nanoid(14),
        id,
        (s.tag as string) || null,
        JSON.stringify(s.domain_scope ?? s.platform_scope ?? []),
        (s.description as string) || null,
        (s.example as string) || null,
        (s.when_to_use as string) || null,
        stratNow,
        JSON.stringify(s.platform_scope ?? []),
        JSON.stringify(s.domain_scope ?? []),
        (s.why_works as string) || null,
        (s.title as string) || null,
      );
      // 主指纹的全局碎片也进索引表
      insertFragmentIndexed.run(
        nanoid(14),
        id,
        author.name,
        null,
        (s.tag as string) || null,
        (s.title as string) || null,
        (s.description as string) || null,
        (s.example as string) || null,
        (s.when_to_use as string) || null,
        (s.why_works as string) || null,
        JSON.stringify(s.platform_scope ?? []),
        JSON.stringify(s.domain_scope ?? []),
        stratNow,
      );
    }
    // 类别细分指纹 + 类别专属碎片
    for (const cp of categoryProfiles) {
      insertCategoryProfile.run(
        id,
        cp.category,
        JSON.stringify(cp.profile_json),
        cp.sample_count,
        nextIteration,
        stratNow,
      );
      const fragments = Array.isArray(
        (cp.profile_json as { category_specific_fragments?: unknown[] })
          .category_specific_fragments,
      )
        ? ((cp.profile_json as { category_specific_fragments: unknown[] })
            .category_specific_fragments as Record<string, unknown>[])
        : [];
      for (const f of fragments) {
        insertFragmentIndexed.run(
          nanoid(14),
          id,
          author.name,
          cp.category,
          (f.tag as string) || null,
          (f.title as string) || null,
          (f.description as string) || null,
          (f.example as string) || null,
          (f.when_to_use as string) || null,
          (f.why_works as string) || null,
          JSON.stringify(f.platform_scope ?? []),
          JSON.stringify(f.domain_scope ?? []),
          stratNow,
        );
      }
    }
  });
  try {
    tx();
  } catch (txErr) {
    return Response.json(
      {
        reextracted: false,
        error: `重提炼结果没能写回：${(txErr as Error).message}。如果是指纹刚被删掉，重新拆解一次就好。`,
      },
      { status: 409 },
    );
  }

  return Response.json({
    newly_added_count: newlyPrepared.length,
    skipped_count: skipped.length,
    skipped,
    failed,
    total_samples: allPrepared.length,
    iteration: nextIteration,
    reextracted: true,
    platforms_analyzed: result.platformsAnalyzed,
    categories_analyzed: categoryProfiles.map((c) => ({
      category: c.category,
      sample_count: c.sample_count,
    })),
    strategy_count: strategyFragments.length,
    timings_ms: {
      stage1: result.timings.stage1Ms,
      stage2: result.timings.stage2Ms,
      stage3: result.timings.stage3Ms,
      total: result.timings.stage1Ms + result.timings.stage2Ms + result.timings.stage3Ms,
    },
  });
}

/**
 * DELETE /api/fingerprint/v3/:id —— 删除一份指纹及其全部附属数据。
 *
 * 级联删除：
 *   - fingerprint_articles（样本关联）
 *   - fingerprint_category_profiles（按类别细分指纹）
 *   - strategies（策略碎片）
 *   - strategy_fragments_indexed（跨博主索引）
 *
 * 关于 authors 表：
 *   - 这份指纹是 author 的唯一指纹 → 一并删 author
 *   - 还有其他指纹 → 保留 author
 *
 * 不删除 articles 表里用过这份指纹生成的历史文章——那是用户的成品。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return jsonError('缺少指纹 id');

  const db = getDb();
  const fp = db
    .prepare(`SELECT id, author_id FROM fingerprints WHERE id = ?`)
    .get(id) as { id: string; author_id: string } | undefined;
  if (!fp) return jsonError('找不到这个指纹', 404);

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM fingerprint_articles WHERE fingerprint_id = ?`).run(id);
    db.prepare(`DELETE FROM fingerprint_category_profiles WHERE fingerprint_id = ?`).run(id);
    db.prepare(`DELETE FROM strategies WHERE fingerprint_id = ?`).run(id);
    db.prepare(`DELETE FROM strategy_fragments_indexed WHERE fingerprint_id = ?`).run(id);
    db.prepare(`DELETE FROM fingerprints WHERE id = ?`).run(id);

    // 该 author 还有别的指纹吗？没了就把 author 也清掉
    const remaining = db
      .prepare(`SELECT COUNT(*) AS n FROM fingerprints WHERE author_id = ?`)
      .get(fp.author_id) as { n: number };
    if (remaining.n === 0) {
      // crawled_articles.author_id 带 ON DELETE CASCADE，直接删 author 会把
      // 该博主的语料一并级联删光——那是热点聚合的输入。先解绑再删。
      db.prepare(`UPDATE crawled_articles SET author_id = NULL WHERE author_id = ?`).run(
        fp.author_id,
      );
      db.prepare(`DELETE FROM authors WHERE id = ?`).run(fp.author_id);
    }
  });

  try {
    tx();
  } catch (err) {
    return jsonError('删除失败：' + (err as Error).message, 500);
  }

  return Response.json({ ok: true, deleted: id });
}
