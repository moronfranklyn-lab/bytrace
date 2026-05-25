import type { Composition, FingerprintMeta } from '@/lib/composition';
import { buildCompositionSystemSnippet, buildPlatformAwareSnippet } from '@/lib/composition';
import { getPlatform, pickV3PlatformFingerprint, type PlatformKey } from '@/lib/platforms';

export interface OutlineSection {
  index: number;
  title: string;
  bullets: string[];
  word_budget: number;
  /** v3.3：本节相对上节"挖深一步"还是"换角度并列"。第 1 节固定为 'open'。 */
  depth_role?: 'open' | 'deeper' | 'parallel' | 'turn' | 'close';
  /** v3.3：本节的核心论断（一句话），article prompt 会让下节首段回扣这句 */
  thesis?: string;
}

export interface Outline {
  working_title: string;
  hook_idea: string;
  sections: OutlineSection[];
  closing_idea: string;
  total_words_estimate: number;
  /** v3.3：整篇骨架形态，跟博主 structure_repertoire / 站点 preferred_structures 对齐 */
  structure_shape?: 'causal_chain' | 'dual_contrast' | 'concentric' | 'flat_list' | 'timeline' | 'problem_solution';
  /** v3.3：核心论点（整篇围绕的那一句） */
  core_thesis?: string;
}

export interface OutlineSiteContext {
  siteLabel: string | null;
  siteProfile: Record<string, unknown> | null;
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
  siteCtx: OutlineSiteContext | null = null,
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

  const siteBlock = buildSiteBlock(siteCtx);
  const structureBlock = buildStructureCapabilityBlock(fingerprints, composition);

  return `你是写作助理。任务是为一篇尚未动笔的文章生成"先框架后填肉"的大纲。这份大纲**最关键的不是 bullet 列表，是一根能让正文层层递进的论证骨架**。

# 选定的风格组合

${compositionSnippet}
${structureBlock}${siteBlock}${platformBlock}
# 作者的题材思路

\`\`\`
${(idea ?? '').trim()}
\`\`\`

# 任务要求（按顺序做）

1. 通读题材思路，提炼出**一句话**的核心论点（写进 core_thesis）。整篇围绕这一句挖。
2. **选定 structure_shape**：综合上方「站点偏好结构」+「博主擅长结构」选一个最合适的——
   - **causal_chain**（因果链）：现象 → 不是 A 是 B → 根源 C → 应对 D。适合"挖根"题材。
   - **dual_contrast**（双线对比）："你以为 X / 实际是 Y" 反复缠绕。适合反认知题材。
   - **concentric**（同心圆）：行业 → 公司 → 个人，由外向内逐圈收紧。
   - **flat_list**（平铺列举）：N 个并列要点。适合工具类、清单类。
   - **timeline**（时间轴）：按时间顺序铺陈。
   - **problem_solution**（问题方案）：先暴露问题，再给方案。
   - **如果站点画像里有 preferred_structures，优先从那里挑。**
3. 设计开篇 hook（写进 hook_idea${target ? `；要符合钩子落点：${target.hook_position}` : ''}）。
4. **按选定的 structure_shape 把论证拆成 ${sectionRange.min}-${sectionRange.max} 个章节**，且**每个章节服务于 core_thesis 的下一层挖掘**——
   - 第 1 节 depth_role = "open"：抛出 core_thesis 或其反面。
   - 后续大多数节 depth_role = "deeper"：相对上节再挖深一层（不是换角度并列）。
   - 偶尔可以放一个 depth_role = "parallel"（同层换角度补充）或 "turn"（反转）。
   - 最后一节 depth_role = "close"：把 core_thesis 提到最高层或落地到读者。
   - **禁止整篇全是 "parallel"** —— 那叫平铺列举，看完读者只觉得"作者罗列了好几个角度"，没有思考的纵深。
5. 每章节给出：
   - title：小标题 10-18 字，宋体感，禁止疑问句堆叠。
   - thesis：本节**核心论断**（一句话，≤ 30 字）。下节的首段会回扣这句继续挖。
   - bullets：3-5 条要点（每条 ≤ 28 字），按"先抛论断 → 拆原因 → 给例 → 反问 / 收口"排序，不平等罗列。
   - depth_role：见上一条枚举。
   - word_budget：${sectionRange.perWordMin}-${sectionRange.perWordMax} 字。
6. 设计 closing_idea：和 hook_idea 在结构上呼应 —— 升华 / 反转 / 留白 / 行动 / 金句任选其一。
7. total_words_estimate = 各节 word_budget 之和，范围 ${sectionRange.totalMin}-${sectionRange.totalMax} 字。

# 严格输出规则

只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何寒暄。
JSON Schema：

\`\`\`json
{
  "working_title": "一个工作标题（10-22 字，不带书名号、不带 emoji）",
  "core_thesis": "整篇围绕的核心论点，一句话，≤ 30 字",
  "structure_shape": "causal_chain / dual_contrast / concentric / flat_list / timeline / problem_solution",
  "hook_idea": "开篇思路一句话（≤ 40 字）",
  "sections": [
    {
      "index": 1,
      "title": "章节小标题",
      "thesis": "本节核心论断，一句话",
      "depth_role": "open / deeper / parallel / turn / close",
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
- 章节小标题不要全部用"为什么 / 是什么 / 怎么办"三段式。
- 不要在大纲里写出完整段落，bullets 是骨头不是肉。
- 标题里禁止出现长破折号外的奇怪符号。
- bullets 每条都是字符串，禁止嵌套对象。
- **禁止**所有 depth_role 都是 "parallel" —— 必须至少有一节 "deeper"。

现在请输出 JSON。`;
}

