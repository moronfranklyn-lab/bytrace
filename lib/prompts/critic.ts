/**
 * Critic Agent · 文章质量评审
 * ------------------------------------------------------------
 * 在 draft 流的草稿落地后跑一次，按博主指纹（v3.3 的 structure_repertoire /
 * depth_pattern / analogy_bank）+ 公众号风格硬约束打 5 维分。
 *
 * 设计思路（面试讲法）：
 *   - 5 维独立打分而不是一个总分：每一维都对应一条 v3.3 写进 prompt 的硬规则，
 *     这样"为什么不及格"能定位到具体维度，重写时给出针对性 hint，而不是
 *     笼统的"再写一次"。
 *   - 分阈值 20/25 而不是 21/25：留一点容差，避免 critic 自己评分抖动一两分
 *     就触发死循环。3 次 critic 用完仍然不及格的话，落库前给出 best-of-N。
 *   - 只让 critic 看"成稿 + 必要的指纹/大纲上下文"，不让它看原 article prompt：
 *     避免 critic 学到 article prompt 的语气，变成自我背书。
 */

import type { Composition, FingerprintMeta } from '@/lib/composition';
import type { Outline } from '@/lib/prompts/outline';

/** Critic 评分维度。和 critic prompt + critic_runs 表列名一一对应。 */
export type CriticDimension =
  | 'structure'   // 结构骨架：是否符合 dominant_shape，是否有承上启下
  | 'depth'      // 挖根深度：是否有"不是 X 是 Y"层层递进
  | 'analogy'    // 物件类比：是否用了 analogy_bank 风格的具象物件
  | 'punchline'  // 金句段：是否有 ≥2 个独立成段的对仗 / 结论短句
  | 'taboo';     // 禁忌项：emoji=0、无空泛形容词、无装饰符号

export interface CriticDimensionScore {
  /** 0-5，5 = 完全符合，0 = 完全不符合 */
  score: number;
  /** 一句话说"为什么扣分 / 没扣分"。重写时会喂回 writer。 */
  reason: string;
}

export interface CriticResult {
  scores: Record<CriticDimension, CriticDimensionScore>;
  /** 5 维之和，满分 25 */
  total: number;
  /** total >= PASS_THRESHOLD */
  passed: boolean;
  /** 最弱的维度 key，给重写 hint 用。如果都满分则为 null。 */
  weakest: CriticDimension | null;
  /** 给 writer 看的具体重写建议（自然语言，一两句话）。 */
  rewrite_hint: string;
}

/** Critic 判定阈值（总分 ≥ 此值视为通过） */
export const CRITIC_PASS_THRESHOLD = 20;
/** Critic 最大尝试次数（首次 draft + 最多 2 次重写 = 3 次 critic） */
export const CRITIC_MAX_ATTEMPTS = 3;

/**
 * 构造 critic prompt。
 *
 * 之所以让 critic 一次给出 5 维分 + reason + hint 而不是分两步（先打分再生成 hint），
 * 是因为分两步会让 critic 跑两次 streamClaude，时延 × 2、token × 2，对本机 Claude
 * Pro 订阅不划算。一次出全部的代价是 prompt 稍长一点。
 */
