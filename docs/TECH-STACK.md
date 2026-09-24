# 笔迹 ByTrace · 技术栈与选型理由

> **文档性质**：对**已建成、已在跑**的系统的回溯性技术栈记录，不是新项目选型建议。
> **命名说明（重要）**：产品正在被重命名为 **笔迹 ByTrace**。本文描述的是**改名之前**的当前代码状态——仓库目录仍叫 `autoarticle/`，`package.json` 的 `name` 仍是 `autoarticle`，`app/layout.tsx:9` 的 `metadata.title` 仍是 `AutoArticle`，代码文件名（如 `lib/prompts/xiaopu-writing.ts`）与数据目录（如 `data/xiaopu-skill/`）一律**保持原名不改**。文中出现的所有真实路径、文件名、命令都按当前仓库原样书写。
> **最后核验**：2026-09-24 · 对应代码状态 `main` @ `90faee7` + 93 项未提交改动（工作树状态，见文末「文档与代码的漂移」）
> **项目根**：`/Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle`

---

## 0. 核验方法与图例

本文所有版本号、路径、命令都实地读取过文件或命令输出。证据等级如下：

| 图例 | 含义 |
| --- | --- |
| 【实测】 | 本次核验实际执行命令/读文件得到的输出 |
| 【文档】 | 来自仓库内已有文档（`CLAUDE.md` / `AGENTS.md` / `STATUS.md` 等），已标注行号 |
| 【推断】 | 从代码组织方式反推，仓库**没有**记录显式理由 |
| 【待核实】 | 无法在本次核验中确认，或文档与代码冲突尚未裁决 |

版本核验命令（在项目根执行，逐包打印真实安装版本）：

```bash
cd /Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle

for p in next react react-dom typescript better-sqlite3 @types/better-sqlite3 \
         zustand nanoid tailwindcss autoprefixer postcss @types/node \
         @types/react @types/react-dom @mozilla/readability cheerio got jsdom \
         tsx zod vitest eslint; do
  v=$(node -e "try{console.log(require('./node_modules/$p/package.json').version)}catch(e){console.log('ABSENT')}")
  echo "$p = $v"
done
```

`package-lock.json` 只用来交叉确认已解析版本与 engines 约束（本次用 `node -e` 读 `packages['node_modules/<pkg>']`）。

---

## 1. 版本清单表

### 1.1 运行时依赖（`dependencies`）

| 依赖 | 声明范围 | 实际安装【实测】 | 用途 | 用途证据 |
| --- | --- | --- | --- | --- |
| `next` | `^15.1.0` | **15.5.18** | App Router 全栈框架：页面路由 + Route Handler（32 个 `route.ts`）+ SSE 流式响应 | `app/**/page.tsx`、`app/api/**/route.ts` |
| `react` | `^19.0.0` | **19.2.6** | UI 运行时。项目大量使用 `'use client'` 组件 + `useState/useEffect/useRef/useMemo` 状态机 | `app/compose/page.tsx` 等 client 组件 |
| `react-dom` | `^19.0.0` | **19.2.6** | React DOM 渲染（版本必须与 `react` 完全一致） | 同上 |
| `better-sqlite3` | `^11.3.0` | **11.10.0** | 唯一数据层：同步 API 直连 SQLite，WAL 模式，进程内单例 | `lib/db.ts:1`、`lib/db.ts:397-405` |
| `zustand` | `^5.0.1` | **5.0.13** | 全局临时状态（L4 层）：主题、Toast | `stores/theme-store.ts`、`stores/toast-store.ts` |
| `nanoid` | `^5.0.7` | **5.1.11** | 生成短 ID（博主 id 12 位、指纹 id 14 位等），替代 UUID 让 URL 更短 | `app/api/fingerprint/v2/route.ts:310-311` 等 |
| `@mozilla/readability` | `^0.6.0` | **0.6.0** | 通用正文抽取：站点选择器没命中时的兜底骨架提取 | `lib/crawler/adapters/generic.ts:3` |
| `cheerio` | `^1.2.0` | **1.2.0** | 各站点适配器的 HTML 解析主力（jQuery 风格 API），也是 Readability 之后的二次解析 | `lib/crawler/html.ts`、`lib/crawler/adapters/*.ts` |
| `got` | `^15.0.5` | **15.0.5** | HTTP 客户端：带 UA 的请求封装、下载体积上限（用 `signal` + `downloadProgress` 实现，got 15 已无 `downloadLimit` 选项） | `lib/crawler/http.ts:1,32,36` |
| `jsdom` | `^29.1.1` | **29.1.1** | 为 `@mozilla/readability` 提供 DOM 环境（Readability 只吃 DOM） | `lib/crawler/adapters/generic.ts:2,52` |

### 1.2 开发依赖（`devDependencies`）

| 依赖 | 声明范围 | 实际安装【实测】 | 用途 |
| --- | --- | --- | --- |
| `typescript` | `^5.6.3` | **5.9.3** | 类型检查（`strict: true`），核心质量 gate `npx tsc --noEmit` |
| `tailwindcss` | `^3.4.14` | **3.4.19** | 原子化 CSS。全部主题色 / 圆角 / 字体 / 缓动都是**映射到 CSS 变量**的 Tailwind token（见 §4） |
| `postcss` | `^8.4.49` | **8.5.15** | Tailwind 的构建管道宿主 |
| `autoprefixer` | `^10.4.20` | **10.5.0** | 浏览器前缀自动补齐 |
| `tsx` | `^4.22.3` | **4.22.3** | 直接跑 TypeScript 脚本（无需先编译）：`scripts/scan-local-assets.ts`、`scripts/tag-local-assets.ts` |
| `@types/node` | `^22.9.0` | **22.19.19** | Node 类型（`child_process` / `fs` / `path` / `crypto`） |
| `@types/react` | `^19.0.0` | **19.2.15** | React 类型 |
| `@types/react-dom` | `^19.0.0` | **19.2.3** | React DOM 类型 |
| `@types/better-sqlite3` | `^7.6.11` | **7.6.13** | `Database.Database` 类型；strict 模式下 `lib/db.ts` 必需（`STATUS.md:89`） |
| `@types/jsdom` | `^28.0.3` | **28.0.3** | jsdom 类型 |

