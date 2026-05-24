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
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后没有任何解释或寒暄。
- JSON 是合法 JSON，字符串用双引号。
- 选位置的原则：每张图都服务于"读者读到这一段时眼睛需要休息一下/需要画面补充"，不要扎堆在开头。
- position_anchor 是该图**应该插在哪段后面**的那段段落的开头约 30 个汉字（去掉空白），后端会用它做定位。**必须从原文中精确截取**，不要改写。
- intent_zh 是 6-12 字的中文图意，例如"安静的书桌 · 牛皮纸笔记本"。
- intent_en 是 3-6 个英文关键词，逗号分隔，例如 "quiet desk, notebook, paper texture, warm light"。后端会直接拿去搜 Unsplash。
- caption 是会显示在图片下方的中文图说，10-18 字。

JSON Schema：

\`\`\`json
{
  "slots": [
    {
      "slot_index": 1,
      "position_anchor": "原文那段开头的 30 字（必须能在文章里找到）",
      "intent_zh": "中文图意 6-12 字",
      "intent_en": "english, keywords, comma, separated",
      "caption": "中文图说 10-18 字"
    }
  ]
}
\`\`\`

slots 数组必须正好有 ${n} 个元素，slot_index 从 1 递增。

===== 文章正文 =====
${content}

现在输出 JSON。只输出一个 \`\`\`json ... \`\`\` 代码块。`;
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
