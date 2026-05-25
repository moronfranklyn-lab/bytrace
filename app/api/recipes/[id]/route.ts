import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 单个风格配方端点。
 *
 * GET    /api/recipes/:id    取详情，并把 fragment_ids 反查成完整碎片对象数组
 * PATCH  /api/recipes/:id    改名 / 改 fragments / 改 notes（platform_key 不允许改，要改就新建）
 * DELETE /api/recipes/:id    删配方（碎片不动）
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

interface FragmentRow {
  id: string;
  fingerprint_id: string;
  author_name: string | null;
  category: string | null;
  tag: string | null;
  title: string | null;
  description: string | null;
  example: string | null;
  when_to_use: string | null;
  why_works: string | null;
  platform_scope_json: string | null;
  domain_scope_json: string | null;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function safeIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return jsonError('缺少配方 id');

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, platform_key, site_id, fragment_ids_json, notes, created_at, updated_at
       FROM style_recipes WHERE id = ?`,
    )
    .get(id) as RecipeRow | undefined;
  if (!row) return jsonError('找不到这份配方', 404);

  const fragmentIds = safeIds(row.fragment_ids_json);
  let fragments: Array<Record<string, unknown>> = [];
  if (fragmentIds.length > 0) {
    const placeholders = fragmentIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, fingerprint_id, author_name, category, tag, title, description,
                example, when_to_use, why_works, platform_scope_json, domain_scope_json
         FROM strategy_fragments_indexed WHERE id IN (${placeholders})`,
      )
      .all(...fragmentIds) as FragmentRow[];
    // 按用户原顺序保留
    const byId = new Map(rows.map((r) => [r.id, r]));
    fragments = fragmentIds
      .map((fid) => byId.get(fid))
      .filter((r): r is FragmentRow => !!r)
      .map((r) => ({
        id: r.id,
        fingerprint_id: r.fingerprint_id,
        author_name: r.author_name,
        category: r.category,
        tag: r.tag,
        title: r.title,
        description: r.description,
        example: r.example,
        when_to_use: r.when_to_use,
        why_works: r.why_works,
        platform_scope: safeArray(r.platform_scope_json),
        domain_scope: safeArray(r.domain_scope_json),
      }));
  }

  return Response.json({
    recipe: {
      id: row.id,
      name: row.name,
      platform_key: row.platform_key,
      site_id: row.site_id,
      fragment_ids: fragmentIds,
      fragments,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}

interface PatchBody {
  name?: string;
  fragment_ids?: string[];
  notes?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return jsonError('缺少配方 id');

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const db = getDb();
  const exists = db
    .prepare(`SELECT id FROM style_recipes WHERE id = ?`)
    .get(id) as { id: string } | undefined;
  if (!exists) return jsonError('找不到这份配方', 404);

  const updates: string[] = [];
  const args: unknown[] = [];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return jsonError('配方名不能为空');
    if (name.length > 60) return jsonError('配方名最多 60 字');
    updates.push('name = ?');
    args.push(name);
  }

  if (body.fragment_ids !== undefined) {
    const ids = Array.isArray(body.fragment_ids)
      ? body.fragment_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (ids.length === 0) return jsonError('至少要保留 1 个策略碎片');
    if (ids.length > 30) return jsonError('碎片太多了（上限 30）');

    // 校验存在
    const placeholders = ids.map(() => '?').join(',');
    const found = db
      .prepare(`SELECT id FROM strategy_fragments_indexed WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string }[];
    const foundSet = new Set(found.map((r) => r.id));
    const missing = ids.filter((x) => !foundSet.has(x));
    if (missing.length > 0) {
      return jsonError(`这些碎片找不到了：${missing.slice(0, 3).join(', ')}`);
    }
    updates.push('fragment_ids_json = ?');
    args.push(JSON.stringify(ids));
  }

  if (body.notes !== undefined) {
    const notes = body.notes === null ? null : body.notes.trim() || null;
    updates.push('notes = ?');
    args.push(notes);
  }

  if (updates.length === 0) return jsonError('请求里没有要改的字段');

  updates.push('updated_at = ?');
  args.push(Date.now());
  args.push(id);

  db.prepare(`UPDATE style_recipes SET ${updates.join(', ')} WHERE id = ?`).run(...args);

  return Response.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return jsonError('缺少配方 id');

  const db = getDb();
  const exists = db
    .prepare(`SELECT id FROM style_recipes WHERE id = ?`)
    .get(id) as { id: string } | undefined;
  if (!exists) return jsonError('找不到这份配方', 404);

  db.prepare(`DELETE FROM style_recipes WHERE id = ?`).run(id);
  return Response.json({ ok: true, deleted: id });
}
