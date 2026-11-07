/**
 * Stage 0（v3）：单篇文章 → 自动归类（科技/经济金融/知识科普/...）
 *
 * 为什么固定 8 类不让模型自由发挥：
 *   自由分类会出现"AI技术/人工智能/科技前沿"这种近义词碎片化，
 *   碎片库会被打散。固定类标签让"科技类策略碎片"可以跨博主合并。
 *
 * 输出契约：单选 + 可选副类，最多 2 个。confidence 用来后续过滤模糊样本。
 */

export const ARTICLE_CATEGORIES = [
  '科技',
  '经济金融',
  '知识科普',
  '生活情感',
  '职场创业',
  '文化娱乐',
  '时事评论',
  '健康医学',
] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export interface Stage0ClassifyInput {
  title?: string;
  content: string;
  platform?: string;
}

export interface Stage0ClassifyOutput {
  primary: ArticleCategory;
  secondary: ArticleCategory | null;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}

export function buildStage0ClassifyPrompt(input: Stage0ClassifyInput): string {
  const title = (input.title ?? '').trim() || '（无标题）';
  const platform = (input.platform ?? '').trim() || '未知平台';
  // 截取前 2000 字够分类用，省 token
  const snippet = input.content.trim().slice(0, 2000);

  return `你是一位文章分类员。把下面这篇文章归类到 8 个固定类别之一（必要时可加一个副类）。

固定类别（必须从中选，不能自创）：
${ARTICLE_CATEGORIES.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

类别边界说明：
- 科技：AI / 互联网产品 / 编程 / 数码硬件 / 科学技术
- 经济金融：投资 / 股市 / 货币 / 宏观经济 / 公司财报
- 知识科普：通识普及（历史 / 地理 / 物理 / 生物 / 心理学），不带强烈观点
- 生活情感：人际关系 / 婚恋 / 育儿 / 个人成长（非职场）
- 职场创业：求职 / 公司管理 / 创业 / 商业案例分析（侧重决策与方法）
- 文化娱乐：电影 / 综艺 / 文学 / 音乐 / 游戏 / 体育
- 时事评论：当下社会事件 / 政策 / 国际关系 / 行业热点点评
- 健康医学：医学知识 / 养生 / 疾病科普 / 公共卫生

判断顺序：
1. 主体讲什么 → 选 primary
2. 是否还有第二条主线占文章 ≥ 30%？有就填 secondary，否则 null
3. confidence：high=明显落在某类；medium=有 2-3 类候选；low=多类杂糅或边缘

样本元数据：
- 平台：${platform}
- 标题：${title}

正文片段（前 2000 字）：
"""
${snippet}
"""

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后无任何文字。
- primary / secondary 必须是上述 8 个类别之一（secondary 可为 null）。
- evidence ≤ 30 字，引用文章里能证明分类的一小段。

输出 JSON Schema：

\`\`\`json
{
  "primary": "科技",
  "secondary": null,
  "confidence": "high",
  "evidence": "从原文里截一小段佐证，用「」包裹"
}
\`\`\`

现在请输出 JSON。`;
}

/**
 * 校验 + 兜底解析。Claude 偶尔会输出"科技类"或不在白名单里的词，这里强制收敛。
 */
export function normalizeCategory(raw: unknown): ArticleCategory | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/类$/, '');
  for (const c of ARTICLE_CATEGORIES) {
    if (cleaned === c || cleaned.includes(c)) return c;
  }
  return null;
}

export function parseStage0Output(rawJson: string): Stage0ClassifyOutput | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(rawJson);
  } catch {
    return null;
  }
  const primary = normalizeCategory(obj.primary);
  if (!primary) return null;
  const secondary = normalizeCategory(obj.secondary);
  const conf = obj.confidence;
  const confidence: 'high' | 'medium' | 'low' =
    conf === 'high' || conf === 'medium' || conf === 'low' ? conf : 'medium';
  const evidence = typeof obj.evidence === 'string' ? obj.evidence : '';
  return { primary, secondary, confidence, evidence };
}
