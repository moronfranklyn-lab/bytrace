import type { Composition, FingerprintMeta } from '@/lib/composition';
import { buildCompositionSystemSnippet, buildPlatformAwareSnippet } from '@/lib/composition';
import type { Outline } from '@/lib/prompts/outline';
import { getPlatform, type PlatformKey } from '@/lib/platforms';

/**
 * /api/compose/draft 用的 prompt：
 *
 *   输入：题材思路 + 选定风格组合 + 已确认的大纲 + 可选目标平台
 *   输出：**纯 Markdown 正文**（不是 JSON），因为正文要流式渲染。
 *
 * 严格写明：禁止 emoji、禁止装饰符号、禁止表格、只能用标题/段落/列表/引用。
 */
export function buildArticlePrompt(
  idea: string,
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
  outline: Outline,
  targetPlatformKey: PlatformKey | null = null,
): string {
  const compositionSnippet = buildCompositionSystemSnippet(composition, fingerprints);
  const outlineSnippet = renderOutline(outline);
  const target = targetPlatformKey ? getPlatform(targetPlatformKey) : null;
  const platformCn = target?.name ?? null;
  const platformExtra = buildPlatformAwareSnippet(fingerprints, composition, platformCn);

  const platformBlock = target
    ? `
# 目标平台风格约束（最高优先级，覆盖通用规则）

平台：${target.name}
建议字数：${target.word_range_min}-${target.word_range_max} 字
语气基调：${target.voice}
推荐结构：${target.structure}
钩子落点：${target.hook_position}
节奏密度：${target.pacing}

要做：
${target.do_extra.map((s) => '- ' + s).join('\n')}

不要做：
${target.dont_extra.map((s) => '- ' + s).join('\n')}
${platformExtra ? `\n# 博主对目标平台的适配提示\n\n${platformExtra}\n` : ''}`
    : '';

  return `你现在要把一份大纲扩写成一篇完整文章。这篇文章会发到${target ? `「${target.name}」` : '公众号或类似严肃长文平台'}，必须是**干净、可发布、像真人写**的成稿。

# 选定的风格组合

${compositionSnippet}
${platformBlock}
# 作者的题材思路（背景理解，不要直接复读）

${(idea ?? '').trim()}

# 已确认的大纲（这就是你的写作骨架，章节顺序不准动）

${outlineSnippet}

# 写作要求

1. **逐章节落笔**，每章节都先写小标题（用 \`## \` 作为 Markdown 二级标题），再写正文段落。
2. 章节小标题用大纲里给的字面文字，可以微调到更顺口、更短，但**禁止重写主题**。
3. 章节字数请尽量贴近大纲给的 \`word_budget\`，允许 ±20% 浮动。
4. 在文章最开头加一段 hook（无标题），承接大纲里的 \`hook_idea\`${target ? `，并符合目标平台的钩子落点：${target.hook_position}` : ''}。
5. 在最后写一段收尾，承接大纲里的 \`closing_idea\`。
6. 文章首行写**主标题**，用 \`# \` 一级标题。主标题可以微调大纲里的 working_title，使其更有冲击力。

# 输出格式（极严格）

- 只输出 **Markdown 正文**，不要前言、不要 \`\`\`fence、不要"以下是文章："这类铺垫。
- **禁止**任何 emoji（包括但不限于：✦ ✨ ✓ ● ◆ 🎯 📝 🌟 💡 → 等图形符号）。
- **禁止**装饰性 Unicode 符号（不准用 ─ ▎ ▌ ❘ ★ ☆ 这类 box drawing / 几何符号）。
- **禁止**输出 Markdown 表格（\`|---|\` 这种），表格在公众号上经常糊掉。
- **禁止**用图片引用 \`![]()\`，配图由后续流程处理。
- **允许**的 Markdown 元素只有：\`#\` 一级标题、\`##\` 二级标题、普通段落、\`-\` 无序列表、\`1.\` 有序列表、\`>\` 引用、\`**强调**\`、\`*斜体*\`、行内代码 \`code\`。
- 段落之间用一个空行隔开；列表项之间不要再空行。
- 中文标点用全角（。，；：？！""''""），英文术语和数字用半角。
- 中英混排时英文左右**保留一个空格**：\`这次用 LLM 帮我写\` 而不是\`这次用LLM帮我写\`。

# 内容质量底线

- 不要写"在这个数字化时代""随着 AI 的飞速发展"这种万能开场。
- 不要堆砌排比和金句，金句留给段落的关键节点，每章最多一处。
- 不要"首先 / 其次 / 最后"机械承接，按风格组合里指纹给的过渡句式来。
- 不要复读大纲里的 bullet，要扩写成有血有肉的段落和案例。
- 引用 / 数据如果不确定真实性，宁愿不写，也不要瞎编人名和数字。

# 文案温度

错误、反例、争议处的语气保持"陪伴而非审判"。不要训诫读者，把读者当朋友。

现在开始写正文。第一行就是 \`# 标题\`。`;
}

function renderOutline(outline: Outline): string {
  const lines: string[] = [];
  lines.push(`工作标题：${outline.working_title}`);
  lines.push(`开篇思路：${outline.hook_idea}`);
  lines.push(`收尾思路：${outline.closing_idea}`);
  lines.push(`预计总字数：${outline.total_words_estimate}`);
  lines.push('');
  lines.push('章节：');
  outline.sections.forEach((s) => {
    lines.push(`${s.index}. ${s.title}（约 ${s.word_budget} 字）`);
    s.bullets.forEach((b) => {
      lines.push(`   · ${b}`);
    });
  });
  return lines.join('\n');
}
