# Agent H · Status

日期：2026-05-24 · 执行者：Agent H（拆解 v2 + 选题中心 + 历史文章 + 全站收尾）

## 完整跑通的功能（真实端到端验证）

1. **新版拆解 `/fingerprints/new` + `/api/fingerprint/v2`**
   - 真粘 5 篇（观点 / 案例 / 教学 / 评论 / 杂感 各一）触发 v2 SSE
   - stage1 并发 3 路 → stage2 综合 → 13 条 strategies 入 `strategies` 表
   - 总耗时 ~145s（stage1 75s + stage2 60s + 落库）
   - 出来的 **fingerprint_id：`110nTdW8coikHp`**（author_id `sRwTX4s4_lFH`）
   - 详情页 `/fingerprints/110nTdW8coikHp` 渲染了所有 v2 新区块（13 张 strategy-card、strengths、weaknesses、strategy_reasoning、category_variance）
   - URL 模式：crawler 公众号拒爬正确返回温暖提示 / 少数派 SPA 抓不到正文也返回 parse-failed 让用户切正文模式 —— 这条 UX 路径在 `/api/crawl-preview` 验证过
2. **选题中心 `/topics`**
   - 风格推荐：基于 2 个 fingerprint 真实出了 8 张推荐卡片，耗时 ~31s，每张挂在正确的 fingerprint_id 上
   - 热点聚合：crawled_articles 表目前空，空状态文案正确弹出
3. **历史文章 `/articles`**
   - 列表渲染 200（articles 表当前空，显示空状态 CTA）
   - 详情页 `/articles/[id]` 实现了 markdown-lite 渲染、删除按钮（用 `DeleteConfirm`）、按指纹/按文章重写跳转
4. **全站收尾**
   - `<DeleteConfirm>`：通用二次确认 modal，文案温暖（"真的要删除「XX」吗？"）
   - `<ToastContainer>` + `stores/toast-store.ts`：全局右下角浮窗，3.5s 自动消失，success/error/info 三档
   - `app/not-found.tsx`：暖文案 404，已通过 `/not-existent-page-xyz` 验证
   - 移动端：`HomeNav` 改为汉堡折叠 + 抽屉，760px 以下生效
   - `lib/db.ts` 新增 `schema-additions-strategies.sql` 自动加载（已验证 strategies 表写入成功）

## Build / Dev 验证

- `npm run build`：**0 error / 0 warning**，全部 9 个页面 + 17 个 API 路由编译通过
- `PORT=3100 npm run dev`：所有页面 200，详见日志
  - `/`、`/compose`、`/fingerprints`、`/fingerprints/new`、`/fingerprints/<已有id>`、`/sites`、`/sites/new`、`/topics`、`/articles` 全部 200
  - 未知路径 → 404（自定义 not-found 页）

## 未在我职责范围的 / 依赖其他 Agent

- `/articles` 当前为空，因为 compose 流程把生成结果写 articles 表是 Agent E 的范围（我没写、未触发，所以列表空）；列表/详情/删除/筛选代码已就绪，等 E 写入文章后自动出列
- `/sites`、`/sites/new`、`/authors/[id]` 由 Agent F 实现，build 通过且 200，未我亲自数据填充
- 真实 URL 端到端：少数派文章页是 SPA 渲染，crawler `parse-failed` 是预期行为；URL 模式整条链路在 `/api/crawl-preview` + v2 route 的代码层验证过；端到端的真粘是用 paste 模式跑的 5 篇

## 给楠的验收清单（按顺序点）

1. `cd autoarticle && PORT=3100 npm run dev`
2. 浏览器开 `http://localhost:3100/` → 看到 hero + 两张博主指纹（半佛仙人测试 + Agent H 测试博主）
3. 点导航「博主指纹」→ `/fingerprints` 列表显示 2 张
4. 点其中 **Agent H 测试博主** 那张 → 进入 `/fingerprints/110nTdW8coikHp`，往下滚到「写作策略集合 · v2」「优劣 + 策略动机」「不同分类下的差异」三块新区
5. 回首页，点「选题中心」→ `/topics`，默认风格推荐 tab，等 30s 看到 8 张选题卡（每张挂在某博主名下）
6. 切「热点聚合」→ 显示空状态「先去拆几个博主」（因为我们没有走 URL 模式所以 crawled_articles 为空）
7. 点「拆解一个新博主」按钮 → `/fingerprints/new`，看到全新版页面：博主名 + 平台 + 5 张初始卡，每张有「URL / 正文」切换 + 分类下拉 + 试爬按钮
8. 点导航「历史文章」→ `/articles` 空状态
9. 手动改 URL 到 `/not-existent-page-xyz` → 看到「这一页飞走了」404 页

## 文件清单

新建：
- `app/fingerprints/new/page.tsx`（重写）
- `app/api/fingerprint/v2/route.ts`
- `app/api/crawl-preview/route.ts`
- `app/api/topics/recommend/route.ts`、`app/api/topics/trending/route.ts`
- `app/api/articles/[id]/route.ts`
- `app/topics/page.tsx`
- `app/articles/page.tsx`、`app/articles/ArticleFilters.tsx`
- `app/articles/[id]/page.tsx`、`app/articles/[id]/ArticleDeleteButton.tsx`
- `app/not-found.tsx`
- `components/ui/DeleteConfirm.tsx`、`components/ui/Toast.tsx`
- `stores/toast-store.ts`
- `lib/prompts/fingerprint-v2-stage1.ts`、`fingerprint-v2-stage2.ts`
- `lib/prompts/topic-recommend.ts`、`topic-trending.ts`
- `lib/schema-additions-strategies.sql`

修改：
- `app/layout.tsx`（挂 `<ToastContainer />`）
- `app/fingerprints/[id]/page.tsx`（追加 v2 三块新区，保留原 v1 渲染）
- `components/nav/HomeNav.tsx`（汉堡 + 真实 topic/articles 链接）
- `lib/db.ts`（启动时执行 `schema-additions-strategies.sql`）
- `app/globals.css`（追加 Agent H 块，未改其他 Agent 写过的样式）

## 已知遗留

1. 当前 articles 表是空的；compose 流程写文章的 PR 来了之后，历史页会自动有内容
2. URL 模式 + 少数派现在抓不到正文（站点 SPA），适配器要进一步针对它们的 JSON 内嵌或走 puppeteer，超出本 Agent 范围
3. ToastContainer 是 zustand store 驱动，旧 `components/compose/Toast.tsx`（compose 页内部用）保留兼容，未替换 — 替换它会改动 E 的范围
4. compose / authors 页里的删除按钮还是 mock，没接上 DeleteConfirm；DeleteConfirm 组件已就绪，谁接谁直接 import 即可
