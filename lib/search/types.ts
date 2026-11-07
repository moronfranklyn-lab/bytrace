/**
 * 博主名搜索（Agent I）的公共类型。
 * 这里只放数据形状，实际的搜索引擎实现在 ./index.ts。
 */

/** 单条搜索候选：让用户判断「是不是我要找的那个人」。 */
export type AuthorCandidate = {
  /** 显示名（候选标题截到博主名前缀）。 */
  name: string;
  /** 主页 / 频道 / 专栏的 URL。 */
  url: string;
  /**
   * 平台中文名，命中已知 host 时给出；不认识就 'unknown'。
   * 常见值：知乎 / B站 / 少数派 / 优设 / YouTube / 简书 / Medium / 公众号 / unknown
   */
  platform: string;
  /** 该候选来自文字博主、视频博主，还是混合。 */
  medium: 'text' | 'video' | 'mixed';
  /** 一段描述（来自搜索结果摘要），让用户判断。 */
  snippet: string;
  /** 工具自己的把握度 0-1（基于 host 是否匹配、query 是否在 title 中等）。 */
  confidence: number;
  /** 搜索源。 */
  source: 'duckduckgo' | 'google';
  /**
   * URL 类型判断：article = 可直接当一篇文章爬正文；
   * index = 主页/合集页（要走 crawlAuthorIndex 才能拿文章列表）；
   * unknown = 形状不明确，先按 article 试一下，失败再让用户处理。
   * 用于 UI 决定：article 直接灌卡，index 需要中转一步「拉列表」。
   */
  kind: 'article' | 'index' | 'unknown';
  /**
   * 风险提示：
   * - 'blocked'：当前站点已知反爬强烈，几乎一定爬失败（如知乎从 2024 中开始全面反爬）
   * - 'limited'：可能拿不到完整内容（如 B 站视频很可能没字幕）
   * - null：常规
   * UI 用：'blocked' 默认不勾 + 黄色警告；'limited' 默认勾但带提示。
   */
  risk: 'blocked' | 'limited' | null;
  /** 风险说明文案（一句话，温暖）。 */
  risk_hint: string | null;
};

/** 搜索失败时的统一错误形状；前端按 reason 给出温暖文案。 */
export type SearchError = {
  reason:
    | 'wechat-only' // 命中公众号但公众号没有可爬主页
    | 'no-results'
    | 'rate-limited'
    | 'timeout'
    | 'engine-error';
  message: string;
};

/** 类型守卫：用于区分 `searchAuthor` 的返回类型。 */
export function isSearchError(x: AuthorCandidate[] | SearchError): x is SearchError {
  return !Array.isArray(x) && typeof (x as SearchError).reason === 'string';
}
