/**
 * 选题中心 · 风格推荐 prompt
 *
 * 输入：博主指纹列表（每条含 author_name / fingerprint_summary / strengths）+ 用户最近写过的标题列表。
 * 输出：≤ 8 条「还没写过但符合某博主风格」的选题卡片。
 */

export interface RecommendInputFingerprint {
  fingerprint_id: string;
  author_name: string;
  platform: string | null;
  fingerprint_summary: string;
  strengths?: string[];
  topic_preference?: string;
}

export function buildTopicRecommendPrompt(params: {
  fingerprints: RecommendInputFingerprint[];
  recentTitles: string[];
}): string {
  const { fingerprints, recentTitles } = params;
  if (fingerprints.length === 0) {
    throw new Error('buildTopicRecommendPrompt: fingerprints 不能为空');
  }

  const fpBlock = fingerprints
    .map(
      (f, i) =>
        `${i + 1}. id=${f.fingerprint_id} · ${f.author_name}（${f.platform ?? '未指定平台'}）\n   summary: ${f.fingerprint_summary}\n   strengths: ${(f.strengths ?? []).join(' / ') || '—'}\n   topic_preference: ${f.topic_preference ?? '—'}`,
    )
    .join('\n');

  const recentBlock =
    recentTitles.length === 0
      ? '（用户还没写过文章）'
      : recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n');

  return `你是写作选题策划。基于下方博主指纹库 + 用户最近写过的标题，推荐 6-8 个「还没写过 + 符合某博主写作风格」的选题。

任务说明：
1. 每个选题必须挂在一个具体的 fingerprint_id 上，说明它适配这位博主的风格。
2. 题目要有钩子，不要写成「关于 X 的思考」这种没钩子的标题。
3. angle 字段说清这个题目的切入角度（一句话）。
4. 要避开用户最近写过的题目（语义层面避开，不只是字面）。
5. 同一位博主最多出现 2 次。

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后无任何文字。
- 字符串字段用双引号。
- **严禁** emoji 或装饰符号。
- topics 数组长度 6-8。

输出 JSON Schema：

\`\`\`json
{
  "topics": [
    {
      "fingerprint_id": "来自上面 id 字段，必须严格匹配",
      "author_name": "对应博主名",
      "title": "选题标题，有钩子",
      "angle": "切入角度，一句话",
      "why_match": "为什么适配这位博主的风格，一句话"
    }
  ]
}
\`\`\`

博主指纹库（${fingerprints.length} 位）：
${fpBlock}

用户最近写过的题目：
${recentBlock}

现在请输出 JSON。`;
}
