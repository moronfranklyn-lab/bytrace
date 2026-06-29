import type { Composition, FingerprintMeta } from '@/lib/composition';
import { buildCompositionSystemSnippet, buildPlatformAwareSnippet } from '@/lib/composition';
import type { Outline } from '@/lib/prompts/outline';
import { getPlatform, type PlatformKey } from '@/lib/platforms';

export interface ArticleSiteContext {
  siteLabel: string | null;
  siteProfile: Record<string, unknown> | null;
}

/**
 * /api/compose/draft 用的 prompt：
 *
 *   输入：题材思路 + 选定风格组合 + 已确认的大纲 + 可选目标平台 + 可选站点画像
 *   输出：**纯 Markdown 正文**（不是 JSON），因为正文要流式渲染。
 *
 * v3.3 加强：
 *   - outline.sections[i].thesis：每节核心论断
 *   - outline.sections[i].depth_role：本节相对上节的位置（open/deeper/parallel/turn/close）
 *   - 博主指纹里的 analogy_bank + 站点画像的 analogy_density：让模型用具体物件做类比
 */
export function buildArticlePrompt(
  idea: string,
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
  outline: Outline,
  targetPlatformKey: PlatformKey | null = null,
  siteCtx: ArticleSiteContext | null = null,
  /**
   * v3.5：codex 联网搜出来的素材包。outline 用过同样的素材包了，
   * 这里再喂一遍是因为 outline → article 是两次独立 LLM 调用，article 同样需要
   * 拿到事实底座才能在正文里准确地写出数字 / 引用，而不是凭空编。
   * 空 = 用户跳过 / 失败 / 没等到，prompt 自动降级。
   */
  researchMaterial?: string,
): string {
  const compositionSnippet = buildCompositionSystemSnippet(composition, fingerprints);
  const outlineSnippet = renderOutline(outline);
  const target = targetPlatformKey ? getPlatform(targetPlatformKey) : null;
  const platformCn = target?.name ?? null;
  const platformExtra = buildPlatformAwareSnippet(fingerprints, composition, platformCn);

  // v3.3：博主结构能力 + 站点画像 block（让正文知道"该挖几层、用哪些物件类比、复用哪些衔接句式"）
  const structureBlock = buildStructureBlock(fingerprints, composition);
  const siteBlock = buildSiteBlock(siteCtx);
  const analogyDensity = extractAnalogyDensity(siteCtx);
  const depthHint = extractDepthHint(siteCtx);
  // v3.5：codex 搜来的素材包，作为正文事实底座
  const materialBlock = buildResearchMaterialBlockForArticle(researchMaterial);

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
${structureBlock}${siteBlock}${platformBlock}${materialBlock}
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

# 论证纵深规则（v3.3 重点）

7. **每节都要服务于核心论点 core_thesis**。core_thesis = ${outline.core_thesis ? `「${outline.core_thesis}」` : '请从开篇 hook 里推断'}。整篇围绕这一句反复挖深，不要每节换个新概念重启。
8. **每节正文的第一段必须显式回扣上一节的核心论断**（大纲里给了每节的 \`thesis\` 字段）。具体做法：用一句话承上，然后再往下挖一层。承上的句式可以参考博主指纹里的「挖根衔接句式」（如「不是 X，是 Y」「你拆开看」「这事不复杂」），或者复用上节的关键词做钩子。**禁止**每节都从一个全新概念讲起。
9. 看每节的 \`depth_role\`：
   - **open**：抛 core_thesis 或它的反面，给读者一个"这文章要讲清楚的事情"。
   - **deeper**：相对上节再挖一层。如果上节讲了"现象"，本节讲"为什么"；上节讲"为什么"，本节讲"更深的为什么"或"应对"。
   - **parallel**：同层补充另一个角度。整篇最多 1-2 节 parallel。
   - **turn**：反转，给读者一个反预期。
   - **close**：把 core_thesis 提到最高层，或者落到读者自己。
10. **禁止任何一节正文写成"罗列三个角度"的形式**。如果上节给了 N 个并列点，本节要从中挑一个最关键的继续挖，不是再补一组新的并列点。
${depthHint ? `11. 站点画像建议挖到「${depthHint}」的深度。如果博主指纹里的「最深可达层数」比这个高，按博主能力走；比这个低，按站点画像走。\n` : ''}
# 物件级类比规则（v3.3 重点）

- **抽象论点必须配具象物件**。"努力被错误定价"这种论点，光说概念读者无感；要配「就像 X 这种生活场景」，X 必须是真实可触摸的物件 / 场景 / 人物（"中年人体检报告" / "黄牛在天台抽烟" / "户口本进 iCloud" 这种）。
- **优先复用博主指纹里 analogy_bank 给的物件**。那些是博主真用过的、风格一致的物件库。能复用就复用，不要凭空造一个风格不搭的新隐喻。
- **抽象隐喻不算**。"如同一场旅程"、"就像登山"、"宛如一面镜子"这种没有具体物件的比喻不算物件级类比，**禁止当成物件级用**。
- 物件类比的密度按站点画像走：${analogyDensity ?? '没有站点画像就按"每 800-1200 字 1 个具体物件类比"为参考，公众号深度长文允许更密'}。
- **禁止类比堆砌**——一个论点配一个类比就够，连续两段都用"就像 X 一样"会显得油腻。

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
${researchMaterial && researchMaterial.trim() ? `- **本次有素材包**：所有具体数字 / 人名 / 事件 / 引用，**必须**来自上方"已搜集的素材包"，不要凭空编、不要做素材包里没有的"小幅润色"。素材包里给出来源 URL 的，在正文里可以**省略 URL**（公众号不挂外链），但事实要忠实。\n` : ''}
# 文案温度

错误、反例、争议处的语气保持"陪伴而非审判"。不要训诫读者，把读者当朋友。

现在开始写正文。第一行就是 \`# 标题\`。`;
}

