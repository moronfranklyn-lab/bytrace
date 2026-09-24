# 笔迹 ByTrace

> 把一个模糊的写作思路，用「拆解过的博主风格」写成一篇有论证骨架的多平台成稿。

AI 写作工具的通病是**表面像、里面空**：能学到一个博主的短句节奏和分节习惯，却学不到他怎么一层层把道理挖下去。结果是每节都在并列罗列角度，读者看完只觉得「作者列了好几个观点」，没有思考的纵深。

**笔迹 ByTrace 的解法是把「论证」从品味变成数据结构。** 它先把喜欢的博主拆成可复用的**风格指纹**（不只是句式，还包括论证形态、挖根路径、物件级类比库），再把目标平台的板块口味拆成**站点画像**，然后强制大纲先立起**论证骨架**——每一节都要标注它在整篇论证里扮演什么角色，确认之后才允许动笔。

---

## 核心能力

| 能力 | 说明 |
| --- | --- |
| **风格指纹** | 粘 3–5 篇目标博主的文章，拆出多维风格特征 + 结构能力库 + 挖根模式 + 物件类比库。一次拆解，长期复用 |
| **站点画像** | 给一个板块 URL，自动建立板块级 + 编辑级画像，写作时按平台口味调整结构与深度 |
| **论证骨架** | 先出大纲，每节必须标注 `depth_role`（`open`/`deeper`/`parallel`/`turn`/`close`），**禁止整篇平铺列举** |
| **物件级类比** | 强制使用具象物件做类比（「户口本进 iCloud」），拒绝抽象隐喻（「如同登山」） |
| **评分回炉** | 正文落地后自动五维评分（结构 / 深度 / 类比 / 金句 / 禁忌），不达标带建议全文重写 |
| **跨模型审查** | 审查模型可独立配置，**刻意与写作模型不同**——换个模型挑刺比自审狠 |
| **事实底座** | 选题确认即后台联网搜集真实事实与来源，正文数字必须有出处 |
| **风格配方** | 跨博主挑碎片组合成配方（「开篇用 A + 论证用 B + 收尾用 C」），命名保存复用 |
| **多平台出稿** | 一次思路，串行产出多个平台版本，并给出平台间改写差异摘要 |

---

## 技术形态

本机运行的单用户 Web 应用。数据全部留在本机单文件数据库，不依赖任何云服务。

```
交互    Next.js App Router（18 个页面）+ SSE 流式
编排    拆解引擎 / 评分回炉循环 / 事实底座编排
模型    统一模型入口，支持 4 种通道 × 3 个任务分组
数据    SQLite（WAL），单文件
```

- **模型通道**：本机 CLI（复用已有订阅，无需 key）／OpenAI 兼容 API／Responses API
- **任务分组**：主 Agent（分析与正文可分设不同模型）、审查模型、联网搜索——三组独立可换

完整架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 快速开始

### 方式一：双击安装（推荐）

项目根目录有三个可双击的文件：

| 文件 | 作用 |
| --- | --- |
| **安装笔迹.command** | 一次性安装：检查 Node → 装依赖 → 生成配置 → 环境体检 → 装启动图标 |
| **填写API密钥.command** | 打开配置文件填 API key（不填也能跑，会回退到本机 CLI 订阅） |
| **启动笔迹.command** | 启动服务并自动打开浏览器 |

安装后桌面上会出现「笔迹 ByTrace」图标，以后直接双击它就能用。

> 首次双击若被 macOS 拦截（提示来自身份不明的开发者），
> **右键点该文件 → 选「打开」→ 再点「打开」**，只需一次。

### 方式二：命令行

```bash
npm install                # better-sqlite3 是原生模块，首次安装需要几分钟编译
cp .env.local.example .env.local
npm run doctor             # 环境体检：哪项没配、哪个依赖缺失，一次说清
npm run dev                # 默认 http://127.0.0.1:3100
```

### 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22 | 必需 |
| npm | 随 Node | 必需 |
| SQLite3 | 系统自带 | 仅排查数据库时需要 |
| 本机 CLI | 可选 | 想复用订阅而不填 key 时需要 |
| OpenCLI | 可选 | 装上后抓取反爬平台质量更好 |

**关于多版本 Node**：`better-sqlite3` 是按固定的 Node ABI 编译的原生模块。
如果机器上有多个来源的 Node（系统、nvm、各类工具内置），版本与 ABI 不一定一致。
启动器会自动挑一个能加载该模块的 Node；体检脚本会明确指出该用哪个版本。

