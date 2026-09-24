import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { DEFAULT_LOCAL_ASSETS_ROOT } from '@/lib/images/scanner';
import {
  classifyImageWithClaude,
  updateLocalAssetClassification,
} from '@/lib/images/classify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

interface AssetRow {
  id: string;
  file_path: string;
  visual_style: string | null;
  ai_tagged: number;
}

export async function POST(req: NextRequest) {
  let body: { limit?: number; all?: boolean; root?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = body.limit ?? Infinity;
  const all = body.all ?? false;
  const root = body.root ?? DEFAULT_LOCAL_ASSETS_ROOT;

  const db = getDb();
  const where = all ? '' : 'WHERE ai_tagged = 0';
  const rows = db
    .prepare(
      `SELECT id, file_path, visual_style, ai_tagged FROM local_assets ${where} ORDER BY indexed_at ASC`,
    )
    .all() as AssetRow[];

  const targets = Number.isFinite(limit) ? rows.slice(0, limit) : rows;

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      message: '没有需要打标的图片',
      total: 0,
      success: 0,
      failed: 0,
    });
  }

  const results = [];
  let ok = 0;
  let failed = 0;

  for (const asset of targets) {
    const t0 = Date.now();
    const result = await classifyImageWithClaude(asset.file_path, { addDir: root });
    const elapsed = Date.now() - t0;

    if (!result) {
      failed += 1;
      results.push({
        id: asset.id,
        path: asset.file_path,
        success: false,
        elapsed_ms: elapsed,
      });
      continue;
    }

    updateLocalAssetClassification(asset.id, result);
    ok += 1;
    results.push({
      id: asset.id,
      path: asset.file_path,
      success: true,
      visual_style: result.visual_style,
      tags: result.tags,
      elapsed_ms: elapsed,
    });
  }

  return NextResponse.json({
    ok: true,
    total: targets.length,
    success: ok,
    failed,
    results,
  });
}
