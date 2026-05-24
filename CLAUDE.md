# AutoArticle · 项目构造记录

> 写给下一个 Claude 看。也写给楠几周后回来看。
> 最后更新：2026-05-24

## 这是什么

本地 Next.js Web 应用。用户给一段思路（题材 + 角度 + 核心观点）+ 选一个博主风格指纹 + 选一个平台画像 → 流式生成有深度的成品文。

**关键约束（违反会被楠纠正）**：

- ✅ 走本机 Claude Code CLI（child_process）—— **不接 Anthropic API、不带 key、不联网调 LLM**
- ✅ 数据全留本机 SQLite —— **不上云、不做 SaaS**
- ❌ **公众号不直接爬**（反爬强）—— 走 Apify 或手贴
- ❌ **不给抖音/小红书账号**（封号风险）
- ❌ **文章正文严禁 emoji 和装饰符号**（写作工具气质要"克制"）
- ❌ **不要做自定义颜色调节器**——只允许选默认主题
- ✅ 文案语气**陪伴而非审判**："这次模型卡住了，我们换个角度再试一次" 不要 "生成失败"

---

## 架构分层（L1–L5，硬规定）

```
L1 Page         app/**/page.tsx          一个 page.tsx = 一个路由 = 一个 URL
L2 Component    components/<group>/*.tsx 单独可见的 UI 元素
L3 Hook         hooks/*.ts               跨组件复用的能力（流式、剪贴板等）
L4 Store        stores/*.ts              全局共享的临时状态（Zustand）
L5 Lib          lib/*.ts                 通用工具，纯函数（日期、文本统计、爬虫等）
```

**改某一层不要动另一层**。Page 不能直接写 fetch 逻辑——抽 Hook；Lib 不能 import React——是纯工具；Store 不放服务端拉的数据，那是 TanStack Query 的活。

---

## Web 路由表（page.tsx）

| URL | 文件 | 职责 |
|---|---|---|
| `/` | [app/page.tsx](app/page.tsx) | 工作台 · Hero + 推荐选题 + 最近指纹 + 日常入口 |
| `/compose` | [app/compose/page.tsx](app/compose/page.tsx) | 7 步生成流程（题材→指纹→平台→生成→预览→排版） |
| `/fingerprints` | [app/fingerprints/page.tsx](app/fingerprints/page.tsx) | 已拆解博主列表 |
| `/fingerprints/new` | [app/fingerprints/new/page.tsx](app/fingerprints/new/page.tsx) | **新博主拆解**——粘 3-5 篇文章一键拆 |
| `/fingerprints/[id]` | [app/fingerprints/[id]/page.tsx](app/fingerprints/[id]/page.tsx) | 单个指纹详情（雷达 + 平台分组 + 策略碎片） |
| `/authors` | [app/authors/page.tsx](app/authors/page.tsx) | 博主搜索/选择面板 |
| `/authors/[id]` | [app/authors/[id]/page.tsx](app/authors/[id]/page.tsx) | 博主多平台对比 4-tab |
| `/authors/[id]/optimize` | [app/authors/[id]/optimize/page.tsx](app/authors/[id]/optimize/page.tsx) | 跨平台改写优化 |
| `/sites` `/sites/[id]` `/sites/new` | [app/sites/](app/sites/) | 站点 × 板块 × 编辑画像 |
| `/topics` | [app/topics/page.tsx](app/topics/page.tsx) | 选题中心（风格推荐 + 热点聚合两 tab） |
| `/articles` `/articles/[id]` | [app/articles/](app/articles/) | 历史文章 |
| `/settings/preferences` | [app/settings/preferences/page.tsx](app/settings/preferences/page.tsx) | 默认主题 + **Apify token 管理** |

## API 路由表（route.ts）

