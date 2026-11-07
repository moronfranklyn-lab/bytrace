# 怎么填 API 密钥（3 种方法，任选一种）

配置文件是 `autoarticle/.env.local`。
**它名字以点开头，是隐藏文件，Finder 默认不显示** —— 所以你觉得"找不到"是正常的，不是文件不存在。

已经确认它就在：

```
/Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle/.env.local
```

里面有两行空着等你填（**第 20 行**和**第 43 行**）：

```bash
BYTRACE_AGENT_API_KEY=          # ← 第 20 行：MiMo 的 key
BYTRACE_SEARCH_API_KEY=         # ← 第 43 行：火山方舟（豆包）的 key
```

---

## 方法一：双击我做的脚本（最省事，推荐）

在项目文件夹里找到 **`填写API密钥.command`**，双击它。

- 会自动用「文本编辑」打开配置文件
- 窗口里也会打印出"第几行要填什么"
- 填完 `Cmd + S` 保存，回到终端窗口按任意键，它会**自动检查你有没有填好**

> 如果双击后 macOS 提示"无法打开，因为来自身份不明的开发者"：
> 右键点这个文件 → 选「打开」→ 再点「打开」。只需做一次。

---

## 方法二：让 Finder 显示隐藏文件

1. 打开 Finder，进到 `autoarticle` 文件夹
2. 按 **`Cmd + Shift + .`**（句号）—— 隐藏文件会以半透明显示出来
3. 看到 `.env.local`，右键 → 打开方式 → 文本编辑
4. 填好两个 key，`Cmd + S` 保存
5. 再按一次 `Cmd + Shift + .` 可以重新隐藏

---

## 方法三：复制这个路径，粘到「文本编辑」里

1. 打开「文本编辑」（Launchpad 或 Spotlight 搜 TextEdit）
2. 菜单 **文件 → 打开**（`Cmd + O`）
3. 在弹出的对话框里按 **`Cmd + Shift + G`**（前往文件夹）
4. 粘贴这一整行，回车：

```
/Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle/.env.local
```

5. 因为以点开头，对话框里可能仍然看不见它，但**直接回车也能打开**
6. 填好两个 key，`Cmd + S` 保存

---

## 两个 key 去哪申请

### ① BYTRACE_AGENT_API_KEY —— MiMo（主 Agent，负责写文章）

1. 打开 https://platform.xiaomimimo.com
2. 注册 / 登录 → 控制台 → API Key 管理
3. 创建一个 key，复制它（`sk-` 开头）
4. 粘到 `.env.local` 的 `BYTRACE_AGENT_API_KEY=` 后面

> ⚠️ 一定要用**按量计费**的 `sk-` key。Token Plan 的 `tp-` key 不支持联网搜索插件。

### ② BYTRACE_SEARCH_API_KEY —— 火山方舟 / 豆包（联网事实搜索）

1. 打开 https://console.volcengine.com/ark
2. 注册 / 登录 → API Key 管理 → 创建，复制
3. 粘到 `.env.local` 的 `BYTRACE_SEARCH_API_KEY=` 后面
4. **还需要开通联网插件**（不然搜索用不了）：
   - 方舟控制台 → **服务组件库** → **联网内容插件** → 点「开通」
   - 免费开通，按搜索次数计费（国内约 ¥16 / 千次）

> 这一步不做也能用 —— 联网搜索会自动回落到**免 key 的 DuckDuckGo**，只是搜出来的中文资料质量差一些。

---

## 填完之后怎么确认对不对

双击 `填写API密钥.command` 时它会自动检查；也可以手动跑：

```bash
cd /Volumes/XiaoBeiDev/资料合集/项目合集/公众号/autoarticle
curl -s http://127.0.0.1:3100/api/health
```

看到 `"ok": true` 就是全配好了。

---

## 常见问题

**Q：我填错了 key，工具会崩吗？**
不会崩。会报一个清楚的错误告诉你是哪个 key 有问题，其他功能不受影响。

**Q：我把 key 发给你（AI）行不行？**
**不要发**。规则是你只填到文件里，我不需要看到它，也不应该看到。你填完告诉我"填好了"，我去跑自检就行。

**Q：这个文件会被上传到 GitHub 吗？**
不会。`.env.local` 已经在 `.gitignore` 里，我推代码时已经确认过它没被上传。

**Q：我想换回本机 Claude / Codex 订阅，不花钱。**
把 `.env.local` 里这一行清空即可，工具会自动回退：
```bash
BYTRACE_AGENT_PROVIDER=
```
