# 笔迹 ByTrace · 技术栈与选型

> 版本：v1.0 · 更新：2026-07-05

**笔迹 ByTrace** 是一个跑在本机的 AI 写作工具：把一段模糊的选题思路，结合拆解过的博主「风格指纹」与目标平台的「站点画像」，生成有论证骨架的多平台成稿。

它不生产信息，它生产**你的观点在别人风格下的成稿**。要解决的问题不是"写不出来"，而是"写出来像 AI、浮于表面、没有论证纵深"。

三条贯穿全局的约束，决定了下面每一个选型：

1. **本机单用户**——没有账号体系、没有并发、没有多租户。
2. **数据不出本机**——全部落在本地 SQLite，不上云、不做 SaaS、不接第三方托管存储。
3. **尽量不新增计量成本**——优先复用本机已订阅的 CLI，其次才是按量计费的 API。

本文记录这套技术栈选了什么、每项为什么、以及明确不选什么。

---

## 0. 技术栈一览

| 维度 | 选择 |
| --- | --- |
| 运行形态 | macOS 本机单用户 · 无云 · 无多租户 · 本机端口 3100 |
| 框架 | Next.js 15 App Router（页面路由 + Route Handler + SSE 流式） |
| UI | React 19 + Tailwind CSS 3 + CSS 变量三主题，**手写组件、不引 UI 库** |
| 状态 | Zustand（仅全局临时状态）+ 组件内 React state |
| 数据 | better-sqlite3（进程内单例 + WAL），**不用 Postgres** |
| 模型接入 | 本机 Claude / Codex CLI 订阅优先，可切任意 OpenAI 兼容端点 |
| 爬取 | got（HTTP）+ cheerio（选择器）+ jsdom / @mozilla/readability（语义兜底）+ 本机 OpenCLI |
| 质量 gate | `strict: true` 下的 `npx tsc --noEmit` |
| 语言 | 全量 TypeScript（`allowJs: false`），无 JS 源码 |

---

## 1. 版本清单

以下锁定版本取自 `package.json` 与 `package-lock.json`，是当前开发环境实际解析到的版本。

### 1.1 运行时依赖（`dependencies`）

| 依赖 | 声明范围 | 锁定版本 | 用途 | 关键位置 |
| --- | --- | --- | --- | --- |
| `next` | `^15.1.0` | **15.5.18** | App Router 全栈框架：页面路由 + Route Handler（34 个 `route.ts`）+ SSE 流式响应 | `app/**/page.tsx`、`app/api/**/route.ts` |
| `react` | `^19.0.0` | **19.2.6** | UI 运行时。项目大量使用 `'use client'` 组件 + `useState / useEffect / useRef / useMemo` 状态机 | `app/compose/page.tsx` 等 client 组件 |
| `react-dom` | `^19.0.0` | **19.2.6** | React DOM 渲染（版本必须与 `react` 完全一致） | 同上 |
| `better-sqlite3` | `^11.3.0` | **11.10.0** | 唯一数据层：同步 API 直连 SQLite，WAL 模式，进程内单例 | `lib/db.ts` |
| `zustand` | `^5.0.1` | **5.0.13** | 全局临时状态（L4 层）：主题、Toast | `stores/theme-store.ts`、`stores/toast-store.ts` |
| `nanoid` | `^5.0.7` | **5.1.11** | 生成短 ID（博主 id 12 位、指纹 id 14 位等），替代 UUID 让 URL 更短 | `app/api/fingerprint/v2/route.ts` 等 |
| `@mozilla/readability` | `^0.6.0` | **0.6.0** | 通用正文抽取：站点选择器没命中时的兜底骨架提取 | `lib/crawler/adapters/generic.ts` |
| `cheerio` | `^1.2.0` | **1.2.0** | 各站点适配器的 HTML 解析主力（jQuery 风格 API），也是 Readability 之后的二次解析 | `lib/crawler/html.ts`、`lib/crawler/adapters/*.ts` |
| `got` | `^15.0.5` | **15.0.5** | HTTP 客户端：统一 UA、超时、中止、下载体积上限（用 `signal` + `downloadProgress` 实现） | `lib/crawler/http.ts` |
| `jsdom` | `^29.1.1` | **29.1.1** | 为 `@mozilla/readability` 提供 DOM 环境（Readability 只吃 DOM） | `lib/crawler/adapters/generic.ts` |

