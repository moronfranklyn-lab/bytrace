import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 风格配方集合端点。
 *
 * GET  /api/recipes                       列出全部配方（可按 ?platform 过滤）
 * POST /api/recipes                       新建一份配方
 *
 * 单条 CRUD 在 /api/recipes/[id]/route.ts。
 */

interface RecipeRow {
  id: string;
  name: string;
  platform_key: string;
  site_id: string | null;
  fragment_ids_json: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeFragmentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function serializeRecipe(row: RecipeRow) {
  let fragmentIds: string[] = [];
  try {
    const parsed = JSON.parse(row.fragment_ids_json);
    if (Array.isArray(parsed)) fragmentIds = parsed.filter((x) => typeof x === 'string');
  } catch {/* empty */}
  return {
    id: row.id,
    name: row.name,
    platform_key: row.platform_key,
    site_id: row.site_id,
    fragment_ids: fragmentIds,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform')?.trim() || null;
  const siteId = url.searchParams.get('site_id')?.trim() || null;

  const db = getDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (platform) {
    where.push('platform_key = ?');
    args.push(platform);
  }
  if (siteId) {
    where.push('site_id = ?');
    args.push(siteId);
  }
  const sql =
    `SELECT id, name, platform_key, site_id, fragment_ids_json, notes, created_at, updated_at
     FROM style_recipes
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY updated_at DESC`;
  const rows = db.prepare(sql).all(...args) as RecipeRow[];
  return Response.json({
    items: rows.map(serializeRecipe),
    count: rows.length,
  });
}

interface PostBody {
  name?: string;
  platform_key?: string;
  site_id?: string | null;
  fragment_ids?: string[];
  notes?: string | null;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const name = (body.name ?? '').trim();
  if (!name) return jsonError('配方名不能为空');
  if (name.length > 60) return jsonError('配方名最多 60 字');

  const platformKey = (body.platform_key ?? '').trim();
  if (!platformKey) return jsonError('platform_key 不能为空');

  const fragmentIds = normalizeFragmentIds(body.fragment_ids);
  if (fragmentIds.length === 0) {
    return jsonError('至少要挑 1 个策略碎片');
  }
  if (fragmentIds.length > 30) {
    return jsonError('碎片太多了（上限 30），挑精的就够');
  }

  const siteId = body.site_id?.trim() || null;
  const notes = body.notes?.trim() || null;

  const db = getDb();

  // 校验 fragmentIds 真的存在
  const placeholders = fragmentIds.map(() => '?').join(',');
  const found = db
    .prepare(`SELECT id FROM strategy_fragments_indexed WHERE id IN (${placeholders})`)
    .all(...fragmentIds) as { id: string }[];
  const foundSet = new Set(found.map((r) => r.id));
  const missing = fragmentIds.filter((x) => !foundSet.has(x));
  if (missing.length > 0) {
    return jsonError(`这些碎片找不到了：${missing.slice(0, 3).join(', ')}`);
  }

  const id = nanoid(12);
  const now = Date.now();
  db.prepare(
    `INSERT INTO style_recipes (id, name, platform_key, site_id, fragment_ids_json, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, platformKey, siteId, JSON.stringify(fragmentIds), notes, now, now);

  const row = db
    .prepare(
      `SELECT id, name, platform_key, site_id, fragment_ids_json, notes, created_at, updated_at
       FROM style_recipes WHERE id = ?`,
    )
    .get(id) as RecipeRow;

  return Response.json({ ok: true, recipe: serializeRecipe(row) }, { status: 201 });
}
