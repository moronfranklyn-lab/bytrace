# 笔迹 ByTrace · API 契约

> 版本：v1.0 · 更新：2026-06-30
> 对应代码：笔迹 ByTrace 写作引擎

## 0. 怎么读这份文档

1. **先看 §1 端点索引表**定位你要找的路由，再跳到对应章节看细节。
2. **§2–§9 每个路由一节**，结构固定：方法 / 请求 / 响应 / 错误 / 运行时常量。
3. **§10 是 SSE 事件总表**（所有流式路由的事件名 → payload → 触发时机），做前端接线时直接查这一节最快。
4. **附录「实现约定与注意事项」**汇总跨路由的公共约定与维护时必须知道的约束，改动相关代码前建议先扫一遍。

### 通用约定（本文档覆盖的 34 个路由一致，除特别注明）

| 约定 | 事实 |
|---|---|
| 运行时 | **每个** route 文件都声明 `export const runtime = 'nodejs'`。原因：better-sqlite3 原生模块 + `child_process.spawn` 依赖 Node API，不能在 edge 跑。 |
| 动态渲染 | **每个** route 文件都声明 `export const dynamic = 'force-dynamic'`（SSE 与数据库读写都不能被缓存）。 |
| `maxDuration` | 仅 `app/api/tag-assets/route.ts` 声明 `export const maxDuration = 300`。其余 31 个**没有**声明。 |
| 错误形状 | 绝大多数 JSON 路由返回 `{ error: string }`（配 `status`）。**有明确例外**，见本节下方「错误形状例外表」。 |
| SSE 编码 | `event: <name>\ndata: <JSON.stringify(data)>\n\n`。前端用 `fetch` + `ReadableStream` 读，**不用 `EventSource`**。 |
| SSE 心跳 | `: heartbeat\n\n`。**仅** `lib/sse.ts` 的 `createSseStream()` 提供：`setInterval` 每 **10s** 检查一次，仅当距上次任何输出已超过 **15s** 时才发。手写流的 6 个路由**没有心跳**。 |
| SSE 终局事件 | `createSseStream()` 在 `finally` 里一定 `close()`；若 handler 抛出且未被内部捕获，会补发 `error { message, phase: 'unknown' }`。手写流路由各自管理终止，**不保证**这条兜底。 |
| 栈信息 | 正常不泄漏堆栈：只回 `(err as Error).message`。**例外**：`/api/scan-assets` 的 500 会带 `stack` 字段；`/api/compose/draft` 只把 stack 打到服务端 console 而不回传。 |
| 命名风格 | 响应 JSON 的 key 一律 `snake_case`。 |
| 数据库 | 全部走 `lib/db.ts` 的 `getDb()` 单例（better-sqlite3，同步 API）。 |
| 模型调用 | 全部走 `lib/claude.ts` 的 `streamClaude()`（本机 Claude Code CLI 订阅，不接 Anthropic API）。 |

#### 错误形状例外表（不是 `{ error: string }` 的路由）

| 路由 | 实际形状 | 说明 |
|---|---|---|
| `GET /api/search-authors` | `{ ok: false, reason, message }` | 2xx 返回业务失败；仅 `q` 为空时 400。 |
| `POST /api/crawl-preview` | `{ ok: false, platform, reason, hint }` | **HTTP 200**；只有「请求体非法 / URL 为空」才用 `{ error }`。 |
| `POST /api/assets/scan` | `{ ok: false, root, error, allowed_roots }` | 403 白名单拒绝。 |
| `GET /api/assets/file` | **纯文本** `missing id` / `not found` / `file missing on disk` | 二进制流端点，不走 JSON。 |
| `POST/GET /api/images/auto`、`GET /api/images/search` | `{ ok: true/false, ... }` | `ok:false` 时同时带 `error` 字段。 |
| `POST /api/scan-assets` | `{ ok: false, error, stack }` | 500。 |
| `POST /api/tag-assets` | `{ ok: true, ... }` | 无失败分支（单图失败记在 `results[i].success`）。 |
| `DELETE /api/articles/[id]` | `{ ok: false, message, detail }` | 404 / 500。 |
| `PATCH /api/fingerprint/v3/[id]` | 报告对象 + `error` 字段 | 502 / 409 时是「业务报告 + error」，不是裸 error。 |

---

## 1. 端点索引表

> 「流式」列：`SSE(helper)` = 走 `lib/sse.ts` 的 `createSseStream`（有心跳 + 终局兜底）；`SSE(手写)` = 路由内自建 `ReadableStream`（无心跳）；`—` = 普通 JSON 响应。

| Method | Path | 源文件 | 流式 | 一句话用途 |
|---|---|---|---|---|
| POST | `/api/fingerprint` | `app/api/fingerprint/route.ts` | SSE(手写) | 指纹拆解 v1：单次 Claude 调用拆 12 维，3–10 篇样本 |
| POST | `/api/fingerprint/v2` | `app/api/fingerprint/v2/route.ts` | SSE(手写) | 指纹拆解 v2：逐篇 stage1（并发 3）+ 跨篇 stage2，5–12 篇，支持 URL/粘贴 |
| POST | `/api/fingerprint/v3` | `app/api/fingerprint/v3/route.ts` | SSE(手写) | 指纹拆解 v3（主版本）：Stage 0 分类 + Stage 1 并发 + Stage 2 综合 + Stage 3 跨平台 + 类别配方，2–20 篇 |
| PATCH | `/api/fingerprint/v3/[id]` | `app/api/fingerprint/v3/[id]/route.ts` | — | 加样本重提炼 / `force_rerun` 原库重跑（**非流式**） |
| DELETE | `/api/fingerprint/v3/[id]` | `app/api/fingerprint/v3/[id]/route.ts` | — | 级联删除指纹 4 张附属表 + 孤儿 author |
| GET | `/api/fingerprints/names` | `app/api/fingerprints/names/route.ts` | — | 按 `ids` 批量把 fingerprint_id 还原成 `{author_name, platform}` |
| PATCH | `/api/authors/[id]` | `app/api/authors/[id]/route.ts` | — | 改博主名 / 平台，改名同步重算 `avatar_emoji` |
| POST | `/api/authors/[id]/optimize` | `app/api/authors/[id]/optimize/route.ts` | SSE(手写) | 在现有指纹上追加 1–10 篇样本，产出 v(N+1)；**v3 指纹被 409 拦截** |
| POST | `/api/recommend` | `app/api/recommend/route.ts` | SSE(helper) | 按题材从指纹库推荐博主组合 |
| POST | `/api/compose/outline` | `app/api/compose/outline/route.ts` | SSE(helper) | 题材 → 大纲（可注入站点画像 / 素材包） |
| POST | `/api/compose/gather` | `app/api/compose/gather/route.ts` | SSE(helper) | 联网搜集「事实底座」素材包，按 `idea_hash` 幂等缓存 |
| POST | `/api/compose/draft` | `app/api/compose/draft/route.ts` | SSE(helper) | 大纲 → 正文；多平台串行 + critic reflection loop + 落库 |
| POST | `/api/compose/refine` | `app/api/compose/refine/route.ts` | SSE(helper) | 正文跨平台润色，结果追加进 `refine_versions_json` |
| GET | `/api/sites` | `app/api/sites/route.ts` | — | 站点画像列表 |
| POST | `/api/sites` | `app/api/sites/route.ts` | — | 新建站点画像（爬列表 → 抓样本 → 提画像） |
| GET | `/api/sites/[id]` | `app/api/sites/[id]/route.ts` | — | 站点画像详情 |
| PATCH | `/api/sites/[id]` | `app/api/sites/[id]/route.ts` | — | `recrawl` / `paste` 加样本并重提炼 |
| DELETE | `/api/sites/[id]` | `app/api/sites/[id]/route.ts` | — | 删站点画像 + 关联 `site_articles` |
| GET | `/api/sites/picker` | `app/api/sites/picker/route.ts` | — | compose Step 1 卡片列表：站点卡 + 通用平台卡 |
| GET | `/api/recipes` | `app/api/recipes/route.ts` | — | 风格配方列表（可按 platform / site_id 过滤） |
| POST | `/api/recipes` | `app/api/recipes/route.ts` | — | 新建风格配方（1–30 个碎片） |
| GET | `/api/recipes/[id]` | `app/api/recipes/[id]/route.ts` | — | 配方详情，`fragment_ids` 反查成完整碎片对象 |
| PATCH | `/api/recipes/[id]` | `app/api/recipes/[id]/route.ts` | — | 改配方名 / 碎片 / notes（**platform_key 不可改**） |
| DELETE | `/api/recipes/[id]` | `app/api/recipes/[id]/route.ts` | — | 删配方（碎片不动） |
| GET | `/api/strategies/search` | `app/api/strategies/search/route.ts` | — | 跨博主策略碎片检索（category / tag / platform） |
| GET | `/api/topics/recommend` | `app/api/topics/recommend/route.ts` | SSE(手写) | 按指纹库风格推荐选题 |
| GET | `/api/topics/trending` | `app/api/topics/trending/route.ts` | SSE(手写) | 从 `crawled_articles` TF-IDF 聚关键词 → Claude 出趋势题 |
| GET | `/api/articles/[id]` | `app/api/articles/[id]/route.ts` | — | 历史文章详情 + composition/outline/关联指纹碎片 |
| DELETE | `/api/articles/[id]` | `app/api/articles/[id]/route.ts` | — | 删文章 + 清 `article_diffs` / `critic_runs` 孤儿行 |
| POST | `/api/articles/[id]/diff` | `app/api/articles/[id]/diff/route.ts` | — | from→to 平台版本差异摘要，`article_diffs` 表按 hash 缓存 |
| POST | `/api/images/auto` | `app/api/images/auto/route.ts` | — | 自动配图：Claude 出图意 slot → 本地素材库 + Unsplash 找候选 |
| GET | `/api/images/search` | `app/api/images/search/route.ts` | — | 手动混合搜图（本地 + Unsplash） |
| POST | `/api/assets/scan` | `app/api/assets/scan/route.ts` | — | 扫描素材目录入库（**有 root 白名单**） |
| GET | `/api/assets/scan` | `app/api/assets/scan/route.ts` | — | 查当前素材库总数 + 默认根目录 |
| GET | `/api/assets/file` | `app/api/assets/file/route.ts` | — | 按 `local_assets.id` 流式读图（不接受路径，防任意文件读） |
| POST | `/api/scan-assets` | `app/api/scan-assets/route.ts` | — | 扫描指定目录入库（**无白名单**，见附录 · 附.2） |
| POST | `/api/tag-assets` | `app/api/tag-assets/route.ts` | — | 批量 Claude 视觉打标（串行，`maxDuration=300`） |
| GET | `/api/settings` | `app/api/settings/route.ts` | — | 列出全部 k/v 设置 |
| PATCH | `/api/settings` | `app/api/settings/route.ts` | — | 写设置（白名单仅 `default_theme`） |
| POST | `/api/crawl-preview` | `app/api/crawl-preview/route.ts` | — | 单 URL 试爬 / 拉作者文章列表 |
| GET | `/api/search-authors` | `app/api/search-authors/route.ts` | — | 博主名搜索（DDG / Google CSE） |
| POST | `/api/import/wechat-draft` | `app/api/import/wechat-draft/route.ts` | — | 公众号草稿箱草稿导入为历史文章 |
| GET | `/api/health` | `app/api/health/route.ts` | — | 运行自检：各任务组配置状态 + 数据库连通性（只报有无，不回显密钥） |
| GET | `/api/health/search` | `app/api/health/search/route.ts` | — | 联网搜索联通性实测：逐通道回报命中数 / 耗时 / 失败原因 |

---

## 2. 指纹拆解

### 2.1 `POST /api/fingerprint`（v1）

源文件：`app/api/fingerprint/route.ts` · 导出函数：`POST` · 流式：SSE(手写)

#### 请求

```ts
interface IncomingArticle {
  title?: string;
  content?: string;
}
interface IncomingPayload {
  author_name?: string;
  platform?: string;
  articles?: IncomingArticle[];
}
```

| 字段 | 必填 | 默认 | 校验 / 说明 |
|---|---|---|---|
| `author_name` | ✅ | — | `trim()` 后非空，否则 400 `博主名不能为空` |
| `platform` | ❌ | `null` | 仅 `trim()`；**无白名单**，空串 → `null` |
| `articles` | ✅ | `[]` | 数组长度必须 `3 ≤ n ≤ 10`（`MIN_ARTICLES=3`, `MAX_ARTICLES=10`） |
| `articles[i].title` | ❌ | `undefined` | `trim()` 后为空则落 `undefined` |
| `articles[i].content` | ✅ | — | `trim()` 后 ≥ **100** 字（`MIN_CONTENT_CHARS`），否则报错并**中止整个请求** |

模块级常量：`MIN_ARTICLES = 3`、`MAX_ARTICLES = 10`、`MIN_CONTENT_CHARS = 100`。

#### 响应（SSE，按代码可发射顺序）

| # | event | data | 触发时机 |
|---|---|---|---|
| 1 | `open` | `{ ok: true }` | 进入流后立刻发，确认通道连通 |
| 2 | `chunk` | `{ text }` | `streamClaude` 的每个增量片段 |
| 3 | `error` | `{ message, phase: 'claude' }` | Claude 调用抛错（`message` 兜底 `'模型那边没回来'`） |
| 3' | `error` | `{ message: '模型输出了一段不太像 JSON 的东西，再试一次大概率就好', phase: 'parse', detail, sample }` | `stripJsonFence` 后 `JSON.parse` 失败；`sample` = 清洗后 JSON 前 280 字 |
| 3'' | `error` | `{ message: '本地数据库这次没接住，看一眼 console 再来一遍', phase: 'db', detail }` | 落库事务抛错（**不中断流**，之后仍会 `closeStream`） |
| 4 | `done` | `{ fingerprint_id, author_id }` | 落库成功 |

`done` 里 id 长度：`author_id = nanoid(12)`、`fingerprint_id = nanoid(14)`。

