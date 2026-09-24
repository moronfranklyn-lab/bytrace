# 笔迹 ByTrace · 部署与运维手册
> 版本：v1.0 · 更新：2026-07-05
> 适用：macOS 本地部署

笔迹 ByTrace 是一个**跑在本机的写作工具**：数据存在本地 SQLite，模型调用走你已登录的 CLI 订阅或你自己的 API key，没有云端服务、没有多用户。所以这里的「部署」就是在机器上装好依赖、配好 `.env.local`、起一个本地 Web 服务。

本文覆盖：前置条件 → 安装 → 启动 → 首次配置 → 数据与备份 → 排错 → 健康检查 → 升级回滚。环境变量的逐项说明不在本文，以 [`docs/ENV.md`](./ENV.md) 为准。

---

## 1. 前置条件

| 前置条件 | 怎么检查 | 缺了会怎样 |
| --- | --- | --- |
| **Node.js ≥ 22** | `node --version` | 项目起不来：`next dev` 直接报错，依赖中也有包要求 Node 22 以上 |
| **npm**（随 Node 附带） | `npm --version` | 无法 `npm install` |
| **本机 Claude CLI 或 Codex CLI**（可选） | `which claude` / `which codex`；`claude --version` | 只有「用订阅额度写作」才需要。两者都没有、也没配 API key 时，生成类功能不可用 |
| **SQLite3 命令行**（系统自带） | `which sqlite3` | 不影响应用运行；缺了无法用命令行查库、做在线备份、排查锁 |

几点说明：

- macOS 上 Node 建议用 Homebrew（`brew install node`）或 nvm / fnm 管理，`PATH` 里能找到即可，不要求固定安装路径。
- 用 nvm / fnm 切换过 Node 版本后要重跑 `npm install`，原因见 §6.3。
- 如果走自己的 API key（OpenAI 兼容端点），可以不装任何 CLI。

排错时比 `node --version` 更有用的一条：

```bash
node -p process.versions.modules   # 当前 Node 的原生模块 ABI 版本
```

---

## 2. 安装

### 2.1 进入项目根

判定标准：该目录下有 `package.json`、`next.config.ts`、`lib/db.ts`、`app/`。

```bash
cd /path/to/autoarticle
pwd
ls package.json next.config.ts lib/db.ts app >/dev/null && echo "OK：这是项目根"
```

> 应用用 `process.cwd()` 定位数据库，**必须在项目根启动**。工作目录错了，应用会在别处新建一个空库。

### 2.2 安装依赖

```bash
cd /path/to/autoarticle
npm install
```

**耗时预期是分钟级，不是秒级。** `better-sqlite3` 是原生模块（native binding）：安装时优先下载与当前 Node 版本匹配的预编译二进制；如果没有匹配产物（例如 Node 版本很新），会退化为用 `node-gyp` 从源码本地编译，更慢，并且需要本机编译工具链：

```bash
xcode-select --install     # 仅在出现编译错误时才需要
```

安装成功的验证：

```bash
node -e "console.log(require('better-sqlite3/package.json').version)"   # 期望 11.x
node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.exec('create table t(a)'); console.log('better-sqlite3 OK')"
```

`next.config.ts` 把 `better-sqlite3` 放进了 `serverExternalPackages`，目的是不让 Next 打包这个原生模块，不要随意改掉这一项。

> 安装过程中不要同时跑 `npm run build` 或 `npm run dev`（原因见 §6.1）。

### 2.3 可选：本地素材与配图脚本

`package.json` 没有为这些脚本建 npm script，直接用 `npx tsx` 调用：

| 用途 | 命令 |
| --- | --- |
| 扫描本地配图素材库 | `npx tsx scripts/scan-local-assets.ts` |
| 给素材做视觉打标 | `npx tsx scripts/tag-local-assets.ts --limit 20` |

---

## 2b. 双击安装（推荐给非命令行用户）

项目根目录提供三个可双击文件：

