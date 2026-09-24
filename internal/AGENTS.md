# AutoArticle · 项目构造记录

> 写给下一个 Codex 看。也写给Ethan几周后回来看。
> 最后更新：2026-05-27（v3.3 收尾 · 多平台 N 个版本 + 配图自动接入 + 列表页快捷删除 + v3.3 端到端验证通过）
> 历史里程碑：
>   2026-05-25 · v3.1 自动分类 + OpenCLI 接入 + 反爬约束 v2
>   2026-05-25 · v3.2 风格配方（策略碎片组合可命名 / 保存 / 复用）
>   2026-05-26 · v3.3 结构能力（structure_repertoire / depth_pattern / analogy_bank）+ outline / article prompt 重写
>   2026-05-27 · v3.3 收尾 + 多平台 compose（一次出 N 个版本 / Step 6 tabbed）+ 配图自动接入 draft 流 + 指纹列表页快捷删除

## 这是什么

本地 Next.js Web 应用。用户给一段思路（题材 + 角度 + 核心观点）+ 选一个博主风格指纹（或挑一份风格配方）+ 选一份站点画像 → 流式生成有深度、有论证骨架的成品文。

**关键约束（违反会被Ethan纠正）**：

- ✅ 走本机 Codex CLI（child_process）—— **不接 Anthropic API、不带 key、不联网调 LLM**
- ✅ Codex CLI 必须用 `--output-format stream-json --include-partial-messages` 才会真流式。**别再用裸 `Codex -p`**，会等整篇生成完才一次性返回（100+ 秒静默）
- ✅ 数据全留本机 SQLite —— **不上云、不做 SaaS**
- ⚠️ **公众号 / B 站 / 小红书 / 抖音爬取规则**：见下方「反爬与账号边界 v2」专节，主通道走 OpenCLI 借登录浏览器
- ❌ **文章正文严禁 emoji 和装饰符号**（写作工具气质要"克制"）
- ❌ **不要做自定义颜色调节器**——只允许选默认主题
- ✅ 文案语气**陪伴而非审判**："这次模型卡住了，我们换个角度再试一次" 不要 "生成失败"
- ✅ **抽象论点必须配物件级类比**（v3.3 核心约束）：article prompt 强制让模型从博主 analogy_bank 里挑具象物件（"黄牛在天台抽烟" / "户口本进 iCloud"），禁止凭空造抽象隐喻（"如同登山"不算）
- ✅ **每节正文首段必须回扣上节 thesis**（v3.3 核心约束）：避免"平铺列举式"伪深度，强制论证按因果链 / 双线对比 / 同心圆等形态走

---

## 2026-05-27 这一轮做了什么（要点速览）

主要是 v3.3 收尾验证 + 4 件并行 feat（前 3 件已通过多 agent 并行落地，第 4 件单 agent 单干）：

1. **v3.3 端到端验证通过**（task 1）
   - 思敏学姐指纹（id `x6xiH7pG20ytvU`）顶层三字段全部就位 ——
     - `structure_repertoire`（dominant=problem_solution，4 种结构带 execution_traits）
     - `depth_pattern`（average_layers=4，max_layers=5，6 条 drilling_phrases + 一段 drilling_observation）
     - `analogy_bank`（15 个**物件级**类比，全具象无抽象隐喻——符合 v3.3 强约束）
   - **重要事实纠正**：这三字段写在 fingerprint_json **顶层**，不在 platform_fingerprints[平台] 下——读取时别走平台节点。原 agent prompt 错指过这里，已修

2. **热点聚合 tab 复核**（task 3，零代码改动）
   - AGENTS.md 原第 354 行那条 TODO "/topics 热点聚合是 mock" 是**过期描述**
   - 实地核查：`app/api/topics/trending/route.ts` + `lib/prompts/topic-trending.ts` 已接通真 Codex（走 `crawled_articles` 表 → TF-IDF 算关键词 → Codex 合并出题路径）
   - 文档更新为已接，task 关闭

3. **配图自动接进 draft 流**（task 2）
   - `components/compose/ImagePanel.tsx` 加 `autoStart?: boolean` prop + `autoStartedRef` 防重复触发 + runAuto 改 useCallback
   - `app/compose/page.tsx` 顶部 import ImagePanel；Step 7 占位 Panel（原文案"配图能力由独立模块负责…"）换成真 `<ImagePanel articleContent={draftMd} fingerprintId={按 weight 排序取主博主} autoStart />`
   - **不动** `/api/images/auto`（POST 已够用，不需要加 GET 端点）/ schema / 其他组件
   - Agent B 原设想"加 GET 端点 + 受控模式 + 改 ImagePanel 核心"被精简掉

4. **列表页 `/fingerprints` 加快捷删除**（task 5）
   - 新建 `app/fingerprints/VersionFingerprintCard.tsx`（client 组件）：包卡 + 右上角 hover 出现的小垃圾桶（默认 opacity:0）+ 两段式确认（红色条覆盖卡顶，"再点一次删除" / "取消"，3 秒自动撤回）+ `router.refresh()`
   - `app/fingerprints/page.tsx` VersionsView 里 inline `<Link className="fp-card">` 换成 `<VersionFingerprintCard />`，AuthorsView **不动**（按博主聚合删整个博主是不同语义，留作另一个 feature）
   - `app/globals.css` 加 `.fp-card-wrap` / `.fp-card-trash` / `.fp-card-confirm` / `.fp-card-confirm-yes` / `.fp-card-confirm-no` / `.fp-card-error`
   - 复用现有 `DELETE /api/fingerprint/v3/[id]` 级联删 5 张表，**不动 API**