#### 错误

| 状态 | 条件 | 消息 |
|---|---|---|
| 400 | 请求体非 JSON | `请求体不是合法 JSON` |
| 400 | `author_name` 空 | `博主名不能为空` |
| 400 | `articles` 长度越界 | `文章数量需要在 3 到 10 篇之间，当前 {n} 篇` |
| 400 | 第 i 篇正文过短 | `第 {i+1} 篇文章内容太短了（不足 100 字），再多粘一点`（1-based） |

错误一律 `{ error: string }`，`Content-Type: application/json; charset=utf-8`。

#### 副作用

事务内 `INSERT INTO authors` + `INSERT INTO fingerprints`，`model_version = 'claude-code-cli'`，`hit_count = 0`；不做 `version` / `version_schema` 标记。

---

### 2.2 `POST /api/fingerprint/v2`

源文件：`app/api/fingerprint/v2/route.ts` · 导出函数：`POST` · 流式：SSE(手写)

#### 请求

```ts
interface IncomingArticleInput {
  mode?: 'url' | 'paste';
  url?: string;
  title?: string;
  content?: string; // 正文模式必填
  category?: string;
}
interface IncomingPayload {
  author_name?: string;
  platform?: string;
  articles?: IncomingArticleInput[];
}
```

| 字段 | 必填 | 默认 | 校验 |
|---|---|---|---|
| `author_name` | ✅ | — | 非空，否则 `博主名不能为空` |
| `platform` | ❌ | `null` | 仅 trim |
| `articles` | ✅ | `[]` | `5 ≤ n ≤ 12`（`MIN_ARTICLES=5`、`MAX_ARTICLES=12`） |
| `articles[i].mode` | ❌ | `'paste'` | 判断方式为 `input.mode === 'url' ? 'url' : 'paste'`，非法值静默按 `paste` |
| `articles[i].url` | mode=url 时 ✅ | — | 空 → `第 {i+1} 篇的 URL 是空的，要么填上要么切到正文模式` |
| `articles[i].content` | mode=paste 时 ✅ | — | `trim()` 后 ≥ **80** 字（`MIN_CONTENT_CHARS=80`） |
| `articles[i].category` | ❌ | `'未分类'` | 仅 `trim()`，空串落 `'未分类'`；**v2 不透传进落库分类列** |

常量：`MIN_ARTICLES=5`、`MAX_ARTICLES=12`、`MIN_CONTENT_CHARS=80`、`STAGE1_CONCURRENCY=3`。

#### 响应（SSE，按代码可发射顺序）

| # | event | data | 触发时机 |
|---|---|---|---|
| 1 | `open` | `{ ok: true, total }` | 流开始 |
| 2 | `phase` | `{ phase: 'prepare', message: '正在准备样本' }` | 准备阶段开始 |
| 3 | `article` | `{ index, status: 'ready', title, category, source, chars, image_count }` | 单篇准备成功（`source` ∈ `'url' \| 'paste'`） |
| 3' | `error` | `{ message, phase: 'prepare', index }` | 单篇准备失败（URL 抓取失败 / 正文过短）→ 发完即关流 |
| 4 | `phase` | `{ phase: 'stage1', message: '正在逐篇拆出局部策略' }` | stage1 开始 |
| 5 | `article` | `{ index, status: 'analyzing' }` | 某篇开始分析 |
| 6 | `chunk` | `{ stage: 'stage1', index, text }` | 该篇增量输出 |
| 7 | `article` | `{ index, status: 'analyzed' \| 'analyzed-loose' }` | 该篇结束；`analyzed-loose` 表示输出不是合法 JSON |
| 8 | `phase` | `{ phase: 'stage2', message: '正在跨篇综合博主整体指纹' }` | stage2 开始 |
| 9 | `chunk` | `{ stage: 'stage2', text }` | stage2 增量输出 |
| 10 | `error` | `{ message: '某一篇拆解时模型没回来：' + msg, phase: 'stage1' }` | stage1 整体抛错 |
| 10' | `error` | `{ message: '综合阶段模型没回来：' + msg, phase: 'stage2' }` | stage2 抛错 |
| 10'' | `error` | `{ message: '模型综合输出不是合法 JSON，再试一次大概率就好', phase: 'parse', detail, sample }` | stage2 JSON 解析失败 |
| 10''' | `error` | `{ message: '本地数据库这次没接住，看一眼 console 再来一遍', phase: 'db', detail }` | 落库失败 |
| 11 | `done` | `{ fingerprint_id, author_id, strategy_count, article_count }` | 落库成功 |

#### 错误（HTTP，与上表并列的「未进入流」错误）

| 状态 | 条件 | 消息 |
|---|---|---|
| 400 | 请求体非 JSON | `请求体不是合法 JSON` |
| 400 | 博主名空 | `博主名不能为空` |
| 400 | 样本数越界 | `文章数量需要在 5 到 12 篇之间，当前 {n} 篇` |

URL 抓取失败的消息由 `prepareArticle` 抛出：`第 {i+1} 篇 URL 抓不下来（{reason}）：{message}。建议切到正文模式贴一下。` / `第 {i+1} 篇抓到的正文太短（{n} 字），可能没抓全。切到正文模式手贴吧。`

#### 副作用

写 `authors`（1 行）+ `fingerprints`（`version = 2`、`article_count`、`model_version = 'claude-code-cli-v2'`）+ `crawled_articles`（仅 URL 来源，`source_type='crawl'`）+ `strategies`（来自指纹 JSON 的 `strategies[]`）。

---

### 2.3 `POST /api/fingerprint/v3`（当前主版本）

源文件：`app/api/fingerprint/v3/route.ts` · 导出函数：`POST` · 流式：SSE(手写)

#### 请求

```ts
interface IncomingArticleInput {
  /** 'url' = 后端用 crawler 抓正文；'paste' = 直接用 content 字段。不传按 paste 兼容老调用 */
  mode?: 'url' | 'paste';
  title?: string;
  content?: string;
  url?: string;
  platform?: string;
  medium?: 'text' | 'video' | 'mixed';
  domain?: string;
  /** 可选：UI 上"类别"标签 */
  category?: string;
}
interface IncomingPayload {
  author_name?: string;
  articles?: IncomingArticleInput[];   // 注意：v3 没有顶层 platform 字段
}
```

| 字段 | 必填 | 默认 | 校验 |
|---|---|---|---|
| `author_name` | ✅ | — | 非空 → `博主名不能为空` |
| `articles` | ✅ | `[]` | `2 ≤ n ≤ 20`（`MIN_ARTICLES=2`、`MAX_ARTICLES=20`） |
| `articles[i].platform` | ✅ **每篇必填** | — | 空 → `第 {i+1} 篇没指定 platform（公众号 / B 站 / 知乎 / ...）`；**无枚举白名单**（自由字符串） |
| `articles[i].medium` | ❌ | `'text'` | 必须 ∈ `text \| video \| mixed`，否则 `第 {i+1} 篇 medium 取值只能是 text / video / mixed` |
| `articles[i].domain` | ❌ | `'未指定'` | 仅 trim |
| `articles[i].category` | ❌ | `null` | 经 `normalizeCategory()`：去尾部「类」后等于或包含 `ARTICLE_CATEGORIES` 之一才生效；命中则跳过 Stage 0 自动分类 |
| `articles[i].mode` | ❌ | 按 `paste` | 仅 `=== 'url'` 才走抓取 |
| `articles[i].content` | mode=paste 时 ✅ | — | ≥ **80** 字；**超过 15000 字截断**（`MAX_SAMPLE_CONTENT_CHARS`） |
| `articles[i].url` | mode=url 时 ✅ | — | 空 → `第 {i+1} 篇的 URL 是空的，要么填上要么切到正文模式` |

**批内去重**：`sampleHash()` — URL 模式取 `hashUrl(url)`；粘贴模式取 `'paste:' + sha1(正文前 200 字).slice(0,16)`。重复项发 `article {status:'skipped-duplicate'}` 后跳过。

去重后如果有效样本 < 2，直接报错：`去重后只剩 {n} 篇有效样本，至少要 2 篇。换一篇不同的文章再来吧。`

常量：`MIN_ARTICLES=2`、`MAX_ARTICLES=20`、`MIN_CONTENT_CHARS=80`、`STAGE1_CONCURRENCY=3`、`STAGE0_CONCURRENCY=4`、`MAX_SAMPLE_CONTENT_CHARS=15000`。
各阶段显式超时：stage1 `300_000` / stage2 `480_000` / stage3 `360_000` / category profile `360_000`。

#### 响应（SSE，按代码可发射顺序）

**注意：v3 用的是 `stage` 事件，v2 用的是 `phase` 事件，两者不可混用。**

| # | event | data | 触发时机 |
|---|---|---|---|
| 1 | `open` | `{ ok: true, total }` | 流开始 |
| 2 | `stage` | `{ stage: 'prepare', message: '正在准备样本' }` | 准备阶段 |
| 3 | `article` | `{ index, status: 'ready', title, platform, medium, domain, chars }` | 单篇准备成功 |
| 3' | `article` | `{ index, status: 'skipped-duplicate', title, message: '这篇和本批前面的样本重复了，只算一篇' }` | 批内重复被跳过 |
| 3'' | `error` | `{ message, phase: 'prepare', index }` | 单篇准备失败 → 关流 |
| 3''' | `error` | `{ message: '已中止', phase: 'abort' }` | 请求被 abort |
| 3'''' | `error` | `{ message: '去重后只剩 {n} 篇有效样本，至少要 2 篇。换一篇不同的文章再来吧。', phase: 'prepare' }` | 去重后不足下限 |
| 4 | `stage` | `{ stage: 'stage0', message: '正在给文章打类别标签' }` | Stage 0 开始 |
| 5 | `article` | `{ index, status: 'categorized', primary_category, secondary_category, category_confidence }` | 某篇分类完成（失败时 `primary_category: null`） |
| 6 | `warn` | `{ phase: 'stage0', message: '自动分类阶段异常：{msg}，继续往下走' }` | Stage 0 整体异常（不阻塞） |
| 7 | `stage` | `{ stage: 'stage0', status: 'done', ms }` | Stage 0 结束 |
| 8 | `stage` | `{ stage: 'stage1', message: '正在逐篇拆出局部策略碎片', concurrency: 3 }` | Stage 1 开始 |
| 9 | `article` | `{ index, status: 'analyzing' }` | 某篇开始 |
| 10 | `chunk` | `{ stage: 'stage1', index, text }` | 该篇增量 |
| 11 | `article` | `{ index, status: 'analyzed' \| 'analyzed-loose' }` | 该篇结束 |
| 12 | `stage` | `{ stage: 'stage1', status: 'done', ms }` | Stage 1 结束 |
| 13 | `stage` | `{ stage: 'stage2', message: '正在跨篇综合按平台 / 领域分组' }` | Stage 2 开始 |
| 14 | `chunk` | `{ stage: 'stage2', text }` | Stage 2 增量 |
| 15 | `stage` | `{ stage: 'stage2', status: 'done', ms }` | Stage 2 结束 |
| 16 | `stage` | `{ stage: 'stage3', message: '正在跑跨平台深度对比报告' }` | 仅当 `platforms_analyzed.length >= 2` |
| 17 | `chunk` | `{ stage: 'stage3', text }` | Stage 3 增量 |
| 18 | `warn` | `{ phase: 'parse-stage3', message: 'stage3 输出不是合法 JSON，沿用 stage2 初稿', detail }` | Stage 3 JSON 坏了 |
| 18' | `warn` | `{ phase: 'stage3', message: '跨平台对比阶段模型没回来：{msg}。沿用 stage2 初稿。' }` | Stage 3 调用失败 |
| 19 | `stage` | `{ stage: 'stage3', status: 'done', ms }` | Stage 3 结束 |
| 19' | `stage` | `{ stage: 'stage3', status: 'skipped', reason: '只有单平台样本，跳过跨平台对比' }` | 单平台 |
| 20 | `stage` | `{ stage: 'category-profiles', message: '正在按类别细分指纹' }` | 类别配方开始 |
| 21 | `chunk` | `{ stage: 'category-profile', category, text }` | 某类别增量 |
| 22 | `category-profile-done` | `{ category, sample_count }` | 某类别配方合成成功（仅当该类样本 ≥ 3） |
| 23 | `warn` | `{ phase: 'category-profile', category, message: '类别细分失败：{msg}' }` | 单类失败 |
| 24 | `stage` | `{ stage: 'category-profiles', status: 'done', ms }` | 类别配方结束 |
| 25 | `error` | `{ message: '某一篇拆解时模型没回来：{msg}', phase: 'stage1' }` | Stage 1 抛错 → 关流 |
| 25' | `error` | `{ message: '综合阶段模型没回来：{msg}', phase: 'stage2' }` | Stage 2 抛错 |
| 25'' | `error` | `{ message: 'stage2 输出的 JSON 这次没修好，再试一次大概率就好', phase: 'parse-stage2', detail, sample }` | `parseStage2WithRepair` 修复后仍失败 |
| 25''' | `error` | `{ message: '本地数据库这次没接住，看一眼 console 再来一遍', phase: 'db', detail }` | 落库失败 |
| 26 | `done` | 见下 | 落库成功 |

`done` 的 data：

```ts
{
  fingerprint_id: string;
  author_id: string;
  schema: 'v3';
  article_count: number;
  platforms_analyzed: string[];
  categories_analyzed: Array<{ category: string; sample_count: number }>;
  strategy_count: number;
  timings_ms: { stage1: number; stage2: number; stage3: number; total: number };
}
```

#### 错误（HTTP）

| 状态 | 条件 | 消息 |
|---|---|---|
| 400 | 请求体非 JSON | `请求体不是合法 JSON` |
| 400 | 博主名空 | `博主名不能为空` |
| 400 | 样本数越界 | `文章数量需要在 2 到 20 篇之间，当前 {n} 篇` |

#### 副作用

