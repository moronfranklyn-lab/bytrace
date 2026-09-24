# 笔迹 ByTrace · 环境变量总表

> **文档定位**：这是**当前代码实际读取**的环境变量完整清单——不是设计稿，是从源码逐条 grep 出来的。
> **⚠️ 重要**：本表描述的是**方案二改造前**的状态。方案二会把「主 Agent / 联网事实搜索 / 深度调研」三组改成新的分组命名，并保留旧变量做兼容层。改造完成后本文件会同步更新。
> 最后更新：2026-09-24 · 对应代码 `main` @ `90faee7`

---

## 一、配置文件放哪

| 文件 | 作用 | 是否进 git |
| --- | --- | --- |
| `.env.local` | **你的真实配置**（含密钥）。Next.js 自动加载 | ❌ 已 gitignore |
| `.env.local.example` | 模板（无密钥），带申请地址注释 | ✅ 进仓库 |
| `lib/prompts/` 等源码里的默认值 | 未配置时的兜底行为 | ✅ 进仓库 |

**铁律**：密钥只写 `.env.local`，不写进代码、不提交、不在对话/日志/截图里回显。

---

## 二、模型的四个 provider 模式

代码里 `AUTOARTICLE_LLM_PROVIDER` 决定整个应用走哪种模型通道（`lib/claude.ts:45` 的 `normalizeProvider()`）。

| 你填的值 | 归一到 | 含义 | 需要 key 吗 |
| --- | --- | --- | --- |
| `claude-cli` / `claude` / 空 | `claude-cli` | **本机 Claude Code CLI 订阅**（默认） | ❌ 不需要 |
| `codex-cli` / `codex` | `codex-cli` | **本机 Codex CLI 登录态**（非流式，但无需 key） | ❌ 不需要 |
| `openai-compatible` / `api` / `local-api` / `local-openai` / `lmstudio` / `lm-studio` / `ollama` | `openai-compatible` | 任意 OpenAI 兼容端点（LM Studio / Ollama / DeepSeek / Kimi / GLM…） | 看服务 |
| `openai-responses` / `openai` / `responses` / `responses-api` | `openai-responses` | OpenAI Responses API | ✅ 必须 |

> 填了不认识的字符串会**直接抛错**：`AUTOARTICLE_LLM_PROVIDER="xxx" 不支持。可用值：claude-cli / codex-cli / openai-compatible / openai-responses`

---

## 三、完整变量表（当前代码实际读取）

### 3.1 模型 · 主开关（`lib/claude.ts`）

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `AUTOARTICLE_LLM_PROVIDER` | 否 | `claude-cli` | 四选一（见上表） |
| `AUTOARTICLE_LLM_BASE_URL` | API 模式必填 | `openai-responses` → `https://api.openai.com/v1`；`openai-compatible` → `http://127.0.0.1:1234/v1` | 端点地址。尾部斜杠会被自动 trim |
| `AUTOARTICLE_LLM_API_KEY` | `openai-responses` 必填 | 空 | API key |
| `AUTOARTICLE_LLM_MODEL` | API 模式必填 | 空 | **分析类**模型（指纹 / 大纲 / critic） |
| `AUTOARTICLE_LLM_ARTICLE_MODEL` | 否 | 回退 `AUTOARTICLE_LLM_MODEL` | **正文类**模型（降 AI 味，对应 `ARTICLE_MODEL` 别名） |

**旧名兼容（仍会被读取，优先级低于 `AUTOARTICLE_*`）**：

| 旧变量 | 等价于 |
| --- | --- |
| `OPENAI_BASE_URL` | `AUTOARTICLE_LLM_BASE_URL` |
| `OPENAI_API_KEY` | `AUTOARTICLE_LLM_API_KEY` |
| `OPENAI_MODEL` | `AUTOARTICLE_LLM_MODEL` |
| `AUTOARTICLE_ARTICLE_MODEL` | `AUTOARTICLE_LLM_ARTICLE_MODEL` |