### 1.2 开发依赖（`devDependencies`）

| 依赖 | 声明范围 | 锁定版本 | 用途 |
| --- | --- | --- | --- |
| `typescript` | `^5.6.3` | **5.9.3** | 类型检查（`strict: true`），核心质量 gate `npx tsc --noEmit` |
| `tailwindcss` | `^3.4.14` | **3.4.19** | 原子化 CSS。全部主题色 / 圆角 / 字体 / 缓动都映射到 CSS 变量（见 §2.4） |
| `postcss` | `^8.4.49` | **8.5.15** | Tailwind 的构建管道宿主 |
| `autoprefixer` | `^10.4.20` | **10.5.0** | 浏览器前缀自动补齐 |
| `tsx` | `^4.22.3` | **4.22.3** | 直接跑 TypeScript 脚本（无需先编译）：`scripts/scan-local-assets.ts`、`scripts/tag-local-assets.ts` |
| `@types/node` | `^22.9.0` | **22.19.19** | Node 类型（`child_process` / `fs` / `path` / `crypto`） |
| `@types/react` | `^19.0.0` | **19.2.15** | React 类型 |
| `@types/react-dom` | `^19.0.0` | **19.2.3** | React DOM 类型 |
| `@types/better-sqlite3` | `^7.6.11` | **7.6.13** | `Database.Database` 类型；strict 模式下 `lib/db.ts` 必需 |
| `@types/jsdom` | `^28.0.3` | **28.0.3** | jsdom 类型 |

### 1.3 环境基线

| 项 | 要求 / 值 | 说明 |
| --- | --- | --- |
| Node.js | **≥ 22** | 硬性要求。`got@15` 声明 `engines: node >=22`；`jsdom@29` 接受 `^20.19.0 \|\| ^22.13.0 \|\| >=24`；`cheerio@1.2` 要求 `>=20.18.1`。走 22.x 线时建议 ≥ 22.13 |
| npm | 随 Node 自带即可 | `package.json` 未声明 `engines` 字段 |
| SQLite | 系统自带 `sqlite3` CLI（可选） | 只有手工查库时才用得到，应用本身通过 better-sqlite3 读写 |
| 数据库文件 | `data/autoarticle.db` | WAL 模式，首次 `getDb()` 时自动建库建表 |

---

## 2. 每一项为什么选它

### 2.1 Next.js App Router

选 App Router 而不是 Pages Router，是被三件事推着走的：

- **一个 `page.tsx` = 一个路由 = 一个 URL**。这条后来被固化成项目的 L1 硬规定（见 §5）：路由结构与目录结构同构，新增页面不用维护一份路由表。
- **Route Handler 天然适合服务端流式**。正文生成需要把模型输出逐字推给浏览器，SSE 走的是 Route Handler 里的 `fetch` + `ReadableStream`，而不是 `EventSource`——因为要带上 POST body、自定义头与中止信号，`EventSource` 表达不了。这套写法在 App Router 的 Route Handler 里最顺（`lib/sse.ts`）。
- **一个仓库同时装页面与 API**。本项目有 18 个页面与 34 个 API 端点，前后端共享 TypeScript 类型，不需要单独的后端服务与跨进程通信。

配套的两个配置都围绕"本机流式生成"这一核心场景：

- `next.config.ts` 声明 `serverExternalPackages: ['better-sqlite3']`，避免框架去打包原生模块（详见 §4.2）。
- 给 `/api/*` 统一加 `X-Accel-Buffering: no`，为流式响应禁掉反向代理缓冲。

### 2.2 React 19

React 19 是主动想要的版本，代价是当时必须把 Next 抬到 15.1+：

- `next@15.0.3` 的 peerDependency 只接受 `react@19` 的 RC，装 `react@19.0.0` 正式版会触发 `ERESOLVE`。
- 依赖表里因此写成 `next: ^15.1.0`（实际锁到 15.5.18），React 19 GA 得到正式支持。

用 React 19 的直接收益是表单 action、`use` 与流式 UI 的原生支持，正文逐字渲染不需要外挂状态库。

