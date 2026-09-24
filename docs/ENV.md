# 笔迹 ByTrace · 环境变量总表

> 版本：v1.0 · 更新：2026-07-05

本文是 **笔迹 ByTrace** 读取的全部环境变量清单，以及推荐的填法。

所有环境变量都由 `lib/env.ts` 统一读取，按用途分成五组：**主 Agent / 审查模型 / 联网事实搜索 / CLI 兜底 / 抓取与配图**。业务代码不直接读 `process.env`，新增变量时也只在这里登记一次。

> **跑起来的最低要求**：什么都不填，应用会回退到本机 Claude CLI / Codex CLI 订阅，照样能写。
> 填了就在对应通道上走 API，不填的通道自动跳过。

---

## 一、配置文件放哪

| 文件 | 作用 | 是否进版本库 |
| --- | --- | --- |
| `.env.local` | **你的真实配置**（含密钥）。Next.js 自动加载 | ❌ 已 gitignore |
| `.env.local.example` | 模板（无密钥），带申请地址注释 | ✅ 进仓库 |
| `.env.local.backup-*` | 改动前的自动备份 | ❌ 已 gitignore |
| `.cache/` | node-gyp / npm 的本地构建缓存 | ❌ 已 gitignore |
| `lib/env.ts` | 统一读取层与三层兜底逻辑 | ✅ 进仓库 |

**用法**：复制 `.env.local.example` 为 `.env.local`，按注释填需要的几行，其余留空。

**铁律**：密钥只写 `.env.local`——不写进代码、不提交、不在对话 / 日志 / 截图里回显。

---

## 二、命名与取值规则

### 2.1 三层兜底（向前兼容设计）

`lib/env.ts` 的每个变量按顺序取第一个非空值：

```
BYTRACE_*   →   AUTOARTICLE_*   →   OPENAI_*   →   内置默认值
（现行命名）      （历史命名）        （更早命名）
```

这是**有意保留的兼容层**，不是临时补丁：

- 只填新名 `BYTRACE_*` 即可，不用管旧名。
- 手里已有的旧配置**一个字不改也能照常运行**，升级不会中途瘫痪。
- 三层都为空时落到内置默认值（通常是本机 CLI 或免 key 兜底），所以空白配置也是一个合法状态。

### 2.2 provider 归一

`BYTRACE_AGENT_PROVIDER` 决定整个应用走哪种模型通道。填简写会被归一到四个标准值：

| 你填的值 | 归一到 | 含义 | 需要 key 吗 |
| --- | --- | --- | --- |
| `claude-cli` / `claude` / 空 | `claude-cli` | **本机 Claude Code CLI 订阅**（默认） | ❌ 不需要 |
| `codex-cli` / `codex` | `codex-cli` | **本机 Codex CLI 登录态**（非流式，但无需 key） | ❌ 不需要 |
| `openai-compatible` / `api` / `local-api` / `local-openai` / `lmstudio` / `lm-studio` / `ollama` / `mimo` / `doubao` / `ark` | `openai-compatible` | 任意 OpenAI 兼容端点（MiMo / DeepSeek / Kimi / GLM / LM Studio / Ollama…） | 看服务 |
| `openai-responses` / `openai` / `responses` / `responses-api` | `openai-responses` | OpenAI Responses API | ✅ 必须 |

- `mimo` / `doubao` / `ark` 是给常见供应商准备的简写，都归到 `openai-compatible`，方便直接写供应商名。
- 填了不认识的字符串会**直接抛错并列出可用值**，而不是静默回落——配错了应当立刻知道。

---

## 三、完整变量表

### 3.1 主 Agent（写作）

大纲、正文、润色、指纹拆解、critic、配图打标全部走这一组。解析逻辑在 `lib/claude.ts` 的 `resolveApiConfig()`，取值统一走 `lib/env.ts`。

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_AGENT_PROVIDER` | 否 | `claude-cli` | 四选一（见 §2.2） |
| `BYTRACE_AGENT_BASE_URL` | API 模式必填 | `openai-responses` → `https://api.openai.com/v1`；`openai-compatible` → `http://127.0.0.1:1234/v1` | 端点地址，尾部斜杠自动 trim |
| `BYTRACE_AGENT_API_KEY` | `openai-responses` 必填 | 空 | API key |
| `BYTRACE_AGENT_MODEL` | API 模式必填 | 空 | **分析类**模型（指纹拆解 / 大纲 / critic） |
| `BYTRACE_AGENT_ARTICLE_MODEL` | 否 | 回退 `BYTRACE_AGENT_MODEL` | **正文类**模型（draft / refine，便于单独控风格与成本） |

