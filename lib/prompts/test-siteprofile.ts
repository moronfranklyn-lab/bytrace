/**
 * 真调 Claude 验证 buildSiteProfilePrompt 输出可解析。
 *
 * 用法：
 *   npx tsx lib/prompts/test-siteprofile.ts
 *
 * 流程：
 * 1. 用 F0 的 crawlAuthorIndex + crawlArticle 爬 3 篇少数派文章
 *    （如果爬失败，就 fallback 到本地 mock 文本，照样验证 prompt → parse 链路）
 * 2. 构造 prompt 调 streamClaude（这里不流式，等完整 stdout）
 * 3. 剥 ```json fence、JSON.parse
 * 4. 把核心字段打印出来，让人肉眼确认
 */

import { buildSiteProfilePrompt, type SiteProfileArticle } from './siteprofile';
import { streamClaude } from '../claude';
import {
  crawlArticle,
  crawlAuthorIndex,
  isCrawlError,
  type CrawledArticle,
} from '../crawler';

const SSPAI_INDEX_URL = 'https://sspai.com/matrix';
const TARGET_COUNT = 3;
const PER_FETCH_SLEEP_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripJsonFence(raw: string): string {
  const m = raw.match(/```json\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  const f = raw.indexOf('{');
  const l = raw.lastIndexOf('}');
  if (f !== -1 && l > f) return raw.slice(f, l + 1).trim();
  return raw.trim();
}

const MOCK_ARTICLES: SiteProfileArticle[] = [
  {
    title: 'Cursor 用了 3 个月，我把它从 IDE 用成了"第二大脑"',
    url: 'mock://sspai/matrix/1',
    content: `开篇先讲场景：作为一个非典型程序员，我每天写代码的时间其实不到 30%，剩下大量时间在看资料、整理思路、写邮件。
传统 IDE 对我没用，但 Cursor 不一样——它内置的 chat 让我可以把"在写代码"和"在思考"无缝衔接。
我把 Cursor 当大纲工具用：每个项目根目录放一个 PLAN.md，让它先帮我梳理思路，再让它去落地实现。
工作流分三步：场景代入 → 工具组合 → 落地步骤。第三个月以后我发现自己居然在 Cursor 里写日记。
当然 Cursor 也有局限：它的 chat 上下文窗口有限，长项目要不停手动 trim；它的本地索引偶尔会漏文件，特别是 Notion 同步过来的 markdown。
对设计师 / 编辑 / 内容工作者来说，Cursor 比 Notion AI 更"长在工作流里"。试试，至少 3 个月再下结论。`,
  },
  {
    title: '用 7 天测了 12 个待办工具，最后留下了这 3 个',
    url: 'mock://sspai/matrix/2',
    content: `今年初我决定做一次"待办工具大清洗"——把电脑和手机里所有看起来在管时间的 app 都试一遍。
测试方式很简单：每一个工具用 7 天，每天至少 3 个真实 todo。规则是不能用花俏功能。
12 个工具里，淘汰了 9 个：要么逻辑太重（Notion 全套），要么生态太薄（一些独立开发者的小工具）。
剩下的三个：Things 3、Reminders、Obsidian Tasks。各有分工：Things 装系统级任务，Reminders 装跨设备语音，Obsidian Tasks 装项目级 todo。
工作流上：早上先扫一遍 Things 3 的 Today，再开 Obsidian 看项目级。中间想到啥按 Hey Siri 扔进 Reminders。
局限：这套组合的同步会有小问题——Things 3 不支持自定义字段，复杂 GTD 用户可能会缺重要功能。但对于 80% 的用户来说够了。
建议：先想清楚自己的"task 类型"再挑工具。工具的边界 = 你工作流的边界。`,
  },
  {
    title: '我把 Obsidian 用成了"个人维基"，3 个月后回头看',
    url: 'mock://sspai/matrix/3',
    content: `三个月前我决定把所有笔记从 Notion 迁到 Obsidian。原因很简单：本地、Markdown、可控。
迁的时候最痛苦的是数据库——Notion 的 Database 在 Obsidian 里没有直接对应。后来用 Dataview 插件实现了 80% 的效果。
迁完之后，发现自己的笔记结构变了：不再追求"完美 PARA 体系"，而是按 Zettelkasten 的"原子化笔记"思路重新整理。
具体步骤：先把所有大文章拆成段落级 atomic notes，再用双链把它们织成网。配 Graph view 看一下，挺有意思。
工作流上变化最大的是写作：以前我会在 Notion 里写长稿，现在习惯先在 Obsidian 里堆零散观点，再在 Cursor 里拼。
当然 Obsidian 也有局限：移动端体验拉胯（特别是 iOS），多人协作几乎不可能。如果是团队用，还是 Notion。
建议：个人笔记选 Obsidian，团队协作选 Notion——别试图用一个工具打天下。`,
  },
];

async function fetchSampleArticles(): Promise<{
  articles: SiteProfileArticle[];
  source: 'live' | 'mock';
  notes: string[];
}> {
  const notes: string[] = [];

  // 1. crawlAuthorIndex
  let candidate: string[] = [];
  try {
    const idx = await crawlAuthorIndex(SSPAI_INDEX_URL);
    if (isCrawlError(idx)) {
      notes.push(`crawlAuthorIndex 失败：${idx.message}`);
    } else {
      candidate = idx.article_urls.slice(0, TARGET_COUNT * 2);
      notes.push(`crawlAuthorIndex 拿到 ${candidate.length} 个候选 URL`);
    }
  } catch (e) {
    notes.push(`crawlAuthorIndex 抛错：${(e as Error).message}`);
  }

  if (candidate.length === 0) {
    notes.push('回退到本地 MOCK 文章');
    return { articles: MOCK_ARTICLES.slice(0, TARGET_COUNT), source: 'mock', notes };
  }

  // 2. 逐篇 crawlArticle
  const articles: SiteProfileArticle[] = [];
  for (const u of candidate) {
    if (articles.length >= TARGET_COUNT) break;
    if (articles.length > 0) await sleep(PER_FETCH_SLEEP_MS);
    try {
      const a = await crawlArticle(u);
      if (isCrawlError(a)) {
        notes.push(`  - ${u} 失败：${a.message}`);
        continue;
      }
      const ca = a as CrawledArticle;
      if (!ca.content || ca.content.length < 200) {
        notes.push(`  - ${u} 正文太短（${ca.content?.length ?? 0}）`);
        continue;
      }
      articles.push({
        title: ca.title ?? undefined,
        url: ca.url,
        content: ca.content,
      });
      notes.push(`  + ${u} ok（${ca.content.length} 字）`);
    } catch (e) {
      notes.push(`  - ${u} 抛错：${(e as Error).message}`);
    }
  }

  if (articles.length < 3) {
    notes.push(`实际只爬到 ${articles.length} 篇，回退到 MOCK`);
    return { articles: MOCK_ARTICLES.slice(0, TARGET_COUNT), source: 'mock', notes };
  }

  return { articles, source: 'live', notes };
}

async function main() {
  console.log('===== test-siteprofile =====');
  console.log('步骤 1：取样本');
  const { articles, source, notes } = await fetchSampleArticles();
  for (const n of notes) console.log('  ' + n);
  console.log(`来源：${source} · 取到 ${articles.length} 篇`);

  console.log('\n步骤 2：构造 prompt');
  const prompt = buildSiteProfilePrompt(articles, {
    siteHost: 'sspai.com',
    sectionHint: 'Matrix · 效率板块',
  });
  console.log(`prompt 长度：${prompt.length} 字符`);

  console.log('\n步骤 3：调 Claude（可能要等 30-90 秒）...');
  const t0 = Date.now();
  let raw = '';
  try {
    raw = await streamClaude(prompt, {
      timeoutMs: 180_000,
      onChunk: () => {
        process.stdout.write('.');
      },
    });
  } catch (e) {
    console.error('\n❌ Claude 调用失败：', (e as Error).message);
    process.exit(1);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n模型耗时 ${dt}s · 原始输出 ${raw.length} 字符`);

  console.log('\n步骤 4：解析 JSON');
  const cleanedJson = stripJsonFence(raw);
  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(cleanedJson);
  } catch (e) {
    console.error('❌ JSON.parse 失败：', (e as Error).message);
    console.error('清洗后输出片段：', cleanedJson.slice(0, 600));
    process.exit(1);
  }

  console.log('\n===== 解析后画像 =====');
  console.log('site_name:        ', profile.site_name);
  console.log('section:          ', profile.section);
  console.log('url_pattern:      ', profile.url_pattern);
  console.log('preferred_topics: ', profile.preferred_topics);
  console.log('word_count_range: ', profile.word_count_range);
  console.log('image_density:    ', profile.image_density);
  console.log('opening_pattern:  ', profile.opening_pattern);
  console.log('closing_pattern:  ', profile.closing_pattern);
  console.log('tone:             ', profile.tone);
  console.log('title_patterns:');
  if (Array.isArray(profile.title_patterns)) {
    for (const t of profile.title_patterns) console.log('  - ' + t);
  }
  console.log('key_phrases:      ', profile.key_phrases);

  // 基本字段断言
  const requiredKeys = [
    'site_name',
    'section',
    'url_pattern',
    'preferred_topics',
    'title_patterns',
    'word_count_range',
    'image_density',
    'opening_pattern',
    'closing_pattern',
    'tone',
    'key_phrases',
  ];
  const missing = requiredKeys.filter((k) => !(k in profile));
  if (missing.length > 0) {
    console.error('\n❌ 缺字段：', missing.join(', '));
    process.exit(1);
  }
  if (
    !Array.isArray(profile.word_count_range) ||
    profile.word_count_range.length !== 2 ||
    typeof profile.word_count_range[0] !== 'number' ||
    typeof profile.word_count_range[1] !== 'number'
  ) {
    console.error('\n❌ word_count_range 不是 [min, max] 数字数组');
    process.exit(1);
  }
  console.log('\n✅ 所有必填字段齐全，JSON 可解析，类型校验通过');
}

main().catch((e) => {
  console.error('未捕获错误：', e);
  process.exit(1);
});