事务写：`authors`、`fingerprints`（`version = 3`、`version_schema = 'v3'`、`platform_fingerprints_json` / `domain_variations_json` / `cross_platform_report_json` / `strategy_fragments_json`、`model_version = 'claude-code-cli-v3'`）、`strategies`、`fingerprint_articles`（`iteration = 1`，带 Stage 0 分类列）、`fingerprint_category_profiles`、`strategy_fragments_indexed`（全局碎片 `category = NULL` + 类别碎片）。
`authors.platform` 取 `platforms_analyzed[0]`。

---

### 2.4 `PATCH /api/fingerprint/v3/[id]` — **非流式**

源文件：`app/api/fingerprint/v3/[id]/route.ts` · 导出函数：`PATCH` · 响应：普通 `Response.json`

#### 请求

```ts
interface ReqBody {
  articles?: IncomingArticleInput[];
  /** 作者主页 / 专栏 / 板块 URL：自动扒文章列表后追加到 articles。 */
  author_url?: string;
  /** v3.3：不加样本、只用现有库重跑（升级 prompt 后回填新字段用） */
  force_rerun?: boolean;
}
```

`IncomingArticleInput` 与 §2.3 相同（单篇 `platform` 必填、`content` ≥ 80 字、超 15000 字截断）。

**三者至少要有一个**：`articles` 非空 / `author_url` 非空 / `force_rerun === true`，否则 400。

`author_url` 行为：`crawlAuthorIndex(url, { skipHashes: 已有 url_hash 集合, maxArticles: 20, maxPages: 10 })`，抓到的 URL 按 hostname 推断 platform：

| hostname 命中 | platform |
|---|---|
| `zhihu.com` | `zhihu` |
| `sspai.com` | `sspai` |
| `uisdc.com` | `uisdc` |
| `woshipm.com` | `wechat` |
| `bilibili.com` / `b23.tv` | `bilibili` |
| `youtube.com` / `youtu.be` | `youtube` |
| `xiaohongshu.com` | `xhs` |
| `douyin.com` | `douyin` |
| 其它 | `wechat` |

#### 响应（全部 200 也可能 `reextracted: false`）

分支 A「无新增样本且非 force_rerun」→ **200**：

```ts
{
  newly_added_count: 0;
  skipped_count: number;
  skipped: Array<{ url: string | null; reason: '已分析过' }>;
  failed: Array<{ url: string | null; reason: string }>;
  total_samples: number;      // COUNT(fingerprint_articles)
  reextracted: false;
  message: string;            // 见下
}
```

`message`：`skipped.length > 0` → `这一轮全是已分析过的文章（跳过 {n} 篇），指纹没变。换条新 URL 再来一次？`；否则 `这一轮一篇都没爬到。看看 failed 里说的是什么原因。`

分支 B「重提炼成功」→ **200**：

```ts
{
  newly_added_count: number;
  skipped_count: number;
  skipped: Array<{ url: string | null; reason: string }>;
  failed: Array<{ url: string | null; reason: string }>;
  total_samples: number;      // allPrepared.length（≤ 20）
  iteration: number;          // 原 iteration_count + 1
  reextracted: true;
  platforms_analyzed: string[];
  categories_analyzed: Array<{ category: string; sample_count: number }>;
  strategy_count: number;
  timings_ms: { stage1: number; stage2: number; stage3: number; total: number };
}
```

#### 错误

| 状态 | 条件 | 消息 / shape |
|---|---|---|
| 400 | 缺 id | `{ error: '缺少指纹 id' }` |
| 400 | 请求体非 JSON | `{ error: '请求体不是合法 JSON' }` |
| 400 | 三个入参全空 | `{ error: 'articles 不能为空；也可以传 author_url 自动扒作者文章，或设置 force_rerun: true 不加样本只重跑' }` |
| 404 | 指纹不存在 | `{ error: '找不到这个指纹' }` |
| 500 | 指纹关联博主缺失 | `{ error: '指纹关联的博主不存在' }` |
| 502 | `author_url` 抓列表失败 | `{ error: '自动扒作者文章失败：{message}' }` |
| 400 | 累计样本 < 2 | `{ error: '累计样本只有 {n} 篇，至少要 2 篇' }` |
| 502 | 重提炼调用失败 | 报告对象 + `error: '这次没成：{msg}。样本已经存进去了，下次再点重提炼就能直接重试。'`（**样本已先落库**） |
| 409 | 写回事务失败（指纹重提炼期间被删） | `{ reextracted: false, error: '重提炼结果没能写回：{msg}。如果是指纹刚被删掉，重新拆解一次就好。' }` |

#### 行为要点

- 新样本**先写库再跑模型**（即使模型挂了也留住样本）。
- 累计样本取 `ORDER BY added_at DESC LIMIT 20` 重新喂 stage1/2/3。
- 老样本若 DB 里没有分类，会由 Stage 0 重跑补分类并**回写** `fingerprint_articles`。
- 写回时：`strategies` 整组删重建；`strategy_fragments_indexed` 全局碎片整组覆盖、类别碎片**只删该次成功合成的类**（失败类保留旧行）；`fingerprint_category_profiles` 用 `INSERT OR REPLACE`（不做无条件全删）。
- `UPDATE fingerprints SET ... iteration_count = COALESCE(iteration_count, 1) + 1`。

---

### 2.5 `DELETE /api/fingerprint/v3/[id]`

源文件：同 §2.4 · 导出函数：`DELETE`

#### 请求

无 body。路径参数 `id`。

#### 响应

| 状态 | shape |
|---|---|
| 200 | `{ ok: true, deleted: id }` |

#### 错误

| 状态 | 消息 |
|---|---|
| 400 | `缺少指纹 id` |
| 404 | `找不到这个指纹` |
| 500 | `删除失败：{msg}` |

#### 级联删除范围（事务内）

1. `fingerprint_articles`
2. `fingerprint_category_profiles`
3. `strategies`
4. `strategy_fragments_indexed`
5. `fingerprints`
6. 若该 author 已无其它指纹 → 先 `UPDATE crawled_articles SET author_id = NULL`（**解绑，避免 ON DELETE CASCADE 把语料删光**），再 `DELETE FROM authors`

**不删除** `articles` 表里用该指纹生成过的历史文章。文档注释明确说明这是有意的。

---

### 2.6 `GET /api/fingerprints/names`

源文件：`app/api/fingerprints/names/route.ts` · 导出函数：`GET`

#### 请求

| query | 必填 | 说明 |
|---|---|---|
| `ids` | ❌ | 逗号分隔的 fingerprint_id 列表 |

#### 响应

`ids` 缺失或解析后为空 → **200 `{}`**（不是错误）。

正常 → **200**：

```ts
Record<string, { author_name: string; platform: string | null }>
```

key 是 `fingerprints.id`，只包含数据库里查到的行（查不到的 id 静默消失，不会出现在结果里）。

#### 错误

| 状态 | shape |
|---|---|
| 500 | `{ error: (err as Error).message }` |

---

### 2.7 `PATCH /api/authors/[id]`

源文件：`app/api/authors/[id]/route.ts` · 导出函数：`PATCH`

#### 请求

```ts
interface ReqBody {
  name?: string;
  platform?: string | null;
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `name` | ❌ | `trim()` 后非空（否则 `博主名不能为空`）、长度 ≤ 60（否则 `博主名最多 60 字`）；改动时**同步重算 `avatar_emoji`**（`pickAvatarChar`） |
| `platform` | ❌ | `null` = 清空；字符串走 `trim()`，空串 → `null`；非 null 时长度 ≤ 30（否则 `平台名最多 30 字`）；**不强制白名单**（注释明确说允许自定义平台） |

两个字段都没给 → 400 `请求里没有要改的字段（name / platform）`。

#### 响应

**200**：

```ts
{
  ok: true;
  author: { id: string; name: string; platform: string | null; avatar_emoji: string | null };
}
```

#### 错误

| 状态 | 消息 |
|---|---|
| 400 | `缺少 author id` |
| 400 | `请求体不是合法 JSON` |
| 404 | `找不到这个博主` |
| 400 | `博主名不能为空` |
| 400 | `博主名最多 60 字` |
| 400 | `平台名最多 30 字` |
| 400 | `请求里没有要改的字段（name / platform）` |

---

### 2.8 `POST /api/authors/[id]/optimize`

源文件：`app/api/authors/[id]/optimize/route.ts` · 导出函数：`POST` · 流式：SSE(手写)

> 这是**「优化指纹」**流程（在现有指纹基础上追加样本产出 v(N+1)），**不是**跨平台改写。
> `version_schema === 'v3'` 的指纹会被 **409 拒绝**（见下），因为本路由用的是 v1 prompt，会把 v3 指纹降级遮蔽。

#### 请求

```ts
interface IncomingArticle {
  title?: string;
  content?: string;
  /** 选择已有 crawled_articles 时给 id；新增手贴时不给。 */
  crawled_article_id?: string;
}
interface IncomingPayload {
  articles?: IncomingArticle[];
}
```

| 规则 | 值 |
|---|---|
| 样本数 | `1 ≤ n ≤ 10`（`MIN_ARTICLES=1`、`MAX_ARTICLES=10`） |
| 正文长度 | ≥ **100** 字（`MIN_CONTENT_CHARS=100`） |
| 两种来源 | 给 `crawled_article_id` → 查 `crawled_articles WHERE id = ? AND author_id = ?`；否则用手贴 `content` |
| 主平台选择 | 取该 author 最新指纹：`ORDER BY COALESCE(version, 1) DESC, created_at DESC LIMIT 1` |

#### 响应（SSE，按代码可发射顺序）

| # | event | data |
|---|---|---|
| 1 | `open` | `{ ok: true, author_name }` |
| 2 | `chunk` | `{ text }` |
| 3 | `error` | `{ message, phase: 'claude' }` / `{ message: '模型输出了一段不太像 JSON 的东西，再试一次大概率就好', phase: 'parse', detail, sample }` / `{ message: '本地数据库这次没接住，看一眼 console 再来一遍', phase: 'db', detail }` |
| 4 | `done` | `{ fingerprint_id, author_id, version, article_count }` |

`streamClaude` 超时显式设为 `360_000`（refine prompt 带旧指纹全文 + 最多 10 篇新样本）。

#### 错误（HTTP，流开始前）

| 状态 | 消息 |
|---|---|
| 400 | `缺少 author id` |
| 400 | `请求体不是合法 JSON` |
| 400 | `至少选 1 篇新文章再来优化` |
| 400 | `一次最多追加 10 篇` |
| 500 | `数据库打不开：{msg}` |
| 404 | `找不到这位博主` |
| 400 | `这位博主还没有指纹，先去完整拆解一次` |
| **409** | `这位博主用的是 v3 指纹，这条老优化通道会把它降回 v1，就不往下走了。去指纹详情页用「加样本重提炼」，新样本会累计进 v3 指纹里，效果一样还不丢东西。` |
| 400 | `第 {i+1} 篇：找不到这篇 crawled_article（{id}）` |
| 400 | `第 {i+1} 篇的正文太短了（< 100 字）`（来自 crawled_articles） |
| 400 | `第 {i+1} 篇手贴的正文太短了（< 100 字）` |

#### 副作用

插入**新** `fingerprints` 行：`version = oldVersion + 1`、`parent_id = latestFp.id`、`article_count = oldCount + 新增篇数`、`model_version = 'claude-code-cli'`（**不带 v2/v3 后缀，且不写 `version_schema`**，见附录 · 附.4）。
`source_articles_json` 为「旧 + 新」合并；回填 `crawled_articles.used_in_fingerprint_id`（仅当原本为 NULL）；更新 `authors.last_used_at`。

---

## 3. 写作链路

### 3.1 `POST /api/recommend`

源文件：`app/api/recommend/route.ts` · 导出函数：`POST` · 流式：SSE(helper)

#### 请求

```ts
interface IncomingPayload {
  idea?: string;
  target_platform?: string;
}
```

| 字段 | 必填 | 默认 | 校验 |
|---|---|---|---|
| `idea` | ✅ | — | `trim()` 后 ≥ **30** 字，否则 400 `题材思路至少 30 字（当前 {n}）` |
| `target_platform` | ❌ | `null` | 传了就必须通过 `isValidPlatformKey`，否则 400 `目标平台 "{v}" 不在允许列表里` |

**指纹库为空的特殊分支（非 SSE）**：直接返回 **200** `{ "empty": true, "recommendations": [] }`，前端据此跳过推荐步骤。

#### 响应（SSE，按代码可发射顺序）

| # | event | data |
|---|---|---|
| 1 | `open` | `{ count }`（指纹总数） |
| 2 | `chunk` | `{ text }` |
| 3 | `error` | `{ message, phase: 'claude' }` |
| 3' | `error` | `{ message: '模型输出了一段不太像 JSON 的东西，再试一次大概率就好', phase: 'parse', detail, sample }` |
| 3'' | `error` | `{ message: '模型这次没给出可用推荐，换个角度的题材描述再试一次', phase: 'normalize', sample }` |
| 4 | `done` | `{ recommendations }` |

#### 错误（HTTP）

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `题材思路至少 30 字（当前 {n}）` |
| 400 | `目标平台 "{v}" 不在允许列表里` |
| 500 | `数据库读取失败：{msg}` |

---

### 3.2 `POST /api/compose/outline`

源文件：`app/api/compose/outline/route.ts` · 导出函数：`POST` · 流式：SSE(helper)

#### 请求

```ts
interface IncomingPayload {
  idea?: string;
  composition?: Composition;
  target_platform?: string;
  /** 可选：用户在 Step 1 选了具体站点画像时传，prompt 会注入画像的结构/深度/类比偏好 */
  target_site_id?: string;
  /** v3.5：联网搜集的素材包。空 = 跳过，prompt 自动降级。 */
  research_material?: string;
}
```

`Composition`（`lib/composition.ts`）：

```ts
interface CompositionAuthor {
  author_id: string;        // authors.id
  fingerprint_id: string;   // fingerprints.id
  weight: number;           // 0-1，prompt 里转百分比
  use_strategies?: string[]; // 'language'|'structure'|'topic'|'visual'|'do_list'|'dont_list'
}
interface Composition {
  selected_authors: CompositionAuthor[];
  custom_notes?: string;
}
```

| 字段 | 必填 | 默认 | 校验 |
|---|---|---|---|
| `idea` | ✅ | — | ≥ **30** 字，否则 400 `题材思路至少 30 字` |
| `composition` | ❌ | `{ selected_authors: [] }` | 空组合合法，走通用风格分支 |
| `target_platform` | ❌ | `null` | 传了必须合法 → `目标平台 "{v}" 不在允许列表里` |
| `target_site_id` | ❌ | — | 查不到静默忽略（`siteProfile` 保持 `null`） |
| `research_material` | ❌ | `undefined` | 非 string 视作 `undefined` |

#### 响应（SSE，按代码可发射顺序）

| # | event | data |
|---|---|---|
| 1 | `open` | `{ ok: true }` |
| 2 | `chunk` | `{ text }` |
| 3 | `error` | `{ message, phase: 'claude' }` |
| 3' | `error` | `{ message: '模型输出了不太像 JSON 的东西，再试一次', phase: 'parse', detail, sample }` |
| 3'' | `error` | `{ message: '大纲结构看起来不对，换个角度的题材描述再试一次', phase: 'normalize', sample }` |
| 4 | `done` | `{ outline }` |

`outline` 是 `normalizeOutline()` 后的结构（`lib/prompts/outline.ts`）：

```ts
interface OutlineSection {
  index: number;
  title: string;
  bullets: string[];
  word_budget: number;      // 非法或 < 200 时兜底 800
  depth_role?: 'open' | 'deeper' | 'parallel' | 'turn' | 'close';
  thesis?: string;
}
interface Outline {
  working_title: string;
  hook_idea: string;
  sections: OutlineSection[];
  closing_idea: string;
  total_words_estimate: number;
  structure_shape?: 'causal_chain' | 'dual_contrast' | 'concentric' | 'flat_list' | 'timeline' | 'problem_solution';
  core_thesis?: string;
}
```

#### 错误（HTTP）

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `题材思路至少 30 字` |
| 400 | `目标平台 "{v}" 不在允许列表里` |
| 500 | `数据库结构升级失败：{msg}` |
| 500 | `数据库读取失败：{msg}` |

超时：`timeoutMs: 240_000`（默认模型，即 CLI 订阅默认）。

---

### 3.3 `POST /api/compose/gather`

源文件：`app/api/compose/gather/route.ts` · 导出函数：`POST` · 流式：SSE(helper)

> **没有 GET 处理函数。** 缓存查询发生在 POST 内部（按 `idea_hash`）。见附录 · 附.5。

#### 请求

```ts
interface IncomingPayload {
  idea?: string;
}
```

`idea` `trim()` 后 ≥ **30** 字，否则 400 `题材思路至少 30 字`。

`idea_hash = sha256(idea.trim()).slice(0, 16)`。

#### 响应（SSE，两个互斥分支）

**分支 A：命中缓存**

| # | event | data |
|---|---|---|
| 1 | `cached` | `{ idea_hash, material_md, chars, elapsed_ms, created_at, from_cache: true }` |
| 2 | `done` | `{ idea_hash, material_md, chars, elapsed_ms, from_cache: true }` |

然后显式 `close()`。

**分支 B：未命中**

| # | event | data |
|---|---|---|
| 1 | `started` | `{ idea_hash }` |
| 2 | `progress` | `{ elapsed_ms: 0, search_engine, search_hits }` |
| 3 | `progress` | `{ elapsed_ms, search_engine }` — 每 **15s** 一次（无 `search_hits`） |
| 4 | `done` | `{ idea_hash, material_md, chars, elapsed_ms, from_cache: false, search_engine, search_hits }` |
| — | `error` | `{ message }`（**无 `phase` 字段**，由路由自身 catch 发出） |

`search_engine` 取值：`'mimo'` | `'tavily'` | `'google'` | `'duckduckgo'` | `'bing'` | `'none'`。
搜索优先级：MiMo web_search（需 `AUTOARTICLE_LLM_API_KEY`）→ Tavily（需 `TAVILY_API_KEY`）→ 自带 `searchWebFacts`（Google CSE → DuckDuckGo → Bing）。

#### 错误

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `题材思路至少 30 字` |
| 500 | `数据库结构升级失败：{msg}` |

超时：`GATHER_TIMEOUT_MS = 360_000`。

#### 副作用

- 成功时 `INSERT INTO gather_runs (idea_hash, idea, material_md, chars, elapsed_ms, created_at)`（按 `idea_hash` 幂等）。
- 额外写 `knowledge_base` + `knowledge_base_tags`（topic 取 idea 前 50 字、5 个启发式关键词、`autoDetectCategory` 归类）；此处失败只打 console，**不影响主流程**。

---

### 3.4 `POST /api/compose/draft`

源文件：`app/api/compose/draft/route.ts` · 导出函数：`POST` · 流式：SSE(helper)

#### 请求

```ts
interface IncomingPayload {
  idea?: string;
  composition?: Composition;
  outline?: unknown;                 // 必须能被 normalizeOutline 解析
  title?: string;                    // 可选主标题；空则从 markdown 解析
  target_platform?: string;          // 主平台；platforms[0] 的默认值
  platforms?: string[];              // 多平台扩写，串行；第一个 = 主平台
  target_site_id?: string;           // 只注入主平台
  use_critic?: boolean;              // 默认 true
  research_material?: string;
  existing_article_id?: string;      // 局部重试复用原文章
  existing_versions?: Record<string, string>; // 首次主平台失败时的已成功版本
}
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `idea` | ✅ | — | ≥ **30** 字 → `题材思路至少 30 字` |
| `outline` | ✅ | — | `normalizeOutline(body.outline)` 失败 → `大纲缺失或格式不对` |
| `composition` | ❌ | `{ selected_authors: [] }` | — |
| `target_platform` | ❌ | `null` | 传了必须 `isValidPlatformKey` → `目标平台 "{v}" 不在允许列表里` |
| `platforms` | ❌ | `[primaryPlatform ?? 'wechat']` | 数组内非字符串 / 非法 key **静默丢弃**；去重；**主平台被强制插到第一位**；过滤后为空 → 400 `没有任何目标平台` |
| `use_critic` | ❌ | **`true`** | 判断为 `body.use_critic !== false`，只有显式 `false` 才关闭 |
| `target_site_id` | ❌ | — | **仅主平台生效**，非主平台强制 `{ siteLabel: null, siteProfile: null }` |
| `research_material` | ❌ | `undefined` | 非 string 视作 `undefined` |
| `existing_article_id` | ❌ | `null` | 命中则走 UPDATE 分支（不新建历史文章） |
| `existing_versions` | ❌ | — | 仅在**新建**分支使用，且过滤掉主平台与空串 |