| 文件 | 作用 |
| --- | --- |
| `安装笔迹.command` | 一次性安装：检查 Node → 装依赖 → 生成 `.env.local` → 体检 → 生成并安装启动图标 |
| `填写API密钥.command` | 打开 `.env.local` 供填写 API key，并自动校验是否填好 |
| `启动笔迹.command` | 挑可用 Node → 检测端口 → 起服务 → 就绪后自动开浏览器 → 打印自检结果 |

安装后会在桌面生成「笔迹 ByTrace」图标，之后直接双击即可。

> macOS 首次打开若提示来自身份不明的开发者：右键 → 打开 → 再点打开，仅需一次。

## 3. 启动

### 3.1 前台启动（推荐）

```bash
cd /path/to/autoarticle
npm run dev -- -p 3100
```

- `npm run dev` 执行的是 `next dev`。
- `--` 之后的参数会透传给 `next dev`，`-p 3100` 指定端口。
- **端口默认 3100。** 项目在 `.env.local` 里预留了 `BYTRACE_PORT`（见 [`docs/ENV.md`](./ENV.md)）作为端口声明。`npm run dev` 直接调用 `next dev`，实际绑定的端口以 `-p` 为准，两处保持一致即可。
- 需要后台常驻：

```bash
nohup npm run dev -- -p 3100 > /tmp/bytrace-dev.log 2>&1 &
disown
```

启动成功的输出形态：

```
  ▲ Next.js 15.5.18
  - Local:        http://localhost:3100
  ✓ Ready in ...
```

然后浏览器打开 <http://localhost:3100>。

### 3.2 关于双击启动脚本

仓库里没有随附启动器，启动就是上面那条 `npm run dev -- -p 3100`。如果你想要一个双击就能跑的东西，可以自己在项目根创建一个 `.command` 文件，`chmod +x` 之后双击即可，内容大致是：

```bash
#!/bin/bash
cd "$(dirname "$0")" || exit 1      # 必须切到项目根，否则数据库会建到别处
npm run dev -- -p 3100
```

仓库根目录另有一个 `填写API密钥.command`，它只负责打开 `.env.local` 供你填 key，不负责启动服务。

---

## 4. 首次配置

### 4.1 生成 .env.local

```bash
cd /path/to/autoarticle
cp .env.local.example .env.local
```

`.env.local` 已被 `.gitignore` 排除，不会进版本库；模板里每一项都写了用途与申请地址。

**环境变量的权威清单见 [`docs/ENV.md`](./ENV.md)**，本文不重复它。只需要先知道三件事：

1. **什么都不填也能跑**：自动回退到本机 Claude / Codex CLI 订阅。
2. 变量有**三层兜底**：`BYTRACE_*` → `AUTOARTICLE_*` → `OPENAI_*`，新配置只填 `BYTRACE_*` 就行。
3. 配置只写在 `.env.local`。密钥不要写进代码、不要提交、不要在日志或截图里回显。

### 4.2 配完自检

```bash
cd /path/to/autoarticle
ls -la .env.local
npx tsc --noEmit                                  # 类型 gate，见 §7.1

npm run dev -- -p 3100                            # 另开一个终端
curl -sS http://127.0.0.1:3100/api/health | python3 -m json.tool
```

`/api/health` 会逐项告诉你「配好了没有、哪儿没配、怎么修」，永远返回 200，并且不回显任何密钥。详见 §7.2。

### 4.3 数据库首次创建

不需要手动建库、不需要跑 migration。首次调用 `getDb()` 时会一次性完成：

- 建 `data/` 目录；
- 建 `data/autoarticle.db`；
- 开启 WAL 模式（`journal_mode = WAL`）与外键约束；
- 跑基础 schema，并幂等补齐所有补充表和列。

首个触发点通常是打开首页。所以「刚装完没有 `data/autoarticle.db`」是正常现象。

---

## 5. 数据位置与备份

### 5.1 数据都在哪

