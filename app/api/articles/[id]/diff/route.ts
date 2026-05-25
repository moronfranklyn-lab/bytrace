import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';
import { streamClaude } from '@/lib/claude';
import { stripMarkdownFence } from '@/lib/sse';
import { buildDiffPrompt } from '@/lib/prompts/diff';
import { isValidPlatformKey, type PlatformKey } from '@/lib/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/articles/:id/diff
 *
 *   body: { from: PlatformKey, to: PlatformKey }
 *
 * 算"从 from 平台版改写到 to 平台版做了什么调整"的摘要。
 * 走 Claude CLI（spawn），结果按 (article_id, from, to, from_hash, to_hash) 缓存。
 *
 * - 内容未变 → 直接返缓存
 * - 内容变了（hash mismatch）→ 重算并覆盖
 * - from == to 或某个版本拿不到正文 → 400
 */

interface DiffSummary {
  overview: string;
  adjustments: string[];
}

interface RefineVersionEntry {
  ts: number;
  source_platform: string;
  target_platform: string;
  content_md: string;
}

function hashMd(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function resolvePlatformContent(
  baseContentMd: string,
  basePlatform: string | null,
  refineVersions: RefineVersionEntry[],
  target: PlatformKey,
): string | null {
  // 目标平台 = 文章本身的 platform_target → 返回主正文
  if (basePlatform === target) return baseContentMd;

  // 否则在 refine_versions_json 里找最新的 target_platform === target
  const matched = refineVersions
    .filter((v) => v.target_platform === target && v.content_md)
    .sort((a, b) => b.ts - a.ts);
  return matched.length > 0 ? matched[0].content_md : null;
}

function safeParseSummary(raw: string): DiffSummary | null {
  const trimmed = stripMarkdownFence(raw).trim();
  try {
    const j = JSON.parse(trimmed);
    if (typeof j?.overview !== 'string') return null;
    if (!Array.isArray(j?.adjustments)) return null;
    const adjustments = j.adjustments.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0);
    if (adjustments.length === 0) return null;
    return { overview: j.overview.trim(), adjustments };
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return Response.json({ error: '缺少 id' }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { from?: string; to?: string } | null;
  if (!body) return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });

  const from = (body.from ?? '').trim();
  const to = (body.to ?? '').trim();
  if (!isValidPlatformKey(from) || !isValidPlatformKey(to)) {
    return Response.json({ error: 'from / to 平台 key 不合法' }, { status: 400 });
  }
  if (from === to) {
    return Response.json({ error: 'from 和 to 是同一个平台，没差异' }, { status: 400 });
  }

  ensureComposeColumns();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, content_md, platform_target, refine_versions_json
       FROM articles WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        content_md: string | null;
        platform_target: string | null;
        refine_versions_json: string | null;
      }
    | undefined;
  if (!row) return Response.json({ error: '这篇找不到' }, { status: 404 });

  let refineVersions: RefineVersionEntry[] = [];
  try {
    if (row.refine_versions_json) {
      const p = JSON.parse(row.refine_versions_json);
      if (Array.isArray(p)) refineVersions = p as RefineVersionEntry[];
    }
  } catch {/* ignore */}

  const fromMd = resolvePlatformContent(row.content_md ?? '', row.platform_target, refineVersions, from as PlatformKey);
  const toMd = resolvePlatformContent(row.content_md ?? '', row.platform_target, refineVersions, to as PlatformKey);

  if (!fromMd || !toMd) {
    return Response.json(
      { error: '这两个平台至少有一个没生成过版本' },
      { status: 400 },
    );
  }

  const fromHash = hashMd(fromMd);
  const toHash = hashMd(toMd);

  // 查缓存
  const cached = db
    .prepare(
      `SELECT summary_json, from_hash, to_hash, created_at
       FROM article_diffs
       WHERE article_id = ? AND from_platform = ? AND to_platform = ?`,
    )
    .get(id, from, to) as
    | { summary_json: string; from_hash: string; to_hash: string; created_at: number }
    | undefined;

  if (cached && cached.from_hash === fromHash && cached.to_hash === toHash) {
    try {
      const parsed = JSON.parse(cached.summary_json) as DiffSummary;
      return Response.json({ summary: parsed, cached: true, created_at: cached.created_at });
    } catch {/* fallthrough, recompute */}
  }

  // 调 Claude
  const prompt = buildDiffPrompt(fromMd, toMd, from as PlatformKey, to as PlatformKey);
  let raw = '';
  try {
    raw = await streamClaude(prompt, {
      signal: req.signal,
      timeoutMs: 90_000,
    });
  } catch (err) {
    return Response.json(
      { error: '这次没成。换个角度再试一次：' + (err as Error).message },
      { status: 502 },
    );
  }

  const summary = safeParseSummary(raw);
  if (!summary) {
    return Response.json(
      { error: '模型返回的格式不对，再试一次：' + raw.slice(0, 200) },
      { status: 502 },
    );
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO article_diffs (article_id, from_platform, to_platform, from_hash, to_hash, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(article_id, from_platform, to_platform) DO UPDATE SET
       from_hash = excluded.from_hash,
       to_hash = excluded.to_hash,
       summary_json = excluded.summary_json,
       created_at = excluded.created_at`,
  ).run(id, from, to, fromHash, toHash, JSON.stringify(summary), now);

  return Response.json({ summary, cached: false, created_at: now });
}