常量：`MIN_IDEA_CHARS = 30`、`PER_PLATFORM_TIMEOUT_MS = 480_000`。
critic：`CRITIC_MAX_ATTEMPTS = 3`（关 critic 时为 1）、`CRITIC_PASS_THRESHOLD = 20`（5 维 × 满分 5 = 25）。
正文走 `ARTICLE_MODEL` 别名，映射到**正文档位**（`BYTRACE_AGENT_ARTICLE_MODEL`，未配置则回退主 Agent 模型）；critic 以 `task='review'` 调用，走**审查模型分组**（`BYTRACE_REVIEW_*`，未配置则继承主 Agent）。

#### 响应（SSE，按代码可发射顺序）

| # | event | data | 触发时机 |
|---|---|---|---|
| 1 | `open` | `{ ok: true, sections, platforms, main_platform }` | 流开始，UI 据此起 N 个 tab |
| 2 | `platform_start` | `{ platform, index, is_main }` | 每个平台开始（按 `platforms` 顺序串行） |
| 3 | `rewrite_start` | `{ platform, attempt, reason }` | `attempt > 1` 时，清空当前 tab 内容；`reason` = 上轮 `rewrite_hint` |
| 4 | `delta` | `{ platform, delta, attempt }` | 正文增量输出（`onChunk`） |
| 5 | `critic_start` | `{ platform, attempt }` | 该轮草稿落地后开始评分（仅 `use_critic`） |
| 6 | `critic` | `{ platform, attempt, total, passed, scores, weakest, rewrite_hint, elapsed_ms, threshold }` | critic 评分成功 |
| 6' | `critic_error` | `{ platform, attempt, message, elapsed_ms }` | critic 自身失败 → **fail-open**，本稿按「未评估」落库并跳出循环 |
| 7 | `critic_best_of_n` | `{ platform, picked_attempt, picked_total, all_attempts, threshold }` | 用完次数仍未过阈值 → 取最高分稿 |
| 8 | `platform_done` | `{ platform, content_md, word_count, is_main, critic_final_attempt, critic_runs_count }` | 该平台最终定稿 |
| 9 | `error` | `{ platform, message, phase: 'claude', attempt }` | 该平台某轮 streamClaude 失败；**不阻断后续平台** |
| 9' | `error` | `{ message: '文章写完了，但本地数据库没接住。原文已经在内存里，复制保留一下', phase: 'db', detail }` | 落库失败；**发完立刻 return，之后不再发 `done`** |
| 10 | `done` | 见下 | 全部平台跑完且落库完成 |

`critic` 事件的 `scores` 形状（`CriticResult.scores`）：

```ts
Record<
  'structure' | 'depth' | 'analogy' | 'punchline' | 'taboo',
  { score: number; reason: string }   // score 0-5
>
```

`done` 的 data：

```ts
{
  article_id: string | null;      // 主平台完全失败时为 null
  title: string;
  main_platform: string;
  content_md: string;             // 主平台 markdown（兼容老 UI 单平台分支）
  content_html: string;           // 极简 markdown→html
  versions: Record<string, string>;  // 所有平台 md，{ [platform]: md }
  all_word_count: number;
  errors: Array<{ platform: string; message: string }>;
  critic_summary: null | {
    use_critic: true;
    total_runs: number;
    total_elapsed_ms: number;
    passed_platforms: number;
    best_of_n_platforms: number;
  };
}
```

#### 错误（HTTP，流开始前）

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `题材思路至少 30 字` |
| 400 | `大纲缺失或格式不对` |
| 400 | `目标平台 "{v}" 不在允许列表里` |
| 400 | `没有任何目标平台` |
| 500 | `数据库结构升级失败：{msg}` |
| 500 | `数据库读取失败：{msg}` |

#### 落库行为

- **新建分支**（无 `existing_article_id` 命中）：
  - `articles.content_md` = 主平台正文；`platform_target` = `platformList[0]`；`layout_theme = 'standard'`；`user_prompt` 与 `idea` 都写 `idea`；`outline_json` / `composition_json`。
  - 其它平台收成 **dict** `{[platform]: md}` 写进 `refine_versions_json`（无其它平台时写 `null`）。
  - `existing_versions` 里非主平台的项会并入 dict。
  - 逐个 `UPDATE fingerprints SET hit_count = hit_count + 1` 与 `authors.last_used_at`。
- **复用分支**（`existing_article_id` 命中）：主平台 UPDATE `title/content_md/content_html`；其它平台经 `parseRefineVersions()` 归一成**数组**后按 `target_platform` 替换或追加。
- `critic_runs` 表 UPSERT（主键 `(article_id, platform, attempt)`），入库失败静默忽略。

---

### 3.5 `POST /api/compose/refine`

源文件：`app/api/compose/refine/route.ts` · 导出函数：`POST` · 流式：SSE(helper)

#### 请求

```ts
interface IncomingPayload {
  content_md?: string;
  platform?: string;          // 目标平台
  source_platform?: string;   // 源平台；非法或空 → 'wechat'
  article_id?: string;        // 带上后可读 composition / 写 refine_versions_json
  composition?: Composition;  // 没有 article_id 时可直接传
}
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `content_md` | ✅ | — | `trim()` 后 ≥ **100** 字，否则 400 `原文太短了（不足 100 字）` |
| `platform` | ✅ | — | `isValidRefinePlatform`（= `isValidPlatformKey`）通过，否则 400 `目标平台不在允许列表里` |
| `source_platform` | ❌ | `'wechat'` | 非法值静默回落 `'wechat'`（**不报错**） |
| `article_id` | ❌ | — | 查不到不报错；`composition` 为空时会从 `articles.composition_json` 补 |
| `composition` | ❌ | `null` | 用于抽 crossHints |

#### 响应（SSE，按代码可发射顺序）

| # | event | data |
|---|---|---|
| 1 | `open` | `{ platform, source_platform, cross_hints }`（`cross_hints` 是条数） |
| 2 | `chunk` | `{ text }` |
| 3 | `error` | `{ message, phase: 'claude' }` |
| 4 | `done` | `{ content_md, platform, source_platform }` |

#### 错误（HTTP）

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `原文太短了（不足 100 字）` |
| 400 | `目标平台不在允许列表里` |

超时 `240_000`，`model: ARTICLE_MODEL`。

#### 落库

若 `article_id` 解析出 `articleRow`：用 `parseRefineVersions()` 先把 `refine_versions_json` 归一成**数组**（兼容 draft 写的 dict 形态），再 append 一条：

```ts
interface RefineVersionEntry {
  ts: number;
  source_platform: PlatformKey;
  target_platform: PlatformKey;
  content_md: string;
}
```

持久化失败只打 `console.warn`，**不影响 SSE 返回**。

---

## 4. 站点画像

### 4.1 `GET /api/sites` · `POST /api/sites`

源文件：`app/api/sites/route.ts` · 导出函数：`GET`、`POST`

#### `GET`

无参数。**200**：

```ts
{
  items: Array<{
    id: string;
    site_name: string;
    section: string | null;
    url_pattern: string | null;
    source_article_count: number | null;
    created_at: number;
    preferred_topics: string[];        // 最多 6 个
    word_count_range: [number, number] | null;
  }>;
}
```

排序：`COALESCE(updated_at, created_at) DESC`。

| 状态 | 消息 |
|---|---|
| 500 | `读取站点列表失败：{msg}` |

#### `POST`

请求 body（未定义 interface，内联类型）：

```ts
{ url?: string; section?: string; article_urls?: string[] }
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `url` | ✅ | — | 非空 → `站点 URL 不能为空`；先过 `detectUrlType`，公众号直接 400 |
| `section` | ❌ | `null` | 板块名 |
| `article_urls` | ❌ | `[]` | 给了就**不**爬列表，直接用（截到 `MAX_ARTICLES_FOR_PROFILE = 20`） |

