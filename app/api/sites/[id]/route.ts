import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

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

/** DELETE /api/sites/[id] */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return jsonError('id 不能为空');
  try {
    const db = getDb();
    const info = db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    if (info.changes === 0) return jsonError('找不到这个站点画像', 404);
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(`删除失败：${(err as Error).message}`, 500);
  }
}
