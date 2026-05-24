#!/usr/bin/env tsx
/**
 * End-to-end smoke test for the image pipeline.
 *
 *   npx tsx scripts/test-image-flow.ts
 *
 * 1. Run a local scan (idempotent).
 * 2. Local search a few keywords, print top hits.
 * 3. Check Unsplash adapter gracefully returns [] when key missing.
 * 4. (Optional) Hit /api/images/auto if BASE_URL env points to a running dev server.
 *
 * No assertions on Claude — it's a real subprocess and not always available.
 */

import { scanDirectory, DEFAULT_LOCAL_ASSETS_ROOT } from '../lib/images/scanner';
import { searchLocalAssets, countLocalAssets } from '../lib/images/local';
import { searchUnsplash, isUnsplashConfigured } from '../lib/images/unsplash';

async function main() {
  console.log('--- 1. scan ---');
  const scanRes = scanDirectory(DEFAULT_LOCAL_ASSETS_ROOT);
  console.log(JSON.stringify(scanRes, null, 2));
  const total = countLocalAssets();
  console.log(`db rows: ${total}`);
  if (total === 0) {
    console.error('FAIL: 0 rows after scan');
    process.exit(1);
  }

  console.log('\n--- 2. local search ---');
  for (const q of [['工作场景'], ['ai'], ['桌面', 'desk'], ['xxx-nothing-matches']]) {
    const hits = searchLocalAssets(q, 3);
    console.log(`  query ${JSON.stringify(q)} -> ${hits.length} hits`);
    for (const h of hits) {
      console.log(`    · ${h.file_name}  tags=${JSON.stringify(h.tags)}`);
    }
  }

  console.log('\n--- 3. unsplash ---');
  console.log(`isUnsplashConfigured = ${isUnsplashConfigured()}`);
  const photos = await searchUnsplash('quiet desk', 3);
  console.log(`searchUnsplash returned ${photos.length} (expected 0 when no key)`);
  if (!isUnsplashConfigured() && photos.length !== 0) {
    console.error('FAIL: unsplash returned non-empty without a key');
    process.exit(1);
  }

  console.log('\n--- 4. /api/images/auto (optional) ---');
  const base = process.env.BASE_URL;
  if (!base) {
    console.log('  skipped (set BASE_URL=http://localhost:3000 to enable)');
  } else {
    const sample =
      '这是一篇关于安静工作环境的短文。我喜欢在清晨打开窗户，让冷空气流进来。' +
      '桌上摊着昨天没写完的笔记本，咖啡还冒着热气。这种时候不需要任何背景音乐，只需要一点光。' +
      '我开始动笔。第一句话往往最难，但写下之后，剩下的字会自己流出来。' +
      '工作就是这样一件事——你不需要等待灵感，只需要给灵感一张桌子。';
    try {
      const res = await fetch(`${base}/api/images/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_content: sample,
          slot_count: 2,
          sources: ['local'],
        }),
      });
      const text = await res.text();
      console.log(`  status: ${res.status}`);
      console.log(`  body (first 400 chars): ${text.slice(0, 400)}`);
    } catch (err) {
      console.log(`  network: ${(err as Error).message}`);
    }
  }

  console.log('\nALL GOOD.');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