> 解析优先级（`lib/claude.ts:80-94`）：
> `baseUrl` = `AUTOARTICLE_LLM_BASE_URL` → `OPENAI_BASE_URL` → 内置默认
> `apiKey` = `AUTOARTICLE_LLM_API_KEY` → `OPENAI_API_KEY` → `''`
> `model` = 请求显式传的 → （若是正文别名）`AUTOARTICLE_LLM_ARTICLE_MODEL` / `AUTOARTICLE_ARTICLE_MODEL` → `AUTOARTICLE_LLM_MODEL` / `OPENAI_MODEL` → **空则抛错**

### 3.2 模型 · Codex CLI（`lib/claude.ts`）

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `AUTOARTICLE_CODEX_BIN` | 否 | `codex` | Codex 可执行文件路径 |
| `AUTOARTICLE_CODEX_CWD` | 否 | `/tmp` | Codex 工作目录。**给中性目录很重要**——否则 codex 会读项目根 `AGENTS.md` 跑偏 |
| `AUTOARTICLE_CODEX_MODEL` | 否 | — | Codex 模型 |
| `AUTOARTICLE_CODEX_ARTICLE_MODEL` | 否 | — | Codex 的正文类模型（低优先级回退） |

### 3.3 Claude CLI 路径

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `CLAUDE_BIN` | 否 | `claude`（走 PATH） | **仅供配图视觉打标用**（`lib/images/classify.ts:32`）。主链路 `lib/claude.ts` **不读这个变量**——它硬编码了两条 fallback 路径，见下方风险 |

> 🔴 **风险 R1**：`lib/claude.ts:7-11` 硬编码
> `/Users/mixingtumima0000/.local/bin/claude` 和 `/Users/mixingtumima0000/.npm-global/bin/claude`。
> 换电脑必挂。**方案二要清除**。

### 3.4 联网事实搜索（`lib/search/` + `app/api/compose/gather`）

**事实底座的真实优先级链**（`app/api/compose/gather/route.ts`）：

```
① MiMo web_search   —— 条件：AUTOARTICLE_LLM_BASE_URL 指向 api.xiaomimimo.com 且 key 以 sk- 开头，且插件已开启
        ↓ 未配置 / 失败
② Tavily            —— 条件：配了 TAVILY_API_KEY
        ↓ 未配置 / 无结果
③ searchWebFacts()  —— 配了 GOOGLE_CSE_KEY + GOOGLE_CSE_ID → Google CSE
        ↓ 否则
④ DuckDuckGo HTML   —— 免 key，内置 1.5s 节流队列
```

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `TAVILY_API_KEY` | 否 | 空 | 第②级。申请：https://tavily.com |
| `GOOGLE_CSE_KEY` | 否 | 空 | 第③级。Google Custom Search API key |
| `GOOGLE_CSE_ID` | 否 | 空 | 第③级。CSE 引擎 id |
| `AUTOARTICLE_MIMO_WEB_SEARCH` | 否 | `auto` | MiMo 联网开关 |
| `AUTOARTICLE_MIMO_FORCE_SEARCH` | 否 | — | 强制走 MiMo 搜索 |
| `AUTOARTICLE_MIMO_SEARCH_LIMIT` | 否 | `5` | 结果条数上限 |
| `AUTOARTICLE_MIMO_MAX_KEYWORD` | 否 | `3` | 关键词个数上限 |
| `AUTOARTICLE_MIMO_SEARCH_REGION` / `_COUNTRY` / `_CITY` | 否 | — | MiMo 搜索地理限定 |

> **全都不配会怎样？** 不阻塞。事实底座跳过（prompt 自动降级），博主名搜索回落到 DuckDuckGo HTML（免 key）。