常量：`MIN_ARTICLES_FOR_PROFILE = 3`、`MAX_ARTICLES_FOR_PROFILE = 20`。

**200**：

```ts
{
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string;
  source_article_count: number;   // COUNT(site_articles)
  failed_count: number;
  skipped_count: number;
  profile: Record<string, unknown>;  // 模型输出的画像 JSON
}
```

错误：

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `站点 URL 不能为空` |
| 400 | `{urlType.hint}`，兜底 `公众号反爬较硬，工具不爬，请直接粘贴正文` |
| 400 | `没爬到这个站点的文章列表：{message}。可以试试直接传 article_urls 数组。` |
| 400 | `这个站点只找到 {n} 篇可爬文章，至少需要 3 篇才能提画像。` |
| 502 | `爬文章失败：{msg}`（同时回滚删除占位 site + site_articles） |
| 502 | `这一轮只爬到了 {n} 篇可用的文章（目标 3 篇起步）。失败：{前 3 条 reason 用「；」连接}` |
| 502 | `调模型失败：{msg}`（同样回滚） |

流程：先插占位 `sites` 行（`profile_json = '{}'`、`source_article_count = 0`、`iteration_count = 1`）→ `fetchArticlesWithDedupe` → `runProfileExtraction` → UPDATE 真画像。`site_name` / `section` / `url_pattern` 优先取模型输出，兜底 host。

---

### 4.2 `GET` / `PATCH` / `DELETE /api/sites/[id]`

源文件：`app/api/sites/[id]/route.ts` · 导出函数：`GET`、`PATCH`、`DELETE`

#### `GET`

**200**：

```ts
{
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  source_url: string | null;
  source_article_count: number | null;
  created_at: number;
  updated_at: number | null;
  profile: Record<string, unknown>;
}
```

| 状态 | 消息 |
|---|---|
| 400 | `id 不能为空` |
| 404 | `找不到这个站点画像` |
| 500 | `读取失败：{msg}` |

#### `DELETE`

先删 `site_articles` 再删 `sites`（**非事务**）。

| 状态 | shape |
|---|---|
| 200 | `{ ok: true }` |
| 400 | `{ error: 'id 不能为空' }` |
| 404 | `{ error: '找不到这个站点画像' }` |
| 500 | `{ error: '删除失败：{msg}' }` |

#### `PATCH`

请求（内联类型）：

```ts
{ mode?: 'recrawl' | 'paste'; article_urls?: string[] }
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `mode` | ❌ | `'paste'` | 必须 ∈ `recrawl \| paste`，否则 `mode 必须是 recrawl 或 paste` |
| `article_urls` | paste 模式必填 | `[]` | paste 模式为空 → `paste 模式下 article_urls 不能为空` |

常量：`MIN_ARTICLES_FOR_PROFILE = 3`、`MAX_ARTICLES_FOR_PROFILE = 20`、`MAX_NEW_ARTICLES_PER_PATCH = 50`、`RECENT_ARTICLE_WINDOW_DAYS = 31`。

`recrawl` 会带 `skipHashes = 已有 site_articles.url_hash`，`maxArticles = 50`、`maxPages = 10`，并把 `{ recentDays: 31 }` 传给 `fetchArticlesWithDedupe`。

**200 分支 A**（无新增样本，不调模型）：

```ts
{
  newly_added_count: 0;
  skipped_count: number;
  skipped_samples: Array<{ url: string; existing_title: string | null }>;  // 前 8 条
  failed: Array<{ url: string; reason: string }>;                          // 前 8 条
  total_samples: number;
  recent_days_window: 31;
  max_new_per_round: 50;
  profile: null;
  reextracted: false;
  message: string;   // 有跳过 → 「这一轮全是已分析过的文章（跳过 N 篇），画像没变。换条新 URL 再来一次？」否则「这一轮一篇都没爬到。看看 failed 里说的是什么原因。」
}
```

**200 分支 B**（重提炼成功）：

```ts
{
  newly_added_count: number;
  skipped_count: number;
  skipped_samples: Array<{ url: string; existing_title: string | null }>;
  failed: Array<{ url: string; reason: string }>;
  total_samples: number;          // COUNT(site_articles) 累计
  used_for_extraction: number;    // 实际喂模型的样本数，≤ 20
  recent_days_window: 31;
  max_new_per_round: 50;
  newly_added: Array<{ title: string | null; url: string; publish_time: string | null }>;
  iteration: number;              // 原 iteration_count + 1
  profile: Record<string, unknown>;
  reextracted: true;
}
```

错误：

| 状态 | 消息 |
|---|---|
| 400 | `id 不能为空` |
| 400 | `请求体不是合法 JSON` |
| 400 | `mode 必须是 recrawl 或 paste` |
| 400 | `paste 模式下 article_urls 不能为空` |
| 404 | `找不到这个站点画像` |
| 400 | `这个站点没有 source_url，无法 recrawl，请用 paste 模式` |
| 502 | `从原 URL 拉文章列表失败：{message}。可以试试 paste 模式手贴 URL。` |
| 400 | `没收到任何候选 URL` |
| 502 | `爬文章失败：{msg}` |
| 400 | `累计样本只有 {n} 篇，至少要 3 篇` |
| 502 | `这次没成。{msg}。样本已经存进去了，下次点「重新提炼」可以直接重试。` |

`source_article_count` 恒为 `COUNT(site_articles)`（累计），与 `used_for_extraction`（≤ 20）是两个概念。

---

### 4.3 `GET /api/sites/picker`

源文件：`app/api/sites/picker/route.ts` · 导出函数：`GET`

无参数。**200**：

```ts
{
  items: Array<SiteItem | GenericItem>;
  site_count: number;
  generic_count: number;
}
```

```ts
interface SiteItem {
  kind: 'site';
  platform_key: PlatformKey;
  site_id: string;
  site_name: string;
  section: string | null;
  sample_count: number;                 // source_article_count ?? 0
  word_range_min: number | null;
  word_range_max: number | null;
  tone_hint: string | null;             // profile.tone 前 28 字
  preferred_topics: string[];           // 前 3 个
  updated_at: number;                   // updated_at ?? created_at
}
interface GenericItem {
  kind: 'generic';
  platform_key: PlatformKey;
  title: string;
  word_range_min: number;
  word_range_max: number;
  pacing: string;
  tone_tag: string;
  ui_hint: string;
}
```

排序：先 site 卡（`COALESCE(source_article_count,0) DESC, updated_at DESC, created_at DESC`），再 generic 卡（`PLATFORMS` 顺序）。

`platform_key` 由 `site_name` 映射（`SITE_NAME_TO_PLATFORM`），未命中先做模糊包含匹配，仍不中 → `'custom'`。已在 site 卡里出现过的 platform_key 不再生成 generic 卡。

**无错误处理**：`getDb()` 抛错会导致未捕获 500。

---

## 5. 风格配方与策略

### 5.1 `GET /api/recipes` · `POST /api/recipes`

源文件：`app/api/recipes/route.ts` · 导出函数：`GET`、`POST`

#### `GET`

| query | 必填 | 说明 |
|---|---|---|
| `platform` | ❌ | 精确匹配 `platform_key` |
| `site_id` | ❌ | 精确匹配 `site_id` |

**200**：

```ts
{
  items: Array<{
    id: string;
    name: string;
    platform_key: string;
    site_id: string | null;
    fragment_ids: string[];
    notes: string | null;
    created_at: number;
    updated_at: number;
  }>;
  count: number;
}
```

排序 `updated_at DESC`。无错误处理（`getDb()` 抛错 → 未捕获 500）。

#### `POST`

```ts
interface PostBody {
  name?: string;
  platform_key?: string;
  site_id?: string | null;
  fragment_ids?: string[];
  notes?: string | null;
}
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `name` | ✅ | — | 非空 → `配方名不能为空`；≤ 60 字 → `配方名最多 60 字` |
| `platform_key` | ✅ | — | 非空 → `platform_key 不能为空`（**不校验是否合法 PlatformKey**） |
| `fragment_ids` | ✅ | `[]` | 只保留非空字符串；`1 ≤ n ≤ 30`；逐个校验存在于 `strategy_fragments_indexed` |
| `site_id` | ❌ | `null` | `trim()` 空 → `null` |
| `notes` | ❌ | `null` | `trim()` 空 → `null` |

**201**：`{ ok: true, recipe: {...同 GET items 单项...} }`

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `配方名不能为空` |
| 400 | `配方名最多 60 字` |
| 400 | `platform_key 不能为空` |
| 400 | `至少要挑 1 个策略碎片` |
| 400 | `碎片太多了（上限 30），挑精的就够` |
| 400 | `这些碎片找不到了：{前 3 个 id 逗号连接}` |

---

### 5.2 `GET` / `PATCH` / `DELETE /api/recipes/[id]`

源文件：`app/api/recipes/[id]/route.ts` · 导出函数：`GET`、`PATCH`、`DELETE`

#### `GET`

**200**：

```ts
{
  recipe: {
    id: string;
    name: string;
    platform_key: string;
    site_id: string | null;
    fragment_ids: string[];
    fragments: Array<{
      id: string;
      fingerprint_id: string;
      author_name: string | null;
      category: string | null;
      tag: string | null;
      title: string | null;
      description: string | null;
      example: string | null;
      when_to_use: string | null;
      why_works: string | null;
      platform_scope: string[];
      domain_scope: string[];
    }>;
    notes: string | null;
    created_at: number;
    updated_at: number;
  };
}
```

`fragments` **按用户原 `fragment_ids` 顺序**排列（`Map` 回填），DB 里已不存在的碎片被静默跳过（`fragment_ids` 里仍有该 id）。

| 状态 | 消息 |
|---|---|
| 400 | `缺少配方 id` |
| 404 | `找不到这份配方` |

#### `PATCH`

```ts
interface PatchBody {
  name?: string;
  fragment_ids?: string[];
  notes?: string | null;
}
```

**`platform_key` / `site_id` 不可修改**（注释：要改就新建）。三个字段都没给 → 400 `请求里没有要改的字段`。

**200**：`{ ok: true }`

| 状态 | 消息 |
|---|---|
| 400 | `缺少配方 id` |
| 400 | `请求体不是合法 JSON` |
| 404 | `找不到这份配方` |
| 400 | `配方名不能为空` |
| 400 | `配方名最多 60 字` |
| 400 | `至少要保留 1 个策略碎片` |
| 400 | `碎片太多了（上限 30）` |
| 400 | `这些碎片找不到了：{前 3 个 id}` |

`notes === null` 时写 `null`；字符串则 `trim()` 后空 → `null`。

#### `DELETE`

**200**：`{ ok: true, deleted: id }`。只删 `style_recipes` 行，**碎片不动**。

| 状态 | 消息 |
|---|---|
| 400 | `缺少配方 id` |
| 404 | `找不到这份配方` |

---

### 5.3 `GET /api/strategies/search`

源文件：`app/api/strategies/search/route.ts` · 导出函数：`GET`

#### 请求 query

| 参数 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `category` | ❌ | `null` | 必须 ∈ `ARTICLE_CATEGORIES`，否则 400 |
| `tag` | ❌ | `null` | 精确匹配（注释列举：`opening` / `transition` / `closing` / `argument` / `language` / `visual` / `pacing` / `hook`，但**代码不校验**） |
| `platform` | ❌ | `null` | 在 `platform_scope` 数组内做包含匹配；**空 scope 视作「通用」也保留** |
| `limit` | ❌ | `20` | `Math.max(1, Math.min(100, n))`；非法数字 → 20 |

`ARTICLE_CATEGORIES` = `科技` / `经济金融` / `知识科普` / `生活情感` / `职场创业` / `文化娱乐` / `时事评论` / `健康医学`。

实现细节：SQL 先取 `limit * 3` 行（给 platform 过滤留余量）再在内存过滤后 `.slice(0, limit)`。

#### 响应

**200**：

```ts
{
  count: number;
  filters: { category: string | null; tag: string | null; platform: string | null; limit: number };
  items: Array<{
    id: string;
    fingerprint_id: string;
    author_name: string | null;
    category: ArticleCategory | null;
    tag: string | null;
    title: string | null;
    description: string | null;
    example: string | null;
    when_to_use: string | null;
    why_works: string | null;
    platform_scope: string[];
    domain_scope: string[];
  }>;
  by_tag: Record<string, typeof items>;   // key = tag || 'unknown'
}
```

#### 错误

| 状态 | 消息 |
|---|---|
| 400 | `category 必须是 科技 / 经济金融 / 知识科普 / 生活情感 / 职场创业 / 文化娱乐 / 时事评论 / 健康医学 之一` |

**注意**：给定 `category` 后，`category IS NULL` 的全局碎片**不会**被命中（设计有意）。

---

## 6. 选题

### 6.1 `GET /api/topics/recommend`

源文件：`app/api/topics/recommend/route.ts` · 导出函数：`GET` · 流式：SSE(手写)

> **无入参**（不读任何 query）。**无 HTTP 错误分支**——所有失败都通过 SSE `error` 事件表达。

#### 响应（SSE，按代码可发射顺序）