/**
 * v3.3：把博主指纹里的 structure_repertoire / depth_pattern / analogy_bank 拼成 prompt block。
 * 这是让 outline 知道"这位博主擅长哪种骨架、惯用哪些句式、有哪些物件类比可以复用"。
 */
function buildStructureCapabilityBlock(
  fingerprints: Map<string, FingerprintMeta>,
  composition: Composition,
): string {
  if (fingerprints.size === 0) return '';
  const lines: string[] = ['# 博主的结构能力'];
  let added = 0;
  for (const sel of composition.selected_authors) {
    const fp = fingerprints.get(sel.fingerprint_id);
    if (!fp?.fingerprint) continue;
    const obj = fp.fingerprint as unknown as Record<string, unknown>;
    const repertoire = obj.structure_repertoire as
      | { dominant_shape?: string; shapes?: Array<{ shape?: string; share?: string; execution_traits?: string[] }> }
      | undefined;
    const depthPattern = obj.depth_pattern as
      | { average_layers?: number; max_layers?: number; drilling_phrases?: string[]; drilling_observation?: string }
      | undefined;
    const analogyBank = Array.isArray(obj.analogy_bank) ? (obj.analogy_bank as string[]) : [];
    if (!repertoire && !depthPattern && analogyBank.length === 0) continue;
    lines.push('', `## 博主「${fp.author_name ?? sel.fingerprint_id.slice(0, 6)}」`);
    if (repertoire?.dominant_shape) {
      lines.push(`- 主擅长结构：${repertoire.dominant_shape}`);
    }
    if (repertoire?.shapes?.length) {
      const top = repertoire.shapes.slice(0, 3).map((s) =>
        `${s.shape ?? '?'}（${s.share ?? '?'}）${s.execution_traits?.length ? '·执行：' + s.execution_traits.slice(0, 2).join('；') : ''}`,
      );
      lines.push(`- 结构清单：${top.join(' / ')}`);
    }
    if (depthPattern) {
      const layers = depthPattern.average_layers
        ? `平均挖 ${depthPattern.average_layers} 层（最深 ${depthPattern.max_layers ?? '?'}）`
        : '';
      lines.push(
        `- 论证深度：${layers}${depthPattern.drilling_observation ? '。' + depthPattern.drilling_observation : ''}`,
      );
      if (depthPattern.drilling_phrases?.length) {
        lines.push(`- 挖根衔接句式：${depthPattern.drilling_phrases.slice(0, 4).map((p) => `「${p}」`).join(' / ')}`);
      }
    }
    if (analogyBank.length > 0) {
      lines.push(
        `- 物件类比库（生成时优先复用其中的具象物件，不要凭空造新隐喻）：${analogyBank.slice(0, 6).join(' / ')}`,
      );
    }
    added += 1;
  }
  return added > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * v3.3：把站点画像的 preferred_structures / preferred_depth / analogy_density 拼成 prompt block。
 */
function buildSiteBlock(ctx: OutlineSiteContext | null): string {
  if (!ctx?.siteProfile) return '';
  const p = ctx.siteProfile as {
    preferred_structures?: Array<{ shape?: string; share?: string; example_title?: string }>;
    preferred_depth?: string;
    analogy_density?: string;
    tone?: string;
    opening_pattern?: string;
    closing_pattern?: string;
  };
  if (!p.preferred_structures && !p.preferred_depth && !p.tone && !p.opening_pattern) return '';
  const lines: string[] = [`# 目标站点画像「${ctx.siteLabel ?? '未命名'}」`];
  if (p.preferred_structures?.length) {
    lines.push(
      '- 偏好结构：' +
        p.preferred_structures
          .map((s) => `${s.shape ?? '?'}（${s.share ?? '?'}）${s.example_title ? '·样例：' + s.example_title : ''}`)
          .join(' / '),
    );
  }
  if (p.preferred_depth) lines.push(`- 偏好深度：${p.preferred_depth}`);
  if (p.analogy_density) lines.push(`- 类比密度：${p.analogy_density}`);
  if (p.tone) lines.push(`- 调性：${p.tone}`);
  if (p.opening_pattern) lines.push(`- 开篇套路：${p.opening_pattern}`);
  if (p.closing_pattern) lines.push(`- 收尾套路：${p.closing_pattern}`);
  return lines.join('\n') + '\n';
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
    const depthRoleRaw = typeof so.depth_role === 'string' ? so.depth_role : '';
    const depthRole: OutlineSection['depth_role'] | undefined =
      depthRoleRaw === 'open' || depthRoleRaw === 'deeper' || depthRoleRaw === 'parallel'
        || depthRoleRaw === 'turn' || depthRoleRaw === 'close'
        ? depthRoleRaw
        : undefined;
    sections.push({
      index: Number.isFinite(Number(so.index)) ? Number(so.index) : i + 1,
      title,
      bullets,
      word_budget: Math.round(budget),
      depth_role: depthRole,
      thesis: typeof so.thesis === 'string' ? so.thesis.trim() || undefined : undefined,
    });
  });
  if (sections.length === 0) return null;

  const shapeRaw = typeof obj.structure_shape === 'string' ? obj.structure_shape : '';
  const structureShape: Outline['structure_shape'] | undefined =
    shapeRaw === 'causal_chain' || shapeRaw === 'dual_contrast' || shapeRaw === 'concentric'
      || shapeRaw === 'flat_list' || shapeRaw === 'timeline' || shapeRaw === 'problem_solution'
      ? shapeRaw
      : undefined;

  return {
    working_title: typeof obj.working_title === 'string' ? obj.working_title : '未命名',
    hook_idea: typeof obj.hook_idea === 'string' ? obj.hook_idea : '',
    sections,
    closing_idea: typeof obj.closing_idea === 'string' ? obj.closing_idea : '',
    total_words_estimate:
      Number.isFinite(Number(obj.total_words_estimate))
        ? Math.round(Number(obj.total_words_estimate))
        : sections.reduce((s, x) => s + x.word_budget, 0),
    structure_shape: structureShape,
    core_thesis: typeof obj.core_thesis === 'string' ? obj.core_thesis.trim() || undefined : undefined,
  };
}
