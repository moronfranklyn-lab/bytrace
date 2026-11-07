#!/usr/bin/env tsx
/**
 * 真调 Claude · 验证 /api/compose/outline 的 prompt 输出能被解析并通过 normalize。
 *
 * 用法：
 *   cd autoarticle
 *   npx tsx lib/prompts/test-outline.ts
 */

import { streamClaude } from '../claude';
import { stripJsonFence } from '../sse';
import { buildOutlinePrompt, normalizeOutline } from './outline';
import type { Composition, FingerprintMeta } from '../composition';
import fingerprintExample from './fingerprint.example.json' assert { type: 'json' };

async function main() {
  const composition: Composition = {
    selected_authors: [
      {
        author_id: 'au_half',
        fingerprint_id: 'fp_half_buddha',
        weight: 0.7,
      },
      {
        author_id: 'au_liu',
        fingerprint_id: 'fp_liurun',
        weight: 0.3,
        use_strategies: ['structure', 'do_list'],
      },
    ],
    custom_notes: '收尾要有一个能截图的金句',
  };

  const fpMap = new Map<string, FingerprintMeta>([
    [
      'fp_half_buddha',
      {
        author_name: '半佛仙人',
        platform: '公众号',
        fingerprint: fingerprintExample as unknown as FingerprintMeta['fingerprint'],
      },
    ],
    [
      'fp_liurun',
      {
        author_name: '刘润',
        platform: '公众号',
        fingerprint: {
          author_summary: '理性温和的商业讲师',
          fingerprint_summary: '场景切入 · 模型框架拆解 · 总结+下一步收尾',
          structure: { opening_hook: '场景', closing_pattern: '总结+下一步' },
          do_list: ['每个观点都配一个落地步骤', '用模型化框架替代散点观点'],
        },
      },
    ],
  ]);

  const idea =
    '想写一篇分析"为什么很多人越努力越穷"的文章。我的角度是从剩余价值的现代变形入手，结合 996 / KPI / 内卷三个现象，最后落到"努力的本质是议价权而非时间投入"。';

  const prompt = buildOutlinePrompt(idea, composition, fpMap);
  console.log('[test-outline] prompt 长度：', prompt.length, '字');
  console.log('[test-outline] 正在调 Claude…');

  const t0 = Date.now();
  let chunkCount = 0;
  const raw = await streamClaude(prompt, {
    onChunk: () => { chunkCount += 1; },
  });
  const ms = Date.now() - t0;
  console.log('[test-outline] Claude 返回 · 耗时', ms, 'ms · 收到', chunkCount, '个 chunk · 原始', raw.length, '字');

  const cleaned = stripJsonFence(raw);
  const parsed = JSON.parse(cleaned);
  const outline = normalizeOutline(parsed);

  if (!outline) {
    console.error('[test-outline] normalize 失败 · 原始片段：\n', cleaned.slice(0, 500));
    process.exitCode = 1;
    return;
  }

  console.log('[test-outline] 大纲解析成功');
  console.log('  working_title:', outline.working_title);
  console.log('  hook_idea:    ', outline.hook_idea);
  console.log('  closing_idea: ', outline.closing_idea);
  console.log('  total:        ', outline.total_words_estimate, '字');
  console.log('  章节：');
  outline.sections.forEach((s) => {
    console.log(`   ${s.index}. ${s.title}（${s.word_budget} 字 · ${s.bullets.length} 条要点）`);
  });

  // Sanity: 没有 emoji
  if (/[\u{1F300}-\u{1FAFF}]/u.test(JSON.stringify(outline))) {
    console.error('[test-outline] 大纲里出现了 emoji（设计禁令违反）');
    process.exitCode = 1;
  }

  console.log('[test-outline] OK');
}

main().catch((err) => {
  console.error('[test-outline] 失败：', err);
  process.exitCode = 1;
});
