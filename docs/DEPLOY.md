# 笔迹 ByTrace · 本机安装与运维手册（DEPLOY）

> **文档性质**：给**你自己**（工具所有者）在 macOS 上安装、启动、排错、备份、升级这份应用用的操作手册。
> **命名说明**：产品正在重命名为 **笔迹 ByTrace**。本文描述改名前的当前代码状态——仓库仍叫 `autoarticle/`，启动器（若存在）仍叫 `AutoArticle.command`，所有真实路径、文件名、命令按原样书写，不做改名。
> **最后核验**：2026-09-24 · 对应代码 `main` @ `90faee7` + 93 项未提交改动
> **适用系统**：macOS（本文命令用 zsh/bash 通用写法）
> **图例**：`【实测】` 本次实际执行命令得到 · `【文档】` 来自仓库文档（标行号） · `【推断】` 由代码反推 · `【待核实】` 无法确认

---

## 0. 先看清一件事：这份应用「不是」什么

| 不是 | 说明 |
| --- | --- |
| 不是服务端部署 | 没有 Docker、没有云端数据库、没有多用户。就是一个跑在你自己 Mac 上的本地 Web 应用 |
| 不需要 API key | 靠本机已登录的 **Claude CLI 订阅**（或 Codex CLI 订阅）计费，不接 Anthropic API（`CLAUDE.md:415-416`） |
| 不需要域名 / 备案 / 证书 | 只在本机 `http://localhost:3100` 访问 |
| 不需要联网跑通核心功能 | 但**首次 `npm install` 需要联网**（拉包 + 下 better-sqlite3 预编译产物） |

**唯一真正的命脉**：本机的 Claude CLI（或 Codex CLI）。它不在 = 生成功能全瘫。见 §1。

---

## 1. 前置条件表

### 1.1 必需项

| 前置条件 | 怎么检查 | 缺了会怎样 | 真实期望安装位置 |
| --- | --- | --- | --- |
| **Node.js ≥ 22** | `node --version` | 项目起不来。`next dev` 直接报错；`got@15` 等包在 Node 20 及以下装不上或运行抛错 | macOS 上用 Homebrew（`brew install node`）或 nvm / fnm 管理；无需固定路径，`PATH` 里有即可。本机实测 **v24.18.1** |
| **npm**（随 Node 附带） | `npm --version` | 无法 `npm install` | 随 Node 一起装。本机实测 **10.8.2** |
| **Git** | `git --version` | 无法看历史 / 回滚（应用本身能跑） | macOS 系统自带或 `brew install git` |
| **Claude CLI** | `which claude` + `claude --version` | **生成功能全瘫**：指纹拆解、大纲、正文、润色、配图视觉打标全部失败。`CLAUDE.md:542` 原话：「生成文章命脉，没有等于工具瘫痪」 | 本机实测 `which claude` → **`/Users/mixingtumima0000/.local/bin/claude`**（symlink → `/Users/mixingtumima0000/.local/share/claude/versions/2.1.258`）。**替代路径** `~/.npm-global/bin/claude`（旧机器遗留路径）。必须有已登录的订阅 |
| **SQLite3 CLI** | `which sqlite3` | 不影响应用运行；影响你用命令行查 DB、做备份、排查锁 | macOS 系统自带 **`/usr/bin/sqlite3`**（【实测】） |

### 1.2 按需项

| 前置条件 | 怎么检查 | 缺了会怎样 | 期望位置 |
| --- | --- | --- | --- |
| **Codex CLI** | `which codex` + `codex --version` | **仅当** `.env.local` 里 `AUTOARTICLE_LLM_PROVIDER=codex-cli` 时需要（本项目当前就是这个值，见 §4.1）。缺了则该 provider 全线报错 | 本机实测 **`/Users/mixingtumima0000/.local/bin/codex`**（symlink → `~/.codex/packages/standalone/current/bin/codex`）。`CLAUDE.md:45` 记 2026-07-08 装回 **codex v0.143.0** |
| **OpenCLI**（可选） | `opencli doctor` | 高反爬平台（公众号 / B 站 / 知乎 / 小红书 / 抖音）**不能自动抓**，只能手动复制正文粘贴。**不影响**少数派 / 优设 / 人人都是产品经理（本地 cheerio 适配器）与所有生成功能 | 本机实测 **`/Users/mixingtumima0000/.local/bin/opencli`**（symlink → `~/.local/lib/node_modules/@jackwener/opencli/dist/src/main.js`）。安装指南见 `OPENCLI-SETUP.md` |
| **Chrome + OpenCLI 扩展** | 上一条 `opencli doctor` 会报 `Extension: connected` / `not connected` | OpenCLI 装了但扩展没连 = 抓取仍然失败 | 见 `OPENCLI-SETUP.md` 步骤 1 |
| **配图素材目录** | `ls "/Users/mixingtumima0000/资料合集/项目合集/公众号/公众号配图"` | 自动配图只剩 Unsplash（若也没配 key，则无图可选） | `ETHAN-CONFIG-REPORT.md:25` 记为 `/Users/mixingtumima0000/资料合集/项目合集/公众号/公众号配图`，当时 11 个文件 |

### 1.3 ⚠️ 必须清除的可移植性缺陷：`lib/claude.ts` 硬编码个人机路径

**这是上客户端 / 换机器前必须修的第一件事。** 证据（【实测】逐字引用 `lib/claude.ts:4-10`）：

```ts
// 2026-07 机器重装后 claude 装在 ~/.local/bin（旧的 ~/.npm-global 已不存在），两个位置都兜底
const FALLBACK_CLAUDE_CANDIDATES = [
  '/Users/mixingtumima0000/.local/bin/claude',
  '/Users/mixingtumima0000/.npm-global/bin/claude',
];
const FALLBACK_CLAUDE_PATH =
  FALLBACK_CLAUDE_CANDIDATES.find((p) => existsSync(p)) ?? FALLBACK_CLAUDE_CANDIDATES[0];
```

问题清单：

| # | 问题 | 后果 |
| --- | --- | --- |
| 1 | 两个 fallback 路径**写死了用户名 `mixingtumima0000`** | 任何其他 Mac（换用户名 / 换机器）上，当 `claude` 不在 `PATH` 时，fallback 一定失败 |
| 2 | fallback 只在 **ENOENT** 时触发一次（`lib/claude.ts:728-733`） | 若 `claude` 在 `PATH` 里但版本/鉴权不对，不会回退，直接报错 |
| 3 | `FALLBACK_CLAUDE_PATH` 用 `?? candidates[0]` 兜底 | 两个路径都不存在时，仍然拿一个**不存在的路径**去 spawn，最终报出的错误会包含这个误导性路径（`lib/claude.ts:743`） |
| 4 | 同类问题在别处 | `lib/crawler/opencli.ts:19-22` 的 OpenCLI 候选里，`/usr/local/bin`、`/opt/homebrew/bin` 是通用的，`$HOME/.local/bin`、`$HOME/.npm-global/bin` 用了 `process.env.HOME` **相对可移植**——比 `lib/claude.ts` 写法好，可作修复参考 |

`docs/行动大纲.md:41`（P1）已把这条列为「换电脑必挂，客户端化必须清」。

**正确的修法方向**（本文不代改代码，仅记录）：把候选列表改成 `process.env.AUTOARTICLE_CLAUDE_BIN` → `PATH` 查找 → `$HOME/.local/bin/claude` → `$HOME/.npm-global/bin/claude`，并在全部失败时给出「请安装 Claude CLI 或设置 `AUTOARTICLE_CLAUDE_BIN`」的可读错误。语法参考 `lib/crawler/opencli.ts:19-22`。