### 2.3 better-sqlite3（而不是 Postgres）

本地工具、单用户、零运维，这三个前提让 Postgres 的**全部优势都变成负担**：连接池、独立服务进程、迁移工具、备份策略，在这里都是纯开销。better-sqlite3 的同步 API 没有 async 往返，在本机读写场景下反而更快、代码更短。

配套实现约束都集中在 `lib/db.ts`：

- **进程内单例**：`let _db` + `getDb()`，命中即返回，避免 Next dev 热重载反复开库。
- **`journal_mode = WAL`**：读写并发不互锁；注意 `-wal` / `-shm` 是数据库的一部分，不要单独删。
- **`foreign_keys = ON`**：外键约束在 SQLite 里默认关闭，必须显式打开。
- **幂等初始化**：启动时跑 `schema.sql` + 一族 `ensureXxx` 建表 / 扩列函数，老库新库都能直接起来，不依赖外部 migration 工具。

结论很明确：**不要换 Postgres**。

### 2.4 Tailwind + CSS 变量（三主题）

项目要的是「克制 + 书卷气」的视觉语言，而不是一套通用中后台皮肤。所以**不引 UI 组件库**，用 Tailwind 手写组件，主题切换交给 CSS 变量。

三套主题各有明确的视觉目标：

| 主题 id | 名字 | 定义位置 |
| --- | --- | --- |
| `B` | 牛皮纸 · 朱砂 | `app/globals.css` 的 `[data-theme="B"]` |
| `C` | 夜书房 · 鎏金 | `app/globals.css` 的 `[data-theme="C"]` |
| `D` | 极简 · 松石青 | `app/globals.css` 的 `[data-theme="D"]` |

名字的权威来源是 `components/theme/ThemeSwitcher.tsx`：

```ts
{ id: 'B', label: '牛皮纸 · 朱砂' },
{ id: 'C', label: '夜书房 · 鎏金' },
{ id: 'D', label: '极简 · 松石青' },
```

机制上，`tailwind.config.ts` **不写死任何颜色**，而是把 CSS 变量映射成 Tailwind token（`bg: 'var(--bg)'`、`text: 'var(--text)'`、`accent: 'var(--accent)'` 等），圆角 / 字体 / 缓动同理。`app/globals.css` 的 `[data-theme="B"|"C"|"D"]` 只负责重定义这批变量，`:root` 放三主题共享 token（字体栈、缓动、圆角）。

于是「换主题」= 切换 `<html data-theme>` 一个属性，**组件代码零改动**。

两个容易踩的默认值细节：

- `app/layout.tsx` 在服务端读 `settings` 表的 `default_theme`，把结果直接写到 `<html data-theme>`，避免首屏主题闪烁。
- `stores/theme-store.ts` 的 zustand fallback 写的是 `theme: 'D'`，那只是客户端兜底。**真正的默认主题由 `settings` 表决定**，要改默认主题请改数据，不要改这两处代码。

### 2.5 Zustand

Zustand 的定位被刻意收得很窄：**只放全局共享的临时状态**，服务端拉来的数据不进 store。

- 放在 L4 层，与 Page / Component / Hook / Lib 分层解耦（见 §5）。
- 目前只有 2 个 store：`stores/theme-store.ts`（带 `persist` 中间件 → `localStorage`，key `autoarticle-theme`）与 `stores/toast-store.ts`。
- 边界很硬：**Store 不放服务端拉的数据**。列表、详情这类数据由页面自己 fetch / 由 `router.refresh()` 同步，避免出现"两套真相"。

体量小是优点：一个主题、一个 Toast，用 Zustand 比引 Redux 工具链便宜得多，也不会把状态管理变成架构主角。

### 2.6 nanoid

`nanoid` 用短 ID 直接进 URL 与主键，替代 UUID：博主 id 12 位、指纹 id 14 位。本机单人工具里，URL 是要被人眼看、手动粘贴的（爬取预览、指纹页、分享给自己），短 ID 明显更好用，碰撞概率在这个量级下也不构成问题。

### 2.7 爬取四件套：got / cheerio / jsdom / @mozilla/readability

这四个库是分工关系，不是备选关系：