5. **多平台一次出 N 个版本**（task 4，最大一件）
   - **关键决策**（Ethan拍板）：
     - N 平台勾选入口在 Step 1（路径 A）：主卡保留单选作为"主平台 + 主画像"，主卡下加 chip 多选行；主平台默认勾且不可取消；非主平台走 generic **不挑站点画像**
     - outline **完全共享**（路径 a）：按主平台生成一份，draft 时各平台 article prompt 自行压缩 / 扩张
     - 服务端**串行**而非并发（决策 5）：本机 Codex 是 Pro 订阅，并发会撞限速
   - **draft route**（`app/api/compose/draft/route.ts`）：
     - 入参加 `platforms: PlatformKey[]`（默认 `[target_platform ?? 'wechat']`，单平台等同改动前）
     - 服务端按数组顺序循环 streamClaude，每平台显式 `timeoutMs: 240_000`
     - SSE 协议：`open { platforms[] }` → `platform_start { platform }` → `delta { platform, delta }` → `platform_done { platform, content_md, word_count }` → `done { versions, all_word_count, errors }` / `error { platform?, message }`
     - 单平台失败不阻断后续（continue + push errors[]）
     - 客户端 AbortController 一次切所有平台
     - 落库：主平台 content_md + 其它平台 dict 形态 `{ [platform]: md }` 进 `articles.refine_versions_json`
   - **compose page**（`app/compose/page.tsx`）：
     - Step 1 加 chip 多选行「ALSO PUBLISH TO · 顺手出这些版本」，主平台 chip disabled + 灰底 + "主" mono label；提示"这次会写 N 份正文 · 串行生成"
     - Step 6 改 tabbed：顶部 tab bar 每平台一条，状态纯文字 "排队中" / "流式中" / "已完成 N 字"（禁 emoji）；每平台独立 scroll 容器 `display:none` 切换不丢已流内容；左侧 sticky 大纲只对 active tab 高亮；切到未开始 tab 显示陪伴文案"轮到这条排队中，到它了再开始"
     - 状态机重构：删除单 `draftMd` state，改用 `draftMap: Partial<Record<PlatformKey, DraftEntry>>` + useMemo 派生
     - Step 7 直接命中 `refineMap` 缓存（draft 完成时把所有平台版本批量塞入），没缓存才回退调 refine（保留 refine 兜底）
   - **单平台路径退化等同改动前**——只勾主平台时 UI / API / SSE / 落库都一致

### 本轮 commit 拆分（拟）
- `feat(compose):` 多平台 N 个版本 + 配图接入 draft 流（compose 路径两件事 page.tsx 改动密不可分，合并 commit）
- `feat(fingerprints):` 列表页 versions 视图加快捷删除
- `docs:` AGENTS.md 补 2026-05-27 一轮 + 修正过期 TODO（v3.3 验证 ✅ / 热点聚合 ✅ / 多平台 ✅ / 配图 ✅）

### 本轮已知 tech debt / 边界 case
- 🟡 **`articles.refine_versions_json` 列双格式**：draft route 写 dict（`{ [platform]: md }`），refine route 写 array（refine 历史追加）。两边各自 own 暂不冲突，但日后历史详情页 / `/api/articles/[id]/diff` 若要读这列需先 detect 是 dict 还是 array
- 🟡 **多平台中止后只能整批重跑**：Step 6 "重新生成" 从头跑全部平台，没做"只重跑失败的"局部重试
- 🟡 **v3.3 视觉对比仍未做**（AGENTS.md 第 360 行）：用同一题材 + v3.3 升级后的指纹生成一篇，跟之前那篇"KPI 是合同"对比纵深 / 物件类比 / 结构差异

### Agent 协作的几条经验
- **agent 改文件被沙箱拒了 Edit 权限**——主线程直接接手是最快路径，但消耗主上下文。如果主上下文充裕、改动面小，接手；否则重派 agent 让Ethan在权限窗口点允许
- **agent prompt 里要写"遇到不确定停下来问，别瞎拍板"**——agent D 就是这样发现 Step 1 单选这个前置 gap 的，5 个决策一次性回报，节省了瞎做被推倒重来的时间
- **SendMessage 工具在当前环境没有**——无法续 agent 上下文，只能新派一个 agent 并把所有调查结果 + 决策一次性塞进 prompt（self-contained）
- **指纹三字段写在顶层** 这种事实，agent prompt 里错指位置的话 agent 也会跟着错——AGENTS.md 已是 truth-of-source，prompt 里别复述位置而是让 agent 自己读

---

## 2026-05-25 → 2026-05-26 这一轮做了什么（要点速览）

按 commit 时间顺序，6 件大事：

1. **OpenCLI + 通用翻页 + woshipm 适配器**（`6f5f579`）
   - 公众号 / B 站 / 知乎 / 小红书主通道切到本机 OpenCLI 借登录浏览器抓
   - 新增 `lib/crawler/pagination.ts` 通用 findNextPageUrl（rel=next / "下一页" / `/page/N` 递增 / `?page=N`）
   - 新增 `lib/crawler/opencli.ts` spawn 客户端，含按平台节奏 throttle
   - 新增 woshipm 适配器（人人都是产品经理）

2. **指纹 v3.1：自动分类 + 类别合成 + 跨博主索引**（`29e7717`）
   - Stage 0 文章分类器（科技 / 经济金融 / 知识科普 / 生活情感 / 职场创业 / 文化娱乐 / 时事评论 / 健康医学）
   - 新表 `fingerprint_category_profiles`：单类别 ≥ 3 篇时生成"该博主写这一类的专属配方"
   - 新表 `strategy_fragments_indexed` + `/api/strategies/search`：跨博主可检索的碎片库
   - 抽 `lib/fingerprints/v3-engine.ts` 共享 POST / PATCH 逻辑

3. **风格配方 CRUD**（`afda294`）
   - 新概念："给某个平台搭一份碎片组合"，可命名 / 保存 / 复用 / 删除
   - 新表 `style_recipes`，新页 `/recipes`，新 API `/api/recipes` 全套 CRUD
   - compose Step 4 加挑配方面板，挑了把碎片汇成文本注入 customNotes

4. **站点画像入口 + sites 重构**（`0e63231`）
   - `/api/sites/picker`：compose Step 1 卡片源从固定 PLATFORMS 换成 sites 表
   - `/api/sites/:id` PATCH 支持 `mode='recrawl'`（带 skipHashes 翻页续爬）和 `mode='paste'`
   - 抽 `lib/sites/profile-engine.ts` 共享 POST / PATCH
   - 修"样本 20 篇 / 共 40 篇"显示 bug：source_article_count 写真实 COUNT

