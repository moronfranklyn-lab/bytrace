/**
 * Stage 2（v3）：跨篇综合 → 按平台分组 + 按领域分组 + 策略碎片库
 *
 * 用途：v3 拆解第二阶段。把 N 份 stage1 的局部分析汇总，让 Claude 输出博主级别的
 * 「平台指纹组（platform_fingerprints）」「领域差异（domain_variations）」「策略碎
 * 片库（strategy_fragments）」。cross_platform_report 在这一阶段先给一个初稿，
 * stage3 会基于这个再做深度跨平台对比。
 *
 * 与 v2 stage2 的区别：
 *   - v2 输出一个「博主整体指纹」对象
 *   - v3 输出按平台分组的 N 个指纹，再加一份跨平台调整报告 + 策略碎片库
 *
 * 输入：N 份 stage1 输出 + 博主名
 * 输出：严格 JSON，只有一个 ```json``` 代码块；禁用 emoji。
 */

export interface FingerprintV3Stage1Output {
  index: number;
  platform: string;
  domain: string;
  medium: 'text' | 'video' | 'mixed';
  title?: string;
  // 直接拼接 stage1 的原始 JSON 字符串就行，不再做二次结构化
  rawJson: string;
}

export function buildFingerprintV3Stage2Prompt(
  authorName: string,
  stage1Outputs: FingerprintV3Stage1Output[],
): string {
  const sources = stage1Outputs
    .map((s) => {
      const title = (s.title ?? '').trim() || '（无标题）';
      return [
        `===== 篇 ${s.index + 1} · 平台「${s.platform}」· 领域「${s.domain}」· 媒介「${s.medium}」· ${title} =====`,
        s.rawJson.trim(),
      ].join('\n');
    })
    .join('\n\n');

  const n = stage1Outputs.length;
  const platformSet = Array.from(new Set(stage1Outputs.map((s) => s.platform))).filter(Boolean);
  const domainSet = Array.from(new Set(stage1Outputs.map((s) => s.domain))).filter(Boolean);

  return `你是一位资深写作风格学者。下面是博主「${authorName}」的 ${n} 篇样本拆出来的局部策略集合。请把它们综合成这位博主的**多平台多领域指纹**。

样本概况：
- 博主：${authorName}
- 样本数：${n}
- 涉及平台：${platformSet.join(' / ') || '未指定'}
- 涉及领域：${domainSet.join(' / ') || '未指定'}

任务说明：
1. 按平台分组，每个平台单独出一份指纹（platform_fingerprints）。只输出**真有样本**的平台，没样本的不要瞎编。
2. 按领域分组，输出每个领域相对于「博主默认风格」的偏移（domain_variations）。同样只输出有样本的领域。
3. 提炼策略碎片库（strategy_fragments）：合并 stage1 里相似的碎片，去重，每条标注适用平台与适用领域。**全库 15-25 条**，覆盖 opening / transition / closing / argument / language / visual / pacing / hook 多个 tag。
4. cross_platform_report 给一个初稿（summary + 1-3 个 comparisons + 2-4 个 transferable_patterns）。stage3 会基于这份初稿继续做深度对比。如果 platforms_analyzed 只有一个，cross_platform_report.summary 写「单平台样本，无跨平台对比」、comparisons 为空数组、transferable_patterns 给 2 条「平台内可复用的模式」。
5. user_facing_summary 给一段 100-180 字的人话，说明这位博主有几套写作「配方」，分别在什么场景用。这段会直接展示给写文章的用户。

严格输出规则（违反任何一条都视为失败）：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何文字。
- JSON 必须合法，字符串字段用双引号。
- **严禁** emoji 或装饰符号（✦ ✨ ✓ ● ◆ 🎯 等都禁用），唯一例外是 visual.emoji_usage 字段（统计用途）。
- 嵌套引号统一用「」中文引号，避免破坏 JSON.parse。
- 数组下限：strategy_fragments ≥ 15，每个平台的 platform_specific_traits ≥ 2、strengths ≥ 2、weaknesses ≥ 2。
- 字段顺序与 schema 一致，便于下游解析。

输出 JSON Schema：

\`\`\`json
{
  "author_summary": "一句话概括这位博主的写作 DNA，不超过 50 字",
  "platforms_analyzed": ["实际拆出来的平台 1", "..."],
  "domains_analyzed": ["实际拆出来的领域 1", "..."],

  "platform_fingerprints": {
    "公众号": {
      "fingerprint_summary": "三句话：他在公众号怎么开篇 / 怎么论证 / 怎么收尾",
      "language": {
        "sentence_length": "短促 / 中等 / 绵长 + 一句话样例",
        "vocabulary_register": "口语 / 书面 / 学术 / 混合 + 一句话特点",
        "verbal_tics": ["口头禅 1", "口头禅 2"]
      },
      "structure": {
        "opening_hook": "提问 / 金句 / 场景 / 数据 / 反常识 + 一句话样例",
        "transition_style": "段落连接方式 + 一句话样例",
        "closing_pattern": "总结升华 / 反转 / 留白 / 行动号召 + 一句话样例"
      },
      "topic": {
        "topic_preference": "在这个平台偏爱的题材 + 3-5 个关键词",
        "viewpoint_density": "观点稀疏 / 适中 / 密集",
        "argumentation": "案例为主 / 数据为主 / 类比为主 / 反问为主 + 一句话特点"
      },
      "visual": {
        "image_style": "1-2 句话描述",
        "emoji_usage": "无 / 极少 / 适度 / 大量 + 偏好符号",
        "layout_preference": "正经版 / 活泼版 / 极简版"
      },
      "platform_specific_traits": [
        "他为了适配这个平台做的独特动作 1（比如「开篇 200 字内立钩子」）",
        "动作 2"
      ],
      "strengths": ["在这个平台的优势 1", "优势 2"],
      "weaknesses": ["在这个平台会失灵的场景 1", "失灵 2"]
    }
  },

  "domain_variations": {
    "商业观察": {
      "differences_from_default": "相对博主默认风格，这个领域有什么偏移，一句话",
      "preferred_structure": "在这个领域他偏爱的结构模板，一句话",
      "tone_shift": "口吻偏移，一句话"
    }
  },

  "cross_platform_report": {
    "summary": "这位博主在不同平台的核心差异，一段话 ≤ 120 字",
    "comparisons": [
      {
        "topic_example": "某个共通的题材或观点",
        "platform_a": "平台 A 名字",
        "platform_a_treatment": "在 A 上怎么处理的，一句话",
        "platform_b": "平台 B 名字",
        "platform_b_treatment": "在 B 上怎么处理的，一句话",
        "why_adjusted": "为什么要这么调，平台用户特点与传播逻辑解释"
      }
    ],
    "transferable_patterns": [
      "可以跨平台保留的模式 1（比如「金句保留，论证可压缩」）",
      "模式 2"
    ]
  },

  "strategy_fragments": [
    {
      "tag": "opening / transition / closing / argument / language / visual / pacing / hook 任选其一",
      "platform_scope": ["公众号", "知乎"],
      "domain_scope": ["商业观察"],
      "title": "碎片名字 6-14 字",
      "description": "一句话讲清这碎片做了什么",
      "example": "原文里能佐证的一小段（≤ 40 字，用「」包裹）",
      "when_to_use": "什么场景下用最合适，一句话",
      "why_works": "为什么这么做有效，结合平台 / 题材的特点解释"
    }
  ],

  "user_facing_summary": "给写文章的用户看的一段话（100-180 字）：这位博主有几套写作配方，分别在什么场景用，怎么挑。"
}
\`\`\`

下面是 ${n} 篇的局部策略集合（每篇都是 stage1 输出的原始 JSON）：

${sources}

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块。`;
}