### 1.3 被文档提到、但**磁盘上不存在**的包

| 包 | 状态 | 说明 |
| --- | --- | --- |
| `zod` | **【实测】ABSENT（未安装）** | `CLAUDE.md:357` 的 lib 表把 `lib/compose-schema.ts` 写成「生成流程的 Zod schema」。实际读该文件：**没有任何 zod import，没有 schema 校验**，只有一个 `ensureComposeColumns()` 幂等扩列函数。全仓库 `grep "from 'zod'"` 零命中。**zod 不是本项目的依赖**，`.env.local.example` 也没有任何 zod 相关配置 |
| `vitest` | **【实测】ABSENT（未安装）** | `CLAUDE.md:578` 写了 `npx vitest run`，但 `package.json` 无 `test` script、无 `vitest.config.*`、无 `*.test.ts` / `*.spec.ts` 文件。**这条测试命令目前是失效的**（详见 `DEPLOY.md` 健康检查节） |
| `eslint` | **【实测】ABSENT（未安装）** | `package.json:9` 的 `lint` script 是 `next lint`，而 `eslint` 未安装、无 `eslint.config.js`。`STATUS.md:101` 已记录「未跑 ESLint：`next lint` 在 Next 15 已 deprecated」。**因此 `npm run lint` 当前不可用** |
| `@anthropic-ai/sdk` | **【实测】ABSENT，且是刻意为之** | 见 §5「明确为什么不」第 1 条 |

### 1.4 环境基线

| 项 | 值 | 证据 |
| --- | --- | --- |
| Node.js（本机实测） | **v24.18.1** | 【实测】`node --version` |
| npm（本机实测） | **10.8.2** | 【实测】`npm --version`（注意 `STATUS.md:27` 记的 `npm 11.12.1` 是旧机器状态） |
| `package.json` 的 `engines` 字段 | **不存在** | 【实测】`package.json` 全文无 `engines` |
| 真实最低 Node 版本 | **≥ 22（22.x 线需 ≥ 22.13；Node 23 不被 jsdom 接受）** | 【实测】`package-lock.json` 中 `got@15.0.5` 要求 `node >=22`；`jsdom@29.1.1` 要求 `node ^20.19.0 \|\| ^22.13.0 \|\| >=24.0.0`；`cheerio@1.2.0` 要求 `>=20.18.1`；`next@15.5.18` 要求 `^18.18.0 \|\| ^19.8.0 \|\| >=20.0.0`。**`CLAUDE.md:543` 写的「≥ 18」是过期说法**，按它装 Node 18/20 会让 `got` 装不上或运行报错 |
| SQLite3 CLI | **`/usr/bin/sqlite3`**（macOS 系统自带） | 【实测】`which sqlite3` |
| 数据库文件 | `data/autoarticle.db`（4,546,560 B）+ `-wal`（2,257,792 B）+ `-shm`（32,768 B） | 【实测】`ls -la data/` |

---

## 2. 每一项为什么选它

> 原则：有仓库记录的理由就**引用原话并给行号**；没有记录的一律标【推断】，不替项目编故事。

### 2.1 Next.js App Router

**仓库没有记录「为什么选 App Router」这个显式理由**【推断】。可核验的只是它带来了什么结构：

- 一个 `page.tsx` = 一个路由 = 一个 URL —— 这条被写成了项目的 L1 硬规定（`CLAUDE.md:224`）。
- 32 个 API endpoint 全部是 `app/api/**/route.ts` 的 Route Handler（【实测】`find app -name route.ts | wc -l` = 32），对应 `CLAUDE.md:309-338` 的 API 路由表。
- SSE 流式不走 `EventSource`，而是 Route Handler 里 `fetch` + `ReadableStream`（`CLAUDE.md:341` 记 `lib/sse.ts`「SSE 编码工具（fetch + ReadableStream，**不用 EventSource**）」）。这是 App Router 的 Route Handler 才方便做到的服务端流式。
- `next.config.ts` 只做两件事：声明原生模块外置、给 `/api/*` 加 `X-Accel-Buffering: no` 头（为流式禁掉反向代理缓冲）——说明框架选型是围绕「本机流式生成」这个核心场景配的。

**待核实**：`docs/行动大纲.md:76` 把本文的选题之一记作「为什么 Next 而不是 Electron」，但仓库里**没有**任何记录选型时对比过 Electron 的材料。这条对比理由属【待核实】，本文不编。

### 2.2 React 19

**这是有明确记录的一次被迫升级**（`STATUS.md:88`）：

> 「**Next 版本从指定的 15.0.3 升到 15.1+**：原因是 `next@15.0.3` 的 peerDependency 不接受 `react@19.0.0` 正式版（只接受 RC），会触发 ERESOLVE。改为 `^15.1.0` 后实际锁到 15.5.18，React 19 GA 正式支持。`package.json` 写成 caret，未来 Agent C 可按需收窄。」

即：**React 19 是想要的，Next 15.0.3 装不上，所以 Next 被抬到 15.1+**。这是 React 19 与 Next 15 在这份依赖表里的真实因果关系。

