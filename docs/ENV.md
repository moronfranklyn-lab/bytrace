# 笔迹 ByTrace · 环境变量总表

> **文档定位**：这是**当前代码实际读取**的环境变量完整清单——不是设计稿，是从源码逐条 grep 出来的。
> **✅ 最后更新：2026-09-24（方案二已落地）** · 对应代码 `main`（含 `lib/env.ts` 统一层）
>
> **方案二改造已完成**，本文件已同步为**新命名体系**。核心变化：
> 1. 新增 `lib/env.ts` 统一读取层，**三层兜底**：`BYTRACE_*` → `AUTOARTICLE_*` → `OPENAI_*`。
> 2. 主 Agent 与联网事实搜索**拆成两组独立配置**（可以写作走一家、搜索走另一家）。
> 3. 清除了 `lib/claude.ts` 与 `app/api/scan-assets/route.ts` 里的**硬编码机器路径**。
> 4. 新增 `/api/health` 自检端点。
> 5. 原计划的第三组「深度调研」**已随 `/research` 链路删除而取消**。

---

## 零、当前推荐配置（Ethan 在用）

| 用途 | 供应商 | 关键变量 |
| --- | --- | --- |
| 主 Agent | **MiMo（小米）** | `BYTRACE_AGENT_BASE_URL=https://api.xiaomimimo.com/v1` + `BYTRACE_AGENT_API_KEY` |
| 联网事实搜索 | **豆包（火山方舟）** | `BYTRACE_SEARCH_API_KEY`（方舟 key）+ 控制台开通「联网内容插件」 |

**一处不用改就能跑**：什么都不填 → 自动回退本机 Claude / Codex CLI 订阅。

---

## 一、配置文件放哪

| 文件 | 作用 | 是否进 git |
| --- | --- | --- |
| `.env.local` | **你的真实配置**（含密钥）。Next.js 自动加载 | ❌ 已 gitignore |
| `.env.local.example` | 模板（无密钥），带申请地址注释 | ✅ 进仓库 |
| `.env.local.backup-*` | 改动前的自动备份 | ❌ 已 gitignore |
| `.cache/` | node-gyp / npm 的本地构建缓存（沙箱内构建用） | ❌ 已 gitignore |
| `lib/env.ts` | 统一读取层与三层兜底逻辑 | ✅ 进仓库 |

**铁律**：密钥只写 `.env.local`，不写进代码、不提交、不在对话/日志/截图里回显。

---

## 二、三层兜底与 provider 归一

### 2.1 三层兜底

`lib/env.ts` 的每个变量都按顺序找第一个非空值：

```
BYTRACE_*   →   AUTOARTICLE_*   →   OPENAI_*   →   内置默认值
（新名）         （旧名兼容）         （更旧兼容）
```

**含义**：你只填新名就行；**老的 `.env.local` 一个字不改也照常运行**。

### 2.2 provider 归一

`BYTRACE_AGENT_PROVIDER`（旧名 `AUTOARTICLE_LLM_PROVIDER`）决定整个应用走哪种模型通道。

| 你填的值 | 归一到 | 含义 | 需要 key 吗 |
| --- | --- | --- | --- |
| `claude-cli` / `claude` / 空 | `claude-cli` | **本机 Claude Code CLI 订阅**（默认） | ❌ 不需要 |
| `codex-cli` / `codex` | `codex-cli` | **本机 Codex CLI 登录态**（非流式，但无需 key） | ❌ 不需要 |
| `openai-compatible` / `api` / `local-api` / `local-openai` / `lmstudio` / `lm-studio` / `ollama` / **`mimo`** / **`doubao`** / **`ark`** | `openai-compatible` | 任意 OpenAI 兼容端点（**MiMo** / DeepSeek / Kimi / GLM / LM Studio / Ollama…） | 看服务 |
| `openai-responses` / `openai` / `responses` / `responses-api` | `openai-responses` | OpenAI Responses API | ✅ 必须 |

> 新增了 `mimo` / `doubao` / `ark` 三个简写，都归到 `openai-compatible`，方便直接写供应商名。
> 填了不认识的字符串会**直接抛错**并列出可用值。