| 库 | 分工 | 代码位置 |
| --- | --- | --- |
| `got` | HTTP 传输层：统一 UA、超时、中止、下载体积上限 | `lib/crawler/http.ts` |
| `cheerio` | 站点适配器的选择器解析主力（每个 adapter 的正文 / 列表抽取） | `lib/crawler/html.ts`、`lib/crawler/adapters/*.ts` |
| `jsdom` | 给 Readability 造 DOM（Readability 的输入是 DOM，不是字符串） | `lib/crawler/adapters/generic.ts` |
| `@mozilla/readability` | 选择器没命中时的**语义兜底**：先从整页猜正文块，再回交 cheerio 解析段落与图片 | `lib/crawler/adapters/generic.ts` |

设计要点：

- **适配器优先、通用兜底**。每个站点（少数派、优设、人人都是产品经理、知乎、B 站、小红书、YouTube…）有独立 adapter；没适配的站点落到 `generic.ts`，靠 Readability 猜正文，保证"能抓"。
- **jsdom 只当一次性 DOM 宿主**。`generic.ts` 用 `new VirtualConsole()` 静默 jsdom 的 CSS 警告——只抽正文时不需要一个完整浏览器环境。
- **抓不到就退回人工粘贴**。公众号正文走本机 OpenCLI 下载；失败时提示手贴，不引入付费抓取通道。

### 2.8 流式：`streamClaude` + `--output-format stream-json`

流式是正文页的体验底线。早期实现里 `claude -p` **默认不流式**：整篇答完才一口气吐 stdout，正文页会长时间停在"已 0 字"。改用：

```
claude -p --output-format stream-json --input-format stream-json --include-partial-messages
```

之后约 **5–6 秒**就有第一个 chunk，按 `content_block_delta > text_delta.text` 解析并喂给 `onChunk`。对外契约没变（`onChunk` 仍是纯文本、返回值是拼装好的全文），所以所有调用方零迁移。

`lib/claude.ts` 是**所有模型调用的唯一入口**，不要在业务代码里自己 `spawn`：

- 默认超时 `DEFAULT_TIMEOUT_MS = 180_000`；重负载阶段显式传更大值（指纹 Stage2 / Stage3 / 分类分别给到 480 / 360 / 360 秒，gather 用 360 秒）。
- 四种 provider 统一在一个入口内部归一：`claude-cli` / `codex-cli` / `openai-compatible` / `openai-responses`。换供应商只改环境变量，不改调用方。
- 正文 draft / refine 走 `ARTICLE_MODEL` 别名（降 AI 味），大纲与 critic 不指定模型、走各通道默认。别名让"正文模型"成为可配置项，而不是散落在各处的字符串。

### 2.9 tsx

两个运维脚本（`scripts/scan-local-assets.ts`、`scripts/tag-local-assets.ts`）直接用 `npx tsx` 跑，不需要为它们配一套编译产物或打包配置：

```bash
npx tsx scripts/scan-local-assets.ts
npx tsx scripts/tag-local-assets.ts --limit 20
```

`package.json` 里没有为它们建 script，保持"脚本即命令"的简单形态。

---

## 3. 明确「为什么不」

下面每一条都是有意做出的否决，而不是"没来得及做"。

| 被否决的方案 | 理由 |
| --- | --- |
| **Anthropic 官方 SDK（`@anthropic-ai/sdk`）** | 本机已订阅 Claude Pro、不购买 API 计量 key，`claude -p "<prompt>"` 走订阅额度算费用。换成 SDK 会变成"按 token 付费"的 SaaS 模式，等于付两份钱。代价也接受得明确：要 spawn 子进程、流式接 stdout、自己管超时。 |
| **上云 / SaaS 形态** | 「数据全留本机 SQLite」是项目铁律：不接托管存储、不做多租户、不把稿件发到第三方服务。本地工具的信任成本几乎为零，这是它相对在线写作工具的核心优势。 |
| **UI 组件库（Ant Design / MUI 等）** | 主题是设计资产（三套书卷气配色 + 字体 + 缓动），组件库的默认视觉会一路对抗它。Tailwind 手写组件 + CSS 变量能精确控制到 token 级，代价是组件要自己写——量不大，值得。 |
| **Postgres** | 本地、单用户、零运维。同步 API + 单文件数据库在这个场景下更快、更省事。见 §2.3。 |
| **edge runtime** | `better-sqlite3` 是原生模块，跑不了 edge runtime。因此**每个 `route.ts` 顶部都必须写 `export const runtime = 'nodejs'`**（见 §4.1）。 |
| **第三方抓取云（FireCrawl / Browserbase / Bright Data 等）** | 中文平台（知乎 403、公众号 captcha、小红书反爬）这些通用抓取云打不过；也没有现成的中文平台适配，仍要自己写解析。结论：爬虫自建（`got` + `cheerio` + Readability），登录态站点交回本机 OpenCLI，抓不到就人工粘贴。 |