| 路径 | 是什么 |
| --- | --- |
| `data/autoarticle.db` | 主数据库：作者、指纹、文章、站点、配方、素材索引、设置等全部业务数据 |
| `data/autoarticle.db-wal` | WAL（write-ahead log）：**已提交但尚未 checkpoint 进主库的数据** |
| `data/autoarticle.db-shm` | WAL 的共享内存索引 |
| `data/assets/` | 本地配图素材 |
| `.env.local` | 本地配置与 key |

数据库与 `.env.local` 都在 `.gitignore` 里 —— **备份 git 不等于备份数据**。

数据目录默认是 `<项目根>/data`，可以在 `.env.local` 里用 `BYTRACE_DATA_DIR` 改到别处（见 [`docs/ENV.md`](./ENV.md)）。

### 5.2 为什么不能直接 cp 数据库文件

这个库开着 WAL 模式：

- 新写入先落进 `-wal`，主库 `.db` 只在 checkpoint 时才更新。
- 运行时 `.db`、`-wal`、`-shm` 是一个**一致性整体**。只 `cp autoarticle.db` 会拿到缺少最新数据的旧快照；分三次拷贝又可能来自不同时刻，拼起来是损坏的库。

### 5.3 正确的备份方式

**方式 A（推荐，不用停服）：SQLite 在线备份**

```bash
cd /path/to/autoarticle

# 备份到带时间戳的文件
sqlite3 data/autoarticle.db ".backup 'data/backup-autoarticle-$(date +%Y%m%d-%H%M%S).db'"

# 验证备份可读
LATEST=$(ls -t data/backup-autoarticle-*.db | head -1)
sqlite3 "$LATEST" "PRAGMA integrity_check;"    # 期望 ok
```

`.backup` 由 SQLite 自己保证一致性，产物是**单个文件**，不含 `-wal` / `-shm`，不需要停服。

**方式 B（最简单，但必须先停服）**

```bash
cd /path/to/autoarticle

# 1) 停服务，确认没有进程在写
pkill -f "next-server" ; pkill -f "next dev"
sleep 2

# 2) 三个文件一起复制
DEST=~/bytrace-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
cp -p data/autoarticle.db data/autoarticle.db-wal data/autoarticle.db-shm "$DEST"/ 2>/dev/null
ls -lh "$DEST"
```

**恢复**：把备份放回 `data/`。方式 A 的产物重命名为 `autoarticle.db` 即可；方式 B 的三个文件要一起放回，并删掉旧的 `-wal` / `-shm`，然后启动。

### 5.4 绝对不要做的事

| 禁止操作 | 后果 |
| --- | --- |
| **单独删除 `data/autoarticle.db-wal`** | `-wal` 里是尚未 checkpoint 的已提交数据，**删了会丢最新写入**。要重置就连整个 `data/` 一起处理 |
| 运行时 `cp data/autoarticle.db` 当备份 | 备份缺最新数据，而且看不出来 |
| `rm -rf data/`（除非确实要重置） | 全部指纹、文章、站点画像、配方、素材索引一次性清空，不可恢复 |
| 直接在 DB 文件上编辑 | 没有事务保护，库会损坏 |

### 5.5 重置数据库

```bash
cd /path/to/autoarticle
pkill -f "next-server" ; pkill -f "next dev"                  # 先停服务
mv data/autoarticle.db data/autoarticle.db.old-$(date +%s)    # 先留一份，不要直接删
rm -f data/autoarticle.db-wal data/autoarticle.db-shm         # 三个文件一起处理
# 重启并打开首页，getDb() 会重建空库
```

---

## 6. 排错手册

每条按 **症状 → 原因 → 处理** 组织。

### 6.1 dev 与 build 共用 `.next` 导致 chunk 报错

| 项 | 内容 |
| --- | --- |
| **症状** | 浏览器报 `Cannot find module './xxx.js'`、`ENOENT ... .next/server/chunks/...`；页面白屏或 500，dev 日志刷 chunk 找不到 |
| **原因** | `.next/` 编译缓存被污染。最常见诱因是 **dev server 还在跑的时候执行了 `npm run build`** —— 两者共用 `.next/`，互相覆盖。次要诱因：升级依赖后残留旧缓存；上次 dev 被 `kill -9` 留下半写缓存 |
| **处理** | 停 dev → 清缓存 → 重启 |

