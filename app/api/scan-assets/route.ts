import { NextRequest, NextResponse } from 'next/server';
import { scanDirectory } from '@/lib/images/scanner';
import { countLocalAssets } from '@/lib/images/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const targetPath = body.path || '/Users/mixingtumima0000/资料合集/项目合集/公众号/公众号配图/2026世界机器人大会';

  try {
    const t0 = Date.now();
    const res = scanDirectory(targetPath);
    const elapsed = Date.now() - t0;
    const total = countLocalAssets();

    return NextResponse.json({
      ok: true,
      path: targetPath,
      elapsed_ms: elapsed,
      scanned: res.scanned,
      inserted: res.inserted,
      skipped_existing: res.skipped_existing,
      errors: res.errors.slice(0, 5),
      total_assets: total,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        stack: (err as Error).stack,
      },
      { status: 500 }
    );
  }
}