export function buildCriticPrompt(
  articleMd: string,
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
  outline: Outline,
): string {
  const fpBlock = renderFingerprintForCritic(composition, fingerprints);
  const outlineBlock = renderOutlineForCritic(outline);

  return `你是一位严格的写作评审。你要对一篇刚刚生成的文章打分，判断它是否达到了"博主指纹 + 论证骨架"的硬约束。

你**不是**编辑，**不要**改写文章；你只输出评分 JSON。

# 博主指纹要求（评分依据，最高优先级）

${fpBlock}

# 大纲约束（评分依据）

${outlineBlock}

# 待评审文章

---
${articleMd}
---

# 评分维度（每维 0-5 分，整数）

**structure（结构骨架，0-5）**
- 5 分：每节首段都显式回扣上节论断；整篇按 causal_chain / problem_solution / concentric 等明确形态推进；没有"全是平行罗列"的章节。
- 3 分：大体有结构，但有 1-2 节是"罗列三个角度"式平铺，没回扣上节。
- 1 分：整篇都是 parallel 列举，章节之间没有承上启下，读起来像 N 个独立小作文拼接。
- 0 分：完全无结构感。

**depth（挖根深度，0-5）**
- 5 分：核心论点至少挖到第 3-4 层（每一层用"不是 X，是 Y" / "你拆开看" / "再挖一层"之类的指纹挖根句式推进），最后给出落地框架或可操作结论。
- 3 分：挖到 2 层就停了；或者用了挖根句式但没真的递进。
- 1 分：只在表层下结论，没有"为什么 → 更深的为什么 → 怎么办"的递进。
- 0 分：纯口水，无论证。

**analogy（物件类比，0-5）**
- 5 分：抽象论点都配了具体可触摸的物件类比（"户口本进 iCloud" / "中年人体检报告" / "黄牛在天台抽烟" 这种），优先复用 analogy_bank 的物件。整篇至少 2-3 处物件级类比。
- 3 分：有类比但偏抽象（"如同登山" / "宛如一面镜子" / "就像一场旅程" 这种没有具体物件的隐喻）。
- 1 分：只有 1 处类比，且仍是抽象的。
- 0 分：完全没有类比，纯抽象论述。

**punchline（金句段，0-5）**
- 5 分：至少有 2 个独立成段的"对仗 / 结论 / 反差"短句，能被读者截图传播。
- 3 分：有 1 个能用的短句。
- 1 分：通篇没有段落级金句。
- 0 分：纯散文。

**taboo（禁忌项，0-5）**
- 5 分：0 个 emoji；0 个装饰符号（✦ ✨ ─ ▎ ★ 之类）；没有"在这个数字化时代""随着 AI 的飞速发展"这类万能开场；没有大量空泛形容词堆砌。
- 3 分：偶有 1 处装饰符号或万能套话。
- 0 分：多处 emoji / 套话 / 平庸排比。

# 输出格式（必须是合法 JSON，不要任何前后铺垫）

\`\`\`json
{
  "scores": {
    "structure": { "score": 4, "reason": "整篇按 causal_chain 推进，但第 3 节是 4 个角度的平行列举，没回扣第 2 节论断" },
    "depth": { "score": 5, "reason": "三层递进且最后给了双层框架" },
    "analogy": { "score": 2, "reason": "只在开篇用了'发动机/车'的抽象类比，正文没用 analogy_bank 里的具体物件" },
    "punchline": { "score": 4, "reason": "有 1 句对仗收尾金句，但中段缺独立成段的判断句" },
    "taboo": { "score": 5, "reason": "无 emoji、无装饰符号、无万能套话" }
  },
  "total": 20,
  "passed": true,
  "weakest": "analogy",
  "rewrite_hint": "正文部分太抽象——把'模型相关层'那段加一个 analogy_bank 里的具体物件（例如'修路 / 养猫 / 新员工'），让抽象论点能挂在可触摸的物件上"
}
\`\`\`

**硬规则**：
- total 必须等于 5 个 score 之和。
- passed 必须等于 (total >= ${CRITIC_PASS_THRESHOLD})。
- weakest 是 5 个维度里 score 最低的那个 key；如果有并列最低，挑 reason 里描述问题最具体的那个。
- 如果整篇全 5 分，weakest 为 null，rewrite_hint 为空字符串。
- rewrite_hint 必须**具体**——指出哪一节 / 哪段、加什么 / 删什么，**不要**输出"建议加强结构感"这种空话。

只输出 JSON，不要写 "下面是评分：" 这种铺垫。`;
}

/**
 * 给 writer 的"带 hint 的重写 prompt"补强片段。
 * 这个不是独立 prompt，而是塞回 buildArticlePrompt 的 idea 段后面，
 * 让 writer 在保留原大纲 + 原指纹的前提下，针对性地改写。
 *
 * 为什么不另开一个"重写专用 prompt"：
 *   - 保持 single source of truth：写作规则只在 article.ts 一处定义
 *   - 让 writer 拿到完整上下文，不会因为"重写 prompt 太轻"而漏掉硬约束
 */