### 2.3 better-sqlite3（而不是 Postgres）

`CLAUDE.md:432-433`：

> 「### 5. 为什么 SQLite 而不是 Postgres？
> 本地工具，单用户，零运维。better-sqlite3 同步 API 速度极快。**不要换 Postgres**。」

配套的实现约束在 `lib/db.ts`：进程内单例（`let _db`，`getDb()` 命中即返回）、`journal_mode = WAL`、`foreign_keys = ON`、启动时幂等跑 `schema.sql` + 全部 `ensureXxx` 扩列/建表函数（`lib/db.ts:397-405`）。「零运维」直接体现为：没有连接池、没有 migration 工具、没有服务端进程。

### 2.4 Tailwind + CSS 变量（三主题）

`CLAUDE.md:435-436`：

> 「### 6. 为什么不用 Ant Design / MUI？
> Ethan要"克制 + 书卷气"，用 Tailwind 手写组件 + CSS variables 做三主题切换（B/C/D）。**不要引 UI 库**。」

这解释了**技术组合**，但主题的数量与名字要按代码核：

| 主题 id | 名字【实测】 | 定义位置 |
| --- | --- | --- |
| `B` | 牛皮纸 · 朱砂 | `app/globals.css:21-61` |
| `C` | 夜书房 · 鎏金（深墨蓝 · 鎏金） | `app/globals.css:62-102` |
| `D` | 极简 · 松石青（雾灰白 · 松石青） | `app/globals.css:103-` |

名字的权威来源是 `components/theme/ThemeSwitcher.tsx:13-15`：

```ts
{ id: 'B', label: '牛皮纸 · 朱砂' },
{ id: 'C', label: '夜书房 · 鎏金' },
{ id: 'D', label: '极简 · 松石青' },
```

机制上，`tailwind.config.ts` **不写死任何颜色**，而是把 CSS 变量映射成 Tailwind token（`bg: 'var(--bg)'`、`text: 'var(--text)'`、`accent: 'var(--accent)'` 等，见 `tailwind.config.ts:13-48`），圆角/字体/缓动同理（`:49-66`）。`app/globals.css` 的 `[data-theme="B"|"C"|"D"]` 只负责重定义这批变量，`:root`（`globals.css:7-19`）放三主题共享 token（字体栈、缓动、圆角）。所以「三主题」= 切换 `<html data-theme>` 一个属性，零组件改动。

两个默认值细节（易踩）：
- `app/globals.css` 的注释把 **B 标为默认**，`app/layout.tsx:21-37` 由 `getSetting('default_theme')` 在服务端读 `settings` 表后写到 `<html data-theme>`（避免首屏闪烁）。
- 但 `stores/theme-store.ts:23` 的 zustand fallback 写的是 `theme: 'D'`。**真正的默认主题由 `settings` 表决定**，`'D'` 只是客户端兜底。改默认主题应改 settings，不要改这两处代码。

### 2.5 Zustand

**仓库没有记录「为什么选 Zustand」**【推断】。可核验的事实：

- 它被明确放在 L4 层：「L4 Store `stores/*.ts` 全局共享的临时状态（Zustand）」（`CLAUDE.md:226`）。
- 边界被硬规定为「Store 不放服务端拉的数据，那是 TanStack Query 的活」（`CLAUDE.md:231`）。
- 实际只有 2 个 store：【实测】`stores/theme-store.ts`（`persist` 中间件 → `localStorage`，key `autoarticle-theme`）、`stores/toast-store.ts`。体量极小，符合「只放临时状态」的定位。

### 2.6 nanoid

**仓库没有记录「为什么选 nanoid」**【推断】。可核验的用法是它替代 UUID 直接进 URL 与主键：【实测】`app/api/fingerprint/v2/route.ts:310-311` 用 `nanoid(12)` 生成 `authorId`、`nanoid(14)` 生成 `fingerprintId`；`app/api/compose/gather/route.ts` 等新路由也用它。选短 ID 与「本机单人工具、URL 要短好认」一致，但这条理由本身未被文档记录。

### 2.7 爬取四件套：cheerio / jsdom / @mozilla/readability / got

**每个库的单独选型理由仓库未记录**【推断】；能核验的是**分工**（`CLAUDE.md:360-386` 的爬虫结构树 + 实际代码）：

| 库 | 分工 | 代码证据 |
| --- | --- | --- |
| `got` | HTTP 传输层，统一 UA + 体积上限 + 超时/中止 | `lib/crawler/http.ts:1,32,36` |
| `cheerio` | 站点适配器的选择器解析主力（每个 adapter 的正文/列表抽取） | `lib/crawler/html.ts`、`lib/crawler/adapters/{sspai,uisdc,woshipm,zhihu,bilibili,xiaohongshu,youtube}.ts` |
| `jsdom` | 给 Readability 造 DOM（Readability 的输入是 DOM，不是字符串） | `lib/crawler/adapters/generic.ts:2,50-52` |
| `@mozilla/readability` | 选择器没命中时的**语义兜底**：先从整页猜正文块，再回交 cheerio 解析段落与图片 | `lib/crawler/adapters/generic.ts:3,10,46-59` |

`generic.ts:50` 用 `new VirtualConsole()` 静默 jsdom 的 CSS 警告，说明作者知道 jsdom 在只抽正文场景下的噪声成本——这是把 jsdom 限制在「一次性 DOM 宿主」而非通用浏览器环境的手法。

**注意**：`CLAUDE.md:446-447`（§8）解释的「Apify token 为什么同时在 `.env.local` 和 `settings` 表」所依赖的 `lib/crawler/apify.ts` **在当前工作树已被删除**（`git status` 显示 `D lib/crawler/apify.ts`），全仓库 `apify` 代码引用为 0。爬虫的付费通道当前**不在代码里**，详见 §8。

