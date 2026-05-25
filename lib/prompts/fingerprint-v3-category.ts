/**
 * 按类别细分指纹（v3.1）：把某一类（如"科技"）的所有 Stage 1 输出合成一份
 * 类别专属指纹，作为主指纹的补充。
 *
 * 与 Stage 2 主合成的差异：
 *   - 主合成跨平台跨类别看博主整体配方
 *   - 类别合成只看同类样本，挖出"这个博主写这一类时特有的开场/论证/收尾套路"
 *   - 输出体积更小（每个类别一份），方便写作时单独检索
 *
 * 触发条件：某类样本 ≥ 3 篇才跑。
 */

import type { FingerprintV3Stage1Output } from './fingerprint-v3-stage2';

export function buildCategoryProfilePrompt(
  authorName: string,
  category: string,
  stage1Outputs: FingerprintV3Stage1Output[],
): string {
  const n = stage1Outputs.length;
  const sources = stage1Outputs
    .map((s, i) => {
      const title = (s.title ?? '').trim() || '（无标题）';
      return [
        `===== 篇 ${i + 1} · ${title} · 平台「${s.platform}」=====`,
        s.rawJson.trim(),
      ].join('\n');
    })
    .join('\n\n');

  return `你是一位写作策略学者。下面是博主「${authorName}」专门写「${category}」类内容的 ${n} 篇样本的局部分析。请合成一份「${category}类专属配方」指纹。

要求：
1. 只看这一类样本，不要泛化到博主的其他类别。
2. 挖出博主写这一类时**特有**的处理（与他写别的类时的差异点）。
3. 给 3-5 条**这一类专属的策略碎片**——可以是该类下的开篇/论证/收尾/结构手法。
4. recommended_when 字段说明：如果用户要写一篇"${category}类"文章，什么场景下最适合套用这份配方。

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后无任何文字。
- JSON 合法，字符串双引号。
- 禁用 emoji 与装饰符号。

输出 JSON Schema：

\`\`\`json
{
  "category": "${category}",
  "sample_count": ${n},
  "summary": "一句话：这位博主写「${category}」类时的核心套路，不超过 50 字",
  "what_makes_this_category_unique": "他写这一类与写其他类时最显著的 1-2 个差异",
  "preferred_opening": "在这一类下他偏爱的开篇方式 + 一句话样例",
  "preferred_argumentation": "这一类的论证方式 + 一句话样例",
  "preferred_closing": "这一类的收尾方式 + 一句话样例",
  "tone_for_this_category": "写这一类时的口吻特点 + 一句话样例",
  "category_specific_fragments": [
    {
      "tag": "opening / transition / closing / argument / language / hook 任选其一",
      "title": "碎片名 6-14 字",
      "description": "一句话讲清做了什么",
      "example": "原文佐证 ≤ 40 字，用「」包裹",
      "when_to_use": "什么场景下复用最合适",
      "why_works": "为什么在「${category}」类内容里这么做有效"
    }
  ],
  "recommended_when": "用户要写一篇「${category}」类时，什么场景下最适合套用这份配方（一句话）"
}
\`\`\`

下面是该类的 ${n} 篇样本拆解：

${sources}

现在请输出 JSON。`;
}
