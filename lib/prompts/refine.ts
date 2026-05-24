/**
 * /api/compose/refine 用的 prompt：
 *
 *   输入：已经写好的 Markdown 正文 + 源平台 + 目标平台 +（可选）博主跨平台报告。
 *   输出：按目标平台风格改写后的 Markdown 正文（流式）。
 *
 * v3 升级：
 *   - 平台清单与 lib/platforms.ts 对齐（不再独立维护一套）
 *   - 接受 sourcePlatform / crossPlatformReport，让模型按博主真实的跨平台映射改写
 */

import { getPlatform, isValidPlatformKey, type PlatformKey } from '@/lib/platforms';
import type { FingerprintMeta } from '@/lib/composition';

export type RefinePlatform = PlatformKey;

export interface RefineCrossPlatformHint {
  /** 博主名（用于 prompt 自然语言里指代） */
  author_name: string;
  /** v3 cross_platform_report.summary */
  summary?: string;
  /** v3 cross_platform_report.comparisons */
  comparisons?: Array<Record<string, unknown>>;
  /** v3 cross_platform_report.transferable_patterns */
  transferable_patterns?: string[];
  /** 命中的目标平台专属指纹（如果有），优先级高于 cross_platform_report */
  matched_platform_fp?: Record<string, unknown> | null;
}

export interface BuildRefineOptions {
  /** 源平台（默认 wechat） */
  sourcePlatform?: PlatformKey;
  /** 博主跨平台提示（来自 v3 fingerprint。多博主时取主权重那一份） */
  crossHints?: RefineCrossPlatformHint[];
}

export function buildRefinePrompt(
  articleMarkdown: string,
  targetPlatform: RefinePlatform,
  options: BuildRefineOptions = {},
): string {
  const target = getPlatform(targetPlatform);
  const source = options.sourcePlatform ? getPlatform(options.sourcePlatform) : null;

  const crossBlock = (options.crossHints && options.crossHints.length > 0)
    ? renderCrossHints(options.crossHints, target.name)
    : '';

  const sourceBlock = source
    ? `
# 源平台（原文是按这个平台写的）

平台：${source.name}
建议字数：${source.word_range_min}-${source.word_range_max} 字
语气：${source.voice}
结构：${source.structure}
钩子落点：${source.hook_position}
节奏：${source.pacing}
`
    : '';

  return `你要把下面这篇文章**改写**到目标平台的风格，而不是从零重写。原文的核心观点、案例、骨架都要保留，只调整：篇幅、节奏、小标题方式、句式密度${source ? `，并且明确"从「${source.name}」到「${target.name}」"的跨平台映射` : ''}。
${sourceBlock}
# 目标平台

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
${crossBlock}
# 全局禁令（对所有平台生效）

- **禁止**任何 emoji 或装饰图形符号（✦ ✨ ✓ ● ◆ 🎯 📝 → 等）。
- **禁止**Markdown 表格（\`|---|\` 这种）。
- **禁止**插入图片引用 \`![]()\`。
- 允许的 Markdown 元素：\`#\`/\`##\` 标题、段落、\`-\`/\`1.\` 列表、\`>\` 引用、\`**强调**\`、\`*斜体*\`、行内代码。
- 中英混排时英文左右保留一个空格。

# 文案温度

陪伴而非审判：错误、反例处不要训诫读者。

# 改写要点

- 字数必须落在目标平台建议字数区间，超出 ±15% 内允许。
- 结构按目标平台模板调，但**论点 / 案例 / 数据**必须保留。
- 钩子位置严格按目标平台的「钩子落点」要求。
- 如果上面给了「博主跨平台映射」，按那个映射规则改写；没给就按通用模板。

# 原文（不要在输出里复读这段）

\`\`\`markdown
${articleMarkdown}
\`\`\`

# 输出

直接输出**改写后的 Markdown 正文**，不要任何前言（不要"以下是改写版："），不要外层 \`\`\`fence。第一行就是 \`# \` 主标题。`;
}

function renderCrossHints(hints: RefineCrossPlatformHint[], targetName: string): string {
  const parts: string[] = ['', `# 博主跨平台映射（指导改写）`, ''];
  for (const h of hints) {
    parts.push(`▸ 博主「${h.author_name}」：`);
    if (h.matched_platform_fp) {
      parts.push(`  - 命中目标平台「${targetName}」专属指纹，直接套用。关键字段如下：`);
      const pf = h.matched_platform_fp;
      if (typeof pf.fingerprint_summary === 'string') {
        parts.push(`    · 三句话指纹：${pf.fingerprint_summary}`);
      }
      if (pf.language) parts.push(`    · 语言：${shallow(pf.language)}`);
      if (pf.structure) parts.push(`    · 结构：${shallow(pf.structure)}`);
      if (Array.isArray(pf.platform_specific_traits)) {
        parts.push(`    · 专属动作：${(pf.platform_specific_traits as unknown[]).join('；')}`);
      }
    } else {
      if (h.summary) parts.push(`  - 跨平台总结：${h.summary}`);
      if (Array.isArray(h.transferable_patterns) && h.transferable_patterns.length > 0) {
        parts.push(`  - 可跨平台保留：${h.transferable_patterns.join('；')}`);
      }
      if (Array.isArray(h.comparisons) && h.comparisons.length > 0) {
        parts.push(`  - 平台对比样本：`);
        for (const c of h.comparisons.slice(0, 3)) {
          const pa = String((c as Record<string, unknown>).platform_a ?? '');
          const pb = String((c as Record<string, unknown>).platform_b ?? '');
          const at = String((c as Record<string, unknown>).platform_a_treatment ?? '');
          const bt = String((c as Record<string, unknown>).platform_b_treatment ?? '');
          parts.push(`    · ${pa}: ${at}  →  ${pb}: ${bt}`);
        }
      }
    }
    parts.push('');
  }
  return parts.join('\n');
}

function shallow(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('；');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`)
      .join('；');
  }
  return String(v);
}

/**
 * 从 fingerprint meta 列表里抽出跨平台 hint。多博主时全部带上，让模型自行权衡。
 */
export function extractCrossHintsFromFingerprints(
  fingerprints: Map<string, FingerprintMeta>,
  targetPlatform: RefinePlatform,
): RefineCrossPlatformHint[] {
  const out: RefineCrossPlatformHint[] = [];
  const targetCn = getPlatform(targetPlatform).name;
  for (const meta of fingerprints.values()) {
    const fp = meta.fingerprint;
    if (!fp) continue;
    const hint: RefineCrossPlatformHint = { author_name: meta.author_name };
    // 命中专属
    if (fp.platform_fingerprints && typeof fp.platform_fingerprints === 'object') {
      const matched = (fp.platform_fingerprints as Record<string, unknown>)[targetCn];
      if (matched && typeof matched === 'object') {
        hint.matched_platform_fp = matched as Record<string, unknown>;
      }
    }
    if (fp.cross_platform_report) {
      hint.summary = fp.cross_platform_report.summary;
      hint.comparisons = fp.cross_platform_report.comparisons;
      hint.transferable_patterns = fp.cross_platform_report.transferable_patterns;
    }
    // 只有当 hint 里至少有一项有内容时才推
    if (hint.matched_platform_fp || hint.summary || (hint.transferable_patterns && hint.transferable_patterns.length) || (hint.comparisons && hint.comparisons.length)) {
      out.push(hint);
    }
  }
  return out;
}

export { isValidPlatformKey as isValidRefinePlatform };