| # | event | data | 触发时机 |
|---|---|---|---|
| 1 | `open` | `{ ok: true }` | 流开始 |
| 2 | `done` | `{ topics: [], empty_reason: '指纹库还是空的，先去 /fingerprints/new 拆一个博主就有了' }` | `fingerprints` 表为空 → 发完关流 |
| 3 | `chunk` | `{ text }` | 有指纹时，模型增量输出 |
| 4 | `error` | `{ message, phase: 'claude' }` | 模型调用失败（兜底 `'模型没回来'`） |
| 4' | `error` | `{ message: '模型输出不是合法 JSON', phase: 'parse', detail, sample }` | JSON 解析失败 |
| 5 | `done` | `{ topics }` | 解析成功 |

数据来源：`fingerprints JOIN authors ORDER BY COALESCE(a.last_used_at, f.created_at) DESC LIMIT 12` + `articles` 最近 12 个非空标题（作为「避免重复」上下文）。
每条指纹传给 prompt 的摘要字段：`fingerprint_summary || author_summary || '（无摘要）'`、`strengths`（数组）、`topic.topic_preference`。

**注意：本路由不发射 `phase` 事件**（`phase` 只出现在 `/api/topics/trending`）。

---

### 6.2 `GET /api/topics/trending`

源文件：`app/api/topics/trending/route.ts` · 导出函数：`GET` · 流式：SSE(手写)

> **无入参**。同样没有 HTTP 错误分支。

#### 响应（SSE，按代码可发射顺序）

| # | event | data | 触发时机 |
|---|---|---|---|
| 1 | `open` | `{ ok: true }` | 流开始 |
| 2 | `done` | `{ topics: [], empty_reason: '还没有爬过任何文章，先去 /fingerprints/new 用 URL 模式拆几个博主，热点池就有数据了' }` | `crawled_articles` 为空（或表不存在） |
| 3 | `phase` | `{ phase: 'tfidf', keyword_count }` | TF-IDF 关键词算完 |
| 4 | `done` | `{ topics: [], empty_reason: '样本太少，关键词聚不出趋势。再多拆几个博主再来。' }` | 关键词 < 3 个 |
| 5 | `chunk` | `{ text }` | 模型增量输出 |
| 6 | `error` | `{ message, phase: 'claude' }` | 模型调用失败 |
| 6' | `error` | `{ message: '模型输出不是合法 JSON', phase: 'parse', detail, sample }` | JSON 解析失败 |
| 7 | `done` | `{ topics, keywords }` | 解析成功 |

`keywords` 是**前 10 个**，形状：

```ts
Array<{ keyword: string; count: number; sample_titles: string[] }>   // sample_titles 最多 3 条
```

算法：读 `crawled_articles ORDER BY crawled_at DESC LIMIT 80` → 标题权重 ×3、正文前 800 字 → 中英 tokenize（英文 ≥3 字符、中文 2–3 字滑窗 + 停用词）→ TF-IDF（`count >= 2` 才计）→ 去掉被更长词包含的短词 → 取前 20 个喂 prompt。

---

## 7. 文章历史

### 7.1 `GET /api/articles/[id]` · `DELETE /api/articles/[id]`

源文件：`app/api/articles/[id]/route.ts` · 导出函数：`GET`、`DELETE`

> 只导出 `GET` + `DELETE`，**没有 POST**。

#### `GET`

**200**：

```ts
{
  id: string;
  title: string;
  content_md: string;
  platform_target: string | null;
  layout_theme: string | null;
  idea: string | null;
  composition: { selected_authors?: Array<{ author_id: string; fingerprint_id: string; weight: number }> };
  outline: unknown | null;
  refine_versions: unknown | null;
  fingerprints: Array<{
    fingerprint_id: string;
    author_id: string;
    author_name: string;
    platform: string | null;
    weight: number;
    has_v3: boolean;                       // 有 platform_fingerprints 或 strategy_fragments
    strategy_fragments: Array<{            // 最多 40 条
      tag?: string;
      platform_scope?: string[];
      title?: string;
      description?: string;
      when_to_use?: string;
    }>;
  }>;
  created_at: number;
}
```

**`content_html` 被 SELECT 出来但没有放进响应体**（`refine_versions` 原样透传 JSON，不做 dict/array 归一）。`composition` / `outline` / `refine_versions` 解析失败时静默退化为 `{}` / `null` / `null`。
`fingerprints` 只包含 `composition.selected_authors` 里能在 DB 命中的项；命不中的静默跳过。

| 状态 | shape |
|---|---|
| 400 | `{ error: '缺少 id' }` |
| 404 | `{ error: '这篇找不到' }` |
| 500 | `{ error: (err as Error).message }` |

#### `DELETE`

事务性说明：**非事务**，先删文章再清关联表。

| 状态 | shape |
|---|---|
| 200 | `{ ok: true }` |
| 400 | `{ error: '缺少 id' }` |
| 404 | `{ ok: false, message: '这篇已经不在了' }` |
| 500 | `{ ok: false, message: '数据库删除失败', detail: string }` |

级联清理：`article_diffs` + `critic_runs`（避免孤儿行）。**不删** `fingerprints` / `authors`。

---

### 7.2 `POST /api/articles/[id]/diff`

源文件：`app/api/articles/[id]/diff/route.ts` · 导出函数：`POST`

#### 请求

```ts
{ from?: string; to?: string }
```

| 规则 | 说明 |
|---|---|
| `from` / `to` 都必须通过 `isValidPlatformKey` | 否则 400 `from / to 平台 key 不合法` |
| `from !== to` | 否则 400 `from 和 to 是同一个平台，没差异` |
| 版本正文解析 | 目标平台 = `articles.platform_target` → 用 `content_md`；否则在 `refine_versions_json` 里找**最新**的 `target_platform === to` 的条目；都拿不到 → 400 |

`resolvePlatformKey()` 兼容老数据里的中文平台名（`公众号` / `知乎` / …）。
`refine_versions_json` 经 `parseRefineVersions()` 归一（兼容 draft 的 dict 形态与 refine 的 array 形态）。

#### 响应

```ts
{
  summary: { overview: string; adjustments: string[] };
  cached: boolean;
  created_at: number;
}
```

缓存 key：`(article_id, from_platform, to_platform)`；命中且 `from_hash` / `to_hash` 都一致时 `cached: true`（hash = `sha1(正文).slice(0,16)`）。内容变了则重算并 UPSERT 覆盖。

#### 错误

| 状态 | 消息 |
|---|---|
| 400 | `缺少 id` |
| 400 | `请求体不是合法 JSON` |
| 400 | `from / to 平台 key 不合法` |
| 400 | `from 和 to 是同一个平台，没差异` |
| 404 | `这篇找不到` |
| 400 | `这两个平台至少有一个没生成过版本` |
| 502 | `这次没成。换个角度再试一次：{msg}` |
| 502 | `模型返回的格式不对，再试一次：{raw 前 200 字}` |

超时 `90_000`。模型输出需满足 `overview` 是 string 且 `adjustments` 是非空 string 数组，否则算格式不对。

---

## 8. 素材与配图

### 8.1 `POST /api/images/auto`

源文件：`app/api/images/auto/route.ts` · 导出函数：`POST` · **非流式**（注释明确：「故意不做 SSE —— 整个流程通常 < 1 分钟」）

> **没有 GET 处理函数**，只导出 `POST`。

#### 请求