| 端点 | 文件 | 职责 |
|---|---|---|
| `POST /api/crawl-preview` | [app/api/crawl-preview/route.ts](app/api/crawl-preview/route.ts) | 单 URL 试爬，返回 title+preview+`apify_cost_usd` |
| `POST /api/search-authors` | [app/api/search-authors/route.ts](app/api/search-authors/route.ts) | 博主名搜索（DDG / Google CSE） |
| `POST /api/fingerprint/v3` | [app/api/fingerprint/v3/route.ts](app/api/fingerprint/v3/route.ts) | **指纹拆解 v3**（多 agent 并行 + 跨平台报告，当前主版本） |
| `POST /api/fingerprint/v2` | [app/api/fingerprint/v2/route.ts](app/api/fingerprint/v2/route.ts) | v2 拆解（保留兼容） |
| `POST /api/fingerprint` | [app/api/fingerprint/route.ts](app/api/fingerprint/route.ts) | v1 拆解（最老的版本，单调用） |
| `POST /api/compose/outline` | [app/api/compose/outline/route.ts](app/api/compose/outline/route.ts) | 题材 → 大纲（流式） |
| `POST /api/compose/draft` | [app/api/compose/draft/route.ts](app/api/compose/draft/route.ts) | 大纲 → 正文（流式 SSE） |
| `POST /api/compose/refine` | [app/api/compose/refine/route.ts](app/api/compose/refine/route.ts) | 正文润色 |
| `GET /api/topics/recommend` | [app/api/topics/recommend/route.ts](app/api/topics/recommend/route.ts) | 风格推荐选题 |
| `GET /api/topics/trending` | [app/api/topics/trending/route.ts](app/api/topics/trending/route.ts) | 热点聚合选题 |
| `GET/POST/PATCH /api/sites` | [app/api/sites/](app/api/sites/) | 站点画像 CRUD |
| `GET/POST /api/articles/[id]` | [app/api/articles/[id]/route.ts](app/api/articles/[id]/route.ts) | 历史文章 |
| `GET/POST /api/images/auto` | [app/api/images/auto/route.ts](app/api/images/auto/route.ts) | 自动配图（本地素材库优先 + Unsplash 补） |
| `GET /api/apify/usage` | [app/api/apify/usage/route.ts](app/api/apify/usage/route.ts) | Apify 余额 + 最近 20 run（前端 status pill 用） |
| `GET/PATCH /api/settings` | [app/api/settings/route.ts](app/api/settings/route.ts) | 偏好设置（`default_theme` / `apify_token` 白名单） |

---

## 关键模块（lib/）

| 路径 | 职责 | 注意事项 |
|---|---|---|
| [lib/db.ts](lib/db.ts) | SQLite 单例 + 各表幂等扩展（PRAGMA + ALTER） | **加新字段必须用 `ensureXxxColumn(db)` 形式幂等扩**，不能直接改 schema.sql |
| [lib/claude.ts](lib/claude.ts) | `child_process.spawn('claude', ['-p'])` + stdin 灌 prompt + 180s 超时 + ENOENT fallback `/Users/nan/.npm-global/bin/claude` | 整个生成流的命脉 |
| [lib/sse.ts](lib/sse.ts) | SSE 编码工具（fetch + ReadableStream，**不用 EventSource**） | 流式输出走这个 |
| [lib/composition.ts](lib/composition.ts) | 文章排版（3 平台 layout：standard/lively/minimal） | 公众号 HTML / 知乎 Markdown / 通用 |
| [lib/platforms.ts](lib/platforms.ts) | 平台元数据（公众号/知乎/B站/小红书/抖音/优设/少数派/YouTube/简书/Medium） | URL 识别、媒介分类 |
| [lib/crawler/](lib/crawler/) | 多站点爬虫 | 详见下面 |
| [lib/apify/usage.ts](lib/apify/usage.ts) | Apify 账户/余额/recent runs 统一查询 | `ACTOR_ID_TO_LABEL` 映射 actor ID → 中文标签 |
| [lib/search/](lib/search/) | 博主名搜索（DDG HTML / Google CSE） | `assessRisk` 判定平台是否反爬 |
| [lib/prompts/](lib/prompts/) | Claude prompt 模板 | 改 prompt 走这 |
| [lib/images/](lib/images/) | 本地素材库扫描 + Unsplash 适配 | |
| [lib/fingerprint-queries.ts](lib/fingerprint-queries.ts) | 指纹 DB 查询 | |
| [lib/format-cost.ts](lib/format-cost.ts) | `formatUsd(n)`：<1 三位小数 / ≥1 两位 | Apify 用量显示统一走这个 |
| [lib/compose-schema.ts](lib/compose-schema.ts) | 生成流程的 Zod schema | |

## 爬虫结构（lib/crawler/）