---

## 4. 运行时约束

### 4.1 每个 route 都必须是 Node.js runtime

规则：`better-sqlite3` 是原生模块（native binding），edge runtime 加载不了，所以**每个 `route.ts` 顶部都要写**：

```ts
export const runtime = 'nodejs';
```

当前 34 个 `app/api/**/route.ts` 全部声明了 `runtime`，没有遗漏。新增端点时照抄这一行即可，忘了会在运行时报原生模块错误。

### 4.2 `serverExternalPackages` 与流式响应头

`next.config.ts`：

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 是 native binding，必须放到 serverExternalPackages，
  // 否则 Next 会尝试打包它并失败
  serverExternalPackages: ['better-sqlite3'],

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

两个配置各自解决一个问题：

- **`serverExternalPackages`**：让 Next 不要用 webpack 打包 better-sqlite3，改为运行时 `require` 原生 `.node`。否则 Server Component 引用 `lib/db.ts` 时会在打包阶段失败。
- **`X-Accel-Buffering: no`**：给所有 API 响应加禁缓冲头，保证 SSE 逐字到达浏览器而不是被中间的代理攒成一坨再发。

### 4.3 TypeScript strict + `@/*` 路径别名

`tsconfig.json` 关键项：

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

四个值得说明的点：

- **`strict: true`**：类型检查是核心质量 gate，提交前跑 `npx tsc --noEmit` 应当全绿。
- **`paths: { "@/*": ["./*"] }`**：`@/` 映射到**项目根**（不是 `src/`）。所以 `@/lib/db` = `<root>/lib/db`。全项目 import 统一走这个别名。
- **`noEmit: true` + `incremental: true`**：只做类型检查、不产出 JS，但会写 `tsconfig.tsbuildinfo`（已被 `.gitignore` 忽略）。
- **`allowJs: false`**：项目不接受 JS 源码，全部 TS / TSX。

---

## 5. 架构分层规则（L1–L5）

项目把代码按职责分成五层，跨层调用只允许自上而下：

```
L1 Page         app/**/page.tsx          一个 page.tsx = 一个路由 = 一个 URL
L2 Component    components/<group>/*.tsx 单独可见的 UI 元素
L3 Hook         hooks/*.ts               跨组件复用的能力（流式、剪贴板等）
L4 Store        stores/*.ts              全局共享的临时状态（Zustand）
L5 Lib          lib/*.ts                 通用工具，纯函数（日期、文本统计、爬虫等）
```

两条被单独点名的禁令：

1. **L1 Page 不得包含 fetch 逻辑**，跨组件复用的请求 / 流式逻辑必须抽到 L3 Hook。
2. **L5 Lib 不得 import React**，必须是纯工具；L4 Store 不放服务端拉的数据。

改某一层时不要顺手动另一层——这是这套分层存在的意义。

### 5.1 各层当前的占用

| 层 | 目录 | 当前内容 |
| --- | --- | --- |
| L1 Page | `app/**/page.tsx` | 18 个页面：`/`、`/compose`、`/fingerprints*`、`/strategies`、`/recipes`、`/authors*`、`/sites*`、`/topics`、`/articles*`、`/settings/preferences`、`/import` |
| L2 Component | `components/**/*.tsx` | 20 个组件，按 `authors/ compose/ fingerprints/ home/ nav/ theme/ ui/` 分组 |
| L3 Hook | `hooks/*.ts` | **待补**：目前只有 `.gitkeep`（见 §6） |
| L4 Store | `stores/*.ts` | 2 个：`theme-store.ts`、`toast-store.ts`，只放临时状态 |
| L5 Lib | `lib/*.ts` | ~25 个模块 + `crawler/`、`images/`、`prompts/`、`search/`、`sites/`、`fingerprints/`、`authors/` 子目录；`lib/` 下无任何 `from 'react'` |