> 填了不认识的字符串会**直接抛错**：`AUTOARTICLE_LLM_PROVIDER="xxx" 不支持。可用值：claude-cli / codex-cli / openai-compatible / openai-responses`

---

## 三、完整变量表（当前代码实际读取）

### 3.1 模型 · 主开关（`lib/claude.ts`）

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| 变量（新名优先） | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_AGENT_PROVIDER` | 否 | `claude-cli` | 四选一（见 §2.2） |
| `BYTRACE_AGENT_BASE_URL` | API 模式必填 | `openai-responses` → `https://api.openai.com/v1`；`openai-compatible` → `http://127.0.0.1:1234/v1` | 端点地址。尾部斜杠自动 trim |
| `BYTRACE_AGENT_API_KEY` | `openai-responses` 必填 | 空 | API key |
| `BYTRACE_AGENT_MODEL` | API 模式必填 | 空 | **分析类**模型（指纹 / 大纲 / critic） |
| `BYTRACE_AGENT_ARTICLE_MODEL` | 否 | 回退 `BYTRACE_AGENT_MODEL` | **正文类**模型（降 AI 味，对应 `ARTICLE_MODEL` 别名） |

**三层兜底对照（`lib/env.ts`）**：

| 用途 | 新名 | 旧名 | 更旧名 |
| --- | --- | --- | --- |
| provider | `BYTRACE_AGENT_PROVIDER` | `AUTOARTICLE_LLM_PROVIDER` | — |
| base url | `BYTRACE_AGENT_BASE_URL` | `AUTOARTICLE_LLM_BASE_URL` | `OPENAI_BASE_URL` |
| api key | `BYTRACE_AGENT_API_KEY` | `AUTOARTICLE_LLM_API_KEY` | `OPENAI_API_KEY` |
| 分析类模型 | `BYTRACE_AGENT_MODEL` | `AUTOARTICLE_LLM_MODEL` | `OPENAI_MODEL` |
| 正文类模型 | `BYTRACE_AGENT_ARTICLE_MODEL` | `AUTOARTICLE_LLM_ARTICLE_MODEL` | `AUTOARTICLE_ARTICLE_MODEL` |

> 解析在 `lib/claude.ts` 的 `resolveApiConfig()`，取值器统一走 `lib/env.ts`。模型为空时抛错并提示该填哪个变量。

### 3.2 模型 · Codex CLI

| 变量（新名优先） | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_CODEX_BIN` | 否 | `codex`（走 PATH） | Codex 可执行文件路径 |
| `BYTRACE_CODEX_CWD` | 否 | `/tmp` | Codex 工作目录。**给中性目录很重要**——否则 codex 会读项目根 `AGENTS.md` 跑偏 |
| `BYTRACE_CODEX_MODEL` | 否 | — | Codex 模型（旧名 `AUTOARTICLE_CODEX_MODEL`） |
| `BYTRACE_CODEX_ARTICLE_MODEL` | 否 | — | Codex 的正文类模型（旧名 `AUTOARTICLE_CODEX_ARTICLE_MODEL`） |

### 3.3 Claude CLI 路径（**已修，不再硬编码**）

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_CLAUDE_BIN` | 否 | 自动探测 | Claude CLI 完整路径（旧名 `CLAUDE_BIN`）。配图视觉打标与主链路都读它 |

**候选顺序**（`lib/claude.ts` 的 `CLAUDE_BIN_CANDIDATES`，由 `$HOME` 推导，**与用户名无关**）：

```
1. BYTRACE_CLAUDE_BIN / CLAUDE_BIN（显式指定）
2. claude                      （交给 PATH）
3. $HOME/.local/bin/claude
4. $HOME/.npm-global/bin/claude
5. $HOME/.bun/bin/claude
6. /opt/homebrew/bin/claude
7. /usr/local/bin/claude
```

> ✅ **旧风险 R1 已解除**：原代码硬编码 `/Users/mixingtumima0000/...`，换电脑必挂。
> 现在 ENOENT 时会**按上表逐个尝试**，全失败才报错，并在错误信息里列出「已试过哪些路径」+ 提示用 `BYTRACE_CLAUDE_BIN` 指定。

