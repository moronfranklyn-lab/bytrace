/**
 * Stage 2：跨篇综合 → 博主整体指纹 + 优劣 + 策略动机
 *
 * 用途：v2 拆解的第二阶段。把 N 份 stage1 输出汇总成博主级指纹。
 *
 * 输入：N 份局部策略 + 博主名 + 平台。
 * 输出：严格 JSON，含 P1 兼容字段 + 新增策略 / 优劣 / 策略动机字段。
 */

export interface FingerprintV2Stage1Output {
  index: number;
  category: string;
  title?: string;
  // 直接拼接 stage1 的原始 JSON 字符串就行，不再做二次结构化
  rawJson: string;
}

export function buildFingerprintV2Stage2Prompt(
  authorName: string,
  platform: string | null,
  stage1Outputs: FingerprintV2Stage1Output[],
): string {
  const sources = stage1Outputs
    .map((s) => {
      const cat = (s.category ?? '').trim() || '未分类';
      const title = (s.title ?? '').trim() || '（无标题）';
      return [
        `===== 篇 ${s.index + 1} · ${cat} · ${title} =====`,
        s.rawJson.trim(),
      ].join('\n');
    })
    .join('\n\n');

  const n = stage1Outputs.length;
  const platformLine = platform ? `平台：${platform}` : '平台：未指定';

  return `你是一位资深写作风格学者。下面是博主「${authorName}」的 ${n} 篇文章拆解出的局部策略集合。请把它们综合成这位博主的**整体写作指纹**。

${platformLine}
博主：${authorName}
样本数：${n}

任务说明：
1. 跨篇稳定复现的特征才是指纹，单篇偶发的不算。
2. 不同分类（观点 / 案例 / 教学 / 评论 / 杂感）下博主的表现会不同——必须在 category_variance 字段里说清楚差异。
3. strategies 字段汇总 8-15 条**博主级**策略（不是单篇级），每条标明它适用于哪几个分类。
4. strengths / weaknesses 各给 3-5 条，weaknesses 不是骂博主，是说他这种风格在哪类题材会失灵。
5. strategy_reasoning 给一段 80-150 字的「为什么这位博主选择这种写作策略」，讲清楚他的读者画像、平台环境、风格选择的内在逻辑。
6. fingerprint_summary 三句话讲清「他怎么开篇 / 怎么论证 / 怎么收尾」，会作为下游生成文章的 system prompt 核心。

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何文字。
- JSON 必须合法，字符串字段用双引号。
- **严禁** emoji 或装饰符号（✦ ✨ ✓ ● ◆ 🎯 等都禁用），唯一例外是 visual.emoji_usage 字段（统计用途）。
- 数组字段必须给满下限：verbal_tics ≥ 3，do_list ≥ 3，dont_list ≥ 3，strengths ≥ 3，weaknesses ≥ 3，strategies ≥ 8。
- 字段顺序与 schema 一致。

输出 JSON Schema：

\`\`\`json
{
  "author_summary": "一句话概括这位作者的写作 DNA，不超过 50 字",
  "language": {
    "sentence_length": "短促 / 中等 / 绵长 + 一句话样例",
    "vocabulary_register": "口语 / 书面 / 学术 / 混合 + 一句话特点",
    "verbal_tics": ["口头禅 1", "口头禅 2", "口头禅 3"]
  },
  "structure": {
    "opening_hook": "提问 / 金句 / 场景 / 数据 / 反常识 + 一句话样例",
    "transition_style": "段落之间的典型连接方式 + 一句话样例",
    "closing_pattern": "总结升华 / 反转 / 留白 / 行动号召 + 一句话样例"
  },
  "topic": {
    "topic_preference": "偏爱的题材类型 + 3-5 个关键词",
    "viewpoint_density": "观点稀疏 / 适中 / 密集（每段大约几个观点）",
    "argumentation": "案例为主 / 数据为主 / 类比为主 / 反问为主 + 一句话特点"
  },
  "visual": {
    "image_style": "配图视觉风格描述（写实/抽象/截图/数据图/插画），1-2 句话",
    "emoji_usage": "无 / 极少 / 适度 / 大量 + 偏好的符号",
    "layout_preference": "正经版（公众号深度文）/ 活泼版（小红书）/ 极简版（博客）"
  },
  "fingerprint_summary": "三句话总结：他怎么开篇、怎么论证、怎么收尾。这段会作为生成文章时的 system prompt 核心。",
  "do_list": ["做这件事 1", "做这件事 2", "做这件事 3"],
  "dont_list": ["不要做 1", "不要做 2", "不要做 3"],
  "strategies": [
    {
      "tag": "opening / transition / closing / argument / language / visual 任选其一",
      "scope": ["适用分类 1", "适用分类 2"],
      "description": "策略名 + 一句话",
      "example": "原文里可佐证的一小段（≤ 30 字）",
      "when_to_use": "什么场景下复用这条策略最合适，一句话"
    }
  ],
  "strengths": ["他的优点 1", "他的优点 2", "他的优点 3"],
  "weaknesses": ["他这种风格在哪类题材会失灵 1", "失灵 2", "失灵 3"],
  "strategy_reasoning": "为什么这位博主选择这种写作策略，80-150 字。讲读者画像、平台环境、风格选择的内在逻辑。",
  "category_variance": {
    "观点": "（如果有「观点」类样本，说说这类下博主的表现差异；没有就写「无样本」）",
    "案例": "同上",
    "教学": "同上",
    "评论": "同上",
    "杂感": "同上"
  }
}
\`\`\`

下面是 ${n} 篇的局部策略集合（每篇都是 stage1 输出的原始 JSON）：

${sources}

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块。`;
}
