import { NextRequest } from 'next/server';
import { streamClaude, ARTICLE_MODEL } from '@/lib/claude';
import {
  buildRefinePrompt,
  extractCrossHintsFromFingerprints,
  isValidRefinePlatform,
} from '@/lib/prompts/refine';
import { createSseStream, stripMarkdownFence } from '@/lib/sse';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';
import {
  buildFingerprintMetaMap,
  type Composition,
  type FingerprintMeta,
} from '@/lib/composition';
import type { PlatformKey } from '@/lib/platforms';
import { parseRefineVersions, type RefineVersionEntry } from '@/lib/refine-versions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingPayload {
  content_md?: string;
  /** 目标平台 */
  platform?: string;
  /** v3 新增：源平台。空则用 wechat */
  source_platform?: string;
  /** v3 新增：文章 id；带上后可以读 composition / 写入 refine_versions_json */
  article_id?: string;
  /** v3 新增：composition（如果没有 article_id，可直接传） */
  composition?: Composition;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: NextRequest) {
  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const md = (body.content_md ?? '').trim();
  if (md.length < 100) {
    return jsonError('原文太短了（不足 100 字）');
  }
  const platform = (body.platform ?? '').trim();
  if (!isValidRefinePlatform(platform)) {
    return jsonError('目标平台不在允许列表里');
  }
  const sourcePlatformRaw = (body.source_platform ?? '').trim();
  const sourcePlatform: PlatformKey = isValidRefinePlatform(sourcePlatformRaw)
    ? sourcePlatformRaw
    : 'wechat';

  // 尝试拉 composition：优先 article_id，其次 body.composition
  let composition: Composition | null = body.composition ?? null;
  let articleRow: {
    id: string;
    refine_versions_json: string | null;
    platform_target: string | null;
    created_at: number;
  } | null = null;
  try {
    ensureComposeColumns();
    if (body.article_id) {
      const db = getDb();
      const row = db
        .prepare(
          `SELECT id, composition_json, refine_versions_json, platform_target, created_at
           FROM articles WHERE id = ?`,
        )
        .get(body.article_id) as
        | {
            id: string;
            composition_json: string | null;
            refine_versions_json: string | null;
            platform_target: string | null;
            created_at: number;
          }
        | undefined;
      if (row) {
        articleRow = {
          id: row.id,
          refine_versions_json: row.refine_versions_json,
          platform_target: row.platform_target,
          created_at: row.created_at,
        };
        if (!composition && row.composition_json) {
          try {
            composition = JSON.parse(row.composition_json) as Composition;
          } catch {/* ignore */}
        }
      }
    }
  } catch (err) {
    // 不致命：拿不到 composition 走通用 refine
    console.warn('refine route: loading composition failed', err);
  }

  // 拉指纹 → 抽 crossHints
  let crossHints: ReturnType<typeof extractCrossHintsFromFingerprints> = [];
  if (composition?.selected_authors?.length) {
    try {
      const ids = composition.selected_authors.map((a) => a.fingerprint_id);
      const db = getDb();
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT f.id, f.author_id, f.fingerprint_json,
                  a.name AS author_name, a.platform
           FROM fingerprints f
           JOIN authors a ON a.id = f.author_id
           WHERE f.id IN (${placeholders})`,
        )
        .all(...ids) as Array<{
          id: string;
          fingerprint_json: string;
          author_name: string;
          platform: string | null;
        }>;
      const fpMap: Map<string, FingerprintMeta> = buildFingerprintMetaMap(rows);
      crossHints = extractCrossHintsFromFingerprints(fpMap, platform);
    } catch (err) {
      console.warn('refine route: loading fingerprints failed', err);
    }
  }

  return createSseStream(async (send, _close, abortSignal) => {
    send('open', { platform, source_platform: sourcePlatform, cross_hints: crossHints.length });

    const prompt = buildRefinePrompt(md, platform, {
      sourcePlatform,
      crossHints,
    });

    let raw = '';
    try {
      raw = await streamClaude(prompt, {
        model: ARTICLE_MODEL, // 润色走 Sonnet 4.6 降 AI 味
        signal: abortSignal,
        timeoutMs: 240_000, // 全文重写，默认 180s 对长文不够
        onChunk: (text) => send('chunk', { text }),
      });
    } catch (err) {
      send('error', { message: (err as Error).message || '模型那边没回来', phase: 'claude' });
      return;
    }

    const refined = stripMarkdownFence(raw);

    // 落库：先把旧数据归一成数组（兼容 draft route 写的 dict 形态，避免整列覆盖
    // 抹掉多平台版本），再 append 这次的润色结果
    if (articleRow) {
      try {
        const db = getDb();
        const arr: RefineVersionEntry[] = parseRefineVersions(
          articleRow.refine_versions_json,
          {
            fallbackTs: articleRow.created_at,
            mainPlatform: articleRow.platform_target ?? undefined,
          },
        );
        arr.push({
          ts: Date.now(),
          source_platform: sourcePlatform,
          target_platform: platform,
          content_md: refined,
        });
        db.prepare(`UPDATE articles SET refine_versions_json = ? WHERE id = ?`).run(
          JSON.stringify(arr),
          articleRow.id,
        );
      } catch (err) {
        console.warn('refine route: persist version failed', err);
      }
    }

    send('done', { content_md: refined, platform, source_platform: sourcePlatform });
  }, req.signal);
}