5. **streamClaude 真流式 + 全 UI 改造**（`28bf105`）
   - **lib/Codex.ts 重写**：用 `--output-format stream-json --include-partial-messages`，解析 `content_block_delta` 喂给 onChunk。从"100+ 秒静默后一次性返回"变成"5 秒第一个 chunk"
   - 指纹详情：AuthorMetaEditor（单击改名 / 改平台，自定义平台名走独立 input）+ DeleteFingerprintButton（两段式确认级联删除）+ AddFingerprintSamplesPanel（贴 URL 加样本）
   - 修"v3 指纹四维度全空"bug：v3 schema 把字段嵌在 `platform_fingerprints[平台]` 下，老 UI 只读顶层
   - 新博主拆解页接 Stage 0 SSE 进度 + 批量贴 URL + 自动 expand index URL（带 cardsRef 修闭包）
   - 历史文章页按"文章"分组，平台 chip 切换平台版本，调用 `/api/articles/:id/diff` 显示 AI 改写差异
   - 加 `/api/authors/:id` PATCH 改名时同步刷 avatar_emoji（抽 `lib/authors/avatar.ts`）

6. **v3.3：结构能力 + 物件类比 + outline/article 重写**（`63fac6a`）
   - 起因：观察到工具产出文章"浮于表面、用词抽象、审美疲劳"。对比半佛仙人发现差距在论证形态——工具学到了"短句独段 / 数字分节"形式特征，没学到"因果链深挖 + 具象物件类比"内容特征
   - 指纹 stage1 加抓 `structure_shape`（6 选 1） + `depth_layers` + `depth_chain` + `concrete_analogies`（强约束物件级，禁止抽象隐喻）
   - 指纹 stage2 汇总成 `structure_repertoire` + `depth_pattern`（含 drilling_phrases）+ `analogy_bank`
   - 站点画像加 `preferred_structures` / `preferred_depth` / `analogy_density`
   - outline prompt 必须输出 `core_thesis` + `structure_shape`，每节必须有 `thesis` + `depth_role`（open/deeper/parallel/turn/close）；禁止整篇全 parallel
   - article prompt：每节首段必须用博主 drilling_phrases 回扣上节 thesis；抽象论点必须配博主 analogy_bank 里的具象物件
   - outline / draft API 收 `target_site_id` 注入站点画像
   - `PATCH /api/fingerprint/v3/:id` 加 `force_rerun: true`：不加新样本直接按新 prompt 重跑（用于 schema 升级回填）
   - stage2/3/category profile 的 timeoutMs 拉到 360-480s（v3.3 prompt 体积变大）
   - stage2 JSON 解析失败自动 retry repair（让模型只修语法不重做整段）

**未完成的事**：v3.3 端到端验证还没跑过完整一次（PATCH force_rerun 已经第三次启动，等通知），如果跑通，建议用同一题材生成一篇 v3.3 文章对比之前 KPI 那篇看纵深变化。

---

## 深度调研流程（/research · v4 · 2026-06）

独立于「风格指纹写作」的第二条链路：给一个选题 → 产出经审查的深度调研报告 → 一键转 compose 当写作弹药。

**分工（全程订阅 CLI，零 API、零 key —— 同第 1 条铁律）**：
- 联网搜集 + 审查 → **codex gpt-5.5**（`codex exec`，走 ChatGPT 会员订阅）
- 起草 + 回炉润色 → **claude sonnet 4.6**（`streamClaude` + `ARTICLE_MODEL`）

**循环**（复用 critic 的 reflection 思路）：codex 联网搜集 → claude 4.6 起草 → codex 审查（输出 JSON：issues / score / verdict）→ 若 revise 则带 hint 回炉 → 再审。≤ 2 轮；pass 标准 = codex 判 pass **或无 high 危问题**，否则 best-of-N 按 score 选稿。

**文件**：
| 路径 | 职责 |
|---|---|
| [lib/codex.ts](lib/codex.ts) | `runCodex()` spawn `codex exec`，对称 `lib/claude.ts`。**坑**：必须 `--skip-git-repo-check` + 关 stdin（否则卡）；用 `--output-last-message <file>` 拿最终答案；`cwd` 给中性目录（tmpdir），否则 codex 会读项目根 AGENTS.md 跑偏 |
| [lib/prompts/research.ts](lib/prompts/research.ts) | 搜集 / 起草 / 审查 / 回炉 4 个 prompt + hint 回注 |
| [lib/research.ts](lib/research.ts) | `runResearchLoop()` 编排（≤2 轮 + best-of-N） |
| [lib/schema-additions-research.ts](lib/schema-additions-research.ts) | `research_reports` + `research_runs` 表（挂在 db.ts getDb 末尾） |
| [app/api/research/route.ts](app/api/research/route.ts) | SSE（createSseStream 包循环） |
| [app/research/page.tsx](app/research/page.tsx) | UI。「用此报告写文」→ sessionStorage → `app/compose` 挂载读取并注入 `customNotes`（分隔块 `# 调研报告 ·`） |

**为什么 codex 跨模型审查**：同模型自审容易认同自己的输出，换 codex 审更狠——实测它揪出过 claude 报告里「错误合成的数字」和「证据外推」这类 claude 自己发现不了的硬伤。codex 走 ChatGPT 会员订阅，符合「不接 API」铁律。

**已知可迭代**：codex 审查偏严，2 轮常收敛不到 pass（可放宽 pass 标准或加轮数）；**不复现** deep-research 的多 agent fan-out（Next app 内跑不了 workflow），搜集深度弱于一次性 deep-research。

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

## 反爬与账号边界（v2 · 2026-05-25 OpenCLI 接入后）

