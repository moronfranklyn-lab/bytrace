/**
 * 选题中心 · 热点聚合 prompt
 *
 * 输入：从 crawled_articles 算出来的高频关键词 + 标题样本。
 * 输出：≤ 8 条「热点趋势选题」。
 *
 * 本 prompt 只让 Claude 起趋势题。关键词/标题的 TF-IDF 聚合在 Node 端算。
 */

export interface TrendingKeyword {
  keyword: string;
  count: number;
  sample_titles: string[];
}

export function buildTopicTrendingPrompt(keywords: TrendingKeyword[]): string {
  if (keywords.length === 0) {
    throw new Error('buildTopicTrendingPrompt: keywords 不能为空');
  }

  const block = keywords
    .map(
      (k, i) =>
        `${i + 1}. 关键词「${k.keyword}」 · 出现 ${k.count} 次\n   样本标题：\n   - ${k.sample_titles.slice(0, 3).join('\n   - ')}`,
    )
    .join('\n');

  return `你是热点观察员。下方是近期爬到的文章里 TF-IDF 排前的关键词 + 它们对应的样本标题。请把它们聚合成 6-8 个「趋势选题」。

任务说明：
1. 把语义相近的关键词合并（比如「Cursor」+「Copilot」+「IDE」合并成「AI 编程工具」类）。
2. 每个趋势选题给一个有钩子的标题、一个一句话切入角度，再给 1-3 个关联关键词。
3. 避免硬蹭——如果关键词不能合理形成一个趋势题，就跳过。

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块。
- **严禁** emoji 或装饰符号。
- topics 数组长度 6-8。

输出 JSON Schema：

\`\`\`json
{
  "topics": [
    {
      "title": "选题标题，有钩子",
      "angle": "切入角度，一句话",
      "related_keywords": ["关键词 1", "关键词 2"],
      "heat_hint": "为什么这个题目现在值得写，一句话"
    }
  ]
}
\`\`\`

近期热门关键词（按频率倒序）：
${block}

现在请输出 JSON。`;
}
