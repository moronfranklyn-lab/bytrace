export interface FingerprintArticle {
  title?: string;
  content: string;
}

/**
 * Build a strict-JSON-output prompt asking Claude to extract a 12-dimension
 * "writing fingerprint" from N reference articles (1-10 supported, 3-5 typical).
 *
 * The output is meant to be parsed with JSON.parse after stripping the
 * ```json ... ``` fence.
 */
export function buildFingerprintPrompt(articles: FingerprintArticle[]): string {
  if (!Array.isArray(articles) || articles.length === 0) {
    throw new Error('buildFingerprintPrompt: articles must be a non-empty array');
  }
  if (articles.length > 10) {
    throw new Error('buildFingerprintPrompt: at most 10 articles supported');
  }

  const articleBlocks = articles
    .map((a, i) => {
      const idx = i + 1;
      const title = (a.title ?? '').trim() || '（无标题）';
      const content = (a.content ?? '').trim();
      return [
        `===== 文章 ${idx} =====`,
        `标题：${title}`,
        '正文：',
        content,
      ].join('\n');
    })
    .join('\n\n');

  const n = articles.length;

  return `你是一位写作风格学者，专长是从作者的样本文本中提取"写作指纹"。请仔细阅读以下 ${n} 篇文章，提取这位作者的写作 DNA。

任务说明：
1. 通读所有 ${n} 篇文章，识别作者**反复出现**的语言、结构、选题、视觉习惯。
2. 单篇里的偶发现象不算指纹，跨篇稳定复现的才算。
3. 按下方 JSON Schema 输出，**12 个维度全部填写**，不要留空。
4. 描述要具体，能落地——比如 "verbal_tics" 必须给出真实可复用的口头禅词组，不要写"幽默风趣"这种空话。
5. "fingerprint_summary" 会作为后续生成文章时的 system prompt 核心，必须三句话讲清"怎么开篇、怎么论证、怎么收尾"。

严格输出规则（违反任何一条都视为失败）：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要有任何文字、解释、寒暄。
- JSON 必须是合法 JSON，所有字符串字段使用双引号。
- **严禁**在 JSON 字段值里使用 emoji 或装饰符号，唯一例外是 "emoji_usage" 字段（统计用途）。
- 数组字段（verbal_tics / do_list / dont_list）必须给满 3 项；topic_preference 的关键词给 3-5 个。
- 字段顺序与 schema 一致，便于下游解析。

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
  "dont_list": ["不要做 1", "不要做 2", "不要做 3"]
}
\`\`\`

以下是 ${n} 篇待分析文章：

${articleBlocks}

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块，不要任何前言后语。`;
}