```ts
interface AutoRequest {
  article_content?: string;
  fingerprint_id?: string;
  slot_count?: number;
  sources?: ('local' | 'unsplash')[];
}
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `article_content` | ✅ | — | `trim()` 后 ≥ **50** 字，否则 400 `文章内容太短了（不足 50 字），自动配图需要先有正文` |
| `fingerprint_id` | ❌ | — | 用于取 `fingerprint.visual.image_style` 作风格关键词；查不到静默 `null` |
| `slot_count` | ❌ | `3` | `Math.max(1, Math.min(n, 8))` |
| `sources` | ❌ | `['local','unsplash']` | 全小写；空数组视作默认 |

#### 响应

**200**：

```ts
{
  ok: true;
  visual_style: string | null;
  unsplash_configured: boolean;
  slot_count: number;
  slots: Array<{
    slot_index: number;
    position_anchor: string;
    intent_zh: string;
    intent_en: string;
    caption: string;
    candidates: Array<{
      source: 'local' | 'unsplash';
      id: string;              // local_assets.id 或 unsplash photo id
      preview_url: string;
      full_url: string;
      alt: string | null;
      author?: string | null;   // 仅 unsplash
      author_url?: string | null;
    }>;
  }>;
}
```

本地候选的 `preview_url` / `full_url` 都是 `/api/assets/file?id={id}`；Unsplash 候选 `preview_url` = thumb、`full_url` = regular。
每 slot 目标凑 3 个候选：先本地（中文关键词 + 风格词），不足 3 个且 Unsplash 已配置时用 `intent_en + visual_style` 补。

#### 错误

`jsonError()` 统一返回 `{ ok: false, error, ...extra }`：

| 状态 | error | extra |
|---|---|---|
| 400 | `请求体不是合法 JSON` | — |
| 400 | `文章内容太短了（不足 50 字），自动配图需要先有正文` | — |
| 502 | `模型那边没回来：{msg}` | `{ phase: 'claude' }` |
| 502 | `模型这次输出不是合法 JSON，再点一次自动配图大概率就好` | `{ phase: 'parse', detail, sample }` |
| 502 | `模型没给出有效的图意 slot` | `{ phase: 'parse' }` |

模型调用：`streamClaude(prompt, { timeoutMs: 120_000, model: 'sonnet' })`（`model` 是硬编码字面量 `'sonnet'`）。

---

### 8.2 `GET /api/images/search`

源文件：`app/api/images/search/route.ts` · 导出函数：`GET`

#### 请求 query

| 参数 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `q` | ❌（但空则无关键词） | `''` | 中文查询词 |
| `en` | ❌ | `''` | 英文查询词 |
| `limit` | ❌ | `6` | `Math.max(1, Math.min(parseInt(n) \|\| 6, 20))` |
| `sources` | ❌ | `'local,unsplash'` | 逗号分隔，小写；未知值静默忽略 |

#### 响应

**200**（无失败分支）：

```ts
{
  ok: true;
  query: { q_zh: string; q_en: string; sources: string[]; limit: number };
  unsplash_configured: boolean;
  hits: Array<{
    source: 'local' | 'unsplash';
    id: string;
    preview_url: string;
    full_url: string;
    alt: string | null;
    caption: string | null;    // local = tags.join(' · ') || null；unsplash = null
    author: string | null;
    author_url: string | null;
  }>;
}
```

本地检索关键词是 `q` 与 `en` 按 `/[\s,，、]+/` 打平后的并集。

---

### 8.3 `POST /api/assets/scan` · `GET /api/assets/scan`

源文件：`app/api/assets/scan/route.ts` · 导出函数：`POST`、`GET`

#### `POST`

```ts
interface ScanRequest {
  root?: string;
}
```

**空 body 合法**（JSON 解析失败也继续），回落 `DEFAULT_LOCAL_ASSETS_ROOT`。

**白名单**（`ALLOWED_SCAN_ROOTS`，前缀匹配 `base === root || root.startsWith(base + sep)`）：

| 允许根 | 实际值 |
|---|---|
| 默认素材根 | `DEFAULT_LOCAL_ASSETS_ROOT` —— 取 `BYTRACE_ASSETS_ROOT`，未配置则 `<repo>/data/assets` |
| 图片 | `resolve(homedir(), 'Pictures')` |
| 桌面 | `resolve(homedir(), 'Desktop')` |
| 下载 | `resolve(homedir(), 'Downloads')` |

注释明确设计意图：索引结果能经 `/api/assets/file` 读出内容，不设边界等于任意目录可读。

**200**：

```ts
{
  ok: true;
  elapsed_ms: number;
  scanned: number;
  inserted: number;
  skipped_existing: number;
  errors: Array<{ path: string; message: string }>;
  root: string;
  total_in_db: number;
}
```

（`scanned` / `inserted` / `skipped_existing` / `errors` / `root` 来自 `scanDirectory()` 的 `ScanResult` 展开。）

**403**：

```ts
{
  ok: false;
  root: string;
  error: '这个目录不在允许扫描的范围里（素材根目录 / 图片 / 桌面 / 下载）';
  allowed_roots: string[];
}
```

**500**：`{ ok: false, root, error }`

#### `GET`

无参数，不触发扫描。**200**：`{ total_in_db: number; default_root: string }`

---

### 8.4 `GET /api/assets/file`

源文件：`app/api/assets/file/route.ts` · 导出函数：`GET`

#### 请求

| query | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | `local_assets.id`。**不接受文件路径**，防止变成任意文件读 |

#### 响应

**200**：图片二进制流。headers：

| Header | 值 |
|---|---|
| `Content-Type` | 按扩展名映射：`.jpg`/`.jpeg` → `image/jpeg`，`.png` → `image/png`，`.webp` → `image/webp`，`.gif` → `image/gif`，其它 → `application/octet-stream` |
| `Content-Length` | 文件的 `stat.size` |
| `Cache-Control` | `private, max-age=300` |

#### 错误（**纯文本**，非 JSON）

| 状态 | body |
|---|---|
| 400 | `missing id` |
| 404 | `not found` |
| 410 | `file missing on disk` |

---

### 8.5 `POST /api/scan-assets`

源文件：`app/api/scan-assets/route.ts` · 导出函数：`POST`

> ⚠️ 与 `/api/assets/scan` 功能重叠，但**没有 root 白名单**，且 500 会回传 `stack`。见附录 · 附.2。

#### 请求

```ts
{ path?: string }
```

空 body 合法。**默认路径**按优先顺序解析：

```
1. BYTRACE_SCAN_DEFAULT_DIR
2. ~/Pictures
3. 当前工作目录
```

**任意路径都会被扫描**（无白名单校验，与 `/api/assets/scan` 的差异见附录 · 附.2）。

#### 响应

**200**：

```ts
{
  ok: true;
  path: string;
  elapsed_ms: number;
  scanned: number;
  inserted: number;
  skipped_existing: number;
  errors: Array<{ path: string; message: string }>;   // 前 5 条
  total_assets: number;
}
```

**500**：

```ts
{ ok: false; error: string; stack: string | undefined }
```

---

### 8.6 `POST /api/tag-assets`

源文件：`app/api/tag-assets/route.ts` · 导出函数：`POST` · `export const maxDuration = 300`

#### 请求

```ts
{ limit?: number; all?: boolean; root?: string }
```

| 字段 | 必填 | 默认 | 规则 |
|---|---|---|---|
| `limit` | ❌ | `Infinity` | 非有限数 → 全量；否则 `rows.slice(0, limit)` |
| `all` | ❌ | `false` | `false` → `WHERE ai_tagged = 0`（只打未标过的）；`true` → 全表 |
| `root` | ❌ | `DEFAULT_LOCAL_ASSETS_ROOT` | 作为 Claude CLI 的 `--add-dir` 参数；**无白名单** |

排序 `ORDER BY indexed_at ASC`。**串行**逐张处理（订阅不并发），单张走 `classifyImageWithClaude`（一次 `claude -p` + Read 工具真看图）。

#### 响应

**200 空集**：

```ts
{ ok: true; message: '没有需要打标的图片'; total: 0; success: 0; failed: 0 }
```

**200 正常**：

```ts
{
  ok: true;
  total: number;
  success: number;
  failed: number;
  results: Array<{
    id: string;
    path: string;
    success: boolean;
    elapsed_ms: number;
    visual_style?: string;   // 仅 success
    tags?: string[];         // 仅 success
  }>;
}
```

单图失败是 fail-open（保留 scanner 启发式标签，`success: false`），**没有 HTTP 错误分支**。

---

## 9. 设置与工具

### 9.1 `GET /api/settings` · `PATCH /api/settings`

源文件：`app/api/settings/route.ts` · 导出函数：`GET`、`PATCH`

#### `GET`

**200**：`Record<string, string>` — 直接把 `settings` 表所有 k/v 铺平成对象（非 `{items}` 包裹）。

| 状态 | shape |
|---|---|
| 500 | `{ error: (err as Error).message }` |

#### `PATCH`

```ts
{ key?: unknown; value?: unknown }
```

**白名单只有 `default_theme`**：

```ts
const ALLOWED_KEYS = new Set(['default_theme']);
const VALUE_VALIDATORS = {
  default_theme: (v) => ['B', 'C', 'D'].includes(v),
};
```

只有 string 类型被接受；非 string（含数字、null、对象）一律被强制成 `''` 后走后续校验。

**200**：`{ ok: true, key, value }`

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `key 不能为空` |
| 400 | `不允许写入 key={key}` |
| 400 | `key={key} 的取值 {value} 不在允许范围内` |
| 500 | `{ error: (err as Error).message }`（写入失败） |

---

### 9.2 `POST /api/crawl-preview`

源文件：`app/api/crawl-preview/route.ts` · 导出函数：`POST`

#### 请求

```ts
interface ReqBody {
  url?: string;
  /**
   * 'article'：单篇（默认 / 旧行为）
   * 'index'：作者主页/板块页拉文章列表
   * 'auto'：先 detectUrlKind，是 index 就走 index 模式，是 article 就走 article；
   *         unknown 时按 article 兜底
   */
  mode?: 'article' | 'index' | 'auto';
}
```

`url` 非空必填（否则 400 `URL 不能为空`）。`mode` 默认 `'article'`；`'auto'` 时 `detectUrlKind` 结果写入响应的 `auto_detected_kind`。

#### 响应（**业务失败也是 HTTP 200**）

**不支持抓取的域名**（先于 crawl 判断）：**200**

```ts
{
  ok: false;
  platform: string;
  is_wechat: boolean;
  hint: string;   // typeInfo.hint || ('公众号文章爬不动，麻烦切到正文模式贴一下' | '这个链接不太对劲，再检查一下')
}
```

**`mode='index'` 成功** → **200**：

```ts
{
  ok: true;
  mode: 'index';
  platform: string;
  author_name: string;
  article_urls: string[];
  auto_detected_kind: 'article' | 'index' | 'unknown' | null;
}
```

**`mode='index'` 失败** → **200**：`{ ok: false, platform, reason, hint }`

**`mode='article'` 成功** → **200**：

```ts
{
  ok: true;
  mode: 'article';
  platform: string;
  title: string;
  preview: string;          // 正文前 200 字
  full_length: number;      // 正文总长
  image_count: number;
  url: string;
  url_hash: string;
  medium: string;           // result.medium ?? 'text'
  auto_detected_kind: 'article' | 'index' | 'unknown' | null;
}
```

**`mode='article'` 抓取失败** → **200**：`{ ok: false, platform, reason, hint }`

**抛异常** → **200**：`{ ok: false, platform, hint: '抓这一条的时候网络抽风了：{msg}' }`

#### 错误（HTTP 4xx）

| 状态 | 消息 |
|---|---|
| 400 | `请求体不是合法 JSON` |
| 400 | `URL 不能为空` |

---

### 9.3 `GET /api/search-authors`

源文件：`app/api/search-authors/route.ts` · 导出函数：`GET`

#### 请求

| query | 必填 | 说明 |
|---|---|---|
| `q` | ✅ | 博主名 |

#### 响应

**200 成功**：`{ ok: true, candidates: AuthorCandidate[] }`（`AuthorCandidate` 定义在 `lib/search/`）

**200 业务失败**：`{ ok: false, reason, message }` — 前端按 `reason` 显示提示，**不当 HTTP 错误**。

**400**（仅 `q` 为空）：`{ ok: false, reason: 'no-results', message: '搜啥呢，名字总得给一个' }`

**200 引擎异常**：`{ ok: false, reason: 'engine-error', message: '搜索后台抽风：{msg}' }`

> **本路由的错误信封不是 `{ error: string }`**，是 `{ ok: false, reason, message }`。

---

### 9.4 `POST /api/import/wechat-draft`

源文件：`app/api/import/wechat-draft/route.ts` · 导出函数：`POST`

#### 请求

```ts
interface WechatDraft {
  title: string;
  content_html: string;
  create_time: number;
  update_time: number;
}
interface ImportRequest {
  drafts: WechatDraft[];
}
```

| 规则 | 说明 |
|---|---|
| `drafts` | 非空数组，否则 400 |
| 去重 | 按 `title` **精确匹配** `articles.title`，命中则 skip |
| 标题兜底 | `draft.title?.trim() \|\| '（无标题）'` |
| 落库字段 | `platform_target = 'wechat'`；`content_md = htmlToMarkdown(content_html)`；`created_at = draft.update_time \|\| now`；`user_prompt = '从公众号草稿箱导入于 {new Date().toLocaleString()}'` |
| HTML→MD | 基础正则转换（`br`/`p`/`h1-h3`/`strong`/`b`/`em`/`i`/`a`/`img` + 实体还原 + 折叠 3 个以上空行） |

#### 响应

**200**：

```ts
{
  ok: true;
  imported: number;
  skipped: number;
  errors: string[];        // 前 10 条，格式 `导入《{title}》失败: {msg}`
  message: string;         // `成功导入 {imported} 篇，跳过 {skipped} 篇重复`
}
```

#### 错误

| 状态 | shape |
|---|---|
| 400 | `{ error: '没有提供草稿数据' }` |
| 500 | `{ error: '导入失败: {msg}' }` |

单条草稿的循环内异常不中断整体，记进 `errors`。

---

### 9.5 `GET /api/health`

源文件：`app/api/health/route.ts` · 导出函数：`GET` · 声明：`runtime='nodejs'`、`dynamic='force-dynamic'`

运行自检端点。一次请求回答「现在到底配好了没有、哪儿没配」。

**设计约定**：

- **永远返回 200**。某一项不可用属于可诊断信息，不是请求失败。
- **只报告状态，绝不回显任何密钥**（只给布尔值与变量名，不给值本身）。
- `ok` 的含义是「**主 Agent 与数据库都就绪**」，即工具能不能干活的最低门槛；审查模型与联网搜索缺失不影响 `ok`。

**200**：

```ts
{
  ok: boolean;
  checked_at: string;              // ISO 时间戳
  summary: string;                 // 一句话结论
  checks: Array<{
    key: 'agent' | 'review' | 'search' | 'database' | 'data_dir' | 'images';
    label: string;
    status: 'ready' | 'missing' | 'unavailable' | 'not-needed';
    detail: string;                // 当前值的人类可读描述（不含密钥）
    fix?: string;                  // 未就绪时给出可操作的修复提示
  }>;
  debug: {
    cwd: string;
    node: string;                  // process.version
    claude_bin_resolved: string;
    claude_bin_candidates: string[];
    agent_provider: string;
    agent_is_local_cli: boolean;
    agent_is_mimo: boolean;
    search_provider: string;
    search_doubao_ready: boolean;
    search_mimo_ready: boolean;
  };
}
```

**`status` 语义**：

| 值 | 含义 |
|---|---|
| `ready` | 已配置且可用 |
| `missing` | 必填项缺失（带 `fix` 指明填哪个变量） |
| `unavailable` | 已配置但不可用（例如 CLI 文件找不到、数据库打不开） |
| `not-needed` | 可选项未配置，不影响主流程 |

**检查项说明**：

| key | 判什么 |
|---|---|
| `agent` | 主 Agent。本机 CLI 模式看可执行文件是否存在；API 模式看端点 / key / 模型是否齐全 |
| `review` | 审查模型。区分「跨模型互审（独立配置）」与「继承主 Agent」两种状态 |
| `search` | 联网事实搜索。按 `provider=auto` 推导出**实际会走的通道**，并列出全部可用通道 |
| `database` | 数据库能否打开 + 三张主表的行数 |
| `data_dir` | 当前数据目录位置及来源 |
| `images` | 配图来源（本地素材库 / 免费图库） |

---

### 9.6 `GET /api/health/search`

源文件：`app/api/health/search/route.ts` · 导出函数：`GET` · 声明：`runtime='nodejs'`、`dynamic='force-dynamic'`、`maxDuration=120`

与 `/api/health` 的区别：**这个端点真的会去打一次联网搜索**。

| 端点 | 是否发网络请求 | 耗时 | 用途 |
|---|---|---|---|
| `/api/health` | 否 | 秒回 | 只检查「配了没有」 |
| `/api/health/search` | **是** | 十几秒起 | 检查「通不通」，并回报每条通道的实际结果 |

**Query**：

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `q` | 否 | `2026 年 AI 产品经理 行业趋势` | 搜索关键词 |

**200**：

```ts
{
  ok: boolean;                     // 是否至少有一条通道成功
  query: string;
  preferred_provider: string;      // 配置里指定的通道（auto / mimo / doubao / …）
  effective_provider: string | null; // 实际第一个成功的通道
  summary: string;
  config: {
    doubao_ready: boolean;
    mimo_ready: boolean;
    tavily_ready: boolean;
    google_cse_ready: boolean;
    web_facts_fallback_ready: boolean;  // 恒为 true（免密钥兜底）
  };
  probes: Array<{
    provider: string;
    label: string;
    attempted: boolean;            // 未配置则为 false
    ok: boolean;
    hitCount: number;
    elapsedMs: number;
    error?: string;                // 已脱敏
    pluginDisabled?: boolean;      // 命中「联网插件未开启」这类可操作原因
    samples: Array<{ title: string; host: string }>;  // 前 3 条，只给标题与域名
  }>;
  note: string;
}
```

**设计约定**：逐条通道独立试、任一成功即可用；某条失败不会导致整体报错。输出不含任何密钥，来源样本也只给标题与域名，不给全文。

> 注意：调用一次会消耗一次搜索额度。这是**排错接口**，不是给日常流程反复调用的。

---

## 10. SSE 事件总表

> 覆盖全部 11 个流式路由。事件顺序 = 代码可发射顺序。
> `SSE(helper)` 的路由额外具备：`: heartbeat` 每 10s（空闲 >15s 时）、handler 抛出时兜底 `error { message, phase: 'unknown' }`、`finally` 关流。

### 10.1 事件速查

| 路由 | event | data 形状 | 何时触发 |
|---|---|---|---|
| `POST /api/fingerprint` | `open` | `{ ok: true }` | 流开始（**无心跳**） |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' }` | Claude 失败 |
| | `error` | `{ message, phase: 'parse', detail, sample }` | JSON 解析失败 |
| | `error` | `{ message, phase: 'db', detail }` | 落库失败 |
| | `done` | `{ fingerprint_id, author_id }` | 落库成功 |
| `POST /api/fingerprint/v2` | `open` | `{ ok: true, total }` | 流开始（**无心跳**） |
| | `phase` | `{ phase: 'prepare', message }` | 准备阶段 |
| | `article` | `{ index, status: 'ready', title, category, source, chars, image_count }` | 单篇就绪 |
| | `error` | `{ message, phase: 'prepare', index }` | 单篇准备失败 |
| | `phase` | `{ phase: 'stage1', message }` | stage1 开始 |
| | `article` | `{ index, status: 'analyzing' }` / `{ index, status: 'analyzed' \| 'analyzed-loose' }` | 单篇开始 / 结束 |
| | `chunk` | `{ stage: 'stage1', index, text }` | stage1 增量 |
| | `phase` | `{ phase: 'stage2', message }` | stage2 开始 |
| | `chunk` | `{ stage: 'stage2', text }` | stage2 增量 |
| | `error` | `{ message, phase: 'stage1' \| 'stage2' \| 'parse' \| 'db', ... }` | 各阶段失败 |
| | `done` | `{ fingerprint_id, author_id, strategy_count, article_count }` | 落库成功 |
| `POST /api/fingerprint/v3` | `open` | `{ ok: true, total }` | 流开始（**无心跳**） |
| | `stage` | `{ stage: 'prepare' \| 'stage0' \| 'stage1' \| 'stage2' \| 'stage3' \| 'category-profiles', ... }` | 各阶段开始/结束（结束带 `status:'done'` + `ms`） |
| | `article` | `{ index, status: 'ready' \| 'skipped-duplicate' \| 'categorized' \| 'analyzing' \| 'analyzed' \| 'analyzed-loose', ... }` | 单篇状态流转 |
| | `chunk` | `{ stage: 'stage1' \| 'stage2' \| 'stage3', index?, text }` / `{ stage: 'category-profile', category, text }` | 模型增量 |
| | `warn` | `{ phase: 'stage0' \| 'parse-stage3' \| 'stage3' \| 'category-profile', message, ... }` | 非致命失败 |
| | `category-profile-done` | `{ category, sample_count }` | 某类别配方成功 |
| | `error` | `{ message, phase: 'prepare' \| 'abort' \| 'stage1' \| 'stage2' \| 'parse-stage2' \| 'db', ... }` | 致命失败 |
| | `done` | `{ fingerprint_id, author_id, schema, article_count, platforms_analyzed, categories_analyzed, strategy_count, timings_ms }` | 落库成功 |
| `POST /api/authors/[id]/optimize` | `open` | `{ ok: true, author_name }` | 流开始（**无心跳**） |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' \| 'parse' \| 'db', detail?, sample? }` | 失败 |
| | `done` | `{ fingerprint_id, author_id, version, article_count }` | 落库成功 |
| `POST /api/recommend` | `open` | `{ count }` | 流开始（helper） |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' \| 'parse' \| 'normalize' }` | 失败 |
| | `done` | `{ recommendations }` | 成功 |
| `POST /api/compose/outline` | `open` | `{ ok: true }` | 流开始（helper） |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' \| 'parse' \| 'normalize' }` | 失败 |
| | `done` | `{ outline }` | 成功 |
| `POST /api/compose/gather` | `cached` | `{ idea_hash, material_md, chars, elapsed_ms, created_at, from_cache: true }` | 命中缓存（随后立刻 `done`） |
| | `started` | `{ idea_hash }` | 未命中缓存，开始搜集 |
| | `progress` | `{ elapsed_ms, search_engine, search_hits? }` | 搜索完成 + 每 15s 心跳式进度 |
| | `error` | `{ message }`（**无 phase**） | 搜集失败 |
| | `done` | `{ idea_hash, material_md, chars, elapsed_ms, from_cache, search_engine?, search_hits? }` | 成功 |
| `POST /api/compose/draft` | `open` | `{ ok: true, sections, platforms, main_platform }` | 流开始（helper） |
| | `platform_start` | `{ platform, index, is_main }` | 每个平台开始 |
| | `rewrite_start` | `{ platform, attempt, reason }` | 第 2 次起重写 |
| | `delta` | `{ platform, delta, attempt }` | 正文增量 |
| | `critic_start` | `{ platform, attempt }` | 开始评分 |
| | `critic` | `{ platform, attempt, total, passed, scores, weakest, rewrite_hint, elapsed_ms, threshold }` | 评分成功 |
| | `critic_error` | `{ platform, attempt, message, elapsed_ms }` | 评分失败（fail-open） |
| | `critic_best_of_n` | `{ platform, picked_attempt, picked_total, all_attempts, threshold }` | 取最高分稿 |
| | `platform_done` | `{ platform, content_md, word_count, is_main, critic_final_attempt, critic_runs_count }` | 单平台定稿 |
| | `error` | `{ platform, message, phase: 'claude', attempt }` / `{ message, phase: 'db', detail }` | 单平台失败 / 落库失败 |
| | `done` | `{ article_id, title, main_platform, content_md, content_html, versions, all_word_count, errors, critic_summary }` | 全部完成 |
| `POST /api/compose/refine` | `open` | `{ platform, source_platform, cross_hints }` | 流开始（helper） |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' }` | 失败 |
| | `done` | `{ content_md, platform, source_platform }` | 成功 |
| `GET /api/topics/recommend` | `open` | `{ ok: true }` | 流开始（**无心跳**） |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' \| 'parse' }` | 失败 |
| | `done` | `{ topics, empty_reason? }` | 成功或空库 |
| `GET /api/topics/trending` | `open` | `{ ok: true }` | 流开始（**无心跳**） |
| | `phase` | `{ phase: 'tfidf', keyword_count }` | 关键词统计完成 |
| | `chunk` | `{ text }` | 模型增量 |
| | `error` | `{ message, phase: 'claude' \| 'parse' }` | 失败 |
| | `done` | `{ topics, keywords?, empty_reason? }` | 成功或数据不足 |

