import type { Composition, FingerprintMeta } from '@/lib/composition';
import { buildCompositionSystemSnippet, buildPlatformAwareSnippet } from '@/lib/composition';
import { getPlatform, pickV3PlatformFingerprint, type PlatformKey } from '@/lib/platforms';

export interface OutlineSection {
  index: number;
  title: string;
  bullets: string[];
  word_budget: number;
}

export interface Outline {
  working_title: string;
  hook_idea: string;
  sections: OutlineSection[];
  closing_idea: string;
  total_words_estimate: number;
}

/**
 * /api/compose/outline 用的 prompt：
 *
 *   输入：题材思路 + 选定的风格组合（外加指纹库）
 *   输出：一份大纲 JSON，描述章节结构、每节要点、预计字数。
 *
 * 输出 JSON 由 ```json ... ``` 包裹。
 */
export function buildOutlinePrompt(
  idea: string,
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
  targetPlatformKey: PlatformKey | null = null,
): string {
  const compositionSnippet = buildCompositionSystemSnippet(composition, fingerprints);
  const target = targetPlatformKey ? getPlatform(targetPlatformKey) : null;
  const platformCn = target?.name ?? null;
  const platformExtra = buildPlatformAwareSnippet(fingerprints, composition, platformCn);

  // 根据目标平台动态调整大纲约束
  const sectionRange = target
    ? sectionRangeForPlatform(targetPlatformKey)
    : { min: 3, max: 6, perWordMin: 500, perWordMax: 1200, totalMin: 2000, totalMax: 5000 };

  const platformBlock = target
    ? `
# 目标平台

平台：${target.name}
建议总字数：${target.word_range_min}-${target.word_range_max} 字
节奏：${target.pacing}
钩子落点：${target.hook_position}
推荐结构：${target.structure}
${platformExtra ? `\n# 博主对目标平台的适配提示\n\n${platformExtra}\n` : ''}`
    : '';

  return `你是写作助理，现在的任务是为一篇尚未动笔的文章生成"先框架后填肉"的大纲。

# 选定的风格组合

${compositionSnippet}
${platformBlock}
# 作者的题材思路

\`\`\`
${(idea ?? '').trim()}
\`\`\`

# 任务要求

1. 通读题材思路，提炼出读者读完应该带走的**一个核心结论**。
2. 设计一个让读者"刷一眼就想读"的开篇 hook${target ? `（要符合目标平台的钩子落点：${target.hook_position}）` : ''}。
3. 把论证拆成 ${sectionRange.min}-${sectionRange.max} 个章节，每章节都有：
   - 一个不大不小的小标题（10-18 字，宋体感，不要疑问句堆叠）；
   - 3-5 个要点 bullet（每条 ≤ 28 字）；
   - 预计字数（${sectionRange.perWordMin}-${sectionRange.perWordMax} 字之间）。
4. 设计一个收尾思路：升华 / 反转 / 留白 / 行动 / 金句 任选其一，但要和开篇 hook 在结构上呼应。
5. 总字数估算 = 各章节字数之和（不含 hook 和收尾的额外铺垫），范围 ${sectionRange.totalMin}-${sectionRange.totalMax} 字。

# 严格输出规则

只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何寒暄。
JSON Schema：

\`\`\`json
{
  "working_title": "一个工作标题（10-22 字，不带书名号、不带 emoji）",
  "hook_idea": "开篇思路一句话（≤ 40 字）",
  "sections": [
    {
      "index": 1,
      "title": "章节小标题",
      "bullets": ["要点 1", "要点 2", "要点 3"],
      "word_budget": 800
    }
  ],
  "closing_idea": "收尾思路一句话（≤ 40 字）",
  "total_words_estimate": 3200
}
\`\`\`

# 禁令

- 严禁 emoji、装饰符号、表情字符。
- 章节小标题不要全部用"为什么 / 是什么 / 怎么办"三段式，避免疑问句过载。
- 不要在大纲里写出完整段落，要点 bullet 是骨头不是肉。
- 标题里禁止出现"——"长破折号外的奇怪符号。
- bullets 数组每条都是字符串，禁止嵌套对象。

现在请输出 JSON。`;
}

/**
 * 根据目标平台给大纲的"章节数 / 单节字数 / 总字数"区间。
 * 抖音 / 小红书等短形态用更少章节；YouTube / B 站长视频允许更多。
 */
function sectionRangeForPlatform(key: PlatformKey | null): {
  min: number;
  max: number;
  perWordMin: number;
  perWordMax: number;
  totalMin: number;
  totalMax: number;
} {
  switch (key) {
    case 'xhs':
      return { min: 3, max: 5, perWordMin: 100, perWordMax: 300, totalMin: 700, totalMax: 1200 };
    case 'douyin':
      return { min: 3, max: 5, perWordMin: 60, perWordMax: 180, totalMin: 300, totalMax: 800 };
    case 'zhihu':
      return { min: 4, max: 8, perWordMin: 700, perWordMax: 1500, totalMin: 4500, totalMax: 8500 };
    case 'bilibili':
      return { min: 4, max: 8, perWordMin: 500, perWordMax: 1200, totalMin: 3000, totalMax: 6000 };
    case 'youtube':
      return { min: 4, max: 7, perWordMin: 500, perWordMax: 1100, totalMin: 2500, totalMax: 5500 };
    case 'sspai':
    case 'uisdc':
      return { min: 3, max: 6, perWordMin: 400, perWordMax: 900, totalMin: 2200, totalMax: 4000 };
    case 'wechat':
    case 'custom':
    default:
      return { min: 3, max: 6, perWordMin: 500, perWordMax: 1200, totalMin: 2000, totalMax: 5000 };
  }
}

/** route 在 JSON.parse 之后用这个做形状校验 / 兜底补齐 */
export function normalizeOutline(raw: unknown): Outline | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const sections: OutlineSection[] = [];
  sectionsRaw.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const so = s as Record<string, unknown>;
    const title = typeof so.title === 'string' ? so.title.trim() : '';
    if (!title) return;
    const bullets = Array.isArray(so.bullets)
      ? (so.bullets as unknown[]).filter((b): b is string => typeof b === 'string')
      : [];
    let budget = Number(so.word_budget);
    if (!Number.isFinite(budget) || budget < 200) budget = 800;
    sections.push({
      index: Number.isFinite(Number(so.index)) ? Number(so.index) : i + 1,
      title,
      bullets,
      word_budget: Math.round(budget),
    });
  });
  if (sections.length === 0) return null;

  return {
    working_title: typeof obj.working_title === 'string' ? obj.working_title : '未命名',
    hook_idea: typeof obj.hook_idea === 'string' ? obj.hook_idea : '',
    sections,
    closing_idea: typeof obj.closing_idea === 'string' ? obj.closing_idea : '',
    total_words_estimate:
      Number.isFinite(Number(obj.total_words_estimate))
        ? Math.round(Number(obj.total_words_estimate))
        : sections.reduce((s, x) => s + x.word_budget, 0),
  };
}