> 替代老约束里「公众号不直接爬 / 不给抖音小红书账号」两条。OpenCLI（[GitHub](https://github.com/jackwener/OpenCLI)）通过本机 Chrome 扩展借用「你已经登录的浏览器会话」操作页面——等同于你本人在浏览器里点，反爬基本失效，但仍要遵守节奏。

### 各平台爬取通道（按推荐顺序）

| 平台 | 首选 | 回退 | 备注 |
|---|---|---|---|
| 公众号 | OpenCLI `weixin download` | 手贴 | 无账号风险，输出完整 Markdown，0 元 |
| B 站元数据 | OpenCLI `bilibili video` | 原生 b 站 API | 无需登录 |
| B 站字幕 | OpenCLI `bilibili subtitle` | （无）—— 没字幕的视频只拿元数据 | **需要 Chrome 登 B 站**，风险低 |
| 知乎 | OpenCLI（待接入） / Apify sian.agency | cheerio 兜底 | 知乎 PC 端登录风险中 |
| 小红书 | OpenCLI（待接入，**节奏控**） / Apify zhorex | （无） | 风险中高，**单次拆解 ≤ 12 篇** |
| 抖音 | OpenCLI（仅元数据 + 个别样本） | （无） | 风险最高，**禁批量** |
| 少数派 / 优设 / 人人都是产品经理 | 本地 cheerio（现有 adapter） | — | 无反爬 |

### 风控行为红线（任何平台禁止）

- 🚫 **定时高频 polling**（如选题中心热点 trending 每小时自动刷）
- 🚫 **短时间连续 > 30 篇**的批量抓取
- 🚫 **零互动 100% 只看**的纯爬行为模式（小红书 / 抖音强敏感）
- 🚫 **跨账号串号操作**（OpenCLI 借的是单一浏览器会话）

### Adapter 层面强制节奏（写到代码里）

每条 URL 抓取后强制 sleep，跟真人浏览节奏对齐：

| 平台 | 间隔 | 一天单账号上限 |
|---|---|---|
| 公众号 | 1 秒 | 100+ 篇 |
| B 站 | 5 秒 | 30-50 条 |
| 知乎 | 8 秒 | 20-30 条 |
| 小红书 | 15 秒 | 10-20 条 |
| 抖音 | 30 秒 | 10 条 |

**AutoArticle 当前使用场景（拆指纹 / 加样本，单次 ≤ 20 篇）全部在安全区内**——除非用户主动批量爬几百篇博主，那种自找的不在工具兜底范围。

### OpenCLI 失败兜底策略

```
首选 OpenCLI（免费 + 高质量 + 无 Apify 额度问题）
    ↓ 失败
回退 Apify（如果还有月额度）
    ↓ 失败
提示用户「手贴正文」（公众号 / 高反爬场景）
```

### 启动检测

- `~/Desktop/AutoArticle.command` 启动脚本应该加一条 `opencli doctor` 检测
- 三个 OK → 工具走 OpenCLI 通道
- 任一 FAIL → toast 提示「OpenCLI 未就绪，本次走 Apify 回退」，不阻塞工具运行

---

## Web 路由表（page.tsx）

| URL | 文件 | 职责 |
|---|---|---|
| `/` | [app/page.tsx](app/page.tsx) | 工作台 · Hero + 推荐选题 + 最近指纹 + 日常入口 |
| `/compose` | [app/compose/page.tsx](app/compose/page.tsx) | 7 步生成流程。Step 1 卡片源是 sites 表 + 通用画像兜底；Step 4 加 RecipePickerPanel + InspirationPanel；Step 5 显示 structure_shape badge + 每节 depth_role chip；Step 6 用 `renderMarkdown` 实时渲染 H2/bold |
| `/fingerprints` | [app/fingerprints/page.tsx](app/fingerprints/page.tsx) | 已拆解博主列表 |
| `/fingerprints/new` | [app/fingerprints/new/page.tsx](app/fingerprints/new/page.tsx) | 新博主拆解。接 Stage 0/1/2/3/category SSE 进度，卡片显示 autoCategory chip，加批量贴 URL 面板 |
| `/fingerprints/[id]` | [app/fingerprints/[id]/page.tsx](app/fingerprints/[id]/page.tsx) | 单个指纹详情。AuthorMetaEditor（改名 / 改平台）+ DeleteFingerprintButton + AddFingerprintSamplesPanel + 类别分布 + 按类别拆解配方 + **结构能力 · 论证骨架**（v3.3 新）|
| `/recipes` | [app/recipes/page.tsx](app/recipes/page.tsx) | **风格配方**列表 / 新建 / 编辑 / 删除（v3.2 新）|
| `/strategies` | [app/strategies/page.tsx](app/strategies/page.tsx) | **策略侦察**：跨博主按 category / tag / platform 检索碎片（v3.1 新）|
| `/authors` | [app/authors/page.tsx](app/authors/page.tsx) | 博主搜索/选择面板 |
| `/authors/[id]` | [app/authors/[id]/page.tsx](app/authors/[id]/page.tsx) | 博主多平台对比 4-tab |
| `/authors/[id]/optimize` | [app/authors/[id]/optimize/page.tsx](app/authors/[id]/optimize/page.tsx) | 跨平台改写优化 |
| `/sites` `/sites/[id]` `/sites/new` | [app/sites/](app/sites/) | 站点 × 板块 × 编辑画像。`/sites/[id]` 加 AddSamplesPanel 客户端组件 |
| `/topics` | [app/topics/page.tsx](app/topics/page.tsx) | 选题中心（风格推荐 + 热点聚合两 tab） |
| `/articles` `/articles/[id]` | [app/articles/](app/articles/) | 历史文章。新版按文章分组（不按博主），平台 chip 切换平台版本，调 `/api/articles/:id/diff` 显示 AI 改写差异 |
| `/settings/preferences` | [app/settings/preferences/page.tsx](app/settings/preferences/page.tsx) | 默认主题 + **Apify token 管理** |

## API 路由表（route.ts）

| 端点 | 文件 | 职责 |
|---|---|---|
| `POST /api/crawl-preview` | [app/api/crawl-preview/route.ts](app/api/crawl-preview/route.ts) | 单 URL 试爬，返回 title+preview+`apify_cost_usd` |
| `POST /api/search-authors` | [app/api/search-authors/route.ts](app/api/search-authors/route.ts) | 博主名搜索（DDG / Google CSE） |
| `POST /api/fingerprint/v3` | [app/api/fingerprint/v3/route.ts](app/api/fingerprint/v3/route.ts) | **指纹拆解 v3**（Stage 0 分类 + 多 agent 并行 + 跨平台报告 + 类别合成，当前主版本） |
| `PATCH /api/fingerprint/v3/[id]` | [app/api/fingerprint/v3/[id]/route.ts](app/api/fingerprint/v3/[id]/route.ts) | **加样本并重提炼**。Body `{articles?, force_rerun?}` —— `force_rerun: true` 不加新样本直接重跑（v3.3 新，用于 prompt 升级回填）|
| `DELETE /api/fingerprint/v3/[id]` | 同上 | 级联删除指纹 + 4 张附属表 + 孤儿 author |
| `POST /api/fingerprint/v2` | [app/api/fingerprint/v2/route.ts](app/api/fingerprint/v2/route.ts) | v2 拆解（保留兼容） |
| `POST /api/fingerprint` | [app/api/fingerprint/route.ts](app/api/fingerprint/route.ts) | v1 拆解（最老的版本，单调用） |
| `PATCH /api/authors/[id]` | [app/api/authors/[id]/route.ts](app/api/authors/[id]/route.ts) | 改博主名 / 平台（自定义平台允许），改名时同步 avatar_emoji |
| `POST /api/compose/outline` | [app/api/compose/outline/route.ts](app/api/compose/outline/route.ts) | 题材 → 大纲（流式）。Body 加 `target_site_id` 注入站点画像；prompt 强制输出 `core_thesis` + `structure_shape` + 每节 `thesis` / `depth_role` |
| `POST /api/compose/draft` | [app/api/compose/draft/route.ts](app/api/compose/draft/route.ts) | 大纲 → 正文（流式 SSE）。Body 加 `target_site_id`；prompt 强制"每节首段回扣上节 thesis"+"抽象论点配 analogy_bank 物件" |
| `POST /api/compose/refine` | [app/api/compose/refine/route.ts](app/api/compose/refine/route.ts) | 正文润色 |
| `GET /api/topics/recommend` | [app/api/topics/recommend/route.ts](app/api/topics/recommend/route.ts) | 风格推荐选题 |
| `GET /api/topics/trending` | [app/api/topics/trending/route.ts](app/api/topics/trending/route.ts) | 热点聚合选题 |
| `GET/POST/PATCH /api/sites` | [app/api/sites/](app/api/sites/) | 站点画像 CRUD。`/api/sites/:id` PATCH 支持 `mode='recrawl' / 'paste'`，每次累加 iteration_count |
| `GET /api/sites/picker` | [app/api/sites/picker/route.ts](app/api/sites/picker/route.ts) | **给 compose Step 1 用的卡片列表**：站点卡（实拆过）+ 通用平台卡（兜底）|
| `GET /api/recipes` `POST /api/recipes` | [app/api/recipes/route.ts](app/api/recipes/route.ts) | **风格配方** 列表 / 新建（v3.2 新）|
| `GET/PATCH/DELETE /api/recipes/[id]` | [app/api/recipes/[id]/route.ts](app/api/recipes/[id]/route.ts) | 配方详情（join 碎片完整信息）/ 编辑 / 删除 |
| `GET /api/strategies/search` | [app/api/strategies/search/route.ts](app/api/strategies/search/route.ts) | **跨博主策略碎片检索**（按 category / tag / platform 过滤，v3.1 新）|
| `GET/POST /api/articles/[id]` | [app/api/articles/[id]/route.ts](app/api/articles/[id]/route.ts) | 历史文章 |
| `POST /api/articles/[id]/diff` | [app/api/articles/[id]/diff/route.ts](app/api/articles/[id]/diff/route.ts) | **平台版本差异摘要**（Codex 算 from→to 改写差异，带 article_diffs 表缓存）|
| `GET/POST /api/images/auto` | [app/api/images/auto/route.ts](app/api/images/auto/route.ts) | 自动配图（本地素材库优先 + Unsplash 补） |
| `GET /api/apify/usage` | [app/api/apify/usage/route.ts](app/api/apify/usage/route.ts) | Apify 余额 + 最近 20 run（前端 status pill 用） |
| `GET/PATCH /api/settings` | [app/api/settings/route.ts](app/api/settings/route.ts) | 偏好设置（`default_theme` / `apify_token` 白名单） |

---

## 关键模块（lib/）

| 路径 | 职责 | 注意事项 |
|---|---|---|
| [lib/db.ts](lib/db.ts) | SQLite 单例 + 各表幂等扩展（PRAGMA + ALTER） | **加新字段必须用 `ensureXxxColumn(db)` 形式幂等扩**，不能直接改 schema.sql。本轮新增的所有 ensureXxx 已合并 |
| [lib/Codex.ts](lib/Codex.ts) | `spawn('Codex', ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--include-partial-messages', '--verbose'])` + 行 JSON 解析 + 默认 180s 超时 | **核心改造**：v3.3 必须用 stream-json，否则不流式。重要调用要显式传 `timeoutMs`（stage2: 480s, stage3 / category: 360s）|
| [lib/sse.ts](lib/sse.ts) | SSE 编码工具（fetch + ReadableStream，**不用 EventSource**） | 流式输出走这个 |
| [lib/composition.ts](lib/composition.ts) | 文章排版（3 平台 layout：standard/lively/minimal） | 公众号 HTML / 知乎 Markdown / 通用 |
| [lib/platforms.ts](lib/platforms.ts) | 平台元数据 | 视频平台（B站/抖音/YouTube）已从 PLATFORMS 中隐藏，仅保留 adapter 兼容存量 |
| [lib/crawler/](lib/crawler/) | 多站点爬虫 + OpenCLI + 通用翻页 | 详见下面 |
| [lib/fingerprints/v3-engine.ts](lib/fingerprints/v3-engine.ts) | **v3 拆解引擎**，POST / PATCH 共享。包含 Stage 0 / 1 / 2 / 3 / category profile 所有阶段 + JSON repair retry | v3.3 prompt 变重，必须用这个引擎，别在路由里直接拼 |
| [lib/sites/profile-engine.ts](lib/sites/profile-engine.ts) | **站点画像拆解引擎**，POST / PATCH 共享 | fetchArticlesWithDedupe / loadHistorySamples / runProfileExtraction |
| [lib/authors/avatar.ts](lib/authors/avatar.ts) | `pickAvatarChar(name)`：首个 CJK / 首字母大写 / 兜底 'A' | v3 POST route + `/api/authors/:id` PATCH 共用 |
| [lib/apify/usage.ts](lib/apify/usage.ts) | Apify 账户/余额/recent runs 统一查询 | `ACTOR_ID_TO_LABEL` 映射 actor ID → 中文标签 |
| [lib/search/](lib/search/) | 博主名搜索（DDG HTML / Google CSE） | `assessRisk` 判定平台是否反爬 |
| [lib/prompts/](lib/prompts/) | Codex prompt 模板 | v3.3 关键改 stage1 / stage2 / outline / article / siteprofile，加了 fingerprint-v3-stage0.ts / fingerprint-v3-category.ts / diff.ts |
| [lib/images/](lib/images/) | 本地素材库扫描 + Unsplash 适配 | |
| [lib/fingerprint-queries.ts](lib/fingerprint-queries.ts) | 指纹 DB 查询 | |
| [lib/format-cost.ts](lib/format-cost.ts) | `formatUsd(n)`：<1 三位小数 / ≥1 两位 | Apify 用量显示统一走这个 |
| [lib/compose-schema.ts](lib/compose-schema.ts) | 生成流程的 Zod schema | |

## 爬虫结构（lib/crawler/）

```
lib/crawler/
├── index.ts          路由入口：detectUrlKind / crawlArticle / crawlAuthorIndex（支持 maxPages / maxArticles / skipHashes）
├── types.ts          CrawledArticle / CrawlError / CrawledAuthorIndex / SiteAdapter（含 urlKind）
├── opencli.ts        **OpenCLI 客户端**：spawn 子进程 + 平台节奏 throttle + JSON 输出（v2 新）
├── pagination.ts     **通用翻页**：rel=next / "下一页"文本 / `/page/N` 递增 / `?page=N`（v2 新）
├── apify.ts          Apify HTTP 客户端 + 4 平台 Actor 调用（last-resort fallback）
├── wechat.ts         公众号：OpenCLI → Apify → wechatRejection
├── http.ts           got 封装 + UA
├── html.ts           cheerio 通用提取
├── dedupe.ts         url 归一化 + 哈希
└── adapters/
    ├── zhihu.ts          知乎：OpenCLI（仅 zhuanlan/p）→ Apify → cheerio
    ├── bilibili.ts       B 站：OpenCLI 元数据 + 字幕（需 B 站登录）→ Apify zhorex
    ├── xiaohongshu.ts    小红书：OpenCLI（含 creator-notes-summary）→ Apify
    ├── sspai.ts          少数派（纯本地爬 + 翻页）
    ├── uisdc.ts          优设（纯本地爬 + 翻页）
    ├── woshipm.ts        **人人都是产品经理**（v2 新，纯本地爬 + 翻页）
    ├── youtube.ts        YouTube（需 YOUTUBE_DATA_API_KEY）
    └── generic.ts        通用兜底（Readability + cheerio）
```

**每个 adapter 实现 `SiteAdapter` 接口**（matches / crawlArticle / crawlAuthorIndex / **urlKind**）。注册在 [lib/crawler/index.ts](lib/crawler/index.ts) 的 `SPECIFIC_ADAPTERS` 数组里。urlKind 是 v2 新加的，让 crawlAuthorIndex 能判 "article / index / unknown"。

---

## DB 表结构（data/autoarticle.db）

| 表 | 来自 | 职责 |
|---|---|---|
| `authors` | schema.sql | 博主基本信息（姓名、平台、来源、avatar_emoji） |
| `fingerprints` | schema.sql + ALTER 扩 v3 列 | 风格指纹（v1/v2/v3 共存，看 `version_schema` 列）。v3 fingerprint_json 包含 platform_fingerprints / domain_variations / cross_platform_report / strategy_fragments / **structure_repertoire / depth_pattern / analogy_bank**（v3.3 新）|
| `strategies` | schema-additions-strategies.sql | v2/v3 拆出的策略碎片 |
| `fingerprint_articles` | ensureFingerprintArticlesTable | **指纹 ↔ 样本关联表**（PRIMARY KEY: fingerprint_id, url_hash）。含 content + iteration + **primary_category / secondary_category / category_confidence**（v3.1 新）|
| `fingerprint_category_profiles` | ensureFingerprintCategoryProfilesTable | **按类别细分指纹**（v3.1 新）：单类 ≥ 3 篇样本时生成，记录 profile_json + sample_count + iteration |
| `strategy_fragments_indexed` | ensureStrategyFragmentsIndexedTable | **跨博主可检索碎片库**（v3.1 新）：带 author_name + category + tag，按 fingerprint_id 整组覆盖写 |
| `style_recipes` | ensureStyleRecipesTable | **风格配方**（v3.2 新）：fragment_ids_json 引用 strategy_fragments_indexed.id |
| `site_articles` | ensureSiteArticlesTable | 站点画像 ↔ 已用样本关联（PRIMARY KEY: site_id, url_hash），含 iteration |
| `article_diffs` | ensureArticleDiffsTable | 平台版本差异摘要缓存（PRIMARY KEY: article_id, from_platform, to_platform），按 hash 失效 |
| `crawled_articles` | schema-additions.sql | 已爬过的文章正文（含 url_hash 去重）。加了 medium 列 |
| `local_assets` | schema-additions-images.sql | 本地素材库（247 张配图扫描） |
| `article_images` | schema-additions-images.sql | 文章 ↔ 图片关联 |
| `articles` | schema-additions-compose.sql | 生成过的文章历史 |
| `sites` | schema-additions-sites.sql | 站点 × 板块 × 编辑画像。加了 iteration_count 列 |
| `settings` | schema-additions-settings.sql | k/v 偏好（`default_theme`, `apify_token`） |

**幂等扩列**：`lib/db.ts` 启动时跑全部 `ensureXxx` 函数（不重不漏）。要加新字段照葫芦画瓢，**别去改 schema.sql 顶层**（老数据库会冲突）。本轮新加的扩列 / 表函数：`ensureFingerprintArticlesTable` / `ensureFingerprintArticlesCategoryColumns` / `ensureFingerprintCategoryProfilesTable` / `ensureStrategyFragmentsIndexedTable` / `ensureStyleRecipesTable` / `ensureSiteArticlesTable` / `ensureSitesIterationColumn` / `ensureFingerprintIterationColumn` / `ensureArticleDiffsTable`。

---

## 关键决策的「为什么」（避免重蹈覆辙）

### 1. 为什么不接 Anthropic API，走本机 Codex CLI？
Ethan没付 API key 钱，但订阅了 Codex Pro。`Codex -p "<prompt>"` 通过本机订阅算费用。代价：要 spawn 子进程 + 流式接 stdout + 180s 超时管理。代码在 [lib/Codex.ts](lib/Codex.ts)。  
**不要换成 @anthropic-ai/sdk**——会变成 SaaS 模式且让Ethan付双份钱。

### 2. 为什么公众号默认不爬？
公众号反爬极强，普通 fetch 触发 captcha。**已知唯一可用方案是 Apify 的 sian.agency/wechat-official-accounts-scraper，但单篇 $0.53**（FREE 用户 $0.14 startup + $0.39/item）。所以默认 [lib/crawler/wechat.ts](lib/crawler/wechat.ts) 走 Apify（如果有 token），否则返回 wechatRejection（"请粘贴正文"）。

### 3. 为什么 Apify B 站换成 zhorex？
2026-05-24 Ethan拆解时被扣 $4.91/$5。复盘发现 sian.agency 系列对 FREE 用户收 $0.14 startup + $0.09-0.39/item，单 run $0.23-0.53。**zhorex/bilibili-scraper 只 $0.005/item 且无 startup**——便宜 50×。  
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
Ethan要"克制 + 书卷气"，用 Tailwind 手写组件 + CSS variables 做三主题切换（B/C/D）。**不要引 UI 库**。

### 7. 为什么有 v1 / v2 / v3 三套指纹拆解？
迭代痕迹：
- v1 单次 Codex 调用，拆 12 维（最老）
- v2 加跨篇综合 + strategies 表
- v3 多 agent 并行 + 平台分组 + 跨平台对比报告（**当前主版本**）

UI 默认走 v3。v1/v2 的代码不要删——老指纹用 `version_schema` 字段判断版本，dispatcher 在 [app/fingerprints/[id]/page.tsx](app/fingerprints/[id]/page.tsx) 里。

### 8. 为什么 Apify token 同时在 .env.local 和 settings 表？
`lib/crawler/apify.ts:getApifyToken()` 先看 DB 再看 env。**DB 优先**让用户能在 UI 上即改即生效。env 是部署 / fallback 兜底。

### 9. 主题切换为什么不能贴边？
Ethan的明确审美：主题切换器**必须收在导航栏下拉里**，不能在右下角悬浮。[components/theme/ThemeSwitcher.tsx](components/theme/ThemeSwitcher.tsx) 已挂在 HomeNav 里。

### 10. 为什么所有的运行时是 nodejs 不是 edge？
better-sqlite3 是原生模块，跑不了 edge runtime。**每个 route.ts 顶部都要写 `export const runtime = 'nodejs'`**。

### 11. 为什么 streamClaude 要用 stream-json 而不是裸 `Codex -p`？
Ethan在 Step 6 流式正文页看到"已 0 字"等了 100+ 秒——根因是 `Codex -p` 默认**不流式**，整篇答完才一口气吐 stdout。换成 `--output-format stream-json --input-format stream-json --include-partial-messages` 后，**5-6 秒就有第一个 chunk**，按 `content_block_delta > text_delta.text` 解析喂给 onChunk。  
对外契约不变（onChunk 仍是 plain text，返回值是 assembled text），所有调用方零迁移。代码在 [lib/Codex.ts](lib/Codex.ts)。

### 12. 为什么 v3 指纹要有 Stage 0 自动分类 + 类别细分？
Ethan观察："一些博主会对热点追踪，可能写科技 / 经济 / 知识等多种类，希望能针对性抓取策略，又能跨博主综合分析"。  
解法：8 个固定类别白名单（**不让模型自由分类**，避免"AI技术 / 人工智能 / 科技前沿"碎片化），单类 ≥ 3 篇时生成 `fingerprint_category_profiles` 专属配方，整库进 `strategy_fragments_indexed` 跨博主索引。写作时按类别筛碎片，比按博主筛精准。

### 13. 为什么 v3.3 要加 structure_repertoire / depth_pattern / analogy_bank？
Ethan观察："工具产出文章总是浮于表面，用词非常抽象，有趣是有趣但是会让人审美疲劳"。  
对比半佛仙人发现：模型抓到了**形式特征**（短句独段 / 数字分节 / 反差幽默），但漏了**内容特征**——
- **论证形态**：半佛是因果链层层挖根（"苹果降价→不是讲良心→是商业策略→策略来自担忧→担忧是失去定义权→若失去会变诺基亚"），工具是平铺列举（"努力是常数 / KPI 是合同 / 内卷是贬值 / 时间不是资产"，5 个独立论点不咬合）
- **物件类比**：半佛用"户口本进 iCloud / 黄牛在天台抽烟 / 中年人体检报告"，工具用"过路费 / 入场券 / 牌桌"（抽象隐喻）

v3.3 的修法是让"结构能力 + 物件类比"从隐式品味变成显式数据流：stage1 抓 → stage2 汇总 → outline / article prompt 强制读 → 模型按指纹的招数走。

### 14. 为什么 outline 的 sections 要带 depth_role？
平铺列举（全是 parallel）是"假深度"的元凶。强制每节标 `open / deeper / parallel / turn / close` 中一个，且**整篇至少一节 deeper、禁止全 parallel**，从结构上逼模型层层挖根。每节同时给出 `thesis`（核心论断），下节 article prompt 强制首段回扣这句 —— 这是论证骨架真的"立"起来的关键。

### 15. 为什么 PATCH /api/fingerprint/v3/:id 要加 force_rerun？
v3.3 升级 prompt 后，老 v3 指纹的 fingerprint_json 没有 structure_repertoire / depth_pattern / analogy_bank 字段。如果非要加新样本才能 PATCH，回填新字段就得手动凑一篇没用的样本——很傻。加 `force_rerun: true` 让 PATCH 跳过"至少 1 篇新样本"检查，直接读 fingerprint_articles 历史样本按新 prompt 重跑。**注意**：v3.3 prompt 体积变大，单次 stage2 可能 5-8 分钟，stage2 / 3 / category 已经各自显式设 timeoutMs（480 / 360 / 360s），同时 stage2 JSON 解析失败有 retry repair 兜底。

### 16. 为什么风格配方（recipes）独立于指纹？
指纹是"博主整体写作 DNA"，但**写作时常常想要"开篇用 A 博主的 + 论证用 B 博主的 + 收尾用 C 博主的"** ——这是跨博主拼合。风格配方表 `style_recipes` 让用户从 `strategy_fragments_indexed` 里跨博主挑碎片组合，命名保存（"公众号 业界动态版"）。生成时把配方碎片汇成结构化文本注入 `customNotes`，下游 prompt 已经会读这段—— **0 改动后端，纯 UI + 表层 feature**。

---

## 未完成事项 / 已知坑

### Apify 相关
- ⚠️ **本月额度已 $4.91/$5**，6 月 1 号才重置。继续测试**需要Ethan充值**或等月底
- ⚠️ env 里 `APIFY_TOKEN` 已注释（[autoarticle/.env.local](.env.local)）——重启用需 uncomment 或在 [/settings/preferences](http://localhost:3100/settings/preferences) 重填
- 🟡 `lib/crawler/apify.ts` 里 `fetchBilibiliCaption` 是 **deprecated stub** 直接返 null。新的 zhorex actor 在 video_detail mode 同时返字幕，不再需要单独调
- 🟡 `estimateActorCost` 是"sync 接口 usageTotalUsd=0 时的预估"——真实 cost 会在 status pill 60s 轮询时显示准确值

### 未接通的 UX
- 🟡 `fetchBilibiliVideosBatch` 和 `fetchXiaohongshuPostsBatch` 函数写好了但**没接到 UI**。fingerprint/new 还是逐条试爬。要加"一键批量抓"得改 [app/fingerprints/new/page.tsx](app/fingerprints/new/page.tsx)
- 🟡 知乎/公众号目前**单条调用**，没有批量节省策略（这两个 actor schema 不支持多 ID 输入，且单价高，必须省着用）
- 🟡 小红书的 search/profile 在 easyapi actor 上返空数组（评分 1.3/5），所以全切到 zhorex/rednote-xiaohongshu-scraper

### 还在写的功能
- ✅ `/topics` 选题中心的"热点聚合"tab 已接 Codex 真调（[app/api/topics/trending/route.ts](app/api/topics/trending/route.ts) + [lib/prompts/topic-trending.ts](lib/prompts/topic-trending.ts)）：读本地 `crawled_articles` → TF-IDF 算关键词 → Codex 合并出题。2026-05-27 复核确认
- 🟡 配图自动打标的 Codex 调用尚未接（[lib/images/](lib/images/) 只扫描，未分类）
- 🟡 跨平台改写 [app/authors/[id]/optimize/page.tsx](app/authors/[id]/optimize/page.tsx) 走 v3 的 cross_platform_report，UI 完成度约 70%

### v3.3 验证 / 后续（2026-05-26）
- ✅ **v3.3 端到端验证通过**（2026-05-27 复核）：思敏学姐指纹（id `x6xiH7pG20ytvU`）顶层三字段都已就位 —— `structure_repertoire`（dominant=problem_solution，4 种结构带 execution_traits）/ `depth_pattern`（average_layers=4，6 条 drilling_phrases）/ `analogy_bank`（15 个物件级类比，全具象无抽象隐喻）。**注意**：这三字段写在 fingerprint_json **顶层**，不是 platform_fingerprints[平台] 下——读取时别走平台节点
- 🟡 **v3.3 视觉对比未做**：理想做法是用同一题材（"努力越努力越穷"）+ v3.3 升级后的指纹生成一次，跟之前那篇"KPI 是合同"对比纵深 / 物件类比 / 结构差异
- ✅ **多平台一次出 N 个版本**（2026-05-27 落地）：Step 1 主卡保留单选作"主平台/主画像"，下加 chip 多选「顺手出这些版本」；outline 完全共享按主平台生成；draft route 服务端按 `platforms[]` **串行**循环 streamClaude（避免本机 Codex 订阅并发限速），SSE 协议带 `open / platform_start / delta{platform,delta} / platform_done{platform,content_md,word_count} / done{versions,errors} / error{platform?,message}`；Step 6 改 tabbed，每平台独立 scroll 容器（display:none 切换不丢已流内容），状态文字"排队中/流式中/已完成 N 字"无 emoji；Step 7 直接命中 `refineMap` 缓存不再调 refine。**单平台路径退化等同改动前**。**已知边界**：`articles.refine_versions_json` 列 draft 写 dict 形态（`{[platform]: md}`）、refine route 写 array 形态——两边各自 own 暂不冲突，但日后历史详情页 / diff API 若要读这列需先 detect 是 dict 还是 array
- ✅ **配图自动接进 draft 流**（2026-05-27 落地）：`components/compose/ImagePanel.tsx` 加 `autoStart?: boolean` prop + useEffect + `autoStartedRef` 防重复触发；`app/compose/page.tsx` Step 7 占位 Panel 换成真 `<ImagePanel articleContent={draftMd} fingerprintId={按 weight 排序取主博主} autoStart />`。复用现有 `/api/images/auto` POST，不需要新加端点 / 不动 schema

### 已知非阻塞问题
- 🟡 dev server 跑着时**不要跑 `npm run build`**——会污染 `.next/` 导致老 dev 进程 ENOENT chunk。要 build 先 kill dev
- 🟡 `data/autoarticle.db-wal` 跟 SQLite WAL 模式有关，**别手动删**——会丢未 checkpoint 的数据。要重置 db 整个 data/ 目录一起删
- 🟡 公众号 URL 含 `#rd` hash 时，url_hash 去重要先 normalize 掉

---

## 环境启动与紧急手册

### 启动
**双击桌面** `~/Desktop/AutoArticle.command`（已配 chmod +x）。脚本会：
1. 检测端口 3100 是否被占（被占就让你选用旧的 / 杀掉重启 / 退出）
2. 检测 Node / Codex CLI / Apify token / 数据库 / node_modules
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
| Codex CLI | `/Users/nan/.npm-global/bin/Codex` | 生成文章命脉，没有等于工具瘫痪 |
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
2. **多 agent 并行做独立任务**是Ethan确认过的偏好——不要等Ethan让你才并行
3. **决策点用 AskUserQuestion 摆卡片**，不要在 chat 里列编号问题
4. **称呼Ethan**——每条消息开头叫"Ethan"
5. **写代码前先想 cost**——Apify 烧钱过历史，加 Apify 调用前要算 per-run 成本；加 Codex 调用前要估时间和配额（单 stage2 重跑 ~5-8 分钟）
6. **改 schema 用 ALTER 幂等**——不要碰 schema.sql 顶层
7. **STATUS-*.md 是旧 agent 的工作记录**——读不读看时间够不够，不必每次都翻
8. **任何流式调用都用 streamClaude**——别再 spawn 裸 `Codex -p`，会卡 100+ 秒静默
9. **重负载 prompt 显式传 timeoutMs**——stage2 / category profile / 跨平台对比这种带 5-20 篇样本的 prompt，180s 默认不够
10. **改 v3 prompt 前看 stage1 / stage2 / outline / article 是不是已经在抓 / 用某个字段**——v3.3 的"结构能力 / 物件类比"链路已经从样本拆解一路串到 article 落笔，别在中间断一环
11. **力争"具象 > 抽象"**——这是写作工具的灵魂底线。模型偶尔会犯"用抽象隐喻偷懒"的毛病，prompt 要硬规定物件级
12. **拒绝平铺列举**——outline 出来如果整篇都是 parallel 角色，正文必然审美疲劳。这条是 v3.3 加的，已写进 outline prompt 禁令
