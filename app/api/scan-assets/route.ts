import { NextRequest, NextResponse } from 'next/server';
import { scanDirectory } from '@/lib/images/scanner';
import { countLocalAssets } from '@/lib/images/local';
import { envStr } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 默认扫描目录。
 *
 * 历史问题：这里曾**硬编码** `/Users/mixingtumima0000/资料合集/.../2026世界机器人大会`，
 * 换电脑 / 换目录必挂。现在改为按优先顺序解析：
 *   1. BYTRACE_SCAN_DEFAULT_DIR（.env.local 显式指定，推荐）
 *   2. ~/Pictures（macOS 通用图片目录）
 *   3. 当前工作目录
 *
 * 注意：本端点仍接受调用方传入的任意 path（与 /api/assets/scan 的白名单策略不同），
 * 这是既有行为；本轮只去掉硬编码，不收紧访问策略，避免改动前端既有调用。
 */
function defaultScanDir(): string {
  const configured = envStr('BYTRACE_SCAN_DEFAULT_DIR');
  if (configured) return configured;
  const home = process.env.HOME || '';
  return home ? `${home}/Pictures` : '.';
}

export async function POST(req: NextRequest) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const targetPath = body.path || defaultScanDir();

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
    // 不返回 stack（与项目「不泄露堆栈」约定对齐；旧版本这里会回传 stack）
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
      },
      { status: 500 }
    );
  }
}