**同类需清的隐患**（`docs/行动大纲.md` P2）：`lib/db.ts:14-16` 用 `process.cwd()` 定位数据库：

```ts
function resolveDbPath(): string {
  // 在 Next.js 运行时 process.cwd() 指向项目根（autoarticle/）
  return join(process.cwd(), 'data', 'autoarticle.db');
}
```

⇒ **必须在项目根目录启动**。任何「双击启动器把工作目录设错」的情况都会让应用去别处新建一个空 DB。

---

## 2. 安装步骤

### 2.1 确认你在项目根

文档里出现的两个根路径，**按你机器上真实存在的那个走**：

```bash
# 文档（CLAUDE.md:524、OPENCLI-SETUP.md:179、ETHAN-CONFIG-REPORT.md:158）里写的路径：
/Users/mixingtumima0000/资料合集/项目合集/公众号/autoarticle

# 本次核验时该仓库实际所在路径（工作区挂载点）：
/Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle
```

**待核实**：两者是否同一份、是否有 symlink 关系、哪个是「权威」路径。**无论哪个，进入项目根的判定标准是：该目录下有 `package.json`、`next.config.ts`、`lib/db.ts`、`app/`。**

```bash
cd /path/to/autoarticle        # ← 换成你机器上的真实路径
pwd
ls package.json next.config.ts lib/db.ts app >/dev/null && echo "✅ 这是项目根"
```

### 2.2 确认外部 CLI 就位（先查再装）

```bash
node --version          # 期望 v22 以上（本机 v24.18.1）
npm --version
which claude && claude --version    # 命脉，必须有
which sqlite3                       # 可选但强烈建议
which codex                         # 仅当用 codex-cli provider
which opencli && opencli doctor     # 可选，看扩展是否 connected
```

### 2.3 安装依赖

```bash
cd /path/to/autoarticle
npm install
```

**耗时预期：分钟级，不是秒级。** `STATUS.md:68` 记录了首次安装的真实数据：

> 「`npm install`：成功，144 packages，better-sqlite3 native 编译通过（**~4 分钟**）。」

原因：`better-sqlite3` 是**原生模块（native binding）**，安装时会下载预编译二进制；若你机器上没有匹配的预编译产物（例如 Node 大版本很新），它会**本地用 `node-gyp` 从源码编译**，更慢，且需要本机编译工具链（Xcode Command Line Tools：`xcode-select --install`）。

安装成功的验证信号：
```bash
node -e "console.log(require('better-sqlite3/package.json').version)"   # 期望 11.10.0
```
`STATUS.md:69` 记录过一条烟测：`new Database(':memory:')` + 建表 / 插入 / 查询正常。

> **不要**在安装过程中跑 `npm run build` 或 `npm run dev`（见 §7.1 的 `.next` 冲突）。

### 2.4 安装后可选的附加能力

| 能力 | 装法 | 依据 |
| --- | --- | --- |
| 本地配图素材库扫描 | `npx tsx scripts/scan-local-assets.ts` | 【文档】`ETHAN-CONFIG-REPORT.md:97,159` |
| 给配图做 Claude 视觉打标 | `npx tsx scripts/tag-local-assets.ts --limit 20`（`--all` 全量，`--root` 指定目录） | 【文档】`ETHAN-CONFIG-REPORT.md:162`；`CLAUDE.md:499` 记实测 ~14s/张 |
| OpenCLI 抓取 | 见 `OPENCLI-SETUP.md`（装 Chrome 扩展 → `opencli doctor` 三个 OK） | 【文档】`OPENCLI-SETUP.md:59-74` |

注意：`package.json` **没有**为这些脚本建 npm script，只能 `npx tsx` 直接调用。

---

## 3. 启动方式

### 3.1 文档记载的启动器：`~/Desktop/AutoArticle.command`

【文档】`CLAUDE.md:515-520`：

> 「**双击桌面** `~/Desktop/AutoArticle.command`（已配 chmod +x）。脚本会：
> 1. 检测端口 3100 是否被占（被占就让你选用旧的 / 杀掉重启 / 退出）
> 2. 检测 Node / Claude CLI / Apify token / 数据库 / node_modules
> 3. `npm run dev -- -p 3100` 起服务
> 4. 服务就绪后自动开浏览器到 http://localhost:3100」

**⚠️ 本次核验：这个文件在磁盘上不存在。**

```bash
ls -la ~/Desktop/*.command
# ls: /Users/mixingtumima0000/Desktop/*.command: No such file or directory
find . -name "*.command" -not -path "./node_modules/*"    # 项目内也没有
```

⇒ **当前你无法靠双击启动器启动**，必须走 §3.2 手动方式，或者先自己把启动器脚本补出来（§3.3）。

### 3.2 手动启动（当前唯一可用方式）

```bash
cd /path/to/autoarticle
npm run dev -- -p 3100
```

逐段解释：

| 片段 | 含义 | 证据 |
| --- | --- | --- |
| `npm run dev` | 执行 `package.json:6` 的 `"dev": "next dev"` | 【实测】`package.json` |
| `-- -p 3100` | npm 把 `--` 之后的参数透传给 `next dev`，指定端口 **3100** | 【文档】`CLAUDE.md:519,525`、`OPENCLI-SETUP.md:180` 都是这个写法 |
| 为什么不是默认 3000 | `package.json` 的 dev script **没有**写端口，`next dev` 默认是 3000。全项目文档统一用 3100（`STATUS-H.md:30,42`、`STATUS-INTEGRATION.md:37`、`ETHAN-CONFIG-REPORT.md:28`）。**3100 是约定，不是框架默认** | 【实测】+【文档】 |

启动成功的信号（Next 15 的输出形态）：
```
  ▲ Next.js 15.5.18
  - Local:        http://localhost:3100
  ✓ Ready in ...
```
然后浏览器打开 **http://localhost:3100**。

> 另一种等价写法（把端口放进环境变量）也出现在旧记录里：`PORT=3100 npm run dev`（`STATUS-H.md:30`）。两种都行，但**推荐 `npm run dev -- -p 3100`**，与当前文档一致。

### 3.3 启动器该检查什么（如果要重建）

`CLAUDE.md:516-520` 定义了它原本的职责；`CLAUDE.md:284` 还提出一条**至今未做**的增强：

> 「`~/Desktop/AutoArticle.command` 启动脚本**应该加**一条 `opencli doctor` 检测。三个 OK → 工具走 OpenCLI 通道；任一 FAIL → toast 提示「OpenCLI 未就绪，本次走 Apify 回退」，不阻塞工具运行。」

注意这条增强文案里的「走 Apify 回退」已过期——Apify 代码已从工作树移除（见 `TECH-STACK.md` §8）。重建启动器时，检测项应为：

| 检查 | 命令 | 失败后果 |
| --- | --- | --- |
| Node 存在且 ≥ 22 | `node --version` | 硬失败，退出 |
| node_modules 存在 | `test -d node_modules` | 提示先 `npm install`，退出 |
| Claude / Codex CLI | `which claude` / `which codex`（按 provider） | 硬失败（生成命脉） |
| 数据库目录可写 | `test -w data` 或让应用自建 | 硬失败 |
| OpenCLI | `opencli doctor` | **软失败**，只提示「高反爬平台需手贴正文」 |
| 端口 3100 占用 | `lsof -nP -iTCP:3100 -sTCP:LISTEN` | 让用户选：用旧的 / 杀掉重启 / 换端口 |
| 工作目录必须是项目根 | `test -f lib/db.ts` | 硬失败（否则 `process.cwd()` 会指错 DB，见 §1.3） |

