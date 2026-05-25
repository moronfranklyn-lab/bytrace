/**
 * 文章平台版本差异摘要 prompt。
 *
 *   输入：同一篇文章的两个平台版本 Markdown（A=源 / B=目标）
 *   输出：JSON，列出"从 A 改写到 B 时调整了什么"
 *
 * 用途：/articles 卡片里点平台 chip 切换时显示，让用户一眼看出
 * "公众号版 vs 小红书版主要差在哪"，而不必读两遍正文。
 */

import { getPlatform, type PlatformKey } from '@/lib/platforms';

export interface DiffSummary {
  /** 一句话总览 */
  overview: string;
  /** 3-5 个关键调整点 */
  adjustments: string[];
  /** 字数 / 段数 / 平均句长这种纯数值，模型不必算，留前端 */
}

export function buildDiffPrompt(
  fromMd: string,
  toMd: string,
  fromPlatform: PlatformKey,
  toPlatform: PlatformKey,
): string {
  const from = getPlatform(fromPlatform);
  const to = getPlatform(toPlatform);

  return `你是一位写作教练。下面是同一篇文章的两个版本：A 是${from.name}版，B 是${to.name}版。请用一句话总览 + 3-5 个关键调整点，说明从 A 改写到 B 时做了哪些调整。

# A · ${from.name}版（${from.voice}）

\`\`\`markdown
${truncateForPrompt(fromMd)}
\`\`\`

# B · ${to.name}版（${to.voice}）

\`\`\`markdown
${truncateForPrompt(toMd)}
\`\`\`

# 任务

对比 A 和 B，回答两个问题：

1. **一句话总览**：B 版相对 A 版整体气质 / 节奏 / 字数上有什么变化？≤ 35 字。
2. **关键调整点**：列出 3-5 条具体的改写动作。每条 ≤ 20 字，从这些角度挑：开头钩子怎么变了 / 章节结构怎么改的 / 句长节奏怎么变 / 案例或例证增删 / 收尾方式不同。

# 输出格式

只输出 JSON，不要解释、不要 markdown 代码块包裹：

{
  "overview": "...",
  "adjustments": ["...", "...", "..."]
}

约束：
- adjustments 数组长度 3-5
- 语气陪伴、不审判（"开头改成问句拉近距离" 而非 "原版开头太啰嗦"）
- 不要 emoji
- 不要"调整了开头"这种没信息量的话，要具体写改成什么样
`;
}

/** Claude CLI 的 prompt 也别太长。每段裁到 8000 字符够用了。 */
function truncateForPrompt(md: string): string {
  const MAX = 8000;
  if (md.length <= MAX) return md;
  return md.slice(0, MAX) + '\n\n…（已截断）';
}