### 3.4 联网事实搜索（`lib/search/` + `app/api/compose/gather`）

**事实底座的真实优先级链**（`app/api/compose/gather/route.ts`）：

```
① 豆包（火山方舟 Responses API + web_search）   ← ★ 当前选定
        ↓ 未配置 / 失败
② MiMo web_search                              ← 复用主 Agent 的 key
        ↓ 未配置 / 失败
③ Tavily                                       ← 需 TAVILY_API_KEY
        ↓ 未配置 / 无结果
④ searchWebFacts() —— Google CSE（配了 key + id）
        ↓ 否则
⑤ DuckDuckGo HTML（免 key，内置 1.5s 节流）
```

**用 `BYTRACE_SEARCH_PROVIDER` 强制指定通道**：`auto`（默认）| `doubao` | `mimo` | `tavily` | `web-facts`。

| 变量（新名优先） | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_SEARCH_PROVIDER` | 否 | `auto` | 通道选择：auto / doubao / mimo / tavily / web-facts |
| `BYTRACE_SEARCH_BASE_URL` | 否 | `https://ark.cn-beijing.volces.com/api/v3` | 方舟端点 |
| `BYTRACE_SEARCH_API_KEY` | 豆包必填 | 空 | ★ 火山方舟 API Key |
| `BYTRACE_SEARCH_MODEL` | 否 | `doubao-seed-2-1-pro-260628` | 执行搜索的方舟模型（需支持 `web_search`） |
| `BYTRACE_SEARCH_MAX_KEYWORD` | 否 | `5` | 单轮最大关键词数（1-50）。越大越广也越贵 |
| `BYTRACE_SEARCH_MAX_RESULTS` | 否 | `5` | 最多保留来源条数 |
| `BYTRACE_SEARCH_SOURCES` | 否 | 空 | 可选垂类源，逗号分隔：`douyin` / `toutiao` / `moji` |
| `BYTRACE_MIMO_WEB_SEARCH` | 否 | `auto` | MiMo 自带联网插件开关（auto / 1 / 0） |
| `TAVILY_API_KEY` | 否 | 空 | 第③级 |
| `BYTRACE_GOOGLE_CSE_KEY` / `_ID` | 否 | 空 | 第④级。旧名 `GOOGLE_CSE_KEY` / `GOOGLE_CSE_ID` |

> **豆包要开通插件才能用**：方舟控制台 → 服务组件库 → 联网内容插件 → 开通（免费开通，按搜索次数计费，国内 ¥16/千次）。
> **MiMo 的联网插件**在 https://platform.xiaomimimo.com/#/console/plugin 开启，约 5 分钟生效；且需 `sk-` 按量计费 key（Token Plan `tp-` 不支持）。
>
> **全都不配会怎样？** 不阻塞。事实底座跳过（prompt 自动降级），博主名搜索回落到 DuckDuckGo HTML（免 key）。

## 四、按「用户旅程」给的最小配置

### 场景 A：完全本机（零 key、零费用）

```bash
# 什么都不用填，或把 BYTRACE_AGENT_PROVIDER 留空。
# 走本机 Claude CLI 订阅 / Codex CLI 订阅 + OpenCLI 抓取 + DDG 免 key 搜索。
# 前提：Node.js 与对应 CLI 可用。
```

### 场景 B：主 Agent 用 MiMo（★ Ethan 当前方案）

```bash
BYTRACE_AGENT_PROVIDER=openai-compatible
BYTRACE_AGENT_BASE_URL=https://api.xiaomimimo.com/v1
BYTRACE_AGENT_API_KEY=              # ← 填你的 MiMo key（sk- 开头）
BYTRACE_AGENT_MODEL=mimo-v2.6-pro
BYTRACE_AGENT_ARTICLE_MODEL=mimo-v2.6-pro
```

### 场景 C：联网事实搜索用豆包（★ Ethan 当前方案）

```bash
BYTRACE_SEARCH_PROVIDER=auto
BYTRACE_SEARCH_API_KEY=             # ← 填你的火山方舟 key
BYTRACE_SEARCH_MODEL=doubao-seed-2-1-pro-260628
# 别忘了到方舟控制台开通「联网内容插件」
```