```
lib/crawler/
├── index.ts          路由入口：detectUrlType / crawlArticle / crawlAuthorIndex
├── types.ts          CrawledArticle / CrawlError / SiteAdapter 接口
├── apify.ts          Apify HTTP 客户端 + 4 平台 Actor 调用（核心）
├── wechat.ts         公众号专属（走 Apify，否则 wechatRejection）
├── http.ts           got 封装 + UA
├── html.ts           cheerio 通用提取
├── dedupe.ts         url 归一化 + 哈希
└── adapters/
    ├── zhihu.ts          知乎（优先 Apify，回退 cheerio）
    ├── bilibili.ts       B 站（优先 Apify zhorex，回退原生 b 站 API）
    ├── xiaohongshu.ts    小红书（仅 Apify）
    ├── sspai.ts          少数派（纯本地爬）
    ├── uisdc.ts          优设（纯本地爬）
    ├── youtube.ts        YouTube（需 YOUTUBE_DATA_API_KEY）
    └── generic.ts        通用兜底（Readability + cheerio）
```

**每个 adapter 实现 `SiteAdapter` 接口**（matches/crawlArticle/crawlAuthorIndex）。注册在 [lib/crawler/index.ts](lib/crawler/index.ts) 的 `SPECIFIC_ADAPTERS` 数组里。

---

## DB 表结构（data/autoarticle.db）

| 表 | 来自 schema 文件 | 职责 |
|---|---|---|
| `authors` | schema.sql | 博主基本信息（姓名、平台、来源） |
| `fingerprints` | schema.sql + ALTER 扩 v3 列 | 风格指纹（v1/v2/v3 共存，看 `version_schema` 列） |
| `strategies` | schema-additions-strategies.sql | v2/v3 拆出的策略碎片 |
| `crawled_articles` | schema-additions.sql | 已爬过的文章正文（含 url_hash 去重） |
| `local_assets` | schema-additions-images.sql | 本地素材库（247 张配图扫描） |
| `article_images` | schema-additions-images.sql | 文章 ↔ 图片关联 |
| `articles` | schema-additions-compose.sql | 生成过的文章历史 |
| `sites` | schema-additions-sites.sql | 站点 × 板块 × 编辑画像（树状） |
| `settings` | schema-additions-settings.sql | k/v 偏好（`default_theme`, `apify_token`） |

**幂等扩列**：`lib/db.ts` 启动时跑 `ensureFingerprintV3Columns` / `ensureStrategyV3Columns` / `ensureCrawledArticlesMediumColumn`。要加新字段照葫芦画瓢，**别去改 schema.sql 顶层**（老数据库会冲突）。

---

## 关键决策的「为什么」（避免重蹈覆辙）

### 1. 为什么不接 Anthropic API，走本机 Claude CLI？
楠没付 API key 钱，但订阅了 Claude Pro。`claude -p "<prompt>"` 通过本机订阅算费用。代价：要 spawn 子进程 + 流式接 stdout + 180s 超时管理。代码在 [lib/claude.ts](lib/claude.ts)。  
**不要换成 @anthropic-ai/sdk**——会变成 SaaS 模式且让楠付双份钱。

### 2. 为什么公众号默认不爬？
公众号反爬极强，普通 fetch 触发 captcha。**已知唯一可用方案是 Apify 的 sian.agency/wechat-official-accounts-scraper，但单篇 $0.53**（FREE 用户 $0.14 startup + $0.39/item）。所以默认 [lib/crawler/wechat.ts](lib/crawler/wechat.ts) 走 Apify（如果有 token），否则返回 wechatRejection（"请粘贴正文"）。

### 3. 为什么 Apify B 站换成 zhorex？
2026-05-24 楠拆解时被扣 $4.91/$5。复盘发现 sian.agency 系列对 FREE 用户收 $0.14 startup + $0.09-0.39/item，单 run $0.23-0.53。**zhorex/bilibili-scraper 只 $0.005/item 且无 startup**——便宜 50×。  
**保留 sian.agency** 在知乎和公众号——因为这两个**市面上找不到便宜替代**（搜遍 Apify Store + Bright Data/FireCrawl/Browserbase/Scrapfly 都没有中文 ready-made scraper）。

