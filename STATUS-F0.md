# F0 · 通用爬虫层 · 完成

## 依赖
新增：`cheerio` / `@mozilla/readability` / `jsdom` / `got` / `@types/jsdom` / `tsx`（dev）。未装 playwright / puppeteer。

## 适配器实测
- **少数派 sspai.ts** — `sspai.com/post/79453` → 3709 字 + 7 图，成功
- **优设 uisdc.ts** — `uisdc.com/google-search` → 3807 字 + 6 图，成功
- **generic.ts** — `overreacted.io/a-complete-guide-to-useeffect/` → 64606 字 + 1 图，成功（Readability 兜底）
- **zhihu.ts** — `zhuanlan.zhihu.com/p/679162970` → 403。adapter 路由正确，温暖错误文案返回（"这个站点把我拦住了…"）
- **公众号** — `mp.weixin.qq.com/s/somefakeid` → 直接拒绝，不发请求

测试预期 5/5 命中（test-output.json 已生成）。

## 已知坑
1. **知乎 403**：所有 zhuanlan/answer 路径对裸 HTTP 都返回 403，需 cookie + JS Challenge。已加 Sec-Fetch headers 和占位 cookie 但仍 403，是站点级反爬，无法绕。建议 UI 侧识别到知乎 host 时弹"知乎反爬厉害，建议粘贴正文"。
2. **Medium 是 SPA**：未登录返回骨架页，只能拿到 "Medium" 标题。已换 overreacted.io 验证 generic 兜底。
3. **图片过滤**：自动剔除 svg / gif / 1x1 / placeholder / spacer，自动补 `//` → `https://`。
4. **cheerio v1 + ESM**：用 `import * as cheerio` 才能用 `cheerio.load`。

## 给 E/F/G/H 的 3 行 API

```ts
import { crawlArticle, detectUrlType, hashUrl } from '@/lib/crawler';

const info = detectUrlType(url);                  // 不发请求，看是不是公众号
const r = await crawlArticle(url);                // 发请求，返回文章或 CrawlError
if ('reason' in r) showWarmError(r.message);     // 错误统一中文文案
```

## 新增表
`crawled_articles`（见 `lib/schema-additions.sql`），`lib/db.ts` 启动时自动执行。

## Build
`npm run build` 在 crawler 范围内 0 error。仓库当前一处编译失败位于 `app/api/assets/scan/route.ts:28`（Agent G 的目录，重复 `root` 属性），不属于 F0 范围。
