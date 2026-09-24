# STATUS-I · 博主名搜索 + B站/YouTube 适配器

`npm run build` 0 error；新增 `/api/search-authors` 路由已注册。

## 搜索引擎实测（DuckDuckGo，无 Google CSE key）
- 「半佛仙人」→ **10 个候选**，平台分布：知乎×5 / B站×3 / YouTube×2，conf 全 1.00
- 「老蒋巨靠谱」→ **10 个候选**，平台分布：知乎×3 / B站×4 / YouTube×3
- 「沈帅波」→ **0 个候选**（DDG 限定 7 站结果集为空，给 no-results 温暖错误；该博主主要在公众号，符合预期）
- 「公众号 xxx」query → 直接 wechat-only 短路，引导用户走正文模式

## B 站爬虫
- 视频抓取 OK（BV1Hx411E7vS 罗翔说刑法）：标题/简介/封面/UP 主头像，105 字 content，2 张图，medium='video'
- 字幕通路代码完整（chooseSubtitle 中文 > 自动 > 任意，mergeSubtitleLines 按时间间隔分段），但抽样视频用户未上传字幕，文案兜底为「（此视频未提供字幕，仅含标题和简介）」
- UP 主主页 wbi 新接口 412（无签名），降级到 `/x/space/arc/search` 仍触发 -799 风控；已加 buvid cookie 预热兜底（_cookieCache），但风控仍生效——返回温暖 `blocked` 提示
  - 不引入 wbi 签名依赖；按需求约束接受现状

## YouTube
- 无 `YOUTUBE_DATA_API_KEY` 时，`crawlArticle` / `crawlAuthorIndex` 都返回 `{ reason: 'unsupported', message: '...到 https://console.cloud.google.com 申请...' }`
- `.env.local.example` 增加了 `YOUTUBE_DATA_API_KEY=` 与 `GOOGLE_CSE_KEY/ID=` 占位

## AuthorSearch 集成（不破坏 H 的页面）
- `app/fingerprints/new/page.tsx` 仅 2 处改动：
  - 第 7 行 `import { AuthorSearch } from '@/components/fingerprints/AuthorSearch';`
  - 在 `<section className="intake-form">` 之前插入 `<AuthorSearch ...>`（约第 396 行），传入 `onArticleUrlsSelected` / `onAuthorNameDetected`
- 新增 `handleSearchedUrls` 回调：从前往后找空 URL 卡灌入，必要时 push 新卡（不超 MAX_ARTICLES）
- `/api/crawl-preview` 扩展支持 `mode: 'index'`，复用 `crawlAuthorIndex`

## 类型/DB 扩展
- `CrawledArticle.medium?` + `UrlTypeInfo.medium?` 字段（可选，兼容老数据）
- `lib/crawler/index.ts` 加 bilibili/youtube adapter；`attachMedium` 自动补 medium
- `lib/schema-additions.sql` 加 `medium TEXT DEFAULT 'text'`；`lib/db.ts` 启动时 `ensureCrawledArticlesMediumColumn` 幂等 ALTER
