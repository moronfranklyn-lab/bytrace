import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { pickAvatarChar } from '@/lib/authors/avatar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/authors/:id —— 改博主名 / 来源平台
 *
 * Body: { name?: string; platform?: string | null }
 *
 * 行为：
 * - 字段都可选，给哪个就改哪个，没给的不动
 * - name 去空白后必须 ≥ 1 字符，否则 400
 * - platform 允许 null（清空）/ 任意字符串（不强制白名单，因为 PLATFORMS 里
 *   还有 custom 之类的兜底；UI 只给标准选项就够了）
 */

interface ReqBody {
  name?: string;
  platform?: string | null;
}

interface Params {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return jsonError('缺少 author id');

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM authors WHERE id = ?`)
    .get(id) as { id: string } | undefined;
  if (!row) return jsonError('找不到这个博主', 404);

  const updates: string[] = [];
  const args: unknown[] = [];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return jsonError('博主名不能为空');
    if (name.length > 60) return jsonError('博主名最多 60 字');
    updates.push('name = ?');
    args.push(name);
    // 同步更新头像字符（首个 CJK 或首字母大写）
    updates.push('avatar_emoji = ?');
    args.push(pickAvatarChar(name));
  }

  if (body.platform !== undefined) {
    const platform =
      body.platform === null ? null : body.platform.trim() || null;
    if (platform !== null && platform.length > 30) {
      return jsonError('平台名最多 30 字');
    }
    updates.push('platform = ?');
    args.push(platform);
  }

  if (updates.length === 0) {
    return jsonError('请求里没有要改的字段（name / platform）');
  }

  args.push(id);
  db.prepare(`UPDATE authors SET ${updates.join(', ')} WHERE id = ?`).run(...args);

  const fresh = db
    .prepare(`SELECT id, name, platform, avatar_emoji FROM authors WHERE id = ?`)
    .get(id) as {
      id: string;
      name: string;
      platform: string | null;
      avatar_emoji: string | null;
    };

  return Response.json({ ok: true, author: fresh });
}
