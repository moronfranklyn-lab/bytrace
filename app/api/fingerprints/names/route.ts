import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fingerprints/names?ids=a,b,c
 * 返回 { [fingerprint_id]: { author_name, platform } }
 * 给 /compose Step 3 把推荐里的 fingerprint_id 还原成可读名字。
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idsParam = (searchParams.get('ids') ?? '').trim();
  if (!idsParam) {
    return Response.json({});
  }
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({});

  try {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT f.id, a.name AS author_name, a.platform
         FROM fingerprints f
         JOIN authors a ON a.id = f.author_id
         WHERE f.id IN (${placeholders})`,
      )
      .all(...ids) as Array<{ id: string; author_name: string; platform: string | null }>;
    const out: Record<string, { author_name: string; platform: string | null }> = {};
    for (const r of rows) out[r.id] = { author_name: r.author_name, platform: r.platform };
    return Response.json(out);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