### 2.8 流式：`streamClaude` + `--output-format stream-json`

`CLAUDE.md:455-457`（§11）：

> 「Ethan在 Step 6 流式正文页看到"已 0 字"等了 100+ 秒——根因是 `claude -p` 默认**不流式**，整篇答完才一口气吐 stdout。换成 `--output-format stream-json --input-format stream-json --include-partial-messages` 后，**5-6 秒就有第一个 chunk**，按 `content_block_delta > text_delta.text` 解析喂给 onChunk。
> 对外契约不变（onChunk 仍是 plain text，返回值是 assembled text），所有调用方零迁移。代码在 `lib/claude.ts`。」

这是全项目唯一有完整「现象 → 根因 → 修法 → 兼容性结论」记录的选型，也是**所有流式调用必须走的唯一入口**（`CLAUDE.md:599`：别再 spawn 裸 `claude -p`）。

补充两个本次核验到的事实：
- `lib/claude.ts:11` 默认超时 `DEFAULT_TIMEOUT_MS = 180_000`；重负载阶段必须显式传 `timeoutMs`（`CLAUDE.md:475` 记 stage2 / stage3 / category 为 480 / 360 / 360 秒；`app/api/compose/gather/route.ts:21` 用 `360_000`）。
- `lib/claude.ts:17` 的 `ARTICLE_MODEL = 'sonnet'`（**别名，不是** `CLAUDE.md:60` 写的 `'claude-sonnet-4-6'` 全名）。正文 draft / refine 传 `model: ARTICLE_MODEL` 降 AI 味；outline / critic 不传 model = 走订阅默认 Opus（`CLAUDE.md:18-19`、`:55-60`）。

### 2.9 tsx

**仓库没有记录「为什么选 tsx」**【推断】。可核验用途：脚本直接用 `npx tsx <file>` 跑，不需要为了两个脚本配置一套编译产物。【文档】`ETHAN-CONFIG-REPORT.md:97,159,162` 记录了两条真实调用：

```bash
npx tsx scripts/scan-local-assets.ts
npx tsx scripts/tag-local-assets.ts --limit 20
```

注意 `package.json` **没有**为它们建 script，所以只能 `npx tsx` 直调。

---

## 3. 明确「为什么不」

以下每一条都是仓库里**有记录**的否决决定，不是本文的推测。

| 被否决的方案 | 记录位置 | 原话 / 理由 |
| --- | --- | --- |
| **`@anthropic-ai/sdk`（Anthropic API）** | `CLAUDE.md:414-416`（§1） | 「Ethan没付 API key 钱，但订阅了 Claude Pro。`claude -p "<prompt>"` 通过本机订阅算费用。……**不要换成 @anthropic-ai/sdk**——会变成 SaaS 模式且让Ethan付双份钱。」代价也被明说：要 spawn 子进程 + 流式接 stdout + 180s 超时管理。 |
| **上云 / SaaS 形态** | `CLAUDE.md:16`（关键约束） | 「数据全留本机 SQLite —— **不上云、不做 SaaS**」。同一条约束还写明「**不接 Anthropic API、不带 key、不联网调 LLM**」。 |
| **UI 组件库（Ant Design / MUI）** | `CLAUDE.md:435-436`（§6） | 「Ethan要"克制 + 书卷气"，用 Tailwind 手写组件 + CSS variables 做三主题切换（B/C/D）。**不要引 UI 库**。」 |
| **Postgres** | `CLAUDE.md:432-433`（§5） | 「本地工具，单用户，零运维。better-sqlite3 同步 API 速度极快。**不要换 Postgres**。」 |
| **edge runtime** | `CLAUDE.md:452-453`（§10） | 「better-sqlite3 是原生模块，跑不了 edge runtime。**每个 route.ts 顶部都要写 `export const runtime = 'nodejs'`**。」 |
| **第三方抓取云 FireCrawl / Browserbase / Bright Data** | `CLAUDE.md:425-430`（§4） | FireCrawl「知乎 403 / 公众号 captcha / 小红书反爬都打不过」；Browserbase「没有中文 ready-made scraper，你要自己写」；Bright Data 的「有小红书 scraper」是调研 agent 的幻觉（给的链接 404）。结论：「要中文平台 ready-made scraper，市面上**只有 Apify 一家**。」 |
| **Apify 的 sian.agency 用于 B 站** | `CLAUDE.md:421-423`（§3） | 2026-05-24 被扣 $4.91/$5；zhorex 只 $0.005/item 且无 startup，**便宜 50×**，故 B 站换 zhorex。sian.agency 只保留在知乎与公众号（「市面上找不到便宜替代」）。 |

> **当前状态提醒**：上表最后两条关于 Apify 的记录是**历史决策**。当前工作树里 Apify 相关代码已整体删除（`lib/crawler/apify.ts`、`lib/apify/usage.ts`、`app/api/apify/usage/route.ts`、`components/nav/ApifyStatusPill.tsx` 均为 `git status` 中的 `D`，且全仓库 `apify` 代码引用 0 处）。「不引云抓取」这条结论仍然成立，但**「用 Apify 兜底」这条现状已不成立**，详见 §8。

---

## 4. 运行时约束

### 4.1 每个 route 都必须是 Node.js runtime（原生模块约束）

规则（`CLAUDE.md:452-453`）：better-sqlite3 是原生模块（native binding），edge runtime 跑不了，所以**每个 `route.ts` 顶部都要写 `export const runtime = 'nodejs'`**。