```bash
cd /path/to/autoarticle
pkill -9 -f "next-server"          # 杀掉所有 next 进程
rm -rf .next                       # 清编译缓存
npm run dev -- -p 3100             # 重启
```

**铁律：dev 运行时绝不跑 `npm run build`。** 要 build 就先停 dev；build 完想回到 dev，先 `rm -rf .next` 再起。

### 6.2 端口 3100 被占用

| 项 | 内容 |
| --- | --- |
| **症状** | `next dev` 提示 `Port 3100 is in use` 后改用 3101，或直接退出；你按 3100 打开的其实是另一个旧实例，改动不生效 |
| **原因** | 上一个 dev 实例没关干净，或别的程序占了 3100 |
| **处理** | 查出占用者，决定「复用旧实例 / 杀掉重启 / 换端口」 |

```bash
# 谁占了 3100
lsof -nP -iTCP:3100 -sTCP:LISTEN

# 选项 1：杀掉占用者再起
kill -9 $(lsof -tiTCP:3100 -sTCP:LISTEN)

# 选项 2：换一个端口起（访问地址也要跟着换）
npm run dev -- -p 3101

# 选项 3：只想确认旧实例还活着
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3100/
```

务必确认你访问的端口就是刚起的那个实例，否则会出现「改了代码没反应」的假象。

### 6.3 原生模块 ABI 不匹配 / better-sqlite3 加载失败

| 项 | 内容 |
| --- | --- |
| **症状** | `Cannot find module '.../better_sqlite3.node'`、`was compiled against a different Node.js version`、`invalid ELF/Mach-O header`、`NODE_MODULE_VERSION` 不匹配 |
| **原因** | ① `node_modules` 没装全；② **装依赖时的 Node 大版本与现在运行的 Node 不一致** —— 原生模块绑定具体 Node 版本的原生 ABI，换版本就可能加载失败；③ 从别的机器整体复制了 `node_modules`；④ Node 太新，没有对应预编译产物，且本机缺编译工具链；⑤ 机器上存在多个来源的 Node，`node --version` 与实际 ABI 不一致 |
| **处理** | 先确认实际 ABI，再用**同一个解释器**重装 |

```bash
cd /path/to/autoarticle

node --version
node -p process.versions.modules   # ★ 关键：确认实际 ABI，别只看版本号
rm -rf node_modules
npm install                        # better-sqlite3 会按当前 Node 重新编译/下载（分钟级）

# 只切换了 Node 版本、不想重装全部依赖时：
npm rebuild better-sqlite3

# 验证
node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('better-sqlite3 OK')"
```

报编译错误先装工具链：`xcode-select --install`。
用 nvm / fnm 固定一个 Node 版本，并在**每次切换版本后重跑 `npm install`**。

**受限环境 / 默认缓存目录不可写时**：`node-gyp` 默认会写 `~/Library/Caches/node-gyp` 与 `~/.npm/_logs`。若这两个目录不可写，把缓存放进项目内再编译：

```bash
cd /path/to/autoarticle
mkdir -p .cache/node-gyp .cache/npm
export npm_config_devdir="$PWD/.cache/node-gyp"
export npm_config_cache="$PWD/.cache/npm"
npm rebuild better-sqlite3
```

（`.cache/` 已在 `.gitignore` 里，不会进版本库。）

### 6.4 SQLite 文件锁 / database is locked

| 项 | 内容 |
| --- | --- |
| **症状** | 页面报 `SQLITE_BUSY` / `database is locked`；写入接口挂住或报错 |
| **原因** | 有进程持有 DB 写锁，通常是没关干净的旧 dev 进程（多个 next-server 同时活着） |
| **处理** | 找到占用进程并清掉 |

```bash
cd /path/to/autoarticle
lsof data/autoarticle.db
lsof data/autoarticle.db-wal

# 确认是残留的 next 进程后杀掉
pkill -f "next-server"
pkill -f "next dev"
```