唯一明显偏离分层的是 `app/compose/page.tsx`：它把 11 处 `fetch(` 直接写在了 Page 里，应当抽成 L3 的 `useSseStream` hook。这件事记在 §6。

---

## 6. 已知限制与后续优化

以下是当前版本明确知道、且有意留到后续处理的事项。它们不影响主链路可用，但都是接下来值得动的地方。

**分层与文件体量**

- `app/compose/page.tsx` 偏大（约 3500 行，11 处 `fetch(`），把请求与流式逻辑写在了 L1。下一步是抽出 `hooks/useSseStream.ts`，让 `hooks/` 层真正落地。
- v3 提取逻辑在 `app/api/fingerprint/v3/route.ts` 与 `lib/fingerprints/v3-engine.ts` 之间存在重复实现，两处容易改一处漏一处。计划整体迁移到 engine 的 `runV3Extraction`，route 只做参数校验与转发。

**数据一致性**

- **风格配方的 fragment id 稳定性**：`style_recipes.fragment_ids_json` 引用 `strategy_fragments_indexed.id`，而后者按 fingerprint 整组覆盖写，重新提炼会换一批 id，导致已有配方静默失效。属于设计级改动，需要 id 稳定化或引用回填。

**流程完整性**

- 多平台生成中止后只能整批重跑：Step 6 的「重新生成」会从头跑全部平台，还没做"只重跑失败平台"的局部重试。
- `research_material` 目前只透传前端 state、不落 article 历史；日后要追溯"某篇正文里的数字来自哪"，得按 `idea_hash` 反查 `gather_runs`。

**本机运行注意事项**

- **dev server 跑着的时候不要跑 `npm run build`**：两者共用 `.next/`，会让老 dev 进程报 ENOENT chunk。要 build 先停 dev。
- `data/autoarticle.db-wal` 是 SQLite WAL 模式的一部分，**不要手动删**，会丢尚未 checkpoint 的数据；要重置数据库就整个 `data/` 目录一起删。
- 公众号 URL 常带 `#rd` 之类的 hash 片段，计算 `url_hash` 去重前要先 normalize 掉。

---

## 7. 技术栈全景（一页速览）

```
┌─ 运行形态 ───────────────────────────────────────────────┐
│ macOS 本机单用户 · 无云 · 无多租户                          │
│ Next.js 15.5.18 App Router，dev 起在本机端口 3100          │
└──────────────────────────────────────────────────────────┘
        │
        ├─ L1 Page      app/**/page.tsx（18 个页面）      ← compose 目前自带 fetch
        ├─ L2 Component components/**/*.tsx（20 个）      ← Tailwind + CSS 变量
        ├─ L3 Hook      hooks/*.ts（待补）                ← 待抽 useSseStream
        ├─ L4 Store     stores/*.ts（2 个，Zustand 5）    ← theme / toast
        └─ L5 Lib       lib/*.ts（~25 模块）              ← 纯函数，无 React
                │
                ├─ lib/claude.ts   模型唯一入口：spawn 本机 CLI，stream-json 真流式
                │                  4 种 provider：claude-cli / codex-cli /
                │                  openai-compatible / openai-responses
                │                  默认超时 180s；重负载显式传 480/360s
                ├─ lib/db.ts       better-sqlite3 单例 + WAL + 幂等建表扩列
                ├─ lib/crawler/    got + cheerio + jsdom + Readability + OpenCLI
                ├─ lib/prompts/    全部 prompt 模板（v3 指纹 / outline / article /
                │                  critic / siteprofile / 写作风格 …）
                ├─ lib/images/     本地素材库扫描 + Unsplash + CLI 视觉分类
                └─ lib/search/     MiMo / 豆包 / Tavily / Google CSE / DuckDuckGo
                │
                └─ 数据         data/autoarticle.db（WAL，首次 getDb() 自建）
```