---

## 4. 首次配置

### 4.1 `.env.local`：必需 vs 可选

模板文件是 **`.env.local.example`**，复制成 **`.env.local`** 后填。`.env.local` 已在 `.gitignore:20-21` 忽略（不会被提交）。

```bash
cd /path/to/autoarticle
cp .env.local.example .env.local
```

**当前本机 `.env.local` 的真实状态**【实测，只读键名不读值】：

| 键 | 状态 | 说明 |
| --- | --- | --- |
| `AUTOARTICLE_LLM_PROVIDER` | **已填**（9 字符 = `codex-cli`） | 唯一被填的项 |
| `AUTOARTICLE_LLM_BASE_URL` | 空 | |
| `AUTOARTICLE_LLM_API_KEY` | 空 | |
| `AUTOARTICLE_LLM_MODEL` | 空 | |
| `AUTOARTICLE_LLM_ARTICLE_MODEL` | 空 | |
| `AUTOARTICLE_CODEX_BIN` | 空 | 空 = 用 `PATH` 里的 `codex`（`lib/claude.ts:349`） |
| `AUTOARTICLE_CODEX_CWD` | 空 | 空 = 默认 `/tmp`（`lib/claude.ts:338`） |
| `UNSPLASH_ACCESS_KEY` | 空 | 可选 |
| `YOUTUBE_DATA_API_KEY` | 空 | 可选 |
| `GOOGLE_CSE_KEY` / `GOOGLE_CSE_ID` | 空 | 可选 |

> **注意**：当前配置为 `codex-cli`，意味着生成走 **Codex CLI**，而不是 `CLAUDE.md:18-19` 描述的「正文走 Claude Sonnet 4.6」。这是有意切换还是临时状态，见 `TECH-STACK.md` §10 第 10 条【待核实】。

**必需 / 可选的判定规则**（依据 `lib/claude.ts:45-107` 与 `.env.local.example`）：

| 分组 | 键 | 何时必需 |
| --- | --- | --- |
| **provider 开关** | `AUTOARTICLE_LLM_PROVIDER` | **省略时默认 `claude-cli`**（`lib/claude.ts:46`）。要让应用能用，要么省略（用 Claude CLI），要么显式写 `claude-cli` / `codex-cli` / `openai-compatible` / `openai-responses`。写到无法识别的值会**直接抛错**（`lib/claude.ts:68-70`） |
| **必需（仅当 provider = `openai-compatible` / `openai-responses`）** | `AUTOARTICLE_LLM_MODEL` | `lib/claude.ts:96-100`：模型不配就直接抛「本机 API 模型未配置」 |
| **必需（仅当 provider = `openai-responses`）** | `AUTOARTICLE_LLM_API_KEY` | `lib/claude.ts:101-105`：缺 key 抛出明确错误 |
| **必需（仅当 provider = `codex-cli`）** | 无额外必需项 | `codex` 必须在 `PATH` 里，或用 `AUTOARTICLE_CODEX_BIN` 指绝对路径 |
| **可选（留空即优雅降级）** | `AUTOARTICLE_LLM_BASE_URL` | 留空时：`openai-compatible` 默认 `http://127.0.0.1:1234/v1`（LM Studio），`openai-responses` 默认 `https://api.openai.com/v1`（`lib/claude.ts:79-83`） |
| **可选** | `AUTOARTICLE_LLM_ARTICLE_MODEL` | 留空则正文也用 `AUTOARTICLE_LLM_MODEL`（`lib/claude.ts:88-91`） |
| **可选** | `AUTOARTICLE_CODEX_BIN` / `AUTOARTICLE_CODEX_CWD` | 留空默认 `codex` 与 `/tmp` |
| **可选** | `UNSPLASH_ACCESS_KEY` | 不填 → 免费图库来源禁用，本地素材库仍可用 |
| **可选** | `YOUTUBE_DATA_API_KEY` | 不填 → YouTube 适配器优雅返回 unsupported |
| **可选** | `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID` | 不填 → 博主名搜索走 DuckDuckGo HTML（免 key） |
| **可选** | `TAVILY_API_KEY` | 不填 → 跳过实时搜索，不阻塞写作主流程 |
| **隐式兼容变量** | `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | 代码**同时**读这三个（`lib/claude.ts:80-94`）。这就是「环境变量三套并存」的来源（`docs/行动大纲.md` P3）——建议只填 `AUTOARTICLE_*` 一套，避免混淆 |

> 📖 **环境变量的权威总表是 [`docs/ENV.md`](./ENV.md)**（由另一份文档单独维护，193 行，从源码逐条 grep 得出）。本文只做「必需 / 可选」判定与排错，**不重复它的逐项清单**。
> 该文件与本文同时落地，相对链接 `./ENV.md` 有效。【实测】`docs/ENV.md` 首行确认为「笔迹 ByTrace · 环境变量总表」，并自己声明描述的是「方案二改造前」的状态——与本文同一代码基线（`main` @ `90faee7`）。

### 4.2 数据库：首次调用 `getDb()` 时自动创建

**不需要手动建库、不需要跑 migration。** 依据 `lib/db.ts:397-405`（【实测】逐字引用）：

```ts
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  ensureDataDir(dbPath);          // ← 目录不存在则 mkdirSync(..., { recursive: true })

  const db = new Database(dbPath); // ← 文件不存在则创建
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(resolveSchemaPath(), 'utf-8');
  db.exec(schema);                 // ← 跑 lib/schema.sql
  // ...随后幂等跑 schema-additions-*.sql 与全部 ensureXxx 建表/扩列函数
```

即首次调用会**一次性完成**：建 `data/` 目录 → 建 `autoarticle.db` → 开 WAL → 跑基础 schema → 幂等补齐所有补充表与列。`STATUS.md:102` 也确认：「`data/autoarticle.db` 尚未生成（首次调用 `getDb()` 才会创建），已 ignore」。

首个触发点通常是打开首页（`app/layout.tsx` 会读 `settings` 表拿 `default_theme`）。

### 4.3 首次配置检查清单

```bash
cd /path/to/autoarticle

# 1. provider 配好了吗
grep -E '^AUTOARTICLE_LLM_PROVIDER' .env.local || echo "未设置 → 默认 claude-cli"

# 2. 命脉 CLI 在不在
which claude || echo "❌ Claude CLI 缺失，生成功能会全瘫"

# 3. 依赖装好了吗
test -d node_modules && echo "✅ node_modules 存在" || echo "❌ 先 npm install"
node -e "console.log('better-sqlite3', require('better-sqlite3/package.json').version)"

# 4. 数据库
ls -lh data/autoarticle.db* 2>/dev/null || echo "DB 尚未创建 → 启动并打开首页后会自动生成"

