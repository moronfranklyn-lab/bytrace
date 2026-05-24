/* eslint-disable no-console */
/**
 * B 站爬虫真实验证脚本（Agent I）。
 * 跑法：cd autoarticle && npx tsx lib/crawler/adapters/test-bilibili.ts
 *
 * 三个用例：
 *   1) 视频 BV1GJ411x7h7（科普向公开视频）→ 标题/简介
 *   2) 同一视频尝试拿字幕 → 打印字幕前 200 字
 *   3) UP 主主页 罗翔说刑法（uid=1340190821）→ 视频列表
 *
 * 真发请求；任何失败照实记录原因。
 */
import { crawlArticle, crawlAuthorIndex, isCrawlError } from '../index';

// 罗翔说刑法 · 较老的稳定公开视频
const VIDEO_URL = 'https://www.bilibili.com/video/BV1Hx411E7vS';
const SPACE_URL_LUOXIANG = 'https://space.bilibili.com/1340190821';
const SPACE_URL_BANFO = 'https://space.bilibili.com/25876945'; // 半佛仙人

async function testVideo() {
  console.log('\n========= B 站视频抓取：' + VIDEO_URL + ' =========');
  const t0 = Date.now();
  const r = await crawlArticle(VIDEO_URL);
  const elapsed = Date.now() - t0;
  if (isCrawlError(r)) {
    console.log(`  FAIL reason=${r.reason}  message="${r.message}"  ${elapsed}ms`);
    return;
  }
  console.log(`  OK   title="${(r.title ?? '').slice(0, 60)}"  ${elapsed}ms`);
  console.log(`       content 长度=${r.content.length}  images=${r.images.length}  medium=${r.medium}`);
  // 区分字幕段（包含 ## 字幕 之后）
  const marker = '## 字幕';
  const idx = r.content.indexOf(marker);
  const subPart = idx >= 0 ? r.content.slice(idx + marker.length).trim() : '';
  if (subPart && !subPart.startsWith('（此视频未提供字幕')) {
    console.log('  字幕前 200 字：');
    console.log('    ' + subPart.replace(/\n/g, ' ').slice(0, 200) + (subPart.length > 200 ? '…' : ''));
  } else {
    console.log('  字幕：无（' + (subPart || '空') + '）');
  }
}

async function testSpace(url: string, label: string) {
  console.log(`\n========= B 站 UP 主主页：${label}  ${url} =========`);
  const t0 = Date.now();
  const r = await crawlAuthorIndex(url);
  const elapsed = Date.now() - t0;
  if (isCrawlError(r)) {
    console.log(`  FAIL reason=${r.reason}  message="${r.message}"  ${elapsed}ms`);
    return;
  }
  console.log(`  OK   作者=${r.author_name}  视频数=${r.article_urls.length}  ${elapsed}ms`);
  for (const u of r.article_urls.slice(0, 5)) {
    console.log('    ' + u);
  }
}

async function main() {
  await testVideo();
  await testSpace(SPACE_URL_LUOXIANG, '罗翔说刑法');
  await testSpace(SPACE_URL_BANFO, '半佛仙人');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
