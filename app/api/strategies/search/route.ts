import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { ARTICLE_CATEGORIES, type ArticleCategory } from '@/lib/prompts/fingerprint-v3-stage0';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/strategies/search?category=科技&tag=opening&platform=公众号&limit=20
 *
 * 跨博主检索策略碎片。前端写作时按"我要写哪类、什么手法、什么平台"召出候选。
 *
 * 过滤：
 *   - category : 限定到 ARTICLE_CATEGORIES 之一。匹配 strategy_fragments_indexed.category
 *     等于该值的行（注意全局碎片 category=NULL 不会被命中——按用户「侦察一类」的明确意图，
 *     全局碎片留给主指纹直接展示）
 *   - tag      : opening / transition / closing / argument / language / visual / pacing / hook
 *   - platform : 字符串匹配 platform_scope_json 内是否包含
 *   - limit    : 默认 20，最大 100
 *
 * 返回：[{ id, author_name, category, tag, title, description, example, when_to_use,
 *   why_works, platform_scope, domain_scope, fingerprint_id }]
 */

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

function safeParseArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category')?.trim() || null;
  const tag = url.searchParams.get('tag')?.trim() || null;
  const platform = url.searchParams.get('platform')?.trim() || null;
  const limitRaw = Number(url.searchParams.get('limit') ?? '20');
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 20));

  if (category && !ARTICLE_CATEGORIES.includes(category as ArticleCategory)) {
    return Response.json(
      { error: `category 必须是 ${ARTICLE_CATEGORIES.join(' / ')} 之一` },
      { status: 400 },
    );
  }

  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (category) {
    where.push(`category = ?`);
    params.push(category);
  }
  if (tag) {
    where.push(`tag = ?`);
    params.push(tag);
  }
  const sql =
    `SELECT id, fingerprint_id, author_name, category, tag, title, description,
            example, when_to_use, why_works, platform_scope_json, domain_scope_json
     FROM strategy_fragments_indexed
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT ?`;
  params.push(limit * 3); // 多拿一些，platform 过滤后再截

  const rows = db.prepare(sql).all(...params) as FragmentRow[];

  const items = rows
    .map((r) => ({
      id: r.id,
      fingerprint_id: r.fingerprint_id,
      author_name: r.author_name,
      category: r.category as ArticleCategory | null,
      tag: r.tag,
      title: r.title,
      description: r.description,
      example: r.example,
      when_to_use: r.when_to_use,
      why_works: r.why_works,
      platform_scope: safeParseArray(r.platform_scope_json),
      domain_scope: safeParseArray(r.domain_scope_json),
    }))
    .filter((x) => {
      if (!platform) return true;
      // 空 scope 视作"通用"，也保留
      return x.platform_scope.length === 0 || x.platform_scope.includes(platform);
    })
    .slice(0, limit);

  // 按 tag 分组方便前端展示"开头 5 条 / 收尾 3 条"
  const byTag: Record<string, typeof items> = {};
  for (const item of items) {
    const k = item.tag || 'unknown';
    (byTag[k] ??= []).push(item);
  }

  return Response.json({
    count: items.length,
    filters: { category, tag, platform, limit },
    items,
    by_tag: byTag,
  });
}
