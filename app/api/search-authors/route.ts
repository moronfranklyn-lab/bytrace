/**
 * GET /api/search-authors?q=博主名
 *
 * 返回 { ok: true, candidates: AuthorCandidate[] }
 * 或   { ok: false, reason, message }
 *
 * 后端实现见 lib/search/index.ts。
 */

import { NextRequest } from 'next/server';
import { searchAuthor, isSearchError } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return json({ ok: false, reason: 'no-results', message: '搜啥呢，名字总得给一个' }, 400);
  }

  try {
    const r = await searchAuthor(q);
    if (isSearchError(r)) {
      // 200 + ok=false：前端按 reason 显示温暖提示，不当作 HTTP 错误。
      return json({ ok: false, reason: r.reason, message: r.message });
    }
    return json({ ok: true, candidates: r });
  } catch (e) {
    return json(
      {
        ok: false,
        reason: 'engine-error',
        message: '搜索后台抽风：' + ((e as Error).message || '未知'),
      },
      200,
    );
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
