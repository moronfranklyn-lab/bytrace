#!/usr/bin/env tsx
/**
 * One-shot scanner — walks 楠's local image library and bulk-inserts into
 * the `local_assets` table. Idempotent: re-running only adds new files.
 *
 *   npx tsx scripts/scan-local-assets.ts [optional/path]
 *
 * Defaults to /Users/nan/ai资料合集/项目合集/公众号/公众号配图/
 */

import { scanDirectory, DEFAULT_LOCAL_ASSETS_ROOT } from '../lib/images/scanner';
import { countLocalAssets } from '../lib/images/local';

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  const root = process.argv[2] ?? DEFAULT_LOCAL_ASSETS_ROOT;
  console.log(`[scan] root: ${root}`);

  const t0 = Date.now();
  const res = scanDirectory(root);
  const elapsed = Date.now() - t0;

  console.log(`[scan] done in ${fmtMs(elapsed)}`);
  console.log(`  scanned          : ${res.scanned} (files walked)`);
  console.log(`  inserted         : ${res.inserted}`);
  console.log(`  skipped_existing : ${res.skipped_existing}`);
  console.log(`  errors           : ${res.errors.length}`);

  if (res.errors.length > 0) {
    console.log('  first 5 errors:');
    for (const e of res.errors.slice(0, 5)) {
      console.log(`    - ${e.path} → ${e.message}`);
    }
  }

  const total = countLocalAssets();
  console.log(`[scan] local_assets total rows now: ${total}`);

  if (total === 0) {
    console.error('[scan] warning: 0 rows in local_assets — directory may be empty or path is wrong');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[scan] fatal:', err);
  process.exit(1);
});