# 5. 端口空着吗
lsof -nP -iTCP:3100 -sTCP:LISTEN || echo "✅ 3100 空闲"
```

---

## 5. 数据位置与备份

### 5.1 数据都在哪

| 路径 | 是什么 | 本次实测 |
| --- | --- | --- |
| `data/autoarticle.db` | **主数据库**：`authors` / `fingerprints` / `articles` / `sites` / `strategies` / `style_recipes` / `crawled_articles` / `local_assets` / `settings` 等全部业务数据 | 4,546,560 B |
| `data/autoarticle.db-wal` | WAL（write-ahead log）：**已提交但尚未 checkpoint 进主库的数据** | 2,257,792 B |
| `data/autoarticle.db-shm` | WAL 的共享内存索引文件 | 32,768 B |
| `data/assets/` | 本地配图素材（扫描结果落地） | 存在 |
| `data/xiaopu-skill/`、`data/xiaopu-article-kb/` | 写作方法论资产与文章知识库（**改名范围见 `docs/行动大纲.md:94-98`，md 内文不改**） | 存在 |
| `weixin-articles/` | OpenCLI 抓下来的公众号文章 Markdown 落盘目录 | 存在 |
| `.env.local` | 全部本地配置与 token | 存在，已 gitignore |

`data/*.db`、`*.db-wal`、`*.db-shm`、`*.db-journal` 都在 `.gitignore:13-17` 里 ⇒ **数据库不在 git 里**，备份 git 不等于备份数据。

### 5.2 ⚠️ 为什么不能直接 `cp` 数据库文件

这个库开着 **WAL 模式**（`lib/db.ts:404`：`db.pragma('journal_mode = WAL')`）。

- WAL 模式下，**新写入先进 `.db-wal`**，主库 `.db` 只在 checkpoint 时才被更新。
- 应用运行时，`.db`、`-wal`、`-shm` 三个文件**是一致性整体**。你如果只 `cp autoarticle.db`，会得到一个**缺少最新数据**的旧快照；如果三个文件分三次拷贝，三个文件可能来自**不同时刻**，拼起来是损坏的库。
- 因此：「半写状态下直接复制 WAL 数据库是不安全的」。

### 5.3 ✅ 正确的备份做法（二选一）

**做法 A（推荐，不停服）：用 SQLite 自己的在线备份**

```bash
cd /path/to/autoarticle

# 备份到带时间戳的文件
sqlite3 data/autoarticle.db ".backup 'data/backup-autoarticle-$(date +%Y%m%d-%H%M%S).db'"

# 验证备份可读、且表数正常
LATEST=$(ls -t data/backup-autoarticle-*.db | head -1)
sqlite3 "$LATEST" "PRAGMA integrity_check;"
sqlite3 "$LATEST" "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table';"
```

`.backup` 由 SQLite 自己保证一致性（它会走正确的读事务 + checkpoint 语义），**不需要停服**。备份出来的**单文件**就是完整可用的库，不含 `-wal` / `-shm`。

**做法 B（最简单，但必须停服）：先停服务再整体复制**

```bash
cd /path/to/autoarticle

# 1) 停服务（必须确认没有进程在写）
pkill -f "next-server" ; pkill -f "next dev"

# 2) 等待 WAL checkpoint（SQLite 用 .backup 或正常关闭都会做）
sleep 2

# 3) 整体复制三个文件（或整目录）
DEST=~/Desktop/autoarticle-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
cp -p data/autoarticle.db data/autoarticle.db-wal data/autoarticle.db-shm "$DEST"/ 2>/dev/null
ls -lh "$DEST"
```

**恢复**：把备份文件放回 `data/`（做法 A 的产物直接重命名为 `autoarticle.db`；做法 B 的三个文件一起放回），然后**删掉旧的 `-wal` / `-shm`**（如果你只恢复主库），再启动。

### 5.4 🚫 绝对不要做的事

| 禁止操作 | 为什么 | 后果 |
| --- | --- | --- |
| **单独删除 `data/autoarticle.db-wal`** | `.db-wal` 里是**尚未 checkpoint 的已提交数据** | **丢失最新写入的数据**。`CLAUDE.md:507` 原话：「跟 SQLite WAL 模式有关，**别手动删**——会丢未 checkpoint 的数据。要重置 db 整个 `data/` 目录一起删」 |
| **运行时 `cp data/autoarticle.db` 当备份** | 主库可能落后于 WAL | 备份缺最新数据，且无法察觉 |
| **`rm -rf data/`**（除非真要重置） | 不可恢复 | 全部指纹、文章、站点画像、配方、素材索引一次性清空 |
| **在 DB 文件上直接编辑** | 无事务保护 | 库损坏 |

### 5.5 重置数据库（确实要重来时）

```bash
cd /path/to/autoarticle
pkill -f "next-server" ; pkill -f "next dev"     # 先停服务
mv data/autoarticle.db data/autoarticle.db.old-$(date +%s)   # 保留一份，别直接 rm
rm -f data/autoarticle.db-wal data/autoarticle.db-shm        # 三个一起处理
# 重新启动并打开首页 → getDb() 会按 §4.2 重建空库
```

---

## 6. 排错手册

### 6.1 手册条目来源说明

`CLAUDE.md:546-572`「紧急情况手册」原有 4 条（ENOENT chunk / Apify 扣钱 / 指纹质量 / SQLite 锁）。其中 **Apify 扣钱那条所依赖的代码已从工作树移除**（见 `TECH-STACK.md` §8），本文保留它但加上状态警示。另按需补充 3 条本次核验发现的常见故障（端口占用 / 原生模块缺失 / `tsc` 报错）。

每条按 **症状 → 原因 → 处理** 组织。

---

#### 6.1.1 dev 起不来 / 卡在 ENOENT chunk 错误

| 项 | 内容 |
| --- | --- |
| **症状** | 浏览器报 `Cannot find module './xxx.js'`、`ENOENT ... .next/server/chunks/...`；页面白屏或 500；dev 进程日志刷 chunk 找不到 |
| **原因** | `.next/` 编译缓存被污染。最常见诱因：**dev server 正在跑的时候跑了 `npm run build`**（两者共用 `.next/`，互相覆盖）。`CLAUDE.md:581`：「不要跑 dev 时跑 build——dev 和 build 共用 `.next/` 会冲突」。次要诱因：升级依赖后残留旧缓存；上次 dev 被 `kill -9` 留下半写缓存 |
| **处理**（【文档】`CLAUDE.md:548-555`，路径已换成占位符） | `pkill -9 -f "next-server"` → `rm -rf .next` → `nohup npm run dev -- -p 3100 &` → `disown` |

```bash
cd /path/to/autoarticle
pkill -9 -f "next-server"          # 杀掉所有 next 进程
rm -rf .next                       # 清编译缓存
nohup npm run dev -- -p 3100 &     # 重启
disown
```

> `nohup ... &` + `disown` 是让 dev 脱离当前终端继续跑。如果你希望前台看日志，就直接 `npm run dev -- -p 3100`。

---

#### 6.1.2 dev 和 build 互相污染（预防）

| 项 | 内容 |
| --- | --- |
| **症状** | 同 6.1.1，但发生在「刚跑完 build 又想跑 dev」或反之 |
| **原因** | 二者写同一目录 `.next/` |
| **处理（铁律）** | **绝不在 dev 运行时跑 `npm run build`。** 要 build 就先 kill dev。跑完 build 想回 dev，先 `rm -rf .next` 再起 dev。依据 `CLAUDE.md:581`，另见 §8.2 |

---

#### 6.1.3 SQLite 文件锁死 / `database is locked`

| 项 | 内容 |
| --- | --- |
| **症状** | 页面报 `SQLITE_BUSY` / `database is locked`；写入接口挂住或报错 |
| **原因** | 有进程持有 DB 的写锁。通常是**没 close 干净的旧 dev 进程**（多个 next-server 同时活着）。`CLAUDE.md:571`：「通常是没 close 干净的旧 dev，pkill 之」 |
| **处理**（【文档】`CLAUDE.md:568-572`） | `fuser data/autoarticle.db` 找占用进程，然后 `pkill` |

```bash
cd /path/to/autoarticle
fuser data/autoarticle.db          # 找哪个进程在锁

# 更直观的等价做法（macOS 上 fuser 输出有时不友好）：
lsof data/autoarticle.db
lsof data/autoarticle.db-wal

# 确认是残留的 next 进程后杀掉
pkill -f "next-server"
pkill -f "next dev"
```

> **不要**用「删 `-wal`」来解锁——见 §5.4。

---

#### 6.1.4 端口 3100 已被占用

| 项 | 内容 |
| --- | --- |
| **症状** | `next dev` 输出 `Port 3100 is in use` 后**自动改用 3101**（或直接退出）；你按 3100 打开看到的是**另一个旧实例**，改动不生效 |
| **原因** | 上一个 dev 实例没关干净；或别的程序占了 3100 |
| **处理** | 查出占用者，决定「复用旧实例 / 杀掉重启 / 换端口」——这正是原启动器设计里让用户选的三条路（`CLAUDE.md:517`） |

```bash
# 谁占了 3100
lsof -nP -iTCP:3100 -sTCP:LISTEN

# 选项 1：杀掉占用者再起
kill -9 $(lsof -tiTCP:3100 -sTCP:LISTEN)

# 选项 2：换一个端口起（注意：换了端口，访问地址也要跟着换）
npm run dev -- -p 3101

# 选项 3：只想确认旧实例还活着
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3100/
```

> 务必确认**你访问的端口就是你刚起的那个实例**，否则会出现「改了代码没反应」的假象。

---

#### 6.1.5 原生模块缺失 / `better-sqlite3` 加载失败

> **⚠️ 2026-09-24 实测补充：本机真实踩过这个坑**
> 本机 PATH 上的 `node` 有**两套不一致的解释器**：
> 1. DSH Desktop 内置的 `node`，`--version` 报 **v24.18.1**，但它的真实 `NODE_MODULE_VERSION` 是 **137**；
> 2. nvm 的 **v22.23.2**（`~/.nvm/versions/node/v22.23.2`），ABI **127**。
>
> 而 `better-sqlite3` 的预编译二进制是 ABI **115**（更老的 Node 22 线）。三者互不匹配，表现就是
> `NODE_MODULE_VERSION 115 / 127 / 137 vs 148` 反复报错，且**用内置 node 编译出来的产物在它自己身上也加载不了**（版本号与 ABI 不一致）。
>
> **可用的做法**：统一用 **nvm 的 Node 22.23.2** 跑服务与编译：
>
> ```bash
> export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
> node --version        # 确认 v22.23.2（ABI 127）
> node -p process.versions.modules
> npm rebuild better-sqlite3
> node -e "const D=require('better-sqlite3'); new D('data/autoarticle.db',{readonly:true}); console.log('OK')"
> ```
>
> **沙箱/受限环境下 `npm rebuild` 会被拒**：node-gyp 默认写 `~/Library/Caches/node-gyp` 与 `~/.npm/_logs`。
> 若这两个目录不可写，把缓存放进项目内再编译：
>
> ```bash
> cd /path/to/autoarticle
> mkdir -p .cache/node-gyp .cache/npm
> export npm_config_devdir="$PWD/.cache/node-gyp"
> export npm_config_cache="$PWD/.cache/npm"
> npm rebuild better-sqlite3
> ```
>
> （`.cache/` 已加进 `.gitignore`，不会进版本库。）

| 项 | 内容 |
| --- | --- |
| **症状** | 启动或首次访问报 `Cannot find module '.../better_sqlite3.node'`、`was compiled against a different Node.js version`、`invalid ELF/Mach-O header`、`NODE_MODULE_VERSION` 不匹配 |
| **原因** | ① `node_modules` 没装全；② 装依赖时的 **Node 大版本和现在运行的 Node 不一致**（原生模块 ABI 绑定具体 Node 版本）；③ 从别的机器整个复制了 `node_modules`；④ Node 太新，没有对应预编译产物且本机缺编译工具链；⑤ **机器上存在多个来源的 Node，`node --version` 与实际 ABI 不一致**（本机实测情况） |
| **处理** | 先确认 `node -p process.versions.modules` 得到的 ABI 与报错里"requires"一致，再用**同一个解释器**重装 |

```bash
cd /path/to/autoarticle

node --version                     # 记下当前版本
node -p process.versions.modules   # ★ 关键：确认实际 ABI，别只看版本号
rm -rf node_modules package-lock.json.bak
npm install                        # better-sqlite3 会按当前 Node 重新编译/下载（分钟级）

# 验证
node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.exec('create table t(a)'); d.prepare('insert into t values (?)').run(1); console.log('better-sqlite3 OK', d.prepare('select count(*) c from t').get());"
```

若报编译错误，先装工具链：`xcode-select --install`。
若你在切换 Node 版本，建议用 `nvm`/`fnm` 固定版本，并在**每次切版本后重跑 `npm install`**。

---

#### 6.1.6 `npx tsc --noEmit` 失败

| 项 | 内容 |
| --- | --- |
| **症状** | 类型错误列表；或报找不到 `@/lib/...` 模块；或报 `.next/types/**` 相关缺失 |
| **原因** | ① 真的类型错了（`strict: true` 下）② `@/*` 别名解析不到（`tsconfig.json:21-23` 要求从项目根运行）③ `tsconfig.json:25` 的 `include` 里有 `.next/types/**/*.ts`，但 `.next/` 被清掉过，Next 生成的类型不存在 ④ 依赖没装 |
| **处理** | 按情况 |

```bash
cd /path/to/autoarticle          # ③② 都要求 cwd = 项目根