### 场景 D：主 Agent 换成别的 OpenAI 兼容服务

```bash
BYTRACE_AGENT_PROVIDER=openai-compatible
BYTRACE_AGENT_BASE_URL=https://api.deepseek.com/v1
BYTRACE_AGENT_API_KEY=              # ← 你自己填
BYTRACE_AGENT_MODEL=deepseek-chat
BYTRACE_AGENT_ARTICLE_MODEL=deepseek-chat
```

---

## 五、P3「三套命名并存」的处理结果（方案二已落地）

**改造前**：

| 命名体系 | 出现位置 | 举例 |
| --- | --- | --- |
| `AUTOARTICLE_*` | 主命名 | `AUTOARTICLE_LLM_MODEL` |
| `OPENAI_*` | 旧兼容（仍被读取） | `OPENAI_MODEL` |
| `CLAUDE_BIN` | 无前缀，只在配图用 | `CLAUDE_BIN` |

**改造后**：

| 做法 | 结果 |
| --- | --- |
| 新增 `lib/env.ts` 统一读取层 | ✅ 所有 `process.env.*` 读取收敛到一处，新增 `BYTRACE_*` 分组命名 |
| 三层兜底 `BYTRACE_*` → `AUTOARTICLE_*` → `OPENAI_*` | ✅ 你填新名时旧配置仍生效，**不会中途瘫痪** |
| 清除 R1 硬编码路径 | ✅ `lib/claude.ts` 改为 `$HOME` 推导 + `ENOENT` 逐个候选重试 |
| 清除 R1b（新发现） | ✅ `app/api/scan-assets/route.ts` 的硬编码私人目录改为 `BYTRACE_SCAN_DEFAULT_DIR` → `~/Pictures` |
| `CLAUDE_BIN` 加前缀 | ✅ 新名 `BYTRACE_CLAUDE_BIN`，旧名仍兼容 |
| 已作废的 `APIFY_TOKEN` | ✅ 随 Apify 模块删除，`.env.local.example` 里也不再有这一行 |

---

## 六、验证清单（改完 env 后照这个查）

```bash
# 1. 确认 .env.local 存在且没被 git 跟踪
ls -la .env.local && git check-ignore -v .env.local

# 2. 确认密钥没进代码
grep -rn "sk-\|AIza\|tvly-" --include="*.ts" --include="*.tsx" lib app | grep -v "sk-xxx"

# 3. 确认类型检查通过
npx tsc --noEmit

# 4. 起服务，然后用自检端点看哪项没配好
npm run dev -- -p 3100
curl -s http://127.0.0.1:3100/api/health | python3 -m json.tool
```

### `/api/health` 自检端点（方案二新增）

**返回结构**（永远 200，`ok` 表示主 Agent + 数据库都就绪）：

```json
{
  "ok": true,
  "summary": "主 Agent 与数据库均就绪，可以开始写作",
  "checks": [
    { "key": "agent",    "label": "主 Agent（openai-compatible）", "status": "ready", "detail": "https://api.xiaomimimo.com/v1 · 模型 mimo-v2.6-pro" },
    { "key": "search",   "label": "联网事实搜索（provider=auto）",  "status": "ready", "detail": "可用通道：豆包（火山方舟） → DuckDuckGo（免 key 兜底）" },
    { "key": "database", "label": "SQLite 数据库",                  "status": "ready", "detail": "作者 4 · 指纹 4 · 文章 15" },
    { "key": "data_dir", "label": "数据目录",                       "status": "ready", "detail": "<项目>/data（默认）" },
    { "key": "images",   "label": "配图（可选）",                    "status": "ready", "detail": "仅本地素材库" }
  ],
  "debug": { "node": "v22.23.2", "claude_bin_candidates": ["claude", "..."] }
}
```

`status` 取值：`ready` / `missing`（缺变量，带 `fix` 提示）/ `unavailable`（装了但坏了）/ `not-needed`（可选未配）。

> ✅ **不泄露密钥**：只报告「有没有」，不回显值本身。
> ✅ **不会因为没配就失败**：始终 200，把「哪儿没配」当作可诊断信息返回。
