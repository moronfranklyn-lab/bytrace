/**
 * 在已有指纹基础上"追加学习"几篇新文章，输出 v(N+1) 指纹。
 *
 * 关键差异（vs 从头拆解）：
 * - 不是无中生有，而是"在现有指纹基础上增强 / 修正 / 补充"
 * - 已经识别准确的特征要保留；新出现的特征要补；模糊的描述要更具体
 * - 输出仍然是同一个 schema 的完整 JSON，便于直接替换
 */

import type { FingerprintArticle } from './fingerprint';

export function buildRefineFingerprintPrompt(
  currentFingerprint: Record<string, unknown>,
  newArticles: FingerprintArticle[],
): string {
  if (!Array.isArray(newArticles) || newArticles.length === 0) {
    throw new Error('buildRefineFingerprintPrompt: newArticles must be a non-empty array');
  }
  if (newArticles.length > 10) {
    throw new Error('buildRefineFingerprintPrompt: at most 10 new articles supported');
  }

  const articleBlocks = newArticles
    .map((a, i) => {
      const idx = i + 1;
      const title = (a.title ?? '').trim() || '（无标题）';
      const content = (a.content ?? '').trim();
      return [
        `===== 新增文章 ${idx} =====`,
        `标题：${title}`,
        '正文：',
        content,
      ].join('\n');
    })
    .join('\n\n');

  const currentJsonStr = JSON.stringify(currentFingerprint, null, 2);
  const n = newArticles.length;

  return `你是一位写作风格学者。一位作者的"写作指纹 v1"已经在下方，现在他又写了 ${n} 篇新文，请你**在 v1 的基础上**输出 v2。

v1 指纹（当前版本）：

\`\`\`json
${currentJsonStr}
\`\`\`

任务说明：
1. 通读下方 ${n} 篇新文，对照 v1 的每一个字段，判断是否需要：
   - **保留**：v1 已经讲对了，新文也没推翻——直接保留
   - **修正**：新文证明 v1 的描述不准——以新文为准更新
   - **补充**：v1 漏掉了某个跨篇稳定特征，新文显形了——补进去
   - **细化**：v1 写得太笼统（比如 "幽默风趣"），新文给了具体素材——换成可落地的描述
2. v2 必须是**完整的指纹 JSON**，不是 diff、不是"以上保持不变"。下游会整段替换。
3. 跨篇稳定才能写进指纹——单篇偶发的现象别误判成新特征。把 v1 已学的 N 篇和新增的 ${n} 篇一起当样本看。
4. 字段顺序、字段结构与 v1 完全一致。

严格输出规则（违反任何一条都视为失败）：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要有任何文字、解释、寒暄。
- JSON 必须是合法 JSON，字符串字段使用双引号。
- 严禁在字段值里使用 emoji 或装饰符号（emoji_usage 字段例外，那是统计用途）。
- 数组字段（verbal_tics / do_list / dont_list）至少 3 项；topic_preference 关键词 3-5 个。
- author_summary 不超过 50 字，fingerprint_summary 必须三句话讲清"怎么开篇、怎么论证、怎么收尾"。

以下是 ${n} 篇新文，请基于 v1 输出 v2：

${articleBlocks}

现在请输出 v2 完整 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块，不要任何前言后语。`;
}
