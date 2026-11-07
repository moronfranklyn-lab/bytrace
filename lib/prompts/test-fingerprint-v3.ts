#!/usr/bin/env tsx
/**
 * 真调 Claude · 跑通 v3 三阶段拆解。
 *
 * 用法：
 *   cd autoarticle
 *   npx tsx lib/prompts/test-fingerprint-v3.ts
 *
 * 输入：3 篇 mock 文章（公众号 + B 站字幕 + 知乎），3 个平台、覆盖 2 个领域。
 * 输出：
 *   1) 打印每阶段耗时
 *   2) 校验最终 JSON 字段完整 / 可解析 / 无 emoji
 *   3) 写盘 lib/prompts/test-output-v3.json，供肉眼复查
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { streamClaude } from '../claude';
import {
  buildFingerprintV3Stage1Prompt,
  type FingerprintV3Article,
} from './fingerprint-v3-stage1';
import {
  buildFingerprintV3Stage2Prompt,
  type FingerprintV3Stage1Output,
} from './fingerprint-v3-stage2';
import { buildFingerprintV3CrossPlatformPrompt } from './fingerprint-v3-cross-platform';

function stripJsonFence(raw: string): string {
  const m = raw.match(/```json\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  const f = raw.indexOf('{');
  const l = raw.lastIndexOf('}');
  if (f !== -1 && l > f) return raw.slice(f, l + 1).trim();
  return raw.trim();
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

const ARTICLES: FingerprintV3Article[] = [
  {
    title: '为什么很多人越努力越穷',
    platform: '公众号',
    medium: 'text',
    domain: '商业观察',
    content: `先说结论：努力的本质是议价权，不是时间投入。这是过去三年我观察上百位"努力但越来越穷"的朋友得出的判断。

第一个常见误区，是把"忙"当成"努力"。早上 7 点到办公室，晚上 11 点回家，周末还要"主动加班赶项目"，朋友圈每天打卡 996——这套动作看似勤奋，但本质上是用时间换工资，是最低杠杆率的资源使用方式。打工人的时间是廉价的，越是低议价权的岗位，越靠堆时间换薪水。

第二个误区，是误以为"学习就是积累"。每天背 50 个单词、刷 3 道算法题，连续 365 天——你以为你在变强，其实你只是在变熟。真正能换钱的不是熟练度，是稀缺度。整个公司里所有人都会的事，你做到极致也只能拿平均工资。

举三个案例。第一个是 2019 年在某互联网公司的 P7 小李，5 年加班 996，工资从 35K 涨到 48K——但同年公司发的"管理层期权"他一颗都没拿到。第二个是 2021 年帮品牌做投放的小杨，每月接 8 个甲方，单子越接越多，但合作方都在压价，到 2023 年他的时薪反而比 2021 年低 30%。第三个是 2022 年我认识的设计师小陈，她拒绝接 80% 的小活，只做自己策展过的品牌，结果一年只交付 4 个项目，但单价是同行的 10 倍。

差异在哪？前两位用的是时间杠杆，第三位用的是议价权杠杆。议价权来自三件事：稀缺性、不可替代性、定价权。

所以"越努力越穷"不是一个反智的口号，而是对一种特定努力方式的诊断：当你的努力只是在堆时间、堆产能、堆熟练度，而没有在建立"别人替代不了你"的护城河时，你的边际收益会逐年下降，到一定程度甚至会变负。

最后留一个具体的动作：今晚花 30 分钟列出你过去 12 个月做过的所有工作，逐条问自己——这件事换个人做，能做到我 80% 吗？如果能，这件事就该停。把省下来的时间砸到那些"换个人做只能做到我 40%"的事情上。这个动作本身，就是你建立议价权的第一步。`,
  },
  {
    title: '【商业观察】3 分钟讲清「越努力越穷」的真相',
    platform: 'B站长视频',
    medium: 'video',
    domain: '商业观察',
    content: `（开场，黑屏白字）你身边是不是也有这种人？每天加班到凌晨，周末还在自学，朋友圈一片打鸡血——但卡里余额跟刚毕业时一样。

（镜头切到我）今天我们用 3 分钟讲清楚一件事：努力和赚钱，根本不是你想的那种关系。

（屏幕弹数据动画）2023 年人社部数据，全国 996 群体平均时薪 38 元。同年某头部主播工作室，主播平均时薪 4800 元。差 126 倍。问题不是努力，是议价权。

（切回口播）什么是议价权？三句话讲清。第一，稀缺。会做的人少。第二，不可替代。换个人客户立刻就能感觉到差异。第三，定价。你说多少钱就是多少钱，不是别人砍价砍出来的。

（视觉化弹三个案例卡，每个 3 秒，配 BGM）案例一：互联网 P7，996 五年，年薪 60 万——但同期入职的同事拿了管理层期权 800 万。案例二：自由设计师每月接 8 单，越接越累——时薪反而每年降 15%。案例三：另一个设计师每年只接 4 单，单价是同行 10 倍——因为只服务她自己策展过的品牌。

（口播加重）听明白了吗？前两个用时间换钱，第三个用稀缺换钱。这是两套完全不同的游戏。

（结尾，弹 CTA 卡）今晚做一件事：列你过去一年所有工作，问自己——这件事换个人做能做到我 80% 吗？能就该停。把时间砸到那些"换人做只能做到 40%"的事上。这是你建立议价权的第一步。

（最后一帧）记住一句话：努力是手段，议价权才是目的。下期我们讲怎么找到自己的议价权——别忘了一键三连。`,
  },
  {
    title: '上班的本质是出售时间，那为什么有人能把时间卖出 10 倍价？',
    platform: '知乎',
    medium: 'text',
    domain: '个人成长',
    content: `先回答题主的疑惑：上班本质上确实是出售时间，但"时间"这个商品有两个属性——数量和质量。大多数人卖的是数量（小时数），少数人卖的是质量（单位时间内的产出密度）。

我想从一个我亲身参与过的项目说起。2022 年底，我帮一家 SaaS 公司做"销售流程梳理"。同期合作的咨询顾问有两位，A 报价 3 万/月长驻，B 报价 8 万/次只来 3 天。最后客户选了 B。为什么？A 提供的是"陪伴感"——每天到办公室，事无巨细参与；B 提供的是"判断力"——3 天里只做三件事：1) 看完所有销售对话录音；2) 跟 5 个 Top 销售各聊 1 小时；3) 出一份 12 页的诊断报告。

这就是质量差异。A 在卖小时数，单价低、总额看起来不少但客户没有为他的判断付费；B 在卖判断力，单价高得离谱但客户买的是结论，不是过程。

回到题主问题：怎么让自己的时间卖出 10 倍价？

第一，从"输出动作"转到"输出判断"。大多数岗位的工资被压低，是因为做的事情可以被 SOP 化、可以被外包、可以被新人快速顶替。你需要让自己输出的是"在 A B C 三个方案里选哪一个，理由如下"，而不是"我把方案做了"。

第二，把自己的工作语言从"我做了什么"改成"我让客户避免了什么"。前者是过程描述，后者是价值描述。同一个工作，描述方式不同，定价天差地别。

第三，主动做"减法"。这是最反直觉的一条。当你接的活越来越多，你的时薪一定在降——因为多接的那部分一定是低单价、低难度、占用判断力的。每次接新活之前问自己：这件事能不能让我下次的报价提高 10%？如果不能，就该拒绝。

最后说点知乎用户都很关心的：怎么验证自己已经"卖判断"了？标准很简单——如果客户/老板能不带你去复述你的方案给别人听，并且对方听完点头，那说明你输出的是判断；如果你不在场对方就讲不清楚，那才是你真正的护城河。

利益相关：自己在做独立顾问 4 年，从按月卖时间到按项目卖判断，时薪翻了大概 12 倍。以上经验自用、自验，不构成建议。`,
  },
];

interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

function validateFinalFingerprint(fp: Record<string, unknown>): ValidationResult {
  const reasons: string[] = [];

  // 顶层字段
  const requiredTopKeys = [
    'author_summary',
    'platforms_analyzed',
    'domains_analyzed',
    'platform_fingerprints',
    'domain_variations',
    'cross_platform_report',
    'strategy_fragments',
    'user_facing_summary',
  ];
  for (const k of requiredTopKeys) {
    if (!(k in fp)) reasons.push(`缺顶层字段：${k}`);
  }

  // platforms_analyzed 至少 2 个（测试用 3 个）
  if (!Array.isArray(fp.platforms_analyzed) || (fp.platforms_analyzed as unknown[]).length < 2) {
    reasons.push('platforms_analyzed 应至少 2 个');
  }

  // platform_fingerprints 是 object
  if (!fp.platform_fingerprints || typeof fp.platform_fingerprints !== 'object' || Array.isArray(fp.platform_fingerprints)) {
    reasons.push('platform_fingerprints 应是对象');
  } else {
    const pfp = fp.platform_fingerprints as Record<string, unknown>;
    const keys = Object.keys(pfp);
    if (keys.length < 2) reasons.push(`platform_fingerprints 应至少 2 个平台条目（实际 ${keys.length}）`);
    for (const k of keys) {
      const v = pfp[k] as Record<string, unknown> | undefined;
      if (!v || typeof v !== 'object') {
        reasons.push(`platform_fingerprints["${k}"] 不是对象`);
        continue;
      }
      const innerRequired = ['fingerprint_summary', 'language', 'structure', 'platform_specific_traits', 'strengths', 'weaknesses'];
      for (const ik of innerRequired) {
        if (!(ik in v)) reasons.push(`platform_fingerprints["${k}"] 缺字段：${ik}`);
      }
    }
  }

  // strategy_fragments 数组
  if (!Array.isArray(fp.strategy_fragments) || (fp.strategy_fragments as unknown[]).length < 8) {
    reasons.push(`strategy_fragments 应至少 8 条（实际 ${Array.isArray(fp.strategy_fragments) ? (fp.strategy_fragments as unknown[]).length : '非数组'}）`);
  } else {
    const frags = fp.strategy_fragments as Record<string, unknown>[];
    for (let i = 0; i < frags.length; i++) {
      const f = frags[i];
      const need = ['tag', 'title', 'description', 'when_to_use', 'why_works', 'platform_scope', 'domain_scope'];
      for (const k of need) {
        if (!(k in f)) reasons.push(`strategy_fragments[${i}] 缺字段：${k}`);
      }
    }
  }

  // cross_platform_report
  const cpr = fp.cross_platform_report as Record<string, unknown> | undefined;
  if (!cpr || typeof cpr !== 'object') {
    reasons.push('cross_platform_report 应是对象');
  } else {
    if (!('summary' in cpr)) reasons.push('cross_platform_report 缺 summary');
    if (!Array.isArray(cpr.comparisons)) reasons.push('cross_platform_report.comparisons 应是数组');
    if (!Array.isArray(cpr.transferable_patterns)) reasons.push('cross_platform_report.transferable_patterns 应是数组');
  }

  // emoji 检测
  const stringified = JSON.stringify(fp);
  if (EMOJI_RE.test(stringified)) {
    reasons.push('输出里出现了 emoji（设计禁令违反）');
  }

  return { ok: reasons.length === 0, reasons };
}

async function main() {
  console.log('===== test-fingerprint-v3 =====');
  console.log(`样本：${ARTICLES.length} 篇 · 平台分别是 ${ARTICLES.map((a) => a.platform).join(' / ')}`);

  // -------- Stage 1 并发 --------
  console.log('\n[Stage 1] 三篇并发拆解局部碎片');
  const tS1 = Date.now();
  const stage1Outputs: FingerprintV3Stage1Output[] = await Promise.all(
    ARTICLES.map(async (article, i) => {
      const prompt = buildFingerprintV3Stage1Prompt(article, i, ARTICLES.length);
      let chunks = 0;
      const raw = await streamClaude(prompt, {
        timeoutMs: 240_000,
        onChunk: () => { chunks++; if (chunks % 40 === 0) process.stdout.write(`s1#${i+1}.`); },
      });
      const cleaned = stripJsonFence(raw);
      // 立即试解析，发现问题早暴露
      try { JSON.parse(cleaned); } catch (e) {
        console.error(`\n  Stage1 篇 ${i+1} JSON.parse 失败：`, (e as Error).message);
        console.error('  片段：', cleaned.slice(0, 300));
        throw e;
      }
      console.log(`\n  [Stage1] 篇 ${i+1}（${article.platform} · ${article.domain}）完成，${cleaned.length} 字`);
      return {
        index: i,
        platform: article.platform,
        domain: article.domain || '未指定',
        medium: article.medium,
        title: article.title,
        rawJson: cleaned,
      };
    }),
  );
  const stage1Ms = Date.now() - tS1;
  console.log(`[Stage 1] 总耗时 ${(stage1Ms / 1000).toFixed(1)}s`);

  // -------- Stage 2 --------
  console.log('\n[Stage 2] 跨篇综合 + 按平台分组');
  const tS2 = Date.now();
  const stage2Prompt = buildFingerprintV3Stage2Prompt('测试博主 J', stage1Outputs);
  let stage2Chunks = 0;
  const stage2Raw = await streamClaude(stage2Prompt, {
    timeoutMs: 240_000,
    onChunk: () => { stage2Chunks++; if (stage2Chunks % 80 === 0) process.stdout.write('s2.'); },
  });
  const stage2Cleaned = stripJsonFence(stage2Raw);
  const stage2Ms = Date.now() - tS2;
  console.log(`\n[Stage 2] 耗时 ${(stage2Ms / 1000).toFixed(1)}s · 原始 ${stage2Raw.length} 字`);

  let stage2Obj: Record<string, unknown>;
  try {
    stage2Obj = JSON.parse(stage2Cleaned);
  } catch (e) {
    console.error('[Stage 2] JSON.parse 失败：', (e as Error).message);
    console.error('片段：', stage2Cleaned.slice(0, 500));
    process.exit(1);
  }

  // -------- Stage 3 --------
  console.log('\n[Stage 3] 跨平台深度对比');
  const tS3 = Date.now();
  const stage3Prompt = buildFingerprintV3CrossPlatformPrompt({
    authorName: '测试博主 J',
    stage2RawJson: stage2Cleaned,
  });
  let stage3Chunks = 0;
  const stage3Raw = await streamClaude(stage3Prompt, {
    timeoutMs: 180_000,
    onChunk: () => { stage3Chunks++; if (stage3Chunks % 40 === 0) process.stdout.write('s3.'); },
  });
  const stage3Cleaned = stripJsonFence(stage3Raw);
  const stage3Ms = Date.now() - tS3;
  console.log(`\n[Stage 3] 耗时 ${(stage3Ms / 1000).toFixed(1)}s · 原始 ${stage3Raw.length} 字`);

  let stage3Obj: Record<string, unknown> | null = null;
  try {
    stage3Obj = JSON.parse(stage3Cleaned);
  } catch (e) {
    console.warn('[Stage 3] JSON.parse 失败（沿用 stage2 初稿）：', (e as Error).message);
  }
  if (stage3Obj) {
    stage2Obj.cross_platform_report = stage3Obj;
  }

  // -------- 校验 + 落盘 --------
  const totalMs = stage1Ms + stage2Ms + stage3Ms;
  console.log('\n===== 总耗时汇总 =====');
  console.log(`Stage 1（${ARTICLES.length} 篇并发）：${(stage1Ms / 1000).toFixed(1)}s`);
  console.log(`Stage 2（综合）              ：${(stage2Ms / 1000).toFixed(1)}s`);
  console.log(`Stage 3（跨平台）            ：${(stage3Ms / 1000).toFixed(1)}s`);
  console.log(`合计                         ：${(totalMs / 1000).toFixed(1)}s`);

  const validation = validateFinalFingerprint(stage2Obj);
  if (!validation.ok) {
    console.error('\n校验未通过：');
    for (const r of validation.reasons) console.error('  - ' + r);
  } else {
    console.log('\n所有必填字段齐全，JSON 可解析，无 emoji。');
  }

  // 打印几个关键字段供肉眼复查
  console.log('\n===== 关键字段预览 =====');
  console.log('author_summary    ：', stage2Obj.author_summary);
  console.log('platforms_analyzed：', stage2Obj.platforms_analyzed);
  console.log('domains_analyzed  ：', stage2Obj.domains_analyzed);
  const pfp = stage2Obj.platform_fingerprints as Record<string, Record<string, unknown>> | undefined;
  if (pfp) {
    for (const k of Object.keys(pfp)) {
      console.log(`platform_fingerprints["${k}"].fingerprint_summary:`);
      console.log('  ' + pfp[k].fingerprint_summary);
    }
  }
  const cpr = stage2Obj.cross_platform_report as Record<string, unknown> | undefined;
  if (cpr) {
    console.log('cross_platform_report.summary:');
    console.log('  ' + cpr.summary);
    console.log('  comparisons 条数：', Array.isArray(cpr.comparisons) ? (cpr.comparisons as unknown[]).length : 0);
  }
  const frags = stage2Obj.strategy_fragments as unknown[] | undefined;
  console.log('strategy_fragments 数量：', Array.isArray(frags) ? frags.length : 0);

  // 落盘
  const outPath = join(process.cwd(), 'lib', 'prompts', 'test-output-v3.json');
  writeFileSync(outPath, JSON.stringify(stage2Obj, null, 2), 'utf-8');
  console.log(`\n输出已写盘：${outPath}`);

  if (!validation.ok) process.exit(1);
}

main().catch((err) => {
  console.error('未捕获错误：', err);
  process.exit(1);
});