test -d node_modules || npm install

# 若报 .next/types 缺失：先让 Next 生成一次类型（会写 .next/，因此必须先停 dev！）
pkill -f "next-server"
npx next build                    # 会生成 .next/types；注意这一步不能与 dev 同跑

# 再跑类型检查
npx tsc --noEmit
```

> `tsconfig.json` 有 `"incremental": true`，跑 `tsc` 会写 `tsconfig.tsbuildinfo`（已在 `.gitignore:10-11` 忽略）。删掉它可强制全量重查：`rm -f tsconfig.tsbuildinfo`。
> `CLAUDE.md:4` 记录 2026-07-07 审查轮结束时 `tsc --noEmit` 全绿——**那是当时的基线**，之后工作树又累积了 93 项未提交改动，当前是否仍全绿未复核【待核实】。

---

#### 6.1.7 Apify 余额报警 / 突然扣钱 ⚠️ 状态已变

| 项 | 内容 |
| --- | --- |
| **症状** | Apify 账户被扣费；月额度告警（历史上被扣到 $4.91 / $5） |
| **原因** | 高反爬平台（公众号 / 知乎 / 小红书）走了 Apify Actor 付费通道。`CLAUDE.md:422`：sian.agency 系列对 FREE 用户收 $0.14 startup + $0.09–0.39/item，单 run $0.23–0.53；公众号单篇 **$0.53** |
| **处理（文档原版，`CLAUDE.md:557-561`）** | ① `.env.local` 里 `APIFY_TOKEN=` 那行加 `#` 注释 ② 到 `/settings/preferences` 把 DB 里的 token 也清空（PATCH 支持空字符串）③ 检查 `/api/apify/usage` 返回 `enabled: false` ④ 到 `console.apify.com/actor-runs` 按 cost 倒序看是哪个 actor 烧钱 |

