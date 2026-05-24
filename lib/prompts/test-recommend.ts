#!/usr/bin/env tsx
/**
 * 真调 Claude · 验证 /api/recommend 的 prompt 输出能被解析并通过 normalize。
 *
 * 用法：
 *   cd autoarticle
 *   npx tsx lib/prompts/test-recommend.ts
 */

import { streamClaude } from '../claude';
import { stripJsonFence } from '../sse';
import { buildRecommendPrompt, normalizeRecommendations, type RecommendFingerprintItem } from './recommend';
import fingerprintExample from './fingerprint.example.json' assert { type: 'json' };

async function main() {
  const fingerprintItems: RecommendFingerprintItem[] = [
    {
      fingerprint_id: 'fp_half_buddha',
      author_id: 'au_half',
      author_name: '半佛仙人',
      platform: '公众号',
      fingerprint: fingerprintExample as unknown as RecommendFingerprintItem['fingerprint'],
    },
    {
      fingerprint_id: 'fp_liurun',
      author_id: 'au_liu',
      author_name: '刘润',
      platform: '公众号',
      fingerprint: {
        author_summary: '理性温和的商业讲师，长于把抽象模型说清楚',
        fingerprint_summary:
          '开篇用"我先讲个故事"切入；中段用模型化框架（如商业飞轮）拆解；收尾用"小结+下一步"给读者带走清晰行动',
        language: { sentence_length: '中等', verbal_tics: ['我先讲个故事', '这就是商业的本质'] },
        structure: { opening_hook: '场景', closing_pattern: '总结+下一步' },
        topic: { topic_preference: '商业本质 / 战略 / 增长 / 管理' },
        do_list: ['每个观点都配一个落地步骤', '用模型化框架替代散点观点'],
        dont_list: ['不要使用网络梗', '不要写得太爽文'],
      },
    },
    {
      fingerprint_id: 'fp_caixukun',
      author_id: 'au_cxk',
      author_name: '蔡崇信观察',
      platform: '知乎',
      fingerprint: {
        author_summary: '硬数据派 · 资本侧观察 · 长答案大量数据',
        fingerprint_summary: '先给数据再给观点；中段穿插表格化结构；收尾给"长期趋势 vs 短期波动"',
        language: { sentence_length: '绵长', vocabulary_register: '半学术' },
        structure: { opening_hook: '数据' },
        topic: { topic_preference: '资本 / 一二级市场 / 财报' },
        do_list: ['用真实数据撑论点', '区分长期 / 短期趋势'],
        dont_list: ['不要写情绪化叙事'],
      },
    },
  ];

  const idea =
    '想写一篇分析"为什么很多人越努力越穷"的文章。我的角度是从剩余价值的现代变形入手，结合 996 / KPI / 内卷三个现象，最后落到"努力的本质是议价权而非时间投入"。';

  const prompt = buildRecommendPrompt(idea, fingerprintItems);
  console.log('[test-recommend] prompt 长度：', prompt.length, '字');
  console.log('[test-recommend] 正在调 Claude…');

  const t0 = Date.now();
  let chunkCount = 0;
  const raw = await streamClaude(prompt, {
    onChunk: () => { chunkCount += 1; },
  });
  const ms = Date.now() - t0;
  console.log('[test-recommend] Claude 返回 · 耗时', ms, 'ms · 收到', chunkCount, '个 chunk · 原始', raw.length, '字');

  const cleaned = stripJsonFence(raw);
  const parsed = JSON.parse(cleaned);
  const validIds = new Set(fingerprintItems.map((f) => f.fingerprint_id));
  const recs = normalizeRecommendations(parsed, validIds);

  console.log('[test-recommend] 解析成功 · 推荐数：', recs.length);
  if (recs.length !== 3) {
    console.warn('[test-recommend] 警告：推荐数不是 3（拿到', recs.length, '个）');
  }

  recs.forEach((r, i) => {
    console.log(`  --- 推荐 ${i + 1} · ${r.label ?? '(no label)'}`);
    console.log('  composition_summary:', r.composition_summary);
    console.log('  why_match:           ', r.why_match);
    r.selected_authors.forEach((a) => {
      console.log(`    · ${a.fingerprint_id} · weight=${a.weight} · ${a.reason ?? ''}`);
    });
  });

  // Sanity: 输出 JSON 不能包含明显 emoji
  if (/[\u{1F300}-\u{1FAFF}]/u.test(JSON.stringify(recs))) {
    console.error('[test-recommend] 输出里出现了 emoji（设计禁令违反）');
    process.exitCode = 1;
  }

  console.log('[test-recommend] OK');
}

main().catch((err) => {
  console.error('[test-recommend] 失败：', err);
  process.exitCode = 1;
});