> **不要**用「删 `-wal`」来解锁 —— 见 §5.4。

### 6.5 `npx tsc --noEmit` 失败

| 项 | 内容 |
| --- | --- |
| **症状** | 一列类型错误；或报找不到 `@/lib/...` 模块；或报 `.next/types/**` 相关缺失 |
| **原因** | ① 真的类型错了（`strict: true` 下）；② `@/*` 路径别名解析不到（要求从项目根运行）；③ `tsconfig.json` 的 `include` 含 `.next/types/**/*.ts`，而 `.next/` 被清过、Next 生成的类型不存在；④ 依赖没装 |
| **处理** | 按情况处理 |

```bash
cd /path/to/autoarticle          # ②③ 都要求 cwd = 项目根
test -d node_modules || npm install

# 若报 .next/types 缺失：先让 Next 生成一次类型（会写 .next/，因此必须先停 dev）
pkill -f "next-server"
npx next build                    # 这一步不能与 dev 同跑

npx tsc --noEmit
```

`tsconfig.json` 开了 `"incremental": true`，跑 `tsc` 会写 `tsconfig.tsbuildinfo`（已 gitignore）。删掉它可以强制全量重查：`rm -f tsconfig.tsbuildinfo`。

---

## 7. 健康检查

### 7.1 类型检查（核心 gate）

```bash
cd /path/to/autoarticle
npx tsc --noEmit        # 无输出 = 通过
```

这是项目当前唯一的自动化质量门。注意它会写 `tsconfig.tsbuildinfo`；`.next/types` 缺失时会误报，处理见 §6.5。

### 7.2 运行时自检端点

服务起着的时候，这两个端点回答「现在到底配好了没有」：

| 端点 | 作用 | 说明 |
| --- | --- | --- |
| `GET /api/health` | 只检查「配了没有」，不发网络请求，秒回 | 永远返回 200；`ok: true` 表示主 Agent 与数据库都就绪；每项带 `status`（`ready` / `missing` / `unavailable` / `not-needed`）与 `fix` 提示；不回显密钥 |
| `GET /api/health/search?q=关键词` | 真的去打一次联网搜索，回报每条通道的命中数与耗时 | 会花掉一次搜索额度、十几秒；用来确认联网搜索是否通 |

```bash
curl -sS http://127.0.0.1:3100/api/health | python3 -m json.tool
curl -sS "http://127.0.0.1:3100/api/health/search?q=2026年AI产品经理趋势" | python3 -m json.tool
```

### 7.3 其他检查

```bash
cd /path/to/autoarticle

# 服务可达（期望 200）
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3100/

# 依赖完整性
node -e "require('better-sqlite3'); console.log('OK')"

# 端口占用
lsof -nP -iTCP:3100 -sTCP:LISTEN

# 数据库完整性（期望 ok）
sqlite3 data/autoarticle.db "PRAGMA integrity_check;"

# 数据量盘点
sqlite3 data/autoarticle.db "
  SELECT
    (SELECT COUNT(*) FROM authors)      AS authors,
    (SELECT COUNT(*) FROM fingerprints) AS fingerprints,
    (SELECT COUNT(*) FROM articles)     AS articles,
    (SELECT COUNT(*) FROM sites)        AS sites;
"
```

### 7.4 已知缺口：没有自动化测试

当前仓库**没有配置自动化测试**：`package.json` 里没有 `test` script，也没有安装任何测试框架，没有测试文件。所以质量把关目前只有 §7.1 的类型检查和 §7.2 的运行时自检这两道。

同理，`npm run lint` 目前不可用：script 指向 `next lint`，但项目没有安装 `eslint`、也没有 ESLint 配置。

补测试框架是后续可以做的事。在那之前，改完代码请至少跑一遍类型检查，并用 `/api/health` 确认运行时没坏。

---

## 8. 升级与回滚

需要 `git`（`git --version` 可查）。

