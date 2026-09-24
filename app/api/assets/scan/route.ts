import { NextRequest, NextResponse } from 'next/server';
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { scanDirectory, DEFAULT_LOCAL_ASSETS_ROOT } from '@/lib/images/scanner';
import { countLocalAssets } from '@/lib/images/local';

// better-sqlite3 + fs sync APIs — Node runtime mandatory.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScanRequest {
  root?: string;
}

// root 白名单：默认素材根目录 + 用户主目录下常见图片目录。
// 索引结果能经 /api/assets/file 读出文件内容，不设边界等于任意目录可读。
const ALLOWED_SCAN_ROOTS = [
  resolve(DEFAULT_LOCAL_ASSETS_ROOT),
  resolve(homedir(), 'Pictures'),
  resolve(homedir(), 'Desktop'),
  resolve(homedir(), 'Downloads'),
];

function isAllowedScanRoot(absRoot: string): boolean {
  return ALLOWED_SCAN_ROOTS.some(
    (base) => absRoot === base || absRoot.startsWith(base + sep),
  );
}

export async function POST(req: NextRequest) {
  let body: ScanRequest = {};
  try {
    body = (await req.json()) as ScanRequest;
  } catch {
    // empty body is fine — fall back to default root
  }

  const root = resolve(body.root?.trim() || DEFAULT_LOCAL_ASSETS_ROOT);
  if (!isAllowedScanRoot(root)) {
    return NextResponse.json(
      {
        ok: false,
        root,
        error: '这个目录不在允许扫描的范围里（素材根目录 / 图片 / 桌面 / 下载）',
        allowed_roots: ALLOWED_SCAN_ROOTS,
      },
      { status: 403 },
    );
  }
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
