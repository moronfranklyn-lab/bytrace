import type { FingerprintShape } from '@/lib/composition';
import { judgePlatformMatchQuality } from '@/lib/composition';
import { getPlatform, pickV3PlatformFingerprint, type PlatformKey } from '@/lib/platforms';

/**
 * /api/recommend 用的 prompt：
 *
 *   输入：用户的题材思路（30 字以上） + 数据库里所有已有指纹的简化清单 +
 *         可选的 target_platform（公众号 / B 站 / 知乎 / ...）。
 *   输出：推荐 N 个"风格组合"（默认 3 个），每个组合可能是单博主或多博主融合，
 *         带 selected_authors / composition_summary / why_match /
 *         platform_match_quality。
 *
 * 输出仍然是 ```json ... ``` 包裹的合法 JSON，由 route.ts 用 stripJsonFence 解析。
 */

export interface RecommendFingerprintItem {
  fingerprint_id: string;
  author_id: string;
  author_name: string;
  platform?: string | null;
  fingerprint: FingerprintShape;
}

const TARGET_RECOMMENDATIONS = 3;

export function buildRecommendPrompt(
  idea: string,
  fingerprints: RecommendFingerprintItem[],
  targetPlatformKey: PlatformKey | null = null,
): string {
  const cleanedIdea = (idea ?? '').trim();
  if (cleanedIdea.length < 10) {
    throw new Error('buildRecommendPrompt: idea 太短，至少 10 字');
  }
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
    throw new Error('buildRecommendPrompt: 至少需要 1 份指纹');
  }

  const targetPlatform = targetPlatformKey ? getPlatform(targetPlatformKey) : null;
  const targetCnNames = targetPlatform ? [targetPlatform.name] : [];

  const blocks = fingerprints.map((fp, i) => {
    const platform = fp.platform ? ` · ${fp.platform}` : '';
    const summary = fp.fingerprint.author_summary ?? '（无 author_summary）';
    const summaryLong = fp.fingerprint.fingerprint_summary ?? '';
    const lang = summarizeDimension(fp.fingerprint.language);
    const struct = summarizeDimension(fp.fingerprint.structure);
    const topic = summarizeDimension(fp.fingerprint.topic);

    // v3 适配：把博主针对该平台的命中情况告诉模型
    let platformMatch = '';
    if (targetPlatform) {
      const matched = pickV3PlatformFingerprint(
        fp.fingerprint.platform_fingerprints,
        targetPlatform.key,
      );
      if (matched) {
        platformMatch = `命中目标平台「${matched.name}」专属指纹（exact）`;
      } else if (fp.fingerprint.platform_fingerprints && Object.keys(fp.fingerprint.platform_fingerprints).length > 0) {
        const have = Object.keys(fp.fingerprint.platform_fingerprints).join(' / ');
        platformMatch = `博主有 ${have} 的 v3 指纹，但没目标平台样本（cross-platform，可按跨平台改写策略）`;
      } else if (fp.fingerprint.cross_platform_report) {
        platformMatch = `博主有跨平台报告，按 transferable 模式处理（cross-platform）`;
      } else {
        platformMatch = `博主只有通用指纹，通用化使用（generic）`;
      }
    }

    return [
      `--- 指纹 ${i + 1} ---`,
      `fingerprint_id: ${fp.fingerprint_id}`,
      `author_id:      ${fp.author_id}`,
      `author_name:    ${fp.author_name}${platform}`,
      `画像：${summary}`,
      summaryLong ? `指纹概述：${summaryLong}` : '',
      lang ? `语言习惯：${lang}` : '',
      struct ? `结构习惯：${struct}` : '',
      topic ? `选题偏好：${topic}` : '',
      platformMatch ? `目标平台匹配：${platformMatch}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  const platformBlock = targetPlatform
    ? `
# 本次目标平台

平台：${targetPlatform.name}
建议字数：${targetPlatform.word_range_min}-${targetPlatform.word_range_max} 字
节奏：${targetPlatform.pacing}
钩子落点：${targetPlatform.hook_position}
推荐结构：${targetPlatform.structure}

挑选博主时**优先**带「命中目标平台专属指纹」的；其次是有跨平台指纹的（可按跨平台改写策略推荐）；最后才是通用 generic。但**不要因此放弃契合题材的博主**——契合优先级 > 平台匹配。
`
    : '';

  return `你是写作教练，要为一位作者挑选适合本次题材的"风格组合"。

# 任务背景

作者刚才写下了题材思路，我会同时给你他指纹库里所有已研究过的博主。你的任务是从这些博主里挑出 ${TARGET_RECOMMENDATIONS} 套风格组合推荐给他。

**单博主**和**多博主融合**都允许：
- 如果某位博主特别契合，可以单博主出战（occupies 100%）。
- 如果两到三位博主在不同维度互补（A 擅长开篇、B 论证扎实、C 收尾犀利），可以做融合，给每位一个 0-1 的权重。
- 同一个组合里**最多 3 位博主**。
- ${TARGET_RECOMMENDATIONS} 个组合之间要有差异：不要给三个几乎一样的方案，让作者真的能挑。
${platformBlock}
# 作者的题材思路

\`\`\`
${cleanedIdea}
\`\`\`

# 指纹库（共 ${fingerprints.length} 位博主）

${blocks.join('\n\n')}

# 输出要求

只输出一个 \`\`\`json ... \`\`\` 代码块，**严禁**前后有任何寒暄或解释。
JSON 顶层是一个数组，长度严格等于 ${TARGET_RECOMMENDATIONS}。

每个组合对象 schema：

\`\`\`json
{
  "label": "给这个组合起个 6-10 字的名字，写在卡片标题上",
  "selected_authors": [
    {
      "author_id": "（直接拷贝上面列表里的 author_id 原值）",
      "fingerprint_id": "（直接拷贝上面列表里的 fingerprint_id 原值）",
      "weight": 0.55,
      "reason": "为什么这位博主出现在这个组合里，一句话"
    }
  ],
  "composition_summary": "用一句话概括整体风格：用 X 的开场 + Y 的论证 + Z 的收尾",
  "why_match": "为什么这个组合特别适合作者刚才那个题材${targetPlatform ? '，以及为什么适合目标平台' : ''}",
  "platform_match_quality": "${targetPlatform ? 'exact | cross-platform | generic 三选一（取组合内多数博主的匹配档位）' : 'generic'}"
}
\`\`\`

# 严格规则

- 数组长度 = ${TARGET_RECOMMENDATIONS}，不多不少。
- author_id / fingerprint_id 必须**原样**从我给你的列表里复制，禁止编造、禁止改大小写、禁止加引号转义之外的字符。
- weight 是 0 到 1 之间的小数，单组合内多个 author 的 weight 之和**应当**接近 1（允许 0.9-1.1 误差，但**禁止**严重越界）。
- 字段值里**严禁 emoji**和任何装饰性符号。
- 中文用全角标点，但 JSON 字符串内部正常用双引号。
- composition_summary、why_match 是给作者看的，要具体、不要说"风格独特""适合本题"这种空话。${targetCnNames.length ? `\n- platform_match_quality 严格取这三个值之一，不要写中文。` : ''}

现在请输出 JSON。`;
}

function summarizeDimension(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 160);
  if (Array.isArray(v)) {
    return v.slice(0, 4).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('；');
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .slice(0, 4)
      .map(([k, val]) => `${k}=${typeof val === 'string' ? val : JSON.stringify(val)}`)
      .join('；')
      .slice(0, 240);
  }
  return String(v);
}

/** 解析期望的 JSON 形状（route 在 JSON.parse 之后用这个做形状校验） */
export interface RecommendationCard {
  label?: string;
  selected_authors: Array<{
    author_id: string;
    fingerprint_id: string;
    weight: number;
    reason?: string;
  }>;
  composition_summary: string;
  why_match: string;
  /** v3 新增：组合的整体平台匹配档位，由模型给出 + 后端用真指纹校正 */
  platform_match_quality?: 'exact' | 'cross-platform' | 'generic';
}

/**
 * 形状校验：保留合法卡片，过滤垃圾，并在 weight 不是 number 时 fallback 到 1/N。
 * 不抛错，最大限度容错。
 *
 * 新增：根据真指纹 + 目标平台，**反向校正** platform_match_quality（不信任模型）。
 */
export function normalizeRecommendations(
  raw: unknown,
  validFingerprintIds: Set<string>,
  fingerprintsById?: Map<string, FingerprintShape>,
  targetPlatformKey?: PlatformKey | null,
): RecommendationCard[] {
  if (!Array.isArray(raw)) return [];
  const out: RecommendationCard[] = [];
  const targetCn = targetPlatformKey ? getPlatform(targetPlatformKey).name : null;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const sa = Array.isArray(obj.selected_authors) ? obj.selected_authors : [];
    const filtered: RecommendationCard['selected_authors'] = [];
    for (const a of sa) {
      if (!a || typeof a !== 'object') continue;
      const ao = a as Record<string, unknown>;
      const fpid = String(ao.fingerprint_id ?? '');
      const aid = String(ao.author_id ?? '');
      if (!validFingerprintIds.has(fpid)) continue;
      let w = Number(ao.weight);
      if (!Number.isFinite(w) || w <= 0) w = 0.5;
      if (w > 1) w = 1;
      filtered.push({
        author_id: aid,
        fingerprint_id: fpid,
        weight: w,
        reason: typeof ao.reason === 'string' ? ao.reason : undefined,
      });
    }
    if (filtered.length === 0) continue;

    // 真指纹校正 platform_match_quality
    let mq: RecommendationCard['platform_match_quality'] | undefined;
    if (fingerprintsById && targetPlatformKey) {
      const buckets: Record<'exact' | 'cross-platform' | 'generic', number> = {
        exact: 0,
        'cross-platform': 0,
        generic: 0,
      };
      for (const sel of filtered) {
        const fp = fingerprintsById.get(sel.fingerprint_id);
        if (!fp) continue;
        buckets[judgePlatformMatchQuality(fp, targetCn)] += 1;
      }
      // 取出现最多的；并列时优先 exact > cross > generic
      mq = (['exact', 'cross-platform', 'generic'] as const).reduce<
        RecommendationCard['platform_match_quality']
      >((best, k) => {
        if (!best) return buckets[k] > 0 ? k : best;
        return buckets[k] > buckets[best] ? k : best;
      }, undefined);
      if (!mq) mq = 'generic';
    } else if (typeof obj.platform_match_quality === 'string') {
      const m = obj.platform_match_quality;
      if (m === 'exact' || m === 'cross-platform' || m === 'generic') mq = m;
    }

    out.push({
      label: typeof obj.label === 'string' ? obj.label : undefined,
      selected_authors: filtered,
      composition_summary: typeof obj.composition_summary === 'string' ? obj.composition_summary : '',
      why_match: typeof obj.why_match === 'string' ? obj.why_match : '',
      platform_match_quality: mq,
    });
  }
  return out;
}