### 10.2 事件名清单（去重）

| event | 出现的路由 |
|---|---|
| `open` | fingerprint v1 / v2 / v3、authors optimize、recommend、outline、gather、draft、refine、topics/recommend、topics/trending（11/11） |
| `done` | 全部 11 个流式路由 |
| `error` | 全部 11 个流式路由 |
| `chunk` | fingerprint v1 / v2 / v3、authors optimize、recommend、outline、refine、topics/recommend、topics/trending |
| `phase` | fingerprint v2、topics/trending **（仅这两个）** |
| `stage` | fingerprint v3 **（仅此一个）** |
| `article` | fingerprint v2、fingerprint v3 |
| `warn` | fingerprint v3 **（仅此一个）** |
| `category-profile-done` | fingerprint v3 **（仅此一个）** |
| `started` / `progress` / `cached` | compose/gather |
| `platform_start` / `delta` / `platform_done` | compose/draft |
| `rewrite_start` / `critic_start` / `critic` / `critic_error` / `critic_best_of_n` | compose/draft |

### 10.3 payload 细节备注

| 备注 | 内容 |
|---|---|
| `chunk` 三种形态 | ① `{ text }`（v1 / optimize / recommend / outline / refine / topics）② `{ stage, index?, text }` 或 `{ stage:'category-profile', category, text }`（v3）③ `{ stage, index, text }`（v2） |
| `draft.critic.scores` | `Record<'structure'\|'depth'\|'analogy'\|'punchline'\|'taboo', { score: 0-5; reason: string }>` |
| `draft.done.versions` | `Record<platform, markdown>`，含主平台 |
| `draft.done.critic_summary` | `use_critic: false` 时是 `null` |
| v3 `stage` 结束态 | `{ stage, status: 'done', ms }`；stage3 单平台跳过态是 `{ stage:'stage3', status:'skipped', reason }` |
| gather `progress` | 第一次带 `search_hits`，之后每 15s 只带 `{ elapsed_ms, search_engine }` |
| `error.phase` 取值全集 | `'unknown'`（helper 兜底）、`'abort'`、`'prepare'`、`'stage1'`、`'stage2'`、`'parse-stage2'`、`'stage3'`、`'parse-stage3'`、`'claude'`、`'parse'`、`'normalize'`、`'db'` |

---

## 附：实现约定与注意事项

### 附.1 跨路由公共约定

- 本文档覆盖的 34 个 route 都声明 `export const runtime = 'nodejs'` 与 `export const dynamic = 'force-dynamic'`。非默认 `maxDuration` 出现在两处：`app/api/tag-assets/route.ts`（300）与 `app/api/health/search/route.ts`（120）。
- SSE 心跳只由 `lib/sse.ts` 的 `createSseStream()` 提供（`: heartbeat`，每 10s 检查、空闲超过 15s 才发）。6 个手写流路由**没有心跳**：`fingerprint`(v1)、`fingerprint/v2`、`fingerprint/v3`、`authors/[id]/optimize`、`topics/recommend`、`topics/trending`。这些路由长时间无输出时可能被中间层断连，也没有 helper 那条终局 `error` 兜底。
- 事件名以 §10 为准：`fingerprint/v3` 发的是 `stage`（v2 才用 `phase`）；`topics/recommend` **不**发射 `phase`（只有 `topics/trending` 发）。
- 错误响应正常不泄漏堆栈，只回 `(err as Error).message`。例外：`/api/scan-assets` 的 500 带 `stack`；`/api/compose/draft` 只把 stack 打到服务端 console。
- 响应 JSON 的 key 一律 `snake_case`；数据库访问统一走 `lib/db.ts` 的 `getDb()` 单例（better-sqlite3，同步 API）；模型调用统一走 `lib/claude.ts` 的 `streamClaude()`。

### 附.2 素材扫描端点

- `/api/assets/scan` 有 `ALLOWED_SCAN_ROOTS` 白名单（素材根 / 图片 / 桌面 / 下载），越界返回 403 + 中文提示。
- `/api/scan-assets` 接受任意 `path`，**没有白名单**，默认路径硬编码在路由里。
- `/api/tag-assets` 的 `root` 同样无白名单，会被当作 Claude CLI 的 `--add-dir` 参数传入。
- 两个扫描端点功能重叠：需要目录边界保护时用 `/api/assets/scan`。`/api/scan-assets` 的 500 会回传 `stack`，与全局「不泄漏堆栈」的约定不同。

### 附.3 JSON 清洗与字段形态

- `stripJsonFence` 在 `lib/sse.ts` 有导出实现，但 `fingerprint`(v1)、`fingerprint/v2`、`fingerprint/v3`、`authors/[id]/optimize`、`topics/recommend`、`topics/trending` 各自保留了一份本地副本。v3 的副本多了「fence 结果先 `JSON.parse` 验证，失败再回退大括号截取」的增强逻辑；改清洗逻辑时这几处要同步。
- `pickAvatarChar` 已抽到 `lib/authors/avatar.ts`（v3 与 `authors/[id]` PATCH 在用），但 `fingerprint`(v1) 与 `fingerprint/v2` 仍各自内联一份相同实现。
- `articles.refine_versions_json` 存在 dict 与 array 两种形态（`compose/draft` 的新建分支写 dict，复用分支写 array），读取必须经 `parseRefineVersions()` 归一，不要在调用方手写 `JSON.parse` + `Array.isArray`。
- `fingerprint/v3` 的样本去重口径：URL 模式用 `hashUrl(url)`，粘贴模式用 `sha1(正文前 200 字)`。同一篇正文改动开头 200 字会被当成新样本，反复粘贴相近正文会累积重复样本。

### 附.4 版本标记的使用

- 判别 v1 / v2 / v3 涉及两个列，语义不同：`version_schema === 'v3'` 用于判断「是不是 v3」；数字列 `version` 用于排序与「取最新一版」。
- `fingerprint`(v1) 与 `fingerprint/v2` 的 INSERT 列清单里都**不写 `version_schema`**，所以 v2 指纹落库后是 `version=2` 而 `version_schema='v1'`。**只用 `version_schema` 无法区分 v1 与 v2**，必须看 `version`。
- `/api/authors/[id]/optimize` 走的是 v1 通道：新指纹行 `model_version = 'claude-code-cli'`、不写 `version_schema`、`version = oldVersion + 1`。v3 指纹会被 409 拦下；v2 指纹经这条通道后，新行只呈现 v1 风格。

### 附.5 落库与事务

- `/api/compose/gather` 只导出 `POST`，没有 GET；缓存查询在 POST 内部按 `idea_hash` 完成，命中时以 `cached` + `done` 事件返回。
- `/api/images/auto` 只导出 `POST`。
- `/api/compose/draft` 的 `platforms` 串行执行、主平台强制排到第一位、单平台失败不阻断后续平台、`use_critic` 默认 `true`。
- `sites/[id]` 的 DELETE（先 `site_articles` 再 `sites`）与 `articles/[id]` 的 DELETE（先删主体再清关联表）都**不是事务**，中途出错会留下中间状态。
- `GET /api/articles/[id]` 的 SELECT 列表包含 `content_html`，但响应体不返回该字段；需要 HTML 预览时要另行补上。
- `fingerprint/v3` 的 POST 在路由内自行实现了 Stage 0/1/2/3 + 类别配方，而 `lib/fingerprints/v3-engine.ts` 有同一套逻辑供 PATCH 使用。两处必须同步修改，否则会漂移。

### 附.6 实现边界（本文档只覆盖路由层契约）

以下细节由各自模块定义，本文只记录路由层传入 / 传出的值：

| 项 | 定义位置 |
|---|---|
| `streamClaude()` 各选项（`timeoutMs`、`model`、`signal`、`onChunk`）的语义与默认值、`ARTICLE_MODEL` 的实际值 | `lib/claude.ts` |
| `AuthorCandidate` 的完整字段 | `lib/search/` |
| `runProfileExtraction()` 产出的 `profile_json` 字段集 | `lib/sites/profile-engine.ts` |
| `fingerprint_json`（v1 / v2 / v3）的完整字段集 | `lib/prompts/fingerprint*.ts`、`lib/composition.ts` |
| `detectUrlType()` / `detectUrlKind()` / `crawlAuthorIndex()` / `crawlArticle()` 的返回联合类型 | `lib/crawler/` |
| `searchWebFacts` 与 MiMo web_search 的内部降级顺序 | `lib/search/` |
| `PLATFORMS` 中 `custom` 卡的 `word_range_min/max` / `pacing` / `tone_tag` / `ui_hint` | `lib/platforms.ts` |
| 表 / 列的完整 DDL 与 JSON 列形状 | 见 DATA-MODEL |
| 硬编码的 `model: 'sonnet'` 是否为 CLI 合法标识 | `lib/claude.ts` |

### 附.7 修改代码时容易改坏的点

- `DELETE /api/fingerprint/v3/[id]`：必须先 `UPDATE crawled_articles SET author_id = NULL` 再删孤儿 author，否则 `ON DELETE CASCADE` 会把语料删光。
- `/api/compose/gather` 命中缓存时只发 `cached` + `done`，不要期待 `started` / `progress`。
- `/api/articles/[id]/diff` 的 `from` / `to` 白名单校验、同平台拦截、`article_diffs` 按 `from_hash` / `to_hash` 缓存与失效都要保持。
- `compose/draft` 的 critic 是 fail-open：critic 自身失败只发 `critic_error`，该稿按「未评估」落库并跳出循环。
- `compose/draft` 落库失败时只发 `error`（`phase: 'db'`）就 return，**不再发 `done`**。
- 心跳、终局 `error` 兜底与 `finally` 关流只属于 `lib/sse.ts` 的 helper；新增流式路由时优先复用它，或自行补齐这三件事。