三层兜底对照：

| 用途 | 现行名 | 历史名 | 更早名 |
| --- | --- | --- | --- |
| provider | `BYTRACE_AGENT_PROVIDER` | `AUTOARTICLE_LLM_PROVIDER` | — |
| base url | `BYTRACE_AGENT_BASE_URL` | `AUTOARTICLE_LLM_BASE_URL` | `OPENAI_BASE_URL` |
| api key | `BYTRACE_AGENT_API_KEY` | `AUTOARTICLE_LLM_API_KEY` | `OPENAI_API_KEY` |
| 分析类模型 | `BYTRACE_AGENT_MODEL` | `AUTOARTICLE_LLM_MODEL` | `OPENAI_MODEL` |
| 正文类模型 | `BYTRACE_AGENT_ARTICLE_MODEL` | `AUTOARTICLE_LLM_ARTICLE_MODEL` | `AUTOARTICLE_ARTICLE_MODEL` |

模型为空时会抛错并提示该填哪个变量，不会带着空模型去发请求。

### 3.2 审查模型（critic 评分，可选但推荐）

**目的**：让"审稿"和"写稿"不是同一个模型。

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_REVIEW_PROVIDER` | 否 | 继承 `BYTRACE_AGENT_PROVIDER` | 审查供应商 |
| `BYTRACE_REVIEW_BASE_URL` | 填了审查 key 就必填 | 继承主 Agent 端点 | 审查端点。例：`https://api.deepseek.com/v1` |
| `BYTRACE_REVIEW_API_KEY` | 否 | 见下方 key 复用规则 | 审查 key |
| `BYTRACE_REVIEW_MODEL` | 否 | 继承 `BYTRACE_AGENT_MODEL` | 审查模型。例：`deepseek-reasoner` / `deepseek-chat` |

**兜底与安全规则**：

1. **完全不填这一组** → critic 走主 Agent，行为与不配审查时完全一致。
2. **只填 `BYTRACE_REVIEW_MODEL`**（不填端点与 key）→ 复用主 Agent 的端点与 key，只换模型名。
3. **填了 `BYTRACE_REVIEW_BASE_URL` 且与主 Agent 端点不同** → **不会**把主 Agent 的 key 发过去，必须显式填 `BYTRACE_REVIEW_API_KEY`（避免把 A 家的 key 泄露给 B 家）。
4. **主 Agent 用本机 CLI 时也能跨模型审查**：只要填了审查端点，critic 走 HTTP API 打到那家，写作仍走 CLI 订阅。

> **协议**：审查组统一按 **OpenAI 兼容协议**调用（DeepSeek / MiMo / Kimi / GLM / 方舟都是），换任何一家都不用改代码。

> **性能提示**：`deepseek-reasoner` 是推理模型，审一篇会慢一些（思考耗时），但 critic 输出只是一个几十行的评分 JSON，成本很低。觉得慢就换成 `deepseek-chat`，效果差别通常不大。

### 3.3 联网事实搜索

用于 compose 流程的"事实底座"与博主名搜索。

**优先级链**（`BYTRACE_SEARCH_PROVIDER=auto` 时）：

```
① MiMo web_search        ← ★ 推荐。复用主 Agent 的 key，无需额外账号
        ↓ 未配置 / 失败
② 豆包（火山方舟 Responses API + web_search）   ← 可选，需独立的方舟 key
        ↓ 未配置 / 失败
③ Tavily                                       ← 需 TAVILY_API_KEY
        ↓ 未配置 / 无结果
④ searchWebFacts() —— Google CSE（配了 key + id）→ DuckDuckGo HTML（免 key，内置 1.5s 节流）
```

用 `BYTRACE_SEARCH_PROVIDER` 可以强制走某一条通道：`auto`（默认）| `mimo` | `doubao` | `tavily` | `web-facts`。**推荐直接写 `mimo`**，跳过其余通道的判断。

三种通道的性质差异：

