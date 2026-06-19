/**
 * 深度调研流程的 prompt 构造。四个角色：
 *   - buildGatherPrompt    → 喂给 codex（联网搜集，gpt-5.5）
 *   - buildDraftPrompt     → 喂给 claude（起草/回炉，走 ARTICLE_MODEL = sonnet 4.6）
 *   - buildReviewPrompt    → 喂给 codex（独立审查，要求输出 JSON）
 *   - buildReviseHintBlock → 把审查意见注入下一轮起草（回炉）
 *
 * 设计原则（继承项目调性）：
 *   - 报告是"写作弹药"，不是学术腔 —— 事实/数据/论点/takeaway/可展开角度，全带来源。
 *   - 严格区分【已验证事实】vs【个人观点/预测】，对夸大宣传保持警惕。
 *   - 报告正文禁 emoji 和装饰符号（项目硬约束）。
 */

export interface ResearchPrefs {
  /** 取材偏好，如 "优先 X(推特)/YouTube 一线从业者一手观点" */
  sourceHint?: string;
}

export interface ResearchIssue {
  severity: 'high' | 'medium' | 'low';
  where: string;
  problem: string;
  suggestion: string;
}

export interface ResearchReview {
  issues: ResearchIssue[];
  verdict: 'pass' | 'revise';
  /** 0-100 报告整体可用度，best-of-N 选稿用 */
  score: number;
  summary: string;
}

/* ----------------------------------------------------------------- */
/* 1. 搜集（codex 联网）                                              */
/* ----------------------------------------------------------------- */

export function buildGatherPrompt(topic: string, prefs: ResearchPrefs = {}): string {
  const sourceHint = prefs.sourceHint?.trim()
    || '优先一线从业者、创始人、工程负责人的一手深度观点；区分一手观点与二手转述';
  return [
    '你是一名严谨的研究员。请围绕下面这个选题联网检索，产出一份"素材包"，供后续写一篇中文深度文章使用。',
    '',
    `# 选题`,
    topic,
    '',
    `# 取材偏好`,
    sourceHint,
    '',
    '# 你要做的',
    '1. 主动联网搜索多个角度（正方/反方/数据/案例/一线观点），不要只搜一个角度。',
    '2. 对每条信息，**严格区分**：【事实/数据】（有可核查来源）还是【个人观点/预测】（某人的判断）。',
    '3. 对夸大宣传、孤证、利益相关方（厂商自家数据）保持警惕，明确标注其局限。',
    '4. 主动找**反方证据**，不要只收集支持某一结论的材料。',
    '',
    '# 输出格式（纯文本，分这几节，不要用 emoji）',
    '## 核心事实与数据',
    '逐条列：结论 + 关键数字 + 来源(URL/出处) + 证据等级(实验/学术 | 行业调查·自评 | 厂商遥测 | 个人观点)。',
    '## 关键观点（一手为主）',
    '谁说的、在哪说的、原话要点；标注这是观点不是事实。',
    '## 反方/争议',
    '有哪些相反证据或学界争论。',
    '## 来源清单',
    '所有用到的 URL，按可信度分类。',
    '',
    '只输出素材包本身，不要寒暄。',
  ].join('\n');
}

/* ----------------------------------------------------------------- */
/* 2. 起草 / 回炉（claude 4.6）                                       */
/* ----------------------------------------------------------------- */

export function buildDraftPrompt(
  topic: string,
  material: string,
  prefs: ResearchPrefs = {},
  reviseHint?: string,
): string {
  const blocks = [
    '你是一名资深中文科技作者。请基于下面的"素材包"，写一份**深度调研报告**，它会被当作写公众号/知乎深度文的"写作弹药"。',
    '',
    `# 选题`,
    topic,
    '',
    `# 素材包（你的唯一事实来源，不要凭空编造素材包里没有的数字或引用）`,
    material,
    '',
    '# 报告要求',
    '- 形态是"写作弹药"：核心事实清单、关键数据（带具体数字和出处）、有冲击力且站得住脚的论点、可展开的写作角度。',
    '- **严格分级标注**每条证据：【实验/学术】【行业调查·自评】【厂商遥测·相关性】【个人观点/预测】【基于事实的推断】。',
    '- 自评感知 vs 客观测量必须分开讲，不能把"受访者觉得"写成"事实就是"。',
    '- 给一个"禁用/慎用清单"：哪些流行说法证据不足、不能无条件写。',
    '- 结尾给"可展开的写作角度"和"来源清单（按可信度分类）"。',
    '- 正文**禁止任何 emoji 和装饰性符号**；结构靠章节和列表。',
    '- 用中文，markdown 格式，从一级标题开始。',
  ];
  if (reviseHint && reviseHint.trim()) {
    blocks.push('', reviseHint.trim());
  }
  blocks.push('', '直接输出报告 markdown，不要寒暄。');
  return blocks.join('\n');
}

/* ----------------------------------------------------------------- */
/* 3. 审查（codex，要求 JSON）                                        */
/* ----------------------------------------------------------------- */

export function buildReviewPrompt(reportMd: string): string {
  return [
    '你是一名独立的事实核查与观点审查官。下面是一份将用于写中文深度文的调研报告。',
    '请联网交叉核实其中的关键数字与引用，挑刺（不是复述、不是夸奖）。',
    '',
    '审查四个维度：',
    '1. 事实与数据：有没有可疑、过时、内部矛盾、明显错误或无法核实的数字/引用。',
    '2. 论点：有没有逻辑漏洞、过度推断、把相关当因果、以偏概全。',
    '3. 资料与来源：有没有把单一来源或利益相关方（厂商自家数据）当成定论。',
    '4. 写作风险：哪些地方写出去最容易被行家打脸；有没有该补的反方。',
    '',
    '# 待审报告',
    reportMd,
    '',
    '# 输出（严格 JSON，不要任何额外文字、不要 markdown 围栏）',
    '{',
    '  "issues": [',
    '    {"severity": "high|medium|low", "where": "指向报告哪部分", "problem": "问题", "suggestion": "怎么改"}',
    '  ],',
    '  "score": 0到100的整数（作为写作素材的整体可用度：90+ 几乎无硬伤，70-89 可用但需小改，<70 有较大问题）,',
    '  "verdict": "pass 或 revise（有任一 high 级问题就必须 revise）",',
    '  "summary": "一句话总判"',
    '}',
  ].join('\n');
}

/* ----------------------------------------------------------------- */
/* 4. 回炉指示（把审查意见注入下一轮起草）                            */
/* ----------------------------------------------------------------- */

export function buildReviseHintBlock(review: ResearchReview, attempt: number): string {
  const lines: string[] = [];
  lines.push('# 上一稿的审查反馈（必须逐条采纳，否则这次仍然不会通过）');
  lines.push('');
  lines.push(`这是第 ${attempt} 次起草。上一稿审查结论：${review.verdict}。${review.summary || ''}`);
  lines.push('');
  lines.push('需要修掉的问题：');
  const sorted = [...review.issues].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
  for (const it of sorted) {
    lines.push(`- [${it.severity}] ${it.where}：${it.problem}`);
    if (it.suggestion) lines.push(`  → 改法：${it.suggestion}`);
  }
  lines.push('');
  lines.push('注意：保留原报告的整体结构和已经站得住的事实，只针对上面这些问题做精准修补，不要整篇重写。');
  return lines.join('\n');
}

function sevRank(s: ResearchIssue['severity']): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}