### 4. 为什么不接 FireCrawl / Browserbase / Bright Data？
全调研过（2026-05-24）：
- FireCrawl 看着便宜（$16/月 5000 页）但**知乎 403 / 公众号 captcha / 小红书反爬都打不过**，命中率太低
- Browserbase 是底层 Chromium，**没有中文 ready-made scraper**，你要自己写
- Bright Data 调研 agent 给的"有小红书 scraper"是幻觉（实际 [brightdata.com/products/web-scraper/xiaohongshu](https://brightdata.com/products/web-scraper/xiaohongshu) 404）
- **结论**：要中文平台 ready-made scraper，市面上**只有 Apify 一家**。这是 Apify 价格贵的原因，也是无可奈何的现实

### 5. 为什么 SQLite 而不是 Postgres？
本地工具，单用户，零运维。better-sqlite3 同步 API 速度极快。**不要换 Postgres**。

### 6. 为什么不用 Ant Design / MUI？
楠要"克制 + 书卷气"，用 Tailwind 手写组件 + CSS variables 做三主题切换（B/C/D）。**不要引 UI 库**。

### 7. 为什么有 v1 / v2 / v3 三套指纹拆解？
迭代痕迹：
- v1 单次 Claude 调用，拆 12 维（最老）
- v2 加跨篇综合 + strategies 表
- v3 多 agent 并行 + 平台分组 + 跨平台对比报告（**当前主版本**）

UI 默认走 v3。v1/v2 的代码不要删——老指纹用 `version_schema` 字段判断版本，dispatcher 在 [app/fingerprints/[id]/page.tsx](app/fingerprints/[id]/page.tsx) 里。

### 8. 为什么 Apify token 同时在 .env.local 和 settings 表？
`lib/crawler/apify.ts:getApifyToken()` 先看 DB 再看 env。**DB 优先**让用户能在 UI 上即改即生效。env 是部署 / fallback 兜底。

### 9. 主题切换为什么不能贴边？
楠的明确审美：主题切换器**必须收在导航栏下拉里**，不能在右下角悬浮。[components/theme/ThemeSwitcher.tsx](components/theme/ThemeSwitcher.tsx) 已挂在 HomeNav 里。

### 10. 为什么所有的运行时是 nodejs 不是 edge？
better-sqlite3 是原生模块，跑不了 edge runtime。**每个 route.ts 顶部都要写 `export const runtime = 'nodejs'`**。

---

## 未完成事项 / 已知坑

### Apify 相关
- ⚠️ **本月额度已 $4.91/$5**，6 月 1 号才重置。继续测试**需要楠充值**或等月底
- ⚠️ env 里 `APIFY_TOKEN` 已注释（[autoarticle/.env.local](.env.local)）——重启用需 uncomment 或在 [/settings/preferences](http://localhost:3100/settings/preferences) 重填
- 🟡 `lib/crawler/apify.ts` 里 `fetchBilibiliCaption` 是 **deprecated stub** 直接返 null。新的 zhorex actor 在 video_detail mode 同时返字幕，不再需要单独调
- 🟡 `estimateActorCost` 是"sync 接口 usageTotalUsd=0 时的预估"——真实 cost 会在 status pill 60s 轮询时显示准确值

### 未接通的 UX
- 🟡 `fetchBilibiliVideosBatch` 和 `fetchXiaohongshuPostsBatch` 函数写好了但**没接到 UI**。fingerprint/new 还是逐条试爬。要加"一键批量抓"得改 [app/fingerprints/new/page.tsx](app/fingerprints/new/page.tsx)
- 🟡 知乎/公众号目前**单条调用**，没有批量节省策略（这两个 actor schema 不支持多 ID 输入，且单价高，必须省着用）
- 🟡 小红书的 search/profile 在 easyapi actor 上返空数组（评分 1.3/5），所以全切到 zhorex/rednote-xiaohongshu-scraper

### 还在写的功能
- 🟡 `/topics` 选题中心的"热点聚合"tab 是 mock 数据（[app/topics/page.tsx](app/topics/page.tsx)）—— Claude 真调还没接
- 🟡 配图自动打标的 Claude 调用尚未接（[lib/images/](lib/images/) 只扫描，未分类）
- 🟡 跨平台改写 [app/authors/[id]/optimize/page.tsx](app/authors/[id]/optimize/page.tsx) 走 v3 的 cross_platform_report，UI 完成度约 70%

### 已知非阻塞问题
- 🟡 dev server 跑着时**不要跑 `npm run build`**——会污染 `.next/` 导致老 dev 进程 ENOENT chunk。要 build 先 kill dev
- 🟡 `data/autoarticle.db-wal` 跟 SQLite WAL 模式有关，**别手动删**——会丢未 checkpoint 的数据。要重置 db 整个 data/ 目录一起删
- 🟡 公众号 URL 含 `#rd` hash 时，url_hash 去重要先 normalize 掉

---

## 环境启动与紧急手册

### 启动
**双击桌面** `~/Desktop/AutoArticle.command`（已配 chmod +x）。脚本会：
1. 检测端口 3100 是否被占（被占就让你选用旧的 / 杀掉重启 / 退出）
2. 检测 Node / Claude CLI / Apify token / 数据库 / node_modules
3. `npm run dev -- -p 3100` 起服务
4. 服务就绪后自动开浏览器到 http://localhost:3100

或者手动：
```bash
cd /Users/nan/ai资料合集/项目合集/公众号/autoarticle
npm run dev -- -p 3100
```

### 环境变量（`.env.local`）

```bash
UNSPLASH_ACCESS_KEY=       # 可选，免费图库
YOUTUBE_DATA_API_KEY=      # 可选，YouTube 字幕
GOOGLE_CSE_KEY=            # 可选，博主搜索更精准（不填走 DDG）
GOOGLE_CSE_ID=
APIFY_TOKEN=               # **当前已注释**，要用需重启用
```

### 必备外部工具

| 工具 | 路径 | 用途 |
|---|---|---|
| Claude CLI | `/Users/nan/.npm-global/bin/claude` | 生成文章命脉，没有等于工具瘫痪 |
| Node.js | `node --version` ≥ 18 | Next.js 运行时 |
| SQLite3 | 系统自带 | DB 检查（启动脚本要用） |

### 紧急情况手册

**dev 起不来 / 卡在 ENOENT chunk 错误**：
```bash
cd /Users/nan/ai资料合集/项目合集/公众号/autoarticle
pkill -9 -f "next-server"          # 杀掉所有 next 进程
rm -rf .next                       # 清编译缓存
nohup npm run dev -- -p 3100 &     # 重启
disown
```

**Apify 余额报警 / 突然扣钱**：
1. 立刻把 [autoarticle/.env.local](.env.local) 里 `APIFY_TOKEN=` 那行加 `#` 注释
2. 在 [/settings/preferences](http://localhost:3100/settings/preferences) 把 DB 里的 token 也清空（PATCH 已支持空字符串）
3. 检查 [/api/apify/usage](http://localhost:3100/api/apify/usage) 返回 `enabled: false`
4. 看是哪个 actor 烧钱：[console.apify.com/actor-runs](https://console.apify.com/actor-runs) 按 cost 倒序

**指纹拆出来质量太差**：
1. 看 [lib/prompts/](lib/prompts/) 里对应 prompt 模板
2. 检查 [app/api/fingerprint/v3/route.ts](app/api/fingerprint/v3/route.ts) 是否 3 个 agent 全跑成功
3. 数据库 `SELECT * FROM fingerprints WHERE id = ?` 看原始 JSON

**SQLite 文件锁死**：
```bash
fuser data/autoarticle.db          # 找哪个进程在锁
# 通常是没 close 干净的旧 dev，pkill 之
```

### 测试

```bash
npx tsc --noEmit                   # 类型检查（核心 gate）
npx vitest run                     # 关键路径单测（少，但有）
```

**不要跑 dev 时跑 build**——dev 和 build 共用 `.next/` 会冲突。

### Git

仓库在 `autoarticle/` 一层（不在外层"公众号/"），main 分支。当前没有 remote。要 push：
```bash
gh repo create autoarticle --private --source=. --push
```

---

## 给下次的你

1. **改之前先读这个文档 + 跑 `git log --oneline -20`** 看最近改了啥
2. **多 agent 并行做独立任务**是楠确认过的偏好——不要等楠让你才并行
3. **决策点用 AskUserQuestion 摆卡片**，不要在 chat 里列编号问题
4. **称呼楠**——每条消息开头叫"楠"
5. **写代码前先想 cost**——Apify 烧钱过历史，加 Apify 调用前要算 per-run 成本
6. **改 schema 用 ALTER 幂等**——不要碰 schema.sql 顶层
7. **STATUS-*.md 是旧 agent 的工作记录**——读不读看时间够不够，不必每次都翻
