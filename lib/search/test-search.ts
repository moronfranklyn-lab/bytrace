/* eslint-disable no-console */
/**
 * 博主名搜索真实验证脚本（Agent I）。
 * 跑法：cd autoarticle && npx tsx lib/search/test-search.ts
 *
 * 真发请求；不 mock。失败也照实记录。
 */
import { searchAuthor, isSearchError } from './index';

const QUERIES = ['半佛仙人', '老蒋巨靠谱', '沈帅波'];

async function main() {
  for (const q of QUERIES) {
    console.log('\n========= 搜索：' + q + ' =========');
    const t0 = Date.now();
    const r = await searchAuthor(q);
    const elapsed = Date.now() - t0;
    if (isSearchError(r)) {
      console.log(`  FAIL reason=${r.reason}  message="${r.message}"  ${elapsed}ms`);
      continue;
    }
    console.log(`  OK   候选数=${r.length}  ${elapsed}ms`);
    const byPlatform = new Map<string, number>();
    for (const c of r) {
      byPlatform.set(c.platform, (byPlatform.get(c.platform) ?? 0) + 1);
    }
    console.log('  平台分布：', Object.fromEntries(byPlatform.entries()));
    // Top 5 候选
    for (const c of r.slice(0, 5)) {
      console.log(
        `    [${c.platform}/${c.medium}] conf=${c.confidence.toFixed(2)} ${c.name}`,
      );
      console.log(`      ${c.url}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