### 8.1 升级前先留一个回滚点

```bash
cd /path/to/autoarticle
STAMP=$(date +%Y%m%d-%H%M%S)

# 1) 数据库（用 §5.3 的方式 A）
sqlite3 data/autoarticle.db ".backup 'data/backup-autoarticle-$STAMP.db'"

# 2) 配置
cp .env.local ".env.local.bak-$STAMP"

# 3) 代码回滚点
git tag "before-upgrade-$STAMP"
```

### 8.2 升级依赖

```bash
cd /path/to/autoarticle

pkill -f "next-server" ; pkill -f "next dev"   # 1) 停 dev
npm outdated                                    # 2) 看哪些包有新版本
npm install next@latest                         # 3) 升级（或在声明范围内整体刷新：npm update）
npm rebuild better-sqlite3                      # 4) 原生模块：Node 大版本变了就必须重编
rm -rf .next                                    # 5) 清缓存
npx tsc --noEmit                                # 6) 类型 gate
npm run dev -- -p 3100                          # 7) 起服务验证
```

升级 Next / React 时留意两者的版本配对：Next 15 与 React 19 之间有 peerDependency 约束，出现 `ERESOLVE` 通常要把 Next 抬到与当前 React 匹配的次版本。

### 8.3 回滚

| 情形 | 做法 |
| --- | --- |
| 只撤掉最后一次提交 | `git revert <sha>`（不要用 `git reset --hard`） |
| 回到某个历史版本 | `git checkout <tag>`；或另开目录 `git worktree add ../autoarticle-rollback <tag>`（新目录需要重新 `npm install`） |
| 只回退某个文件 | `git checkout <tag> -- <file>` |
| 数据库回滚 | 用 §5.3 的备份文件覆盖 `data/autoarticle.db`，并删掉旧的 `-wal` / `-shm` |

回滚后核对：

```bash
cd /path/to/autoarticle
npx tsc --noEmit
npm run dev -- -p 3100
curl -sS http://127.0.0.1:3100/api/health | python3 -m json.tool
```

### 8.4 再次强调：build 与 dev 不能同时跑

`npm run build` 与 `npm run dev` 共用 `.next/`，**不能同时运行**（见 §6.1）。需要构建生产版本时：

```bash
cd /path/to/autoarticle
pkill -f "next-server" ; pkill -f "next dev"   # 1) 停 dev
rm -rf .next                                   # 2) 清缓存
npm run build                                  # 3) 构建
npm start                                      # 4) 生产模式（next start）
```

---

## 9. 一页速查

```bash
# ── 安装 ──────────────────────────────────────────────
cd /path/to/autoarticle
node --version                  # 需 ≥ 22
which claude sqlite3            # CLI（走订阅时用）+ 可选
npm install                     # better-sqlite3 原生模块，分钟级

# ── 首次配置 ───────────────────────────────────────────
cp .env.local.example .env.local    # 逐项说明见 docs/ENV.md

# ── 启动 ──────────────────────────────────────────────
npm run dev -- -p 3100
open http://localhost:3100

# ── 健康检查 ──────────────────────────────────────────
npx tsc --noEmit                                        # 唯一自动化 gate
curl -sS http://127.0.0.1:3100/api/health | python3 -m json.tool
curl -sS "http://127.0.0.1:3100/api/health/search?q=关键词" | python3 -m json.tool
sqlite3 data/autoarticle.db "PRAGMA integrity_check;"   # 期望 ok

# ── 备份（不停服）────────────────────────────────────────
sqlite3 data/autoarticle.db ".backup 'data/backup-autoarticle-$(date +%Y%m%d-%H%M%S).db'"

# ── 出事第一反应 ──────────────────────────────────────
pkill -9 -f "next-server" ; rm -rf .next               # chunk 报错
lsof data/autoarticle.db                                # 找锁
lsof -tiTCP:3100 -sTCP:LISTEN | xargs -r kill -9        # 端口占用
# 永不：单独删 -wal / dev 跑着时 build / 直接 rm -rf data
```
