/**
 * Stage 1：单篇文章 → 局部策略集合
 *
 * 用途：v2 拆解的第一阶段。N 篇文章并发调用 Claude，每次让 Claude 从一篇里抽出
 * 「这篇里看得见的写作策略集合」。后续 stage2 会把 N 份 stage1 输出合在一起，
 * 让 Claude 输出博主整体指纹 + 优劣 + 策略动机。
 *
 * 输入：单篇文章（含分类 / 标题 / 正文）。
 * 输出：严格 JSON，只有一个 ```json``` 代码块。
 */

export interface FingerprintV2Article {
  title?: string;
  category?: string; // 观点 / 案例 / 教学 / 评论 / 杂感
  content: string;
}

export function buildFingerprintV2Stage1Prompt(
  article: FingerprintV2Article,
  index: number,
  total: number,
): string {
  const title = (article.title ?? '').trim() || '（无标题）';
  const category = (article.category ?? '').trim() || '未分类';
  const content = (article.content ?? '').trim();

  return `你是一位写作策略分析师。下面是一篇博主写的文章（${index + 1}/${total}），分类是「${category}」。请仔细读完，提取这一篇里**可以被复用的写作策略**。

任务说明：
1. 只看这一篇，输出这一篇里**真的能拆出来**的策略，不要凭空想。
2. 每条策略要具体，能落地——例如「反问钩子开场」必须给出原文里实际出现的反问例子。
3. 策略数量 6-12 条之间，覆盖：开篇、转场、收尾、论证、语言、视觉。
4. 同时给一段「局部观察」，描述这一篇的整体调性、节奏、情绪。

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何文字、寒暄、解释。
- JSON 必须合法，所有字符串字段用双引号。
- **严禁** emoji 或装饰符号（✦ ✨ ✓ ● ◆ 🎯 等都禁用）。文章可能有，但你的输出里不能有。
- 字段顺序与 schema 一致。

输出 JSON Schema：

\`\`\`json
{
  "local_observation": "这一篇的整体调性、节奏、情绪。不超过 60 字。",
  "category": "${category}",
  "strategies": [
    {
      "tag": "opening / transition / closing / argument / language / visual 任选其一",
      "description": "策略名 + 一句话说清楚做了什么",
      "example": "原文里能佐证这条策略的一小段（≤ 30 字，原文摘抄）",
      "when_to_use": "什么场景下复用这条策略最合适，一句话"
    }
  ],
  "language_observation": {
    "sentence_length": "短促 / 中等 / 绵长，举一句话样例",
    "verbal_tics": ["这篇里反复出现的口头禅 1", "口头禅 2"]
  },
  "structure_observation": {
    "opening_hook": "这篇怎么开篇的，一句话",
    "closing_pattern": "这篇怎么收尾的，一句话"
  }
}
\`\`\`

文章信息：
===== 文章 ${index + 1} =====
分类：${category}
标题：${title}
正文：
${content}

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块，不要任何前言后语。`;
}