function renderOutline(outline: Outline): string {
  const lines: string[] = [];
  lines.push(`工作标题：${outline.working_title}`);
  if (outline.core_thesis) lines.push(`核心论点：${outline.core_thesis}`);
  if (outline.structure_shape) lines.push(`整篇结构形态：${outline.structure_shape}`);
  lines.push(`开篇思路：${outline.hook_idea}`);
  lines.push(`收尾思路：${outline.closing_idea}`);
  lines.push(`预计总字数：${outline.total_words_estimate}`);
  lines.push('');
  lines.push('章节：');
  outline.sections.forEach((s) => {
    const roleBadge = s.depth_role ? ` [${s.depth_role}]` : '';
    lines.push(`${s.index}. ${s.title}${roleBadge}（约 ${s.word_budget} 字）`);
    if (s.thesis) lines.push(`   核心论断：${s.thesis}`);
    s.bullets.forEach((b) => {
      lines.push(`   · ${b}`);
    });
  });
  return lines.join('\n');
}

/**
 * v3.3：渲染博主结构能力 block。
 * 重点是把 analogy_bank 和 drilling_phrases 喂进去，让正文能直接复用。
 */
function buildStructureBlock(
  fingerprints: Map<string, FingerprintMeta>,
  composition: Composition,
): string {
  if (fingerprints.size === 0) return '';
  const lines: string[] = ['# 博主的结构能力（必看）'];
  let added = 0;
  for (const sel of composition.selected_authors) {
    const fp = fingerprints.get(sel.fingerprint_id);
    if (!fp?.fingerprint) continue;
    const obj = fp.fingerprint as unknown as Record<string, unknown>;
    const repertoire = obj.structure_repertoire as
      | { dominant_shape?: string }
      | undefined;
    const depthPattern = obj.depth_pattern as
      | { average_layers?: number; max_layers?: number; drilling_phrases?: string[] }
      | undefined;
    const analogyBank = Array.isArray(obj.analogy_bank) ? (obj.analogy_bank as string[]) : [];
    if (!repertoire && !depthPattern && analogyBank.length === 0) continue;
    lines.push('', `## 博主「${fp.author_name ?? sel.fingerprint_id.slice(0, 6)}」`);
    if (repertoire?.dominant_shape) {
      lines.push(`- 擅长结构：${repertoire.dominant_shape}`);
    }
    if (depthPattern?.average_layers) {
      lines.push(`- 论证深度：平均挖 ${depthPattern.average_layers} 层${depthPattern.max_layers ? `，最深 ${depthPattern.max_layers}` : ''}`);
    }
    if (depthPattern?.drilling_phrases?.length) {
      lines.push(`- **挖根衔接句式（写每节首段时优先复用）**：${depthPattern.drilling_phrases.slice(0, 5).map((p) => `「${p}」`).join(' / ')}`);
    }
    if (analogyBank.length > 0) {
      lines.push('- **物件类比库（优先从这里挑物件做新类比，不要凭空造）**：');
      analogyBank.slice(0, 8).forEach((a) => lines.push(`  · ${a}`));
    }
    added += 1;
  }
  return added > 0 ? lines.join('\n') + '\n' : '';
}