核验结果【实测】：

```bash
find app -name route.ts | wc -l                    # -> 32
grep -rl "runtime = 'nodejs'" app --include=route.ts | wc -l   # -> 32
for f in $(find app -name route.ts); do grep -q "runtime" "$f" || echo "MISSING: $f"; done  # -> 无输出
```

**32 / 32 全部声明，0 个遗漏。** 这是项目当前遵守得最彻底的一条硬约束。

### 4.2 `serverExternalPackages: ['better-sqlite3']`

`next.config.ts` 全文（【实测】逐字引用）：

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 是 native binding，必须放到 serverExternalPackages，否则 Next 会尝试打包导致失败
  serverExternalPackages: ['better-sqlite3'],

  // API 路由配置
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

两个配置各自的作用：
- `serverExternalPackages`：让 Next **不要** webpack 打包 better-sqlite3，改为运行时 `require` 原生 `.node`。`STATUS.md:90` 记录了加它的原因：「否则 Server Components 引用 db.ts 时 Next 会尝试 webpack 打包 native 模块导致失败」。官方也叫 `serverExternalPackages`（旧名 `experimental.serverComponentsExternalPackages`）。
- `X-Accel-Buffering: no`：给 `app/api/*` 所有响应加禁缓冲头，保证 SSE 逐字到达浏览器而不是被代理攒成一坨。

### 4.3 TypeScript strict + `@/*` 路径别名

`tsconfig.json` 关键项（【实测】）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

要点：
- **`strict: true`**：类型检查是核心质量 gate。`CLAUDE.md:4` 记「tsc 全绿」，`CLAUDE.md:577` 把它列为「类型检查（核心 gate）」。
- **`paths: { "@/*": ["./*"] }`**：`@/` 映射到**项目根**（不是 `src/`）。所以 `@/lib/db` = `<root>/lib/db`，`@/components/...` = `<root>/components/...`。全项目 import 都走这个别名。
- **`noEmit: true` + `incremental: true`**：只做类型检查、不产出 JS，但会写 `tsconfig.tsbuildinfo`（**该文件在 `.gitignore:10-11` 已忽略**）。副作用：跑 `tsc --noEmit` 会写这个缓存文件。
- **`allowJs: false`**：项目不接受 JS 源码，全 TS/TSX。

---

## 5. 架构分层规则（L1–L5）

项目自己的硬规定，抄录自 `CLAUDE.md:221-231`（`AGENTS.md:171-181` 同文）：

```
L1 Page         app/**/page.tsx          一个 page.tsx = 一个路由 = 一个 URL
L2 Component    components/<group>/*.tsx 单独可见的 UI 元素
L3 Hook         hooks/*.ts               跨组件复用的能力（流式、剪贴板等）
L4 Store        stores/*.ts              全局共享的临时状态（Zustand）
L5 Lib          lib/*.ts                 通用工具，纯函数（日期、文本统计、爬虫等）
```

**两条被单独点名的禁令**（`CLAUDE.md:231`）：

> 「**改某一层不要动另一层**。Page 不能直接写 fetch 逻辑——抽 Hook；**Lib 不能 import React**——是纯工具；Store 不放服务端拉的数据，那是 TanStack Query 的活。」

即：
1. **L1 Page 不得包含 fetch 逻辑**，必须抽到 L3 Hook。
2. **L5 Lib 不得 import React**，必须是纯工具。

### 5.1 各层当前的实际占用【实测】

| 层 | 目录 | 实际内容 | 符合度 |
| --- | --- | --- | --- |
| L1 Page | `app/**/page.tsx` | 14 个页面（`/`、`/compose`、`/fingerprints*`、`/strategies`、`/recipes`、`/authors*`、`/sites*`、`/topics`、`/articles*`、`/settings/preferences`、`/import`） | ⚠️ `app/compose/page.tsx` 违规（见 §5.2） |
| L2 Component | `components/**/*.tsx` | 20 个组件，分组 `authors/ compose/ fingerprints/ home/ nav/ theme/ ui/` | ✅ 目录分组与规则一致 |
| L3 Hook | `hooks/*.ts` | **只有 `.gitkeep`——该层是空的** | ❌ 层空置，正是 §5.2 违规的直接后果 |
| L4 Store | `stores/*.ts` | 2 个：`theme-store.ts`、`toast-store.ts` | ✅ 只放临时状态，无服务端数据 |
| L5 Lib | `lib/*.ts` | ~25 个模块 + `crawler/`、`images/`、`prompts/`、`search/`、`sites/`、`fingerprints/`、`authors/` 子目录 | ✅ `lib/` 下无任何 `from 'react'`（【实测】`grep -rn "from 'react'" lib/` 零命中），符合「Lib 不能 import React」 |

### 5.2 已记录的违规实例（L1）

- **`app/compose/page.tsx` 把 fetch 逻辑写在 Page 里**：【实测】该文件有 **11 处 `fetch(`**（如 `:512`、`:631`、`:688`），且文件长 **3512 行**。这正是 `CLAUDE.md:44` 记的第 ③ 项技术债：违反自家 L1–L5 分层，该抽 `useSseStream` hook。L3 层为空（§5.1）也印证了这个 hook 至今没抽出来。
- **数字漂移**：`CLAUDE.md:44` 与 `docs/PRD.md:245` 都写「约 3100 行 / 3123 行」，**实测是 3512 行**（`wc -l`）。结论不变，数字应更新。

---

## 6. 已知技术债

### 6.1 `CLAUDE.md:44`「未修（记录在案）」四条（2026-07-07 全项目审查轮）