### 3.5 抓取（爬虫）

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `YOUTUBE_DATA_API_KEY` | 否 | 空 | YouTube 字幕 / 频道列表。不填时 YouTube adapter **优雅返回 unsupported**，不影响其他平台 |
| `HOME` | — | 系统提供 | 打开登录浏览器 / 定位 CLI（非你填的） |

> **Apify 相关变量已作废**：`.env.local.example` 里仍有 `APIFY_TOKEN=`，但 `lib/crawler/apify.ts` 与 `lib/apify/usage.ts` **已从工作树删除**，代码不再读取该变量。**这一行可以删掉**（方案一会顺手清）。
> 爬虫现在只走 **OpenCLI（借登录浏览器）→ cheerio 本地解析**，零 API 成本。

### 3.6 配图

| 变量 | 必填 | 默认 | 作用 |
| --- | --- | --- | --- |
| `UNSPLASH_ACCESS_KEY` | 否 | 空 | 免费图库补图。不填时「免费图库」来源自动禁用，**本地素材库仍可用** |

---

## 四、按"用户旅程"给的最小配置

### 场景 A：完全本机（零 key、零费用）— **当前默认**

```bash
# 什么都不用填。
# 走本机 Claude CLI 订阅 + 本机 Codex CLI 订阅 + OpenCLI 抓取 + DDG 免 key 搜索。
# 唯一前提：Node.js、claude CLI、codex CLI 已装在 PATH 上。
```

### 场景 B：主 Agent 改用 API（方案二后）

```bash
AUTOARTICLE_LLM_PROVIDER=openai-compatible
AUTOARTICLE_LLM_BASE_URL=https://api.deepseek.com/v1
AUTOARTICLE_LLM_API_KEY=sk-...        # ← 你自己填
AUTOARTICLE_LLM_MODEL=deepseek-chat
AUTOARTICLE_LLM_ARTICLE_MODEL=deepseek-chat
```

### 场景 C：加上真实联网事实底座

```bash
TAVILY_API_KEY=tvly-...               # ← 你自己填
```

### 场景 D：抓 YouTube 字幕

```bash
YOUTUBE_DATA_API_KEY=AIza...          # ← 你自己填
```

---

## 五、当前的三套命名并存问题（P3，方案二要修）

| 命名体系 | 出现位置 | 举例 |
| --- | --- | --- |
| `AUTOARTICLE_*` | 主命名（`lib/claude.ts`） | `AUTOARTICLE_LLM_MODEL` |
| `OPENAI_*` | 旧兼容（仍被读取） | `OPENAI_MODEL` |
| `CLAUDE_BIN` | 无前缀，只在配图用 | `CLAUDE_BIN` |
| 文档里提过但代码不读 | 旧文档 / `CLAUDE.md` | 旧文档写过 `APIFY_TOKEN`（已作废） |

**方案二的做法**：
1. 新建 `lib/env.ts` 统一读取，新的 `BYTRACE_*` 分组命名。
2. **保留旧变量做兜底**（`BYTRACE_*` → `AUTOARTICLE_*` → `OPENAI_*`），保证你填新的时旧的还能跑，不会中途瘫痪。
3. 清除 R1 硬编码路径，改读 `PATH` + `.env`。
4. 删除已作废的 `APIFY_TOKEN` 行。

---

## 六、验证清单（改完 env 后照这个查）

```bash
# 1. 确认 .env.local 存在且没被 git 跟踪
ls -la .env.local && git check-ignore -v .env.local

# 2. 确认密钥没进代码
grep -rn "sk-\|AIza\|tvly-" --include="*.ts" --include="*.tsx" lib app | grep -v "sk-xxx"

# 3. 确认类型检查通过
npx tsc --noEmit

# 4. 起服务看有没有 env 相关报错
npm run dev -- -p 3100
```

> **方案三会补一条更省事的**：`/api/health` + `doctor` 自检命令，一条命令告诉你哪个变量没配、哪个 CLI 没装。
