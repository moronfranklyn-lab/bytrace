# OpenCLI 安装指南

> 为 AutoArticle 启用微信公众号自动爬取功能
> 生成时间：2026-08-20

---

## 当前状态

✅ **已完成**：
- OpenCLI CLI v1.8.6 已安装（`/Users/mixingtumima0000/.local/bin/opencli`）
- OpenCLI daemon 已运行（端口 19825）
- Chrome 浏览器已打开
- Chrome Web Store 扩展页面已打开

⚠️ **待完成**（需要你手动操作）：
- 在 Chrome 中安装 OpenCLI Browser Bridge 扩展

---

## 安装步骤（5 分钟）

### 步骤 1：安装 Chrome 扩展

**方式 A：Chrome Web Store（推荐）**

刚才已经自动为你打开了这个页面：
https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk

1. 点击右上角蓝色的「添加至 Chrome」按钮
2. 弹窗中点击「添加扩展程序」
3. 看到「OpenCLI 已添加至 Chrome」提示即成功

**方式 B：手动加载（备选）**

如果 Chrome Web Store 打不开：

```bash
# 1. 下载扩展 zip
curl -L -o ~/Downloads/opencli-extension.zip \
  https://github.com/jackwener/opencli/releases/latest/download/opencli-extension-v1.8.6.zip

# 2. 解压
unzip ~/Downloads/opencli-extension.zip -d ~/Downloads/opencli-extension

# 3. 打开 Chrome 扩展页面
open "chrome://extensions"
```

然后：
- 右上角打开「开发者模式」
- 点击「加载已解压的扩展程序」
- 选择 `~/Downloads/opencli-extension` 文件夹

### 步骤 2：验证安装

扩展安装完成后，在终端运行：

```bash
opencli doctor
```

**期望输出**：
```
[OK] Daemon: running on port 19825 (v1.8.6)
[OK] Extension: connected
[OK] Connectivity: ready
```

如果还是显示 `[MISSING] Extension: not connected`：
- 刷新一下 Chrome 扩展页面（`chrome://extensions`）
- 确保扩展右下角开关是「开启」状态
- 等待 5-10 秒让扩展连接到 daemon
- 再次运行 `opencli doctor`

### 步骤 3：测试微信文章抓取

```bash
# 用一篇公众号文章测试（替换成真实URL）
opencli weixin download \
  --url "https://mp.weixin.qq.com/s/xxxxx" \
  -f json
```

**成功输出示例**：
```json
{
  "ok": true,
  "data": [
    {
      "title": "文章标题",
      "author": "公众号名称",
      "publish_time": "2026-08-20",
      "status": "success",
      "size": "25.3 KB",
      "saved": "weixin-articles/.../xxx.md"
    }
  ]
}
```

---

## AutoArticle 集成状态

✅ **已完成代码集成**：

AutoArticle 的爬虫模块 (`lib/crawler/wechat.ts`) 已经接入 OpenCLI：

```
优先级链路：
1. OpenCLI weixin download（免费、高质量）
2. 手动粘贴正文（兜底）
```

一旦你完成上述扩展安装，AutoArticle 的「新建指纹」页面就能：
- 直接粘贴公众号文章 URL
- 自动调用 `opencli weixin download` 抓取完整 Markdown
- 无需付费 Apify（公众号单篇 $0.53）

---

## 节奏控制

OpenCLI 已内置节奏控制（`lib/crawler/opencli.ts`），符合 CLAUDE.md 反爬约束：

| 平台 | 间隔 |
|------|------|
| 公众号 | 1 秒/篇 |
| B 站 | 5 秒/条 |
| 知乎 | 8 秒/条 |
| 小红书 | 15 秒/条 |

单次拆解指纹（5-10 篇文章）完全在安全区内。

---

## 常见问题

### Q: 扩展安装后还是显示 "not connected"？

A: 
1. 确保 Chrome 完全启动（不是无痕模式）
2. 在 `chrome://extensions` 页面，找到 OpenCLI 扩展，点击「详细信息」，确认「允许访问的网站」不是「在特定网站上」
3. 重启 Chrome
4. 运行 `opencli doctor` 查看连接状态

### Q: 抓取时报 "attach failed: Cannot access chrome-extension://"？

A: 
- 其他扩展可能干扰，暂时禁用广告拦截/隐私保护扩展
- 或者在 Chrome 设置 → 隐私和安全 → 网站设置中，允许 OpenCLI 访问所有网站

### Q: 不想装扩展，有没有别的办法？

A: 
保持现状也完全可用：
- AutoArticle 会提示「OpenCLI 没接住，请直接粘贴正文」
- 你手动复制公众号文章正文，粘贴到「手动输入」框
- 指纹质量完全一致，只是多了一步复制粘贴

---

## 下一步

**现在请完成步骤 1 和步骤 2**，然后：

```bash
# 验证安装
opencli doctor

# 如果全部 [OK]，用真实公众号文章测试一次
opencli weixin download --url "https://mp.weixin.qq.com/s/你的文章链接" -f json
```

测试成功后，回到 AutoArticle：

```bash
cd /Users/mixingtumima0000/资料合集/项目合集/公众号/autoarticle
npm run dev -- -p 3100
```

访问 http://localhost:3100/fingerprints/new，直接粘贴公众号文章 URL，体验自动抓取。

---

有问题随时反馈。
