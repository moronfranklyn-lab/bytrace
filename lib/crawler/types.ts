/**
 * 爬虫公共类型定义。其他 Agent 应从 lib/crawler 主入口导入，本文件主要给适配器内部用。
 */

export type CrawledArticle = {
  url: string;
  url_hash: string;
  title: string | null;
  content: string;
  images: { url: string; alt: string | null }[];
  source: 'cheerio' | 'paste';
  host: string;
  /**
   * 内容载体（Agent I 增）：
   *   text  = 文字博文（默认，老适配器都填这个）
   *   video = 视频博主，content 实际是字幕/简介合并
   *   mixed = 既有文字也有视频
   * 历史数据可能不带这个字段，消费方需用 `?? 'text'` 兜底。
   */
  medium?: 'text' | 'video' | 'mixed';
  /** Apify 抓取专属：本次 run 的 ID 与计费（USD），用于前端 toast 展示 */
  apify_run_id?: string;
  apify_cost_usd?: number;
  apify_platform?: string; // 'zhihu' | 'bilibili' | 'wechat' | 'xiaohongshu'
};

export type CrawlError = {
  reason: 'wechat' | 'timeout' | 'blocked' | 'not-found' | 'unsupported' | 'parse-failed';
  message: string;
};

export type CrawledAuthorIndex = {
  author_name: string | null;
  platform: string;
  article_urls: string[];
};

export type UrlTypeInfo = {
  platform: string;
  is_wechat: boolean;
  is_supported_for_crawl: boolean;
  hint: string | null;
  /** Agent I 新增：识别到的内容载体（前端可据此区分视频/文字 UI）。 */
  medium?: 'text' | 'video' | 'mixed';
};

/** 站点适配器接口：每个站点一个文件，统一在 lib/crawler/index.ts 路由。 */
export interface SiteAdapter {
  /** 站点 id，用于日志与 STATUS。 */
  id: string;
  /** 平台中文名（"知乎" / "少数派" 等）。 */
  platform: string;
  /** 判断该 URL 是否属于本适配器。 */
  matches(url: URL): boolean;
  /** 抓取单篇文章。 */
  crawlArticle(url: URL): Promise<CrawledArticle | CrawlError>;
  /** 抓取作者文章列表（可选）。 */
  crawlAuthorIndex?(url: URL): Promise<CrawledAuthorIndex | CrawlError>;
  /**
   * 判断 URL 形态（可选）。返回 'article' = 文章详情页；'index' = 主页/板块页/作者页；
   * 'unknown' = 形态不明（调用方按各自策略兜底）。
   * 不实现时调用方会用启发式：含 .html 末尾 / `/post/<num>` / `/p/<num>` 等 → article；否则 index。
   */
  urlKind?(url: URL): 'article' | 'index' | 'unknown';
}

/** CrawlError 类型守卫。 */
export function isCrawlError(x: CrawledArticle | CrawledAuthorIndex | CrawlError): x is CrawlError {
  return (x as CrawlError).reason !== undefined && typeof (x as CrawlError).message === 'string';
}
