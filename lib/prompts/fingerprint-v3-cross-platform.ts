/**
 * Stage 3（v3）：跨平台深度对比报告
 *
 * 用途：仅当 platforms_analyzed.length >= 2 时执行。在 stage2 已经给出按平台分组的指
 * 纹之后，让 Claude 专门做一次「同一博主在不同平台的差异 + 为什么这么调」的深度对比，
 * 替换 stage2 里 cross_platform_report 的初稿。
 *
 * 与 stage2 的区别：stage2 的 cross_platform_report 只是初稿（comparisons 1-3 个），
 * 这里要求 3-5 个详细对比，并明确写出平台用户特点 + 传播逻辑。
 *
 * 输入：stage2 的完整结果（用 JSON 字符串传入，避免重复 stringify）
 * 输出：严格 JSON，只有一个 ```json``` 代码块；禁用 emoji。
 */

export interface FingerprintV3Stage2ForCrossPlatform {
  authorName: string;
  /** stage2 输出的完整 JSON 字符串（已经 stripJsonFence 过） */
  stage2RawJson: string;
}

export function buildFingerprintV3CrossPlatformPrompt(
  input: FingerprintV3Stage2ForCrossPlatform,
): string {
  return `你是一位专攻「跨平台内容策略」的研究者。下面是博主「${input.authorName}」的 stage2 综合指纹（按平台分组、按领域分组的完整 JSON）。

任务说明：
1. 重点是「同博主在不同平台的差异」。从 platform_fingerprints 里找出最值得对比的 3-5 组场景。
2. 每组对比要落到一个**具体题材或观点**上，描述「在平台 A 是怎么处理的、在平台 B 是怎么处理的」。
3. 关键是 why_adjusted：必须说清平台 A 与平台 B 的**用户特点 + 传播逻辑**差异，让用户读完就知道下次自己写同类内容要怎么取舍。
4. transferable_patterns 给 3-5 条「不论平台都能保留的内核」（金句、核心观点、论证骨架等）。
5. summary 是一段 ≤ 150 字的总结，作为博主详情页「跨平台报告」的开场白。

严格输出规则：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要任何文字。
- JSON 必须合法，字符串字段用双引号。
- **严禁** emoji 或装饰符号。
- 嵌套引号统一用「」中文引号，避免破坏 JSON.parse。
- comparisons 3-5 个，transferable_patterns 3-5 条。
- 如果 stage2 里 platforms_analyzed 只有一个，那就给一份「单平台说明」：summary 写明「目前只有单平台样本」，comparisons 为空数组，transferable_patterns 给 3 条「该平台内的稳定模式」。

输出 JSON Schema：

\`\`\`json
{
  "summary": "这位博主在不同平台的核心差异 + 调整逻辑，一段 ≤ 150 字",
  "comparisons": [
    {
      "topic_example": "具体题材或观点（比如「越努力越穷」）",
      "platform_a": "平台 A 名字",
      "platform_a_treatment": "在 A 上怎么处理的，一句话",
      "platform_b": "平台 B 名字",
      "platform_b_treatment": "在 B 上怎么处理的，一句话",
      "why_adjusted": "为什么要这么调：平台 A 的用户特点是 X、传播逻辑是 Y；平台 B 的用户特点是 P、传播逻辑是 Q。两句话讲透。"
    }
  ],
  "transferable_patterns": [
    "跨平台可保留的模式 1（要具体，能落地）",
    "模式 2",
    "模式 3"
  ]
}
\`\`\`

下面是 stage2 的完整输出：

\`\`\`json
${input.stage2RawJson}
\`\`\`

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块。`;
}