export function buildRewriteHintBlock(prev: CriticResult, attempt: number): string {
  const lines: string[] = [];
  lines.push('# 上一稿的评审反馈（必须采纳，否则这次仍然不会通过）');
  lines.push('');
  lines.push(`这是第 ${attempt} 次尝试。上一稿总分 ${prev.total}/25（阈值 ${CRITIC_PASS_THRESHOLD}），未通过。`);
  lines.push('');
  lines.push('各维度评分：');
  const order: CriticDimension[] = ['structure', 'depth', 'analogy', 'punchline', 'taboo'];
  for (const dim of order) {
    const s = prev.scores[dim];
    if (!s) continue;
    lines.push(`- ${dim}：${s.score}/5 — ${s.reason}`);
  }
  if (prev.weakest) {
    lines.push('');
    lines.push(`**最弱维度**：${prev.weakest}`);
  }
  lines.push('');
  lines.push('**这次重写要做的事**：');
  lines.push(prev.rewrite_hint || '（评审没给出具体提示，请按最弱维度自行加强）');
  lines.push('');
  lines.push('注意：保留原大纲的章节顺序和 thesis，不要把文章重新构思一遍。重点是修补上面指出的问题。');
  return lines.join('\n');
}

/* ----------------------------------------------------------------- */
/* 内部 helpers                                                       */
/* ----------------------------------------------------------------- */

function renderFingerprintForCritic(
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
): string {
  if (composition.selected_authors.length === 0 || fingerprints.size === 0) {
    return '本次没有指定具体博主指纹。按"克制、书卷气、有论证骨架"的通用公众号深度长文标准评分。';
  }
  const lines: string[] = [];
  for (const sel of composition.selected_authors) {
    const meta = fingerprints.get(sel.fingerprint_id);
    if (!meta) continue;
    const obj = meta.fingerprint as unknown as Record<string, unknown>;

    lines.push(`【博主：${meta.author_name}】`);

    // 顶层 v3.3 字段
    const repertoire = obj.structure_repertoire as { dominant_shape?: string } | undefined;
    const depthPattern = obj.depth_pattern as
      | { average_layers?: number; max_layers?: number; drilling_phrases?: string[] }
      | undefined;
    const analogyBank = Array.isArray(obj.analogy_bank) ? (obj.analogy_bank as string[]) : [];

    if (repertoire?.dominant_shape) {
      lines.push(`- 主导结构：${repertoire.dominant_shape}`);
    }
    if (depthPattern?.average_layers) {
      lines.push(`- 期望深度：平均挖 ${depthPattern.average_layers} 层${depthPattern.max_layers ? `，最深 ${depthPattern.max_layers}` : ''}`);
    }
    if (depthPattern?.drilling_phrases?.length) {
      lines.push(`- 挖根句式参考：${depthPattern.drilling_phrases.slice(0, 5).map((p) => `「${p}」`).join(' / ')}`);
    }
    if (analogyBank.length > 0) {
      lines.push('- analogy_bank（物件类比参考库，前 8 条）：');
      analogyBank.slice(0, 8).forEach((a) => lines.push(`  · ${a}`));
    }
    lines.push('');
  }
  return lines.join('\n').trim() || '（指纹信息为空，按通用深度长文标准评分。）';
}

function renderOutlineForCritic(outline: Outline): string {
  const lines: string[] = [];
  if (outline.core_thesis) lines.push(`核心论点：${outline.core_thesis}`);
  if (outline.structure_shape) lines.push(`整篇结构形态：${outline.structure_shape}`);
  lines.push(`章节数：${outline.sections.length}`);
  outline.sections.forEach((s) => {
    const role = s.depth_role ? ` [${s.depth_role}]` : '';
    lines.push(`${s.index}. ${s.title}${role}${s.thesis ? ` — 核心论断：${s.thesis}` : ''}`);
  });
  return lines.join('\n');
}