| 通道 | 返回什么 | 典型耗时 | 成本 |
| --- | --- | --- | --- |
| **MiMo web_search** | **模型整理后的结果** + 带引用来源 | ~40s | 含在 MiMo key 里（另外计联网插件调用费） |
| 豆包（方舟） | 模型整理后的结果 + url_citation | ~15–70s（取决于选的方舟模型） | 方舟 key，¥16 / 千次 |
| web-facts | **原始网页列表**（标题 / URL / 摘要） | ~12s | 免费 |

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_SEARCH_PROVIDER` | 否 | `auto` | 通道选择：auto / mimo / doubao / tavily / web-facts |
| `BYTRACE_MIMO_WEB_SEARCH` | 否 | `auto` | MiMo 自带联网插件开关（auto / 1 / 0） |
| `BYTRACE_SEARCH_BASE_URL` | 豆包模式 | `https://ark.cn-beijing.volces.com/api/v3` | 方舟端点 |
| `BYTRACE_SEARCH_API_KEY` | 豆包必填 | 空 | 火山方舟 API Key |
| `BYTRACE_SEARCH_MODEL` | 否 | `doubao-seed-2-1-pro-260628` | 执行搜索的方舟模型（需支持 `web_search`） |
| `BYTRACE_SEARCH_MAX_KEYWORD` | 否 | `5` | 单轮最大关键词数（1–50）。越大越广也越贵 |
| `BYTRACE_SEARCH_MAX_RESULTS` | 否 | `5` | 最多保留来源条数 |
| `BYTRACE_SEARCH_SOURCES` | 否 | 空 | 可选垂类源，逗号分隔：`douyin` / `toutiao` / `moji` |
| `BYTRACE_TAVILY_API_KEY` | 否 | 空 | Tavily（历史名 `TAVILY_API_KEY`） |
| `BYTRACE_GOOGLE_CSE_KEY` / `_ID` | 否 | 空 | Google CSE（历史名 `GOOGLE_CSE_KEY` / `GOOGLE_CSE_ID`） |

> **MiMo 的联网插件**要到 <https://platform.xiaomimimo.com/#/console/plugin> 开启，约 5 分钟生效；且需要 `sk-` 开头的按量计费 key（Token Plan `tp-` 不支持）。
>
> **豆包要开通插件才能用**：方舟控制台 → 服务组件库 → 联网内容插件 → 开通（免费开通，按搜索次数计费，国内 ¥16 / 千次）。
>
> **全都不配会怎样？** 不阻塞。事实底座跳过（prompt 自动降级），博主名搜索回落到免 key 的 DuckDuckGo HTML。

### 3.4 CLI 兜底

只有主 Agent 走 `claude-cli` / `codex-cli` 时才需要这一组。**通常一个字都不用填。**

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_CLAUDE_BIN` | 否 | 自动探测 | Claude CLI 完整路径（历史名 `CLAUDE_BIN`）。配图视觉打标与主链路都读它 |
| `BYTRACE_CODEX_BIN` | 否 | `codex`（走 PATH） | Codex 可执行文件路径 |
| `BYTRACE_CODEX_CWD` | 否 | `/tmp` | Codex 工作目录。**给中性目录很重要**——否则 codex 会读项目根的 agent 说明文件而跑偏 |
| `BYTRACE_CODEX_MODEL` | 否 | — | Codex 模型（历史名 `AUTOARTICLE_CODEX_MODEL`） |
| `BYTRACE_CODEX_ARTICLE_MODEL` | 否 | — | Codex 的正文类模型（历史名 `AUTOARTICLE_CODEX_ARTICLE_MODEL`） |

Claude CLI 的候选顺序由 `$HOME` 推导，**与用户名、机器路径无关**：

```
1. BYTRACE_CLAUDE_BIN / CLAUDE_BIN（显式指定）
2. claude                      （交给 PATH）
3. $HOME/.local/bin/claude
4. $HOME/.npm-global/bin/claude
5. $HOME/.bun/bin/claude
6. /opt/homebrew/bin/claude
7. /usr/local/bin/claude
```

`ENOENT` 时会按上表逐个尝试，全失败才报错，并在错误信息里列出"已试过哪些路径"，同时提示用 `BYTRACE_CLAUDE_BIN` 显式指定。

### 3.5 抓取与配图（可选）

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_UNSPLASH_ACCESS_KEY` | 否 | 空 | Unsplash 免费图库（历史名 `UNSPLASH_ACCESS_KEY`）。不填时"免费图库"来源自动禁用，本地素材库仍可用 |
| `BYTRACE_YOUTUBE_API_KEY` | 否 | 空 | YouTube 字幕 / 频道列表（历史名 `YOUTUBE_DATA_API_KEY`）。不填时 YouTube 适配器优雅返回 unsupported |
| `BYTRACE_SCAN_DEFAULT_DIR` | 否 | `~/Pictures` | 素材扫描的默认目录，避开每次手输路径 |

