/**
 * Build a strict-JSON-output prompt asking Claude to find N image slots in an
 * article: where to put each image, what it should depict (Chinese + English
 * keywords), and a 30-char position anchor (paragraph head) the front-end can
 * use to locate the insertion point.
 *
 * Output is parsed with JSON.parse after stripping ```json ... ``` fence.
 */

export interface ImageKeywordSlot {
  slot_index: number;
  position_anchor: string;     // first ~30 chars of the paragraph it follows
  intent_zh: string;           // 中文图意 e.g. "工作场景 · 桌面"
  intent_en: string;           // English search keywords for Unsplash
  caption: string;             // 短图说明（中文）
}

export function buildImageKeywordsPrompt(
  articleContent: string,
  slotCount: number,
  visualStyle: string | null = null,
): string {
  const content = (articleContent ?? '').trim();
  if (!content) {
    throw new Error('buildImageKeywordsPrompt: articleContent is empty');
  }
  const n = Math.max(1, Math.min(slotCount, 8));
  const styleLine = visualStyle
    ? `作者的配图风格偏好：${visualStyle}（生成 English keywords 时把这种风格作为修饰词加入）。`
    : '作者没有指定配图风格，给中性、写实、商用安全的关键词即可。';

  return `你是文章编辑助手。任务：阅读下面这篇成稿文章，挑出 ${n} 个适合插入配图的位置，给每个位置写出图意关键词。

${styleLine}

严格输出规则：
- **只输出 JSON，不要有任何其他文字**
- **不要用 markdown 代码块包裹（不要 \`\`\`json），直接输出裸 JSON**
- JSON 必须是合法 JSON 格式，所有字符串用双引号
- position_anchor：从原文精确截取段落开头 **20 个汉字**（不是 30，要短）
- intent_zh：6-10 字的中文图意，例如"机器人展台"
- intent_en：3-5 个英文关键词，例如 "robot, exhibition, technology"
- caption：10-15 字的中文图说

输出格式（slots 数组必须正好有 ${n} 个元素）：

{
  "slots": [
    {
      "slot_index": 1,
      "position_anchor": "原文段落开头20字",
      "intent_zh": "中文图意6-10字",
      "intent_en": "english, keywords",
      "caption": "中文图说10-15字"
    }
  ]
}

===== 文章正文 =====
${content}

现在输出 JSON（直接输出裸 JSON，不要任何其他内容）：`;
}

/**
 * Best-effort strip of the ```json ... ``` fence.
 */
export function stripJsonFence(raw: string): string {
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) return raw.slice(first, last + 1).trim();
  return raw.trim();
}
