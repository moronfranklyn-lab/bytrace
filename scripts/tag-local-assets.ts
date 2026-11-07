#!/usr/bin/env tsx
/**
 * One-shot 视觉打标 — 把 local_assets 里还没经过真视觉分类（ai_tagged=0）的图
 * 逐张喂给本机 Claude CLI 看图，写回 visual_style + 内容标签。
 *
 *   npx tsx scripts/tag-local-assets.ts [--limit N] [--all] [--root /path]
 *
 *   --limit N  最多处理 N 张（默认全部 ai_tagged=0 的）。先 --limit 2 试水再放开。
 *   --all      连 ai_tagged=1 的也重打（默认只挑没打过的，省配额）。
 *   --root     传给 Claude --add-dir 的可读根（默认图库根，让 Read 工具能访问到图）。
 *
 * 串行不并发：本机 Claude 是订阅，并发会撞限速（与 draft route 多平台串行同理）。
 * 每张 ~30-90s，14 张约 10-20 分钟。fail-open：单张失败不阻断后续。
 */

import { getDb } from '../lib/db';
import { DEFAULT_LOCAL_ASSETS_ROOT } from '../lib/images/scanner';
import {
  classifyImageWithClaude,
  updateLocalAssetClassification,
} from '../lib/images/classify';

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface AssetRow {
  id: string;
  file_path: string;
  visual_style: string | null;
  ai_tagged: number;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let limit = Infinity;
  let all = false;
  let root = DEFAULT_LOCAL_ASSETS_ROOT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      limit = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = Infinity;
    } else if (a === '--all') {
      all = true;
    } else if (a === '--root') {
      root = argv[++i] ?? root;
    }
  }
  return { limit, all, root };
}

async function main() {
  const { limit, all, root } = parseArgs();
  const db = getDb();

  const where = all ? '' : 'WHERE ai_tagged = 0';
  const rows = db
    .prepare(
      `SELECT id, file_path, visual_style, ai_tagged FROM local_assets ${where} ORDER BY indexed_at ASC`,
    )
    .all() as AssetRow[];

  const targets = Number.isFinite(limit) ? rows.slice(0, limit) : rows;

  console.log(`[tag] 候选 ${rows.length} 张（${all ? '全部' : 'ai_tagged=0'}），本次处理 ${targets.length} 张`);
  console.log(`[tag] add-dir root: ${root}`);
  if (targets.length === 0) {
    console.log('[tag] 没有要打标的图，退出。');
    return;
  }

  let ok = 0;
  let failed = 0;
  const t0 = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const asset = targets[i];
    const label = `[${i + 1}/${targets.length}]`;
    const ti = Date.now();
    process.stdout.write(`${label} ${asset.file_path} ... `);

    const result = await classifyImageWithClaude(asset.file_path, { addDir: root });
    const dt = Date.now() - ti;

    if (!result) {
      failed += 1;
      console.log(`失败（${fmtMs(dt)}）—— 保留启发式标，fail-open`);
      continue;
    }

    updateLocalAssetClassification(asset.id, result);
    ok += 1;
    console.log(`${result.visual_style} · [${result.tags.join(', ')}] （${fmtMs(dt)}）`);
  }

  console.log(`\n[tag] 完成：成功 ${ok} · 失败 ${failed} · 总耗时 ${fmtMs(Date.now() - t0)}`);
}

main().catch((err) => {
  console.error('[tag] fatal:', err);
  process.exit(1);
});