### 3.6 运行参数

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `BYTRACE_PORT` | 否 | `3100` | 服务端口 |
| `BYTRACE_DATA_DIR` | 否 | `<项目目录>/data` | 数据目录。留空回退到工作目录下的 `data/` |

---

## 四、根据使用场景的推荐配置

### 推荐组合：MiMo 写作 + MiMo 联网搜索 + DeepSeek 审查

| 用途 | 供应商 | 关键变量 |
| --- | --- | --- |
| 主 Agent（写作） | **MiMo（小米）** | `BYTRACE_AGENT_BASE_URL=https://api.xiaomimimo.com/v1` + `BYTRACE_AGENT_API_KEY` |
| 联网事实搜索 | **MiMo 自带 web_search 插件** | `BYTRACE_SEARCH_PROVIDER=mimo`——复用上面同一个 key，不需要第二个账号 |
| 审查（critic 评分） | **DeepSeek** | `BYTRACE_REVIEW_*`——换一个模型审你的文章，比自审狠 |

**为什么审查要单独一家**：同一个模型写、同一个模型审，容易认同自己的输出。换成 DeepSeek 审就是**跨模型互审**，这是 critic 环节质量提升最明显的一步。不填 `BYTRACE_REVIEW_*` 则自动继承主 Agent，功能不受影响。

> **结论：主 Agent 与联网搜索只需要一个 MiMo key。**
> MiMo 的 `web_search` 是"挂在对话模型上的联网工具"，直接复用主 Agent 的 key 与端点。
> 唯一前提是到控制台开启「联网搜索」插件（约 5 分钟生效）。

```bash
# ── 主 Agent：MiMo ──
BYTRACE_AGENT_PROVIDER=openai-compatible
BYTRACE_AGENT_BASE_URL=https://api.xiaomimimo.com/v1
BYTRACE_AGENT_API_KEY=            # ← 填你的 MiMo key（sk- 开头）
BYTRACE_AGENT_MODEL=mimo-v2.6-pro
BYTRACE_AGENT_ARTICLE_MODEL=mimo-v2.6-pro

# ── 联网事实搜索：MiMo 自带插件 ──
BYTRACE_SEARCH_PROVIDER=mimo

# ── 审查：DeepSeek（跨模型互审）──
BYTRACE_REVIEW_PROVIDER=openai-compatible
BYTRACE_REVIEW_BASE_URL=https://api.deepseek.com/v1
BYTRACE_REVIEW_API_KEY=           # ← 填你的 DeepSeek key
BYTRACE_REVIEW_MODEL=deepseek-reasoner
```

### 场景 A：完全本机（零 key、零费用）

```bash
# 什么都不用填，或把 BYTRACE_AGENT_PROVIDER 留空。
# 走本机 Claude CLI / Codex CLI 订阅 + OpenCLI 抓取 + DuckDuckGo 免 key 搜索。
# 前提：Node.js 与对应 CLI 可用。
```

### 场景 B：联网搜索改用豆包（火山方舟）

只在想换一个搜索源时才需要：

```bash
BYTRACE_SEARCH_PROVIDER=auto        # 或 doubao
BYTRACE_SEARCH_API_KEY=             # ← 填你的火山方舟 key
BYTRACE_SEARCH_MODEL=doubao-seed-2-1-pro-260628
# 别忘了到方舟控制台开通「联网内容插件」
```

### 场景 C：主 Agent 换成别的 OpenAI 兼容服务

