/**
 * 站点画像 prompt：从一组同站点的文章里提炼"这个板块/编辑发文偏好"。
 *
 * 与 fingerprint 不一样的是：fingerprint 学的是"博主个人 DNA"，
 * site profile 学的是"目标平台的发文模板"——字数、配图密度、标题套路。
 *
 * 输出严格 JSON，由调用方剥掉 ```json ... ``` fence 后 JSON.parse。
 */

export interface SiteProfileArticle {
  title?: string;
  url?: string;
  content: string;
}

export function buildSiteProfilePrompt(
  articles: SiteProfileArticle[],
  hint?: { siteHost?: string; sectionHint?: string },
): string {
  if (!Array.isArray(articles) || articles.length === 0) {
    throw new Error('buildSiteProfilePrompt: articles must be a non-empty array');
  }
  if (articles.length > 10) {
    throw new Error('buildSiteProfilePrompt: at most 10 articles supported');
  }

  const articleBlocks = articles
    .map((a, i) => {
      const idx = i + 1;
      const title = (a.title ?? '').trim() || '（无标题）';
      const url = a.url?.trim() || '';
      const content = (a.content ?? '').trim();
      return [
        `===== 文章 ${idx} =====`,
        `标题：${title}`,
        url ? `URL：${url}` : '',
        '正文：',
        content,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const n = articles.length;
  const hostLine = hint?.siteHost ? `\n站点 host：${hint.siteHost}` : '';
  const sectionLine = hint?.sectionHint ? `\n板块提示：${hint.sectionHint}` : '';

  return `你是一位平台编辑研究员，专长是从同一个网站/板块下的多篇文章里提炼"发文偏好"——也就是这个板块的编辑/运营反复挑选、反复呈现的那套模板。

任务说明：
1. 通读以下 ${n} 篇来自同一站点/板块的文章。${hostLine}${sectionLine}
2. 关注**跨篇稳定**的特征：偏爱的题材、典型标题套路、字数区间、配图密度、开篇与收尾模式、文章基调、高频词汇。
3. 单篇里的偶发现象不算画像，跨篇复现的才算。
4. 这份画像未来会被用来"按板块调字数、调标题、调引导语"——所以字数区间、标题模板、开篇套路要尽量具体可复用。
5. 严禁空话（"内容优质""文笔流畅"这种描述零信息）。每个字段都要给到能直接落地的细节。

严格输出规则（违反任何一条都视为失败）：
- 只输出一个 \`\`\`json ... \`\`\` 代码块，前后不要有任何文字、解释、寒暄。
- JSON 必须是合法 JSON，所有字符串字段使用半角双引号 ASCII " 包裹。
- **JSON 字符串值内部**严禁出现裸的半角双引号 "。需要表达「引用」「例如」时，**必须用中文全角引号「」**，不要用 ASCII "..."、也不要用 \\" 转义（容易漏）。下游会直接 JSON.parse，任何不合法的引号都会导致失败。
- 严禁在 JSON 字段值里使用 emoji 或装饰符号。
- 数组字段必须给满规定数量（preferred_topics 给 3-5 个；title_patterns 给 3-5 个；key_phrases 给 5-8 个）。
- word_count_range 是 [min, max] 的两元素整数数组，反映这一批文章实际的字数分布（粗略估计即可）。
- 字段顺序与 schema 一致，便于下游解析。

输出 JSON Schema（注意所有举例都用「」中文引号，不用 ASCII 引号）：

\`\`\`json
{
  "site_name": "站点名称（中文，比如「少数派 Matrix」）",
  "section": "板块名称（比如「效率板块」），无明显板块就写「主站」",
  "url_pattern": "URL 通配模式（比如「sspai.com/matrix/...」或「sspai.com/post/...」）",
  "preferred_topics": ["题材关键词 1", "题材关键词 2", "..."],
  "title_patterns": [
    "标题套路 1（用占位符 X / Y 表示可替换部分，比如「我用 X 个月，把 Y 这件事 ...」）",
    "标题套路 2",
    "标题套路 3"
  ],
  "word_count_range": [3500, 8000],
  "image_density": "高（每 500 字一张）/ 中（每 1000 字一张）/ 低（仅头图）/ 无图，附一句话说明",
  "opening_pattern": "开篇典型套路（场景代入 / 痛点抛出 / 个人体验 / 数据反差 等），附一句话样例描述",
  "closing_pattern": "收尾典型套路（总结 + 行动建议 / 局限说明 / 反问留白 等），附一句话样例描述",
  "tone": "整体基调描述，比如「理性、克制、工具感」「温暖、个人化、有故事感」等",
  "key_phrases": ["高频词或固定短语 1", "高频词或固定短语 2", "..."]
}
\`\`\`

以下是 ${n} 篇待分析的同站点文章：

${articleBlocks}

现在请输出 JSON。记住：只输出一个 \`\`\`json ... \`\`\` 代码块，不要任何前言后语。`;
}
