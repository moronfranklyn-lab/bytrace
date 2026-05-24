/* eslint-disable no-console */
/**
 * 本地真实抓取测试。
 * 跑法：cd autoarticle && npx tsx lib/crawler/test-crawler.ts
 * 不 mock；失败就老实记录失败原因，便于排查站点结构变化或反爬。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crawlArticle, detectUrlType, isCrawlError } from './index';
import type { CrawledArticle, CrawlError } from './index';

type Expect = 'success' | 'wechat-error' | 'success-or-blocked';

type Case = {
  label: string;
  url: string;
  expect: Expect;
  note?: string;
};

const CASES: Case[] = [
  {
    label: '知乎专栏',
    url: 'https://zhuanlan.zhihu.com/p/679162970',
    expect: 'success-or-blocked',
    note: '知乎对裸 HTTP 请求强制 403，需要浏览器/cookie。adapter 正确路由+给出温暖错误即算通过',
  },
  {
    label: '少数派',
    url: 'https://sspai.com/post/79453',
    expect: 'success',
  },
  {
    label: '优设网',
    url: 'https://www.uisdc.com/google-search',
    expect: 'success',
  },
  {
    label: 'Generic 兜底（overreacted.io）',
    url: 'https://overreacted.io/a-complete-guide-to-useeffect/',
    expect: 'success',
  },
  {
    label: '公众号（应被拒绝）',
    url: 'https://mp.weixin.qq.com/s/somefakeid',
    expect: 'wechat-error',
  },
];

type Row = {
  label: string;
  url: string;
  detect: ReturnType<typeof detectUrlType>;
  ok: boolean;
  expect: Expect;
  matched: boolean;
  title: string | null;
  content_len: number;
  image_count: number;
  host: string | null;
  source: string | null;
  error?: CrawlError;
};

function summarize(label: string, url: string, expect: Expect, r: CrawledArticle | CrawlError): Row {
  const detect = detectUrlType(url);
  if (isCrawlError(r)) {
    const matched =
      (expect === 'wechat-error' && r.reason === 'wechat') ||
      (expect === 'success-or-blocked' && (r.reason === 'blocked' || r.reason === 'timeout'));
    return {
      label,
      url,
      detect,
      ok: false,
      expect,
      matched,
      title: null,
      content_len: 0,
      image_count: 0,
      host: null,
      source: null,
      error: r,
    };
  }
  return {
    label,
    url,
    detect,
    ok: true,
    expect,
    matched: expect === 'success' || expect === 'success-or-blocked',
    title: r.title,
    content_len: r.content.length,
    image_count: r.images.length,
    host: r.host,
    source: r.source,
  };
}

async function main() {
  const rows: Row[] = [];
  for (const c of CASES) {
    process.stdout.write(`\n[${c.label}] ${c.url}\n`);
    const t0 = Date.now();
    const res = await crawlArticle(c.url);
    const elapsed = Date.now() - t0;
    const row = summarize(c.label, c.url, c.expect, res);
    rows.push(row);
    console.log(
      `  detect=${row.detect.platform} (wechat=${row.detect.is_wechat}, supported=${row.detect.is_supported_for_crawl})`,
    );
    if (row.ok) {
      console.log(
        `  OK   title="${(row.title ?? '').slice(0, 40)}"  content=${row.content_len}字  images=${row.image_count}  source=${row.source}  host=${row.host}  ${elapsed}ms`,
      );
    } else {
      console.log(
        `  FAIL reason=${row.error?.reason}  msg="${row.error?.message}"  matched-expect=${row.matched}  ${elapsed}ms`,
      );
    }
  }

  const total = rows.length;
  const matched = rows.filter((r) => r.matched).length;
  console.log(`\n=== 汇总：${matched}/${total} 命中预期 ===\n`);

  const outPath = join(process.cwd(), 'lib', 'crawler', 'test-output.json');
  writeFileSync(outPath, JSON.stringify({ generated_at: Date.now(), rows }, null, 2), 'utf-8');
  console.log(`已写入 ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