该轮 5 个审查 agent 并行扫全部子系统，交叉验证 ~50 项问题，49 项已修（33 文件 +979/−344，`tsc` 全绿），**剩这 4 项明确未修**：

| # | 技术债 | 原文（`CLAUDE.md:44`） | 本次核验 |
| --- | --- | --- | --- |
| ① | **风格配方 fragment-id 不稳定** | 「风格配方引用碎片 id，PATCH 重提炼整组换新 id 后配方静默失效——要 id 稳定化或回填，属设计级改动」 | 未修。`style_recipes.fragment_ids_json` 引用 `strategy_fragments_indexed.id`，后者按 fingerprint_id 整组覆盖写 → id 会换 |
| ② | **v3 POST 路由与 engine 复制体漂移** | 「v3 POST 路由与 engine 的复制体漂移（本轮只同步了 repair，整体迁移到 `runV3Extraction` 留待下轮）」 | 未修。`app/api/fingerprint/v3/route.ts` 与 `lib/fingerprints/v3-engine.ts` 仍有重复逻辑，属真实漂移风险 |
| ③ | **`app/compose/page.tsx` 违反自家 L1–L5 分层** | 「compose page 3123 行违反自家 L1-L5 分层（该抽 `useSseStream` hook）」 | 未修。**实测 3512 行**，11 处 `fetch(`，L3 `hooks/` 仍为空 |
| ④ | **Apify 无进程内预算护栏** | 「Apify 无进程内预算护栏（$4.91 前科，建议加会话累计计数器）」 | 未修——且注意：当前工作树里 Apify 代码已整体删除，这条护栏的**对象本身已不在代码里**（§8） |

### 6.2 `CLAUDE.md:482-512`「未完成事项 / 已知坑」

**Apify 相关（`CLAUDE.md:484-488`）**
- ⚠️ 记录时本月额度已 $4.91/$5（FREE 层上限 $5/月），继续测试需充值或等月底重置。
- ⚠️ `.env.local` 里 `APIFY_TOKEN` 已注释——重启用需 uncomment 或在 `/settings/preferences` 重填。
- 🟡 `fetchBilibiliCaption` 是 deprecated stub 直接返 null（zhorex 在 video_detail mode 同时返字幕）。
- 🟡 `estimateActorCost` 只是 sync 接口 `usageTotalUsd=0` 时的预估，真实 cost 靠 status pill 60s 轮询。

**未接通的 UX（`CLAUDE.md:490-494`）**
- 🟡 `fetchBilibiliVideosBatch` / `fetchXiaohongshuPostsBatch` 函数写好了但**没接到 UI**；`/fingerprints/new` 仍是逐条试爬。要加「一键批量抓」得改 `app/fingerprints/new/page.tsx`。
- 🟡 知乎/公众号单条调用，无批量节省策略（actor schema 不支持多 ID 且单价高）。
- 🟡 小红书 search/profile 在旧 easyapi actor 上返空数组（评分 1.3/5），已全切 zhorex。

**功能完成度（`CLAUDE.md:496-504`）**
- ✅ `/topics` 热点聚合已接真模型（`app/api/topics/trending/route.ts` + `lib/prompts/topic-trending.ts`），2026-05-27 复核确认（原「是 mock」的描述已过期）。
- ✅ 配图 Claude 视觉打标已接（`lib/images/classify.ts` 让 CLI 用 `Read` 工具真看图，`scripts/tag-local-assets.ts` 串行批量，实测 ~14s/张）。
- ✅ `/authors/[id]/optimize` 实为「优化指纹」流程且已完整（`OptimizeFlow` 517 行）；旧文档误标「跨平台改写 70%」已订正。
- 🟡 **多平台中止后只能整批重跑**（`CLAUDE.md:137`）：Step 6「重新生成」从头跑全部平台，没做「只重跑失败的」局部重试。
- 🟡 **v3.3 视觉对比仍未做**（`CLAUDE.md:136`）：应用同一题材 + v3.3 升级后的指纹生成一篇，跟「KPI 是合同」那篇对比纵深 / 物件类比 / 结构差异。
- 🟡 `research_material` 只透前端 state，不落 article 历史：日后追溯「某篇正文的数字来自哪」得按 `idea_hash` 反查 `gather_runs`。
- 🟡 v3.5 gather 的 codex 联网搜集产出质量**尚未端到端实测**。

**已知非阻塞问题（`CLAUDE.md:506-511`）**
- 🟡 **dev server 跑着时不要跑 `npm run build`**——会污染 `.next/` 导致老 dev 进程 ENOENT chunk。要 build 先 kill dev。
- 🟡 `data/autoarticle.db-wal` 是 SQLite WAL 模式的一部分，**别手动删**——会丢未 checkpoint 的数据。要重置 db 就整个 `data/` 目录一起删。
- 🟡 公众号 URL 含 `#rd` hash 时，`url_hash` 去重要先 normalize 掉。

### 6.3 本次核验补充的技术债（代码事实，未见于 `CLAUDE.md`）