```bash
BYTRACE_AGENT_PROVIDER=openai-compatible
BYTRACE_AGENT_BASE_URL=https://api.deepseek.com/v1
BYTRACE_AGENT_API_KEY=              # ← 你自己填
BYTRACE_AGENT_MODEL=deepseek-chat
BYTRACE_AGENT_ARTICLE_MODEL=deepseek-chat
```

---

## 五、自检端点

配完环境变量后，用两个端点确认"到底通没通"，不用等到写文章时才发现问题。

### 5.1 `GET /api/health` —— 配置自检（不发网络请求，秒回）

一条请求回答"现在配好了没有、哪儿没配"。**永远返回 200**：某一项不可用是可诊断的信息，不是请求失败。`ok` 表示主 Agent 与数据库都就绪。

返回结构示例：

```json
{
  "ok": true,
  "summary": "主 Agent 与数据库均就绪，可以开始写作",
  "checks": [
    { "key": "agent",    "label": "主 Agent（openai-compatible）", "status": "ready", "detail": "https://api.xiaomimimo.com/v1 · 模型 mimo-v2.6-pro · 正文模型 mimo-v2.6-pro" },
    { "key": "review",   "label": "审查模型（critic · 跨模型互审）", "status": "ready", "detail": "https://api.deepseek.com/v1 · 模型 deepseek-reasoner —— 写作与审查不是同一个模型，比自审严" },
    { "key": "search",   "label": "联网事实搜索（provider=mimo）", "status": "ready", "detail": "可用通道：MiMo → DuckDuckGo（免 key 兜底） · 实际走 mimo" },
    { "key": "database", "label": "SQLite 数据库", "status": "ready", "detail": "作者 4 · 指纹 4 · 文章 15" },
    { "key": "data_dir", "label": "数据目录", "status": "ready", "detail": "<项目>/data（默认）" },
    { "key": "images",   "label": "配图（可选）", "status": "not-needed", "detail": "仅本地素材库（未配 Unsplash，免费图库来源自动禁用）" }
  ],
  "debug": { "node": "v22.x", "claude_bin_candidates": ["claude", "…"] }
}
```

`status` 取值：

| 值 | 含义 |
| --- | --- |
| `ready` | 已就绪 |
| `missing` | 缺变量，带 `fix` 提示 |
| `unavailable` | 装了但坏了（例如找不到可执行文件） |
| `not-needed` | 可选且未配置，属正常状态 |

> ✅ **不泄露密钥**：只报告"有没有"，不回显值本身。
> ✅ **不会因为没配就失败**：始终 200，把"哪儿没配"当作可诊断信息返回。

### 5.2 `GET /api/health/search?q=关键词` —— 搜索联通性自检

**真的去打一次联网搜索**，把每条通道的结果数量与耗时回报给你（会花掉一次搜索额度，十几秒）。用途：填完 key 之后确认联网到底通没通。

与 `/api/health` 的区别：

| 端点 | 行为 | 耗时 |
| --- | --- | --- |
| `/api/health` | 只检查"配了没有"，不发网络请求 | 秒回 |
| `/api/health/search` | 真的发请求，逐条通道独立试 | 十几秒 |

输出不含任何密钥，来源只给标题与域名，不给全文。

---

## 六、安全规则

1. **密钥只写在 `.env.local`**，不进代码、不进版本库、不进前端产物。
2. **密钥永不回显**：日志、健康检查、错误信息里只出现"有没有配"，不出现值本身。
3. **跨供应商不复用 key**：审查端点与主 Agent 端点不同时，必须显式提供审查 key，代码不会把主 Agent 的 key 发到第三方域名。
4. **提交前自查**：确认 `.env.local` 未被跟踪，且 `lib/`、`app/` 下没有硬编码的 `sk-` / `AIza` / `tvly-` 之类密钥。

---

## 七、改完配置后的验证清单

```bash
# 1. 确认密钥没有进代码
grep -rn "sk-\|AIza\|tvly-" --include="*.ts" --include="*.tsx" lib app | grep -v "sk-xxx"

# 2. 确认类型检查通过
npx tsc --noEmit

# 3. 起服务，用自检端点看哪项没配好
npm run dev -- -p 3100
curl -s http://127.0.0.1:3100/api/health | python3 -m json.tool

# 4. 填过搜索 key 的话，确认联网真的通
curl -s "http://127.0.0.1:3100/api/health/search?q=2026年AI产品经理趋势" | python3 -m json.tool
```