function buildSiteBlock(ctx: ArticleSiteContext | null): string {
  if (!ctx?.siteProfile) return '';
  const p = ctx.siteProfile as {
    preferred_structures?: Array<{ shape?: string; example_title?: string }>;
    preferred_depth?: string;
    analogy_density?: string;
    tone?: string;
    opening_pattern?: string;
    closing_pattern?: string;
  };
  if (!p.preferred_structures && !p.preferred_depth && !p.tone) return '';
  const lines: string[] = [`# 目标站点画像「${ctx.siteLabel ?? '未命名'}」`];
  if (p.preferred_structures?.length) {
    lines.push('- 偏好结构：' + p.preferred_structures.map((s) => s.shape ?? '?').join(' / '));
  }
  if (p.preferred_depth) lines.push(`- 偏好深度：${p.preferred_depth}`);
  if (p.analogy_density) lines.push(`- 类比密度：${p.analogy_density}`);
  if (p.tone) lines.push(`- 调性：${p.tone}`);
  if (p.opening_pattern) lines.push(`- 开篇套路：${p.opening_pattern}`);
  if (p.closing_pattern) lines.push(`- 收尾套路：${p.closing_pattern}`);
  return lines.join('\n') + '\n';
}

function extractAnalogyDensity(ctx: ArticleSiteContext | null): string | null {
  if (!ctx?.siteProfile) return null;
  const v = (ctx.siteProfile as { analogy_density?: string }).analogy_density;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function extractDepthHint(ctx: ArticleSiteContext | null): string | null {
  if (!ctx?.siteProfile) return null;
  const v = (ctx.siteProfile as { preferred_depth?: string }).preferred_depth;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * v3.5：把 codex 联网搜来的素材包嵌进正文 prompt。
 *
 * 注意与 outline prompt 里那个同名 helper 的差异：
 *   - outline 的 block 强调"骨架阶段就该挂事实"
 *   - article 的 block 强调"正文里写的具体数字必须忠实，禁止自由发挥"
 * 两段提醒口径要一致但侧重不同。
 */
function buildResearchMaterialBlockForArticle(material: string | undefined): string {
  const trimmed = (material ?? '').trim();
  if (!trimmed) return '';
  return `
# 已搜集的素材包（事实底座 · 正文写具体数字 / 引用时的唯一来源）

下面这段是 codex 联网搜出来的硬料。正文里出现的每一个**具体数字 / 人名 / 公司案例 / 时间 / 引用原话**，**必须**能在这段素材里找到对应来源：

\`\`\`
${trimmed}
\`\`\`

写作时的边界：
- 素材包里的事实 → 可以直接用，可以改写成更顺口的中文，**但数字 / 人名不要漂移**。
- 素材包里的观点 → 写"X 在 Y 上说……"或"某厂商的自评数据显示……"时，明确归属，不要把观点包装成事实。
- 素材包里没有的具体事实 → **禁止凭想象补**。宁可省掉那个数字，用"显著上升""明显下降"这种定性描述，也别瞎编"涨了 47%"这种伪数字。
- 素材包标了"反方"或"争议"的内容 → 至少在一节正文里体现，不能装作没看见。
`;
}
