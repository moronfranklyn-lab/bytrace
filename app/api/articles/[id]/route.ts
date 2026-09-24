import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/articles/:id
 * 给 compose Step 7 的「拆解此文产出逻辑」面板用。
 * 返回 article 主体 + composition_json + outline_json + 关联指纹的浅信息（名字/平台/v3 标记）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: '缺少 id' }, { status: 400 });
  }
  try {
    ensureComposeColumns();
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, title, content_md, content_html, platform_target,
                layout_theme, composition_json, outline_json, idea,
                refine_versions_json, created_at
         FROM articles WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          title: string;
          content_md: string;
          content_html: string;
          platform_target: string | null;
          layout_theme: string | null;
          composition_json: string | null;
          outline_json: string | null;
          idea: string | null;
          refine_versions_json: string | null;
          created_at: number;
        }
      | undefined;
    if (!row) return Response.json({ error: '这篇找不到' }, { status: 404 });

    let composition: { selected_authors?: Array<{ author_id: string; fingerprint_id: string; weight: number }> } = {};
    try { composition = row.composition_json ? JSON.parse(row.composition_json) : {}; } catch {/* ignore */}
    let outline: unknown = null;
    try { outline = row.outline_json ? JSON.parse(row.outline_json) : null; } catch {/* ignore */}
    let refineVersions: unknown = null;
    try { refineVersions = row.refine_versions_json ? JSON.parse(row.refine_versions_json) : null; } catch {/* ignore */}

    // 关联指纹 → 拿名字 / 平台 / strategy_fragments
    let fingerprintInfo: Array<{
      fingerprint_id: string;
      author_id: string;
      author_name: string;
      platform: string | null;
      weight: number;
      has_v3: boolean;
      strategy_fragments: Array<{
        tag?: string;
        platform_scope?: string[];
        title?: string;
        description?: string;
        when_to_use?: string;
      }>;
    }> = [];
    if (Array.isArray(composition.selected_authors) && composition.selected_authors.length > 0) {
      const ids = composition.selected_authors.map((a) => a.fingerprint_id);
      const placeholders = ids.map(() => '?').join(',');
      const fpRows = db
        .prepare(
          `SELECT f.id, f.author_id, f.fingerprint_json,
                  a.name AS author_name, a.platform
           FROM fingerprints f
           JOIN authors a ON a.id = f.author_id
           WHERE f.id IN (${placeholders})`,
        )
        .all(...ids) as Array<{
          id: string;
          author_id: string;
          fingerprint_json: string;
          author_name: string;
          platform: string | null;
        }>;
      const fpById = new Map(fpRows.map((r) => [r.id, r]));
      for (const sel of composition.selected_authors) {
        const r = fpById.get(sel.fingerprint_id);
        if (!r) continue;
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(r.fingerprint_json) as Record<string, unknown>; } catch {/* ignore */}
        const fragments = Array.isArray(parsed.strategy_fragments)
          ? (parsed.strategy_fragments as Array<Record<string, unknown>>)
              .slice(0, 40)
              .map((f) => ({
                tag: typeof f.tag === 'string' ? f.tag : undefined,
                platform_scope: Array.isArray(f.platform_scope) ? (f.platform_scope as string[]) : undefined,
                title: typeof f.title === 'string' ? f.title : undefined,
                description: typeof f.description === 'string' ? f.description : undefined,
                when_to_use: typeof f.when_to_use === 'string' ? f.when_to_use : undefined,
              }))
          : [];
        fingerprintInfo.push({
          fingerprint_id: sel.fingerprint_id,
          author_id: sel.author_id,
          author_name: r.author_name,
          platform: r.platform,
          weight: sel.weight,
          has_v3: Boolean(parsed.platform_fingerprints || parsed.strategy_fragments),
          strategy_fragments: fragments,
        });
      }
    }

    return Response.json({
      id: row.id,
      title: row.title,
      content_md: row.content_md,
      platform_target: row.platform_target,
      layout_theme: row.layout_theme,
      idea: row.idea,
      composition,
      outline,
      refine_versions: refineVersions,
      fingerprints: fingerprintInfo,
      created_at: row.created_at,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/articles/:id
 * 删除一篇历史文章。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return new Response(JSON.stringify({ error: '缺少 id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const db = getDb();
  try {
    const info = db.prepare(`DELETE FROM articles WHERE id = ?`).run(id);
    // 顺手清掉关联表，避免留孤儿行（diff 缓存 / critic 评分记录）
    db.prepare(`DELETE FROM article_diffs WHERE article_id = ?`).run(id);
    db.prepare(`DELETE FROM critic_runs WHERE article_id = ?`).run(id);
    if (info.changes === 0) {
      return new Response(
        JSON.stringify({ ok: false, message: '这篇已经不在了' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: '数据库删除失败',
        detail: (err as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }
}