| 项 | 证据 | 影响 |
| --- | --- | --- |
| **`lib/claude.ts` 硬编码个人机路径** | `lib/claude.ts:5-10`：`FALLBACK_CLAUDE_CANDIDATES = ['/Users/mixingtumima0000/.local/bin/claude', '/Users/mixingtumima0000/.npm-global/bin/claude']` | 换机器 / 换用户名即失效。已写入 `DEPLOY.md` 与 `docs/行动大纲.md` 的 P1 |
| **DB 路径依赖 `process.cwd()`** | `lib/db.ts:14-16`：`join(process.cwd(), 'data', 'autoarticle.db')` | 启动目录一变就找不到 DB。`docs/行动大纲.md` P2 |
| **环境变量名三套并存** | `.env.local.example` 主推 `AUTOARTICLE_LLM_*`；`lib/claude.ts:80-94` 同时还读 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`；`CLAUDE.md:528-536` 又只列 `UNSPLASH_*` / `APIFY_TOKEN` 等另一批 | 填 `.env` 时不知道填哪个才对。`docs/行动大纲.md` P3；细节归 `docs/ENV.md` |
| **无健康检查端点** | 无 `app/api/health/route.ts`（【实测】32 个 route 清单里没有） | 缺 key / 缺 CLI 时报错散落各处，无法一眼看出哪儿没配。`docs/行动大纲.md` P5 |
| **测试链路名存实亡** | `package.json` 无 `test` script；`vitest` 未安装；无测试文件 | `CLAUDE.md:578` 的 `npx vitest run` 不可执行 |
| **lint 链路不可用** | `package.json:9` = `next lint`；`eslint` 未安装 | `npm run lint` 不可执行；`STATUS.md:101` 已记录需单独配 `eslint.config.js` |

---

## 7. 版本清单表与 `STATUS.md` / `CLAUDE.md` 的差异

`STATUS.md:10-25` 自带的版本表**大部分仍然准确**，本次实测更新了 4 处：

| 依赖 | `STATUS.md` 记录 | 本次实测 | 结论 |
| --- | --- | --- | --- |
| `next` | 15.5.18 | **15.5.18** | 一致 |
| `react` / `react-dom` | 19.2.6 | **19.2.6** | 一致 |
| `typescript` | 5.9.3 | **5.9.3** | 一致 |
| `better-sqlite3` | 11.10.0 | **11.10.0** | 一致 |
| `zustand` | 5.0.13 | **5.0.13** | 一致 |
| `nanoid` | 5.1.11 | **5.1.11** | 一致 |
| `tailwindcss` | 3.4.19 | **3.4.19** | 一致 |
| `autoprefixer` | 10.4.21 | **10.5.0** | 有更新（caret 内漂移） |
| `postcss` | `8.5.x` | **8.5.15** | 精确化 |
| `@types/node` | `22.x` | **22.19.19** | 精确化 |
| `@types/react` | `19.x` | **19.2.15** | 精确化 |
| `@types/react-dom` | `19.x` | **19.2.3** | 精确化 |
| Node / npm | Node 24.15.0 / npm 11.12.1 | **Node v24.18.1 / npm 10.8.2** | npm 大版本不同——`STATUS.md` 记的是旧机器 |

`STATUS.md` 表里**没有**列 `@mozilla/readability` / `cheerio` / `got` / `jsdom` / `tsx` / `@types/jsdom`，本文 §1 已补齐（这些是后续迭代加入爬虫链路时新增的）。

---

## 8. 文档与代码的漂移（必须知道，否则会照文档改坏代码）

本文核验时工作树有 **93 项未提交改动**（【实测】`git status --short | wc -l` = 93），`CLAUDE.md` / `AGENTS.md` 描述的部分内容已与工作树不符。以下每条都已实地核验：

| 漂移 | 文档说法 | 代码实况【实测】 |
| --- | --- | --- |
| **Apify 整体移除** | `CLAUDE.md:446-447`（§8）讲 `lib/crawler/apify.ts:getApifyToken()`；`:484-488`、`:557-561` 整节讲 Apify 额度与烧钱排错；`:535` 列 `APIFY_TOKEN` | `git status` 显示 `D lib/crawler/apify.ts`、`D lib/apify/usage.ts`、`D app/api/apify/usage/route.ts`、`D components/nav/ApifyStatusPill.tsx`；全仓库 `grep -rn apify`（排除 node_modules）**0 命中**。`lib/crawler/wechat.ts:12,23` 现在的兜底链注释已写成「OpenCLI weixin download → 手贴拒绝」**两级**，不含 Apify |
| **`/research` 深度调研链路移除** | `CLAUDE.md:195-219` 有完整「深度调研流程（/research · v4）」专节，列出 `lib/codex.ts` / `lib/research.ts` / `lib/prompts/research.ts` / `app/api/research/route.ts` / `app/research/page.tsx` | 上列 5 个路径**全部**在 `git status` 中为 `D`；`app/research/` 目录不存在。代码里对 `@/lib/research`、`@/lib/codex` 的 import **0 处** |
| **Codex 不再是独立模块** | `CLAUDE.md:207`、`:339-358` 把 `lib/codex.ts` 列为独立模块「对称 `lib/claude.ts`」 | `lib/codex.ts` 已删除。codex 现在是 `lib/claude.ts` 内的一个 provider 分支：`LlmProvider = 'claude-cli' \| 'codex-cli' \| 'openai-compatible' \| 'openai-responses'`（`lib/claude.ts:19`），spawn 在 `lib/claude.ts:349`（`codex exec --ephemeral --skip-git-repo-check --json --sandbox read-only -C <cwd> -`） |
| **compose page 行数** | `CLAUDE.md:44` / `PRD.md:245`：约 3100 / 3123 行 | **3512 行** |
| **`ARTICLE_MODEL` 值** | `CLAUDE.md:60`：`'claude-sonnet-4-6'` | `lib/claude.ts:17`：`ARTICLE_MODEL = 'sonnet'`（别名；API provider 再映射到 `AUTOARTICLE_LLM_ARTICLE_MODEL`，见 `:86-91`） |
| **Claude CLI 路径** | `CLAUDE.md:542`：`/Users/nan/.npm-global/bin/claude`（旧用户名、旧路径） | `lib/claude.ts:6-7` 硬编码 `mixingtumima0000`；本机实际 `which claude` = `/Users/mixingtumima0000/.local/bin/claude`（symlink → `.../claude/versions/2.1.258`） |
| **Node 最低版本** | `CLAUDE.md:543`：`≥ 18` | 真实约束 **≥ 22**（`got@15.0.5` engines `>=22`，见 §1.4） |
| **`lib/compose-schema.ts` 是 Zod schema** | `CLAUDE.md:357` | 该文件**无 zod**，只导出 `ensureComposeColumns()`；`zod` 未安装 |
| **测试命令** | `CLAUDE.md:578`：`npx vitest run` | `vitest` 未安装、无 `test` script、无测试文件 |
| **桌面启动器** | `CLAUDE.md:516`：「双击桌面 `~/Desktop/AutoArticle.command`（已配 chmod +x）」 | `ls ~/Desktop/*.command` **不存在该文件** |

**给后续改代码的人**：`CLAUDE.md` / `AGENTS.md` 是「决策与历史」的权威来源，但**不是当前代码结构的权威来源**。任何「某文件/某模块现在是什么」的判断，都要回到工作树实际读文件。本表就是为此而记。

---

## 9. 技术栈全景（一页速览）

```
┌─ 运行形态 ───────────────────────────────────────────────┐
│ macOS 本机单用户 · 无云 · 无 API key · 无多租户            │
│ Next.js 15.5.18 App Router，dev 起在本机端口 3100          │
└──────────────────────────────────────────────────────────┘
        │
        ├─ L1 Page      app/**/page.tsx（14 个页面）      ← compose 违规含 fetch
        ├─ L2 Component components/**/*.tsx（20 个）      ← Tailwind + CSS 变量
        ├─ L3 Hook      hooks/*.ts（**空**）              ← 待抽 useSseStream
        ├─ L4 Store     stores/*.ts（2 个，Zustand 5）    ← theme / toast
        └─ L5 Lib       lib/*.ts（~25 模块）              ← 纯函数，无 React
                │
                ├─ lib/claude.ts   模型入口：spawn 本机 CLI，stream-json 真流式
                │                  4 种 provider：claude-cli / codex-cli /
                │                  openai-compatible / openai-responses
                │                  默认超时 180s；重负载显式传 480/360s
                ├─ lib/db.ts       better-sqlite3 单例 + WAL + 幂等扩列
                ├─ lib/crawler/    got + cheerio + jsdom + Readability + OpenCLI
                ├─ lib/prompts/    全部 prompt 模板（v3 指纹 / outline / article /
                │                  critic / siteprofile / xiaopu-writing …）
                ├─ lib/images/     本地素材库扫描 + Unsplash + Claude 视觉分类
                └─ lib/search/     MiMo / Tavily / DDG / Google CSE 联网事实
                │
                └─ 数据         data/autoarticle.db（WAL，首次 getDb() 自建）
```

---

## 10. 待核实

以下条目本次**无法确认**，或文档与代码冲突需项目所有者裁决。**不猜**。

1. **`zod` 到底要不要用** —— 当前 `zod` 未安装、代码零使用，但 `CLAUDE.md:357` 明确把它当作 `lib/compose-schema.ts` 的实现。是文档写错，还是「曾经用过后来拆掉」？若是前者，应订正 `CLAUDE.md:357`；若是后者，需确认 API 入参是否真的无校验（那会是安全/健壮性缺口）。
2. **Apify 是永久移除还是临时摘掉** —— 工作树删除、`CLAUDE.md` 仍大篇幅记录。若永久移除，`CLAUDE.md:419`、`:446-447`、`:484-488`、`:535`、`:557-561` 都需要重写；若只是暂时，得说明为什么删文件而不是注释。
3. **`/research` 与 v3.5 gather 的关系** —— `/research` 整链已删，但 `lib/schema-additions-research.ts` 仍在 `lib/db.ts:5` 被 import 并建表，`app/api/compose/gather/route.ts` 也仍在跑（改用 `lib/search/mimo-web-search.ts` + `lib/search/web-facts.ts`）。是「v3.5 gather 取代了 /research」，还是「/research 待重建」？
4. **Next.js App Router 的选型理由** —— 仓库无记录。`docs/行动大纲.md:76` 提出要写「为什么 Next 而不是 Electron」，但本次未找到任何当时的对比材料。
5. **Zustand / nanoid / tsx / cheerio / jsdom / got / Readability 各自的选型理由** —— 仓库均无记录，本文只写了可核验的分工与用法。
6. **`next.config.ts` 的 `X-Accel-Buffering` 是否真有必要** —— 本机 `next dev`/`next start` 前面没有 Nginx，这个头在本机场景下的收益需要确认；它更像为将来套反代预留。
7. **`components/nav/ApifyStatusPill.tsx` 删除后，Apify 用量 UI 是否还有替代** —— 需确认 `/settings/preferences` 里的 Apify token 管理界面是否一并移除。
8. **`data/xiaopu-skill/` 与 `data/xiaopu-article-kb/` 的清理范围** —— `docs/行动大纲.md:94-98` 已定「目录改名但 md 内文一字不改」，本文不改动，但改名后的引用同步点未逐一核验。
9. **npm 版本差异** —— `STATUS.md:27` 记 npm 11.12.1，本机实测 10.8.2。是换了机器还是被降级？对安装行为是否有影响待确认。
10. **`.env.local` 当前只填了 `AUTOARTICLE_LLM_PROVIDER=codex-cli`（9 字符），其余全空** —— 是否意味着当前正文生成实际走 codex 而非 claude？这与 `CLAUDE.md:18-19`「正文 draft + refine 走 Sonnet 4.6」的分工描述不符，需确认是有意切换还是临时状态。