```bash
cd /path/to/autoarticle

# ① 先止血：注释掉 token（先备份）
cp .env.local .env.local.bak
sed -i '' 's/^APIFY_TOKEN=/# APIFY_TOKEN=/' .env.local
grep -n "APIFY" .env.local

# ③ 文档里说的验证端点（⚠️ 该 route 在当前工作树已被删除，见下）
curl -sS http://localhost:3100/api/apify/usage
```

> **⚠️ 重要现状**：本次核验发现 Apify 相关代码**已从当前工作树整体删除**——`lib/crawler/apify.ts`、`lib/apify/usage.ts`、`app/api/apify/usage/route.ts`、`components/nav/ApifyStatusPill.tsx` 在 `git status` 中均为 `D`，全仓库 `apify` 代码引用 **0 处**。而 `.env.local.example:64-67` 里 `APIFY_TOKEN` 的说明仍在。
> ⇒ **上面第 ③ 步的 `curl` 会 404。** 在确认 Apify 是「永久移除」还是「临时摘掉」之前（见 `TECH-STACK.md` §10 第 2 条），本条目的实际操作只剩「注释 token + 去 Apify 控制台看账单」。爬虫当前的真实兜底链是 **OpenCLI → 手贴正文**（`lib/crawler/wechat.ts:12,23`）。

---

#### 6.1.8 指纹拆出来质量太差

| 项 | 内容 |
| --- | --- |
| **症状** | 拆出的指纹四维度空、analogy_bank 是抽象隐喻而非物件级、结构全是 parallel、文章写出来「浮于表面」 |
| **原因** | ① 对应 prompt 模板不对 ② v3 多 agent 阶段没全跑成功（中途超时/JSON 解析失败）③ 样本量不足或样本不具代表性 |
| **处理**（【文档】`CLAUDE.md:563-566`） | ① 看 `lib/prompts/` 里对应模板 ② 检查 `app/api/fingerprint/v3/route.ts` 是否 3 个 agent 全跑成功 ③ 直接查库看原始 JSON |

```bash
cd /path/to/autoarticle

# ③ 看原始 JSON（把 <FINGERPRINT_ID> 换成真实 id）
sqlite3 -json data/autoarticle.db \
  "SELECT id, author_id, version_schema, length(fingerprint_json) AS json_len, created_at
   FROM fingerprints ORDER BY created_at DESC LIMIT 10;"

sqlite3 data/autoarticle.db \
  "SELECT fingerprint_json FROM fingerprints WHERE id = '<FINGERPRINT_ID>';" | python3 -m json.tool | head -80

# 重点看 v3.3 三字段是否在 fingerprint_json 顶层（不是 platform_fingerprints[平台] 下）
sqlite3 data/autoarticle.db \
  "SELECT fingerprint_json FROM fingerprints WHERE id = '<FINGERPRINT_ID>';" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print({k: (type(d.get(k)).__name__ if d.get(k) is not None else 'MISSING') for k in ['structure_repertoire','depth_pattern','analogy_bank']})"
```

> **已知事实纠正**（`CLAUDE.md:82-84`）：这三字段写在 `fingerprint_json` **顶层**，**不在** `platform_fingerprints[平台]` 下——读数时别走平台节点。
> 超时相关：v3.3 prompt 体积大，单次 stage2 可能 5–8 分钟；stage2/3/category 的 `timeoutMs` 分别是 480/360/360 秒（`CLAUDE.md:475`）。若你手动改过默认 180s，会频繁超时。
> 重跑而不加新样本：`PATCH /api/fingerprint/v3/<id>` 传 `{"force_rerun": true}`（`CLAUDE.md:474-475`）。

---

#### 6.1.9 生成卡住 / 等 100 秒没有任何输出

| 项 | 内容 |
| --- | --- |
| **症状** | Step 6 正文页长时间「已 0 字」，100+ 秒后整篇一次性出现 |
| **原因** | 有人改回裸 CLI 调用（不走 `streamClaude` 的 `--output-format stream-json --include-partial-messages`）。`CLAUDE.md:455-456` 记录这就是最初的 bug 根因 |
| **处理** | 确认所有流式调用都走 `lib/claude.ts` 的 `streamClaude`；`CLAUDE.md:599`：「任何流式调用都用 streamClaude——别再 spawn 裸 `claude -p`，会卡 100+ 秒静默」 |

```bash
cd /path/to/autoarticle
grep -rn "spawn(" app lib --include=*.ts | grep -v "lib/claude.ts" | grep -v "lib/crawler/opencli.ts"
# 除了 claude.ts（模型入口）与 opencli.ts（爬虫通道），不应有别的 spawn CLI 的地方
```

---

#### 6.1.10 缺 CLI 导致生成全瘫

| 项 | 内容 |
| --- | --- |
| **症状** | 报 `claude not found in PATH and fallback /Users/mixingtumima0000/... also failed`（`lib/claude.ts:743` 的文案）；或 `Failed to spawn codex`（`lib/claude.ts:352`） |
| **原因** | 本机 CLI 未安装 / 不在 `PATH` / 硬编码 fallback 路径不匹配（**这正是 §1.3 的可移植性缺陷**） |
| **处理** | 装 CLI 并确认 `PATH`；或用环境变量指绝对路径 |

```bash
which claude codex
echo $PATH | tr ':' '\n' | grep -E "\.local/bin|npm-global"

# 若 CLI 装在非标准位置，用环境变量顶上（codex 有官方变量；claude 目前没有，只能进 PATH）
echo 'export AUTOARTICLE_CODEX_BIN=/absolute/path/to/codex' >> .env.local

# 临时把常见安装位置加进 PATH
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
which claude && claude --version
```

> Claude CLI 目前**没有**官方环境变量覆盖入口（`lib/claude.ts:29` 的 `claudeBin` 选项注释写着「mostly for testing」，路由层不传）。要让换机可用，必须改 `lib/claude.ts`——见 §1.3。

---

## 7. 健康检查命令

### 7.1 已验证可用的检查

| 检查 | 命令 | 期望 | 来源 / 状态 |
| --- | --- | --- | --- |
| **类型检查（核心 gate）** | `cd /path/to/autoarticle && npx tsc --noEmit` | 无输出 = 通过 | 【文档】`CLAUDE.md:577`「类型检查（核心 gate）」。**注意**：会写 `tsconfig.tsbuildinfo`；若 `.next/types` 缺失会误报，见 §6.1.6 |
| **依赖完整性** | `test -d node_modules && node -e "require('better-sqlite3')" && echo OK` | OK | 【推断】直接验证原生模块能加载 |
| **服务可达** | `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3100/` | `200` | 【推断】`STATUS-H.md:30` 记录过「所有页面 200」 |
| **端口占用** | `lsof -nP -iTCP:3100 -sTCP:LISTEN` | 有输出 = 有实例在跑 | 【推断】启动器设计要做的检测（`CLAUDE.md:517`） |
| **数据库完整性** | `sqlite3 data/autoarticle.db "PRAGMA integrity_check;"` | `ok` | 【推断】SQLite 标准做法 |
| **数据量盘点** | 见下方 SQL | 各表计数 | 【文档】`ETHAN-CONFIG-REPORT.md:239-245` 给过一条同款查询 |
| **git 状态** | `git status --short` | 见 §8.1 | 【文档】`CLAUDE.md:594` |
| **最近提交** | `git log --oneline -20` | 见 §8.1 | 【文档】`CLAUDE.md:594` |

