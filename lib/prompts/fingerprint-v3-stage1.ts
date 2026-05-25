/**
 * Stage 1（v3）：单篇文章 → 局部策略碎片集合（带平台 / 领域 / 媒介标签）
 *
 * 用途：v3 拆解第一阶段。每篇文章带着「平台 / 题材领域 / 媒介」三个标签独立调一次
 * Claude，目标是从这一篇里提取出 3-7 个「局部策略碎片」，并且额外记录作者在这一篇
 * 里为了适配「这个平台 + 这个领域」做了哪些独特调整。
 *
 * 与 v2 stage1 的区别：
 *   - v2 只看 category（观点/案例/教学/...），平台是博主级别字段
 *   - v3 每篇都带 platform + domain + medium，让模型在解读时就分平台思考
 *   - v3 输出多了 platform_adjustments 与 domain_adjustments 两个字段
 *
 * 输入：一篇文章（含 platform / domain / medium / 可选 title / content）
 * 输出：严格 JSON，只有一个 ```json``` 代码块；禁用 emoji 与装饰符号。
 */

export interface FingerprintV3Article {
  title?: string;
  content: string;
  url?: string;
  platform: string; // '公众号' / 'B 站长视频' / '抖音' / '小红书' / '知乎' / 'YouTube' / ...
  medium: 'text' | 'video' | 'mixed';
  domain?: string; // '商业观察' / '情感' / '教学' / 不指定时为 '未指定'
}

export function buildFingerprintV3Stage1Prompt(
  article: FingerprintV3Article,
  index: number,
  total: number,
): string {
  const title = (article.title ?? '').trim() || '（无标题）';
  const platform = (article.platform ?? '').trim() || '未知平台';
  const medium = (article.medium ?? 'text').trim() || 'text';
  const domain = (article.domain ?? '').trim() || '未指定';
  const content = (article.content ?? '').trim();

  return `你是一位写作策略分析师，正在帮博主拆解他自己的写作 DNA。下面是这位博主的第 ${index + 1}/${total} 篇样本，请仔细看完。

样本元数据：
- 平台：${platform}
- 媒介：${medium}（text=纯文 / video=视频脚本或字幕 / mixed=图文混排）
- 题材领域：${domain}
- 标题：${title}

任务说明：
1. 只看这一篇，从里面提取「局部策略碎片」，每篇 3-7 条。
2. 每条碎片要具体、能落地——必须给出原文里能佐证的例子（≤ 40 字摘抄）。
3. 重点：你要意识到这篇是写给「${platform}」「${domain}」的，作者在这一篇里**为了适配这个平台和这个领域**，做了哪些**独特调整**？把这部分单独写在 platform_adjustments 和 domain_adjustments。
4. 给一段 ≤ 60 字的「局部观察」，描述这篇的整体调性、节奏、情绪。
5. **判断这一篇的论证形态与深度**——这是生成时仿写最关键的骨架信息：
   - structure_shape：这一篇属于哪种形态？causal_chain（因果链，一个核心论点层层挖根）/ dual_contrast（双线对比，"你以为 X，其实 Y"反复缠绕）/ concentric（同心圆，现象→公司→个人逐圈收紧）/ flat_list（平铺列举，N 个并列要点）/ timeline（时间轴）/ problem_solution（问题方案）。挑最贴近的一个。
   - depth_layers：这一篇围绕**核心论点**挖了几层？1 层 = 抛论点就走；2-3 层 = 挖到"为什么会这样"；4+ 层 = 从现象一路扒到底层机制。给整数。
   - depth_chain：把这一篇的因果链/递进路径用 3-6 个短句串出来，比如「现象 X → 不是 A，是 B → B 的根源是 C → 所以应对 D」。让下游能直接看出"作者怎么挖"。
6. **抓「物件级类比」**——这是仿写最容易丢失的特征。物件级 = 真实可触摸的物件 / 场景 / 人物，比如「中年人体检报告」「黄牛在天台抽烟」「户口本进 iCloud」。抽象的「就像一场旅程」「如同登山」不算。把这篇里所有物件级类比原文摘出来放进 concrete_analogies 数组（≤ 40 字/条，最多 6 条；没有就给空数组，**不要硬凑**）。

严格输出规则（违反任何一条都视为失败）：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何文字、寒暄、解释。
- JSON 必须合法，所有字符串字段用双引号。
- **严禁** emoji 或装饰符号（✦ ✨ ✓ ● ◆ 🎯 等都禁用）。文章里可能有，但你的输出里不能有。
- 嵌套引号统一用「」中文引号，避免破坏 JSON.parse。
- 字段顺序与 schema 一致。

输出 JSON Schema：

\`\`\`json
{
  "platform": "${platform}",
  "domain": "${domain}",
  "medium": "${medium}",
  "local_observation": "这一篇的整体调性、节奏、情绪。不超过 60 字。",
  "strategy_fragments": [
    {
      "tag": "opening / transition / closing / argument / language / visual / pacing / hook 任选其一",
      "title": "碎片名字，6-14 字",
      "description": "一句话讲清这碎片做了什么",
      "example": "原文里能佐证的一小段（≤ 40 字，原文摘抄；用「」包裹）",
      "when_to_use": "什么场景下复用这条最合适，一句话",
      "why_works": "为什么这种处理在「${platform}」这个平台、「${domain}」这个题材上有效，一句话"
    }
  ],
  "platform_adjustments": [
    "这位作者在这一篇里为了适配「${platform}」做的独特调整 1（一句话）",
    "调整 2"
  ],
  "domain_adjustments": [
    "为了适配「${domain}」题材做的独特调整 1（一句话）",
    "调整 2"
  ],
  "language_observation": {
    "sentence_length": "短促 / 中等 / 绵长 + 一句话样例",
    "verbal_tics": ["这篇里反复出现的口头禅 1", "口头禅 2"]
  },
  "structure_observation": {
    "opening_hook": "这篇怎么开篇的，一句话",
    "closing_pattern": "这篇怎么收尾的，一句话"
  },
  "structure_shape": "causal_chain / dual_contrast / concentric / flat_list / timeline / problem_solution 之一",
  "depth_layers": 3,
  "depth_chain": [
    "用 3-6 个短句把核心论点的递进路径写出来",
    "例：现象 X → 不是 A，是 B → 根源 C → 应对 D"
  ],
  "concrete_analogies": [
    "原文摘抄的物件级类比 1，用「」包裹，≤ 40 字",
    "原文摘抄的物件级类比 2"
  ]
}
\`\`\`

文章正文：
===== 文章 ${index + 1} =====
平台：${platform} · 媒介：${medium} · 领域：${domain}
标题：${title}
正文：
${content}

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块，不要任何前言后语。`;
}