### 端口

默认 `3100`。被占用时启动器会自动往后找可用端口；也可以指定：

```bash
BYTRACE_PORT=3200 npm run dev
```

### 配置

编辑 `.env.local`，按任务组填你要用的模型供应商。**什么都不填也能启动**。

环境变量分三组，可分别指向不同厂商：

```bash
# 主 Agent（大纲 / 正文 / 指纹拆解）
BYTRACE_AGENT_PROVIDER=openai-compatible
BYTRACE_AGENT_BASE_URL=https://api.xiaomimimo.com/v1
BYTRACE_AGENT_API_KEY=
BYTRACE_AGENT_MODEL=mimo-v2.6-pro
BYTRACE_AGENT_ARTICLE_MODEL=mimo-v2.6-pro

# 审查模型（刻意换一家，实现跨模型审查）
BYTRACE_REVIEW_BASE_URL=https://api.deepseek.com/v1
BYTRACE_REVIEW_API_KEY=
BYTRACE_REVIEW_MODEL=deepseek-reasoner

# 联网事实搜索（模型自带联网插件时可与主 Agent 同源）
BYTRACE_SEARCH_PROVIDER=auto
```

完整变量清单见 [`docs/ENV.md`](docs/ENV.md)。

### 自检

```bash
npm run doctor                                          # 命令行体检
curl http://127.0.0.1:3100/api/health                   # 各任务组配置状态（不回显密钥）
curl "http://127.0.0.1:3100/api/health/search?q=关键词"   # 实测联网搜索连通性
```

---

## 使用流程

```
选目标平台 → 写选题思路 →[确认]→ 挑风格指纹 → 微调配方
                                    ↓
                    生成大纲 →[确认论证骨架]→ 流式正文 → 预览导出
```

第 5 步的大纲确认是**全流程唯一强制闸门**——这是「平铺列举」和「层层下钻」的分水岭。

---

## 导出格式

公众号 HTML · Markdown · 小红书长图 · 纯文本

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | 产品需求：目标用户、核心任务、验收标准、阶段规划 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构设计：七层架构、组件选型、数据流、安全边界 |
| [`docs/API.md`](docs/API.md) | 接口契约：全部端点、请求响应结构、SSE 事件表 |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | 数据模型：表结构、索引、ER 图、迁移规则 |
| [`docs/TECH-STACK.md`](docs/TECH-STACK.md) | 技术选型：版本清单、每项选择理由、明确不选的技术 |
| [`docs/ENV.md`](docs/ENV.md) | 环境变量：分组说明、兜底规则、按场景的最小配置 |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | 部署运维：安装、配置、备份、排错、升级回滚 |

---

## 开发约定

**分层规则（L1–L5）**：

```
L1 Page       app/**/page.tsx          一个 page.tsx = 一个 URL
L2 Component  components/<group>/*.tsx 单独可见的 UI 元素
L3 Hook       hooks/*.ts               跨组件复用的能力（流式、剪贴板等）
L4 Store      stores/*.ts              全局共享的临时状态
L5 Lib        lib/*.ts                 通用工具，纯函数
```

改一层不要动另一层。页面组件不写网络请求逻辑（抽 Hook）；`lib/` 不引入 UI 框架。

**提交前检查**：

```bash
npx tsc --noEmit      # 类型检查是当前的提交前 gate
```

**数据库改动**：新增字段必须走 `lib/db.ts` 里的幂等扩列函数（`ensureXxx`），不要直接改基础建表脚本——已有数据库不会因为 `CREATE TABLE IF NOT EXISTS` 而补列。

**密钥**：只写在 `.env.local`（已 gitignore）。不进代码、不进前端产物、不进日志。

---

## 已知限制

| 限制 | 说明 |
| --- | --- |
| 无自动化测试 | 当前以 `tsc` + 手工验证为主，关键路径单测待补 |
| 无成本护栏 | 只有用量显示，没有硬上限 |
| 长任务无断点续跑 | 中途失败需要整体重来 |
| 未套壳为原生窗口 | 通过本机浏览器访问，非独立窗口应用；已提供双击启动图标 |
| 单用户 | 无账号体系，仅监听本机回环地址 |

后续规划见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 的「当前架构约束与后续演进」。