数据量盘点（`ETHAN-CONFIG-REPORT.md:239-245` 原版）：

```bash
cd /path/to/autoarticle
sqlite3 data/autoarticle.db "
  SELECT
    (SELECT COUNT(*) FROM authors) AS authors,
    (SELECT COUNT(*) FROM fingerprints) AS fingerprints,
    (SELECT COUNT(*) FROM articles) AS articles,
    (SELECT COUNT(*) FROM sites) AS sites;
"
```

### 7.2 ⚠️ 文档里的测试命令目前**不可用**（不要照抄）

`CLAUDE.md:574-579`「测试」节写了两条：

```bash
npx tsc --noEmit                   # 类型检查（核心 gate）
npx vitest run                     # 关键路径单测（少，但有）
```

**第二条是错的/过期的**，本次核验依据（全部【实测】）：

| 检查 | 结果 |
| --- | --- |
| `package.json` 里有 `test` script 吗 | **没有**。scripts 只有 `dev` / `build` / `start` / `lint` |
| `vitest` 装了吗 | **没有**。`require('./node_modules/vitest/package.json')` → 不存在 |
| 有 `vitest.config.*` / `jest.config.*` 吗 | **没有** |
| 有测试文件吗 | **没有**。`find . -name "*.test.ts" -o -name "*.spec.ts"`（排除 node_modules）零命中 |

⇒ **不要跑 `npx vitest run`**：它要么报 `command not found`，要么触发 npm 去联网临时下载 vitest 然后因为无配置/无测试而报错。`CLAUDE.md:578` 那句「少，但有」与仓库实际状态不符，应订正为「当前无测试框架」。

> 本文**不发明**替代测试命令。当前项目唯一的自动化质量 gate 就是 `npx tsc --noEmit`。
> 同理，`npm run lint` 也不可用：script 是 `next lint`，但 `eslint` 未安装、无 `eslint.config.js`（`STATUS.md:101` 已记录 Next 15 中 `next lint` 已 deprecated）。

---

## 8. 升级与回滚

### 8.1 先看清仓库当前状态（**重要，回滚前必读**）

【实测】`git log --oneline -20`：

```
90faee7 feat(images): 配图 Claude 视觉打标 — CLI 看图分风格 + 抽内容标签
bcda0c8 docs: CLAUDE.md 补记 v3.4 critic + Sonnet 4.6 切换 + v3.5 gather 三轮
94e65dc feat(compose): v3.5 gather 事实底座 — idea 确认即后台 codex 联网搜集素材注入正文
e1ff10e feat(research): 新增 /research 深度调研节点 + 文章产出切 Sonnet 4.6
4ecb5d8 feat(critic): 补提交 v3.4 reflection loop 评审模块
c10a283 docs: CLAUDE.md 补 2026-05-27 这一轮（v3.3 收尾 + 4 件并行 feat）
030ac52 feat(fingerprints): 列表页 versions 视图加快捷删除
8cb3c96 feat(compose): 多平台一次出 N 个版本 + 配图自动接入 draft 流
b815118 docs: CLAUDE.md 同步 v3.1 / v3.2 / v3.3 三轮迭代
63fac6a feat(v3.3): 结构能力 + 物件类比库 + outline/article 重写论证骨架
28bf105 feat(claude+ui): streamClaude 真流式 + 指纹详情可编辑 + 历史文章按分组重设计
0e63231 feat(sites): 站点画像支持加样本迭代 + 抽 profile-engine + 给 compose 提供入口
afda294 feat(recipes): 风格配方 CRUD + 管理页
29e7717 feat(fingerprint): v3.1 自动分类 + 按类别细分指纹 + 跨博主策略碎片索引
6f5f579 feat(crawler): 接入 OpenCLI + 通用翻页 + 添加 woshipm 适配器
d7cbffa docs: add CLAUDE.md 项目构造记录
f0556d3 init: AutoArticle 本地写作工具首版
```

分支与远端【实测】：

```bash
git branch          # * main（只有 main）
git remote -v       # 空 —— 没有配远程仓库
```

`CLAUDE.md:585` 也确认：「仓库在 `autoarticle/` 一层（不在外层"公众号/"），main 分支。当前没有 remote」。

**⚠️ 工作树严重未提交**【实测】`git status --short | wc -l` = **93**。其中包含：

- **大量 `M`（已修改）**：`lib/claude.ts`、`lib/db.ts`、`lib/critic.ts`、`lib/fingerprints/v3-engine.ts`、`lib/crawler/*`、`app/compose/page.tsx`、`app/api/**/route.ts` 等——即 **2026-07-07 全项目审查修复轮的成果（33 文件 +979/−344）尚未 commit**。
- **删除 `D`**：`lib/codex.ts`、`lib/research.ts`、`lib/prompts/research.ts`、`lib/crawler/apify.ts`、`lib/apify/usage.ts`、`app/api/apify/usage/route.ts`、`app/api/research/route.ts`、`app/research/page.tsx`、`components/nav/ApifyStatusPill.tsx`。
- **未跟踪 `??`**：`docs/`、`lib/refine-versions.ts`、`lib/prompts/xiaopu-writing.ts`、`lib/search/mimo-web-search.ts`、`lib/search/web-facts.ts`、`app/import/`、`app/api/scan-assets/`、`app/api/tag-assets/`、`ETHAN-CONFIG-REPORT.md`、`OPENCLI-SETUP.md`、`autoarticle.db`（根目录那个 0 字节空文件）等。

**这意味着：`git checkout .` / `git reset --hard` / `git stash drop` 会一次性销毁上面这些未提交工作。**

### 8.2 🚫 铁律：dev 运行时绝不跑 build

`CLAUDE.md:581`：「**不要跑 dev 时跑 build**——dev 和 build 共用 `.next/` 会冲突。」
后果与处理见 §6.1.1 / §6.1.2。要 build 的流程必须是：

```bash
cd /path/to/autoarticle
pkill -f "next-server" ; pkill -f "next dev"   # 1) 停 dev
rm -rf .next                                   # 2) 清缓存（避免残留污染）
npm run build                                  # 3) 构建
npm start                                      # 4) 若要跑生产模式（next start）
```

### 8.3 升级前：做一份「可回滚」的快照

因为工作树有 93 项未提交改动，**升级前不要依赖 git 回滚**，要手动留快照：

```bash
cd /path/to/autoarticle
STAMP=$(date +%Y%m%d-%H%M%S)

# 1) 备份数据库（用 §5.3 的做法 A，最安全）
sqlite3 data/autoarticle.db ".backup 'data/backup-autoarticle-$STAMP.db'"

# 2) 备份配置
cp .env.local ".env.local.bak-$STAMP"

# 3) 把「代码当前状态」也留一份（含未提交改动）—— 用 git stash 会改变工作树，故用 tar
tar --exclude=node_modules --exclude=.next --exclude='data/*.db*' \
    -czf "$HOME/Desktop/autoarticle-src-$STAMP.tar.gz" .

# 4) 记录版本基线
git log --oneline -20 > "$HOME/Desktop/autoarticle-gitlog-$STAMP.txt"
git status --short   >> "$HOME/Desktop/autoarticle-gitlog-$STAMP.txt"
```

