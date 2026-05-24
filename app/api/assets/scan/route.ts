import { NextRequest, NextResponse } from 'next/server';
import { scanDirectory, DEFAULT_LOCAL_ASSETS_ROOT } from '@/lib/images/scanner';
import { countLocalAssets } from '@/lib/images/local';

// better-sqlite3 + fs sync APIs — Node runtime mandatory.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScanRequest {
  root?: string;
}

export async function POST(req: NextRequest) {
  let body: ScanRequest = {};
  try {
    body = (await req.json()) as ScanRequest;
  } catch {
    // empty body is fine — fall back to default root
  }

  const root = body.root?.trim() || DEFAULT_LOCAL_ASSETS_ROOT;
  const t0 = Date.now();
  try {
    const res = scanDirectory(root);
    const total = countLocalAssets();
    return NextResponse.json({
      ok: true,
      elapsed_ms: Date.now() - t0,
      ...res,
      total_in_db: total,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        root,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

// Allow a quick GET to see current asset count without triggering a scan.
export async function GET() {
  const total = countLocalAssets();
  return NextResponse.json({
    total_in_db: total,
    default_root: DEFAULT_LOCAL_ASSETS_ROOT,
  });
}