### 8.4 回滚的三种情形

| 情形 | 做法 | 风险 |
| --- | --- | --- |
| **A. 只想撤掉「最后一次已提交」** | `git log --oneline -20` 找到目标 commit → `git revert <sha>`（**不要** `git reset --hard`） | `git revert` 会因工作树的 93 项改动而冲突；有冲突就停手，别强推 |
| **B. 想回到某个历史 commit 的干净状态** | **不要** `git reset --hard` / `git checkout .`——会销毁未提交成果。改为另开目录：`git worktree add ../autoarticle-rollback <sha>` | 需要重新 `npm install`（另一个 worktree 没有 node_modules） |
| **C. 只想回退某个文件** | `git diff <file>` 看清 → `git checkout <sha> -- <file>`，或直接从 §8.3 的 tar 里取 | 少量、可控 |

**核对回滚是否成功**：

```bash
cd /path/to/autoarticle
git log --oneline -5
git status --short | wc -l
npx tsc --noEmit                       # 类型 gate
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3100/
```

### 8.5 升级依赖的正确顺序

```bash
cd /path/to/autoarticle

# 0) 先按 §8.3 留快照（含 DB！）
pkill -f "next-server" ; pkill -f "next dev"   # 1) 停 dev

# 2) 看哪些包有新版本
npm outdated

# 3) 升级（示例：只升某个包）
npm install next@latest
#    或按 package.json 声明范围整体刷新
npm update

# 4) better-sqlite3 是原生模块：Node 大版本变了就必须重编
npm rebuild better-sqlite3

# 5) 清缓存 + 类型检查
rm -rf .next
npx tsc --noEmit

# 6) 起 dev 验证
npm run dev -- -p 3100
```

**升级 Next 前必读**：`STATUS.md:88` 记录过一次真实事故——`next@15.0.3` 与 `react@19.0.0` GA 的 peerDependency 冲突（ERESOLVE），被迫把 Next 抬到 `^15.1.0`。升级 Next/React 时优先检查这条配对关系。

### 8.6 推送备份到远端（当前没有 remote）

`CLAUDE.md:583-588` 提出：

```bash
cd /path/to/autoarticle
gh repo create autoarticle --private --source=. --push
```

> 提醒：`data/*.db*` 与 `.env.local` 都在 `.gitignore` 里，**push 不会备份数据与密钥**。数据备份只能靠 §5.3。

---

## 9. 一页速查

```bash
# ── 安装 ──────────────────────────────────────────────
cd /path/to/autoarticle
node --version                 # 需 ≥ 22
which claude sqlite3           # 命脉 + 可选
npm install                    # better-sqlite3 原生编译，分钟级

# ── 启动（当前无桌面启动器）─────────────────────────────
npm run dev -- -p 3100
open http://localhost:3100

# ── 健康检查 ──────────────────────────────────────────
npx tsc --noEmit                                       # 唯一可用的质量 gate
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3100/
sqlite3 data/autoarticle.db "PRAGMA integrity_check;"   # 期望 ok
lsof -nP -iTCP:3100 -sTCP:LISTEN                        # 谁在跑
git log --oneline -20 ; git status --short              # 版本基线（当前 93 项未提交）

# ── 备份（不停服，SQLite 在线备份）────────────────────────
sqlite3 data/autoarticle.db ".backup 'data/backup-autoarticle-$(date +%Y%m%d-%H%M%S).db'"

# ── 出事第一反应 ──────────────────────────────────────
pkill -9 -f "next-server" ; rm -rf .next               # ENOENT chunk
fuser data/autoarticle.db                               # 找锁
lsof -tiTCP:3100 -sTCP:LISTEN | xargs -r kill -9         # 端口占用
# 🚫 永不：删 -wal 单文件 / dev 跑着时 build / git reset --hard
```

---

## 10. 待核实

以下条目本次**无法确认**，或文档与代码冲突需你裁决。**不猜。**

1. **`~/Desktop/AutoArticle.command` 去哪了** —— `CLAUDE.md:516` 说它存在且已 `chmod +x`，但本机 `~/Desktop/*.command` 与仓库内 `find -name "*.command"` 均无。是删了、没重建，还是在别的机器上？
2. **两个项目根路径的关系** —— 文档写 `/Users/mixingtumima0000/资料合集/项目合集/公众号/autoarticle`；本次核验的仓库实际位于 `/Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle`。是否同一份（symlink / 外置卷挂载）？启动器与 `process.cwd()` 依赖哪个？**这直接决定 §1.3 的 P2 是否已经在咬人。**
3. **Apify 是永久移除还是临时摘掉** —— 代码全删（4 个文件 `D`、0 处引用），但 `.env.local.example:64-67` 与 `CLAUDE.md` 大段仍在讲它。若永久移除，§6.1.7 的处置流程要整体重写。
4. **`.env.local` 当前是 `codex-cli`** —— 与 `CLAUDE.md:18-19`「正文 draft + refine 走 Claude Sonnet 4.6」的分工描述不符。是有意切到 Codex，还是临时调试残留？影响 §1.1「命脉」到底该指 Claude 还是 Codex。
5. **Claude CLI 版本的订阅状态** —— `ETHAN-CONFIG-REPORT.md:29` 记录过「Claude CLI v2.1.235，有订阅」，本机实测 symlink 指向 **2.1.258**。当前订阅是否仍有效、配额如何，未核验。
6. **`npx tsc --noEmit` 当前是否仍全绿** —— `CLAUDE.md:4` 记 2026-07-07 全绿，但之后工作树累积 93 项未提交改动。本次**故意未运行**（`tsconfig.json` 的 `incremental: true` 会写 `tsconfig.tsbuildinfo`，属修改现有文件，被本次任务规则禁止）。请你自行跑一次确认。
7. **`docs/ENV.md` 与本文的交叉引用一致性** —— §4.1 已把环境变量权威总表指向 [`docs/ENV.md`](./ENV.md)（该文件已落地，193 行）。两份文档同基线（`main` @ `90faee7`），但 ENV.md 声明自己会在「方案二改造」后更新；改造落地后请复核本文 §4.1 的「必需 / 可选」判定是否仍成立。
8. **`npm run lint` 的替代方案** —— `eslint` 未安装、`next lint` 已 deprecated（`STATUS.md:101`）。是否要引入 ESLint / Biome，未定。
9. **测试框架是否要补** —— 当前完全无测试（§7.2）。`CLAUDE.md:578` 的 `npx vitest run` 是空头支票：是「计划装 vitest」还是「文档写错」，需裁决。
10. **固定端口 3100 还是自动 +1** —— `CLAUDE.md:517` 记载的启动器行为是「检测占用后让用户选」，而 `docs/行动大纲.md:169` 提的方案是「不用 3100 固定值，冲突自动 +1」。两者不一致，重建启动器前需定。
11. **`data/xiaopu-skill/` 与 `data/xiaopu-article-kb/` 的目录改名** —— `docs/行动大纲.md:94-98` 定「目录改名但 md 内文一字不改」，同步改引用路径。改名后哪些代码路径引用了这两个目录，本次未逐一核验。
12. **根目录那个 0 字节 `autoarticle.db`** —— 【实测】项目根有一个 **0 字节**的 `autoarticle.db`（未跟踪），与真正的 `data/autoarticle.db` 不是一回事。它是不是历史误建、能否删，未确认。**不要**误把它当数据库。
