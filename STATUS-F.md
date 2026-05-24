# Agent F · 站点画像 + 博主优化指纹

日期：2026-05-24 · 执行者：Agent F

## 交付

### Schema
- `lib/schema-additions-sites.sql`：`sites` 表（id / site_name / section / url_pattern / profile_json / source_url / source_article_count / created_at / updated_at）+ 两个索引
- `lib/db.ts`：追加 `resolveSitesSchemaPath` 执行 + 通过 PRAGMA 幂等给 `fingerprints` 补 `version` / `parent_id` / `article_count` 三列（SQLite 不支持 IF NOT EXISTS ADD COLUMN，用 PRAGMA table_info 检测后 ALTER）

### Prompts
- `lib/prompts/siteprofile.ts` → `buildSiteProfilePrompt(articles, { siteHost, sectionHint })`
- `lib/prompts/fingerprint-refine.ts` → `buildRefineFingerprintPrompt(currentFp, newArticles)`，输出 v(N+1) 完整 JSON（不是 diff）

### API
- `GET /api/sites` · `POST /api/sites`（同步路由，~2 分钟；调 F0 的 `crawlAuthorIndex` 拿候选 URL，逐篇 `crawlArticle`，每篇 sleep 1s）
- `GET /api/sites/[id]` · `DELETE /api/sites/[id]`
- `POST /api/authors/[id]/optimize`（SSE，事件 open/chunk/done/error；回填 `crawled_articles.used_in_fingerprint_id`；新指纹 version+1、parent_id 指向上一版、合并 source_articles_json）

### UI
- `/sites` 列表（按 site_name 分组）· `/sites/new`（URL + 板块输入 → 爬 → 提画像 → 结果卡）· `/sites/[id]` 详情（四象限：题材 / 结构 / 标题模板 / 字数配图）
- `/authors/[id]` 三标签页（指纹 / 历史文章按 category 分组 / 版本历史），含 `components/authors/AuthorTabs.tsx`
- `/authors/[id]/optimize` 含 `components/authors/OptimizeFlow.tsx`：选未学习的 `crawled_articles` ∪ 手贴文章，SSE 流式跑 v(N+1)
- 顺手把 HomeNav 的「站点画像」link 从 `#` 改成 `/sites`；首页"扩充站点画像"卡片 → `/sites/new`；fingerprint 详情页加了「博主详情」按钮

## 验证
- `npm run build` 0 error 通过；30 个路由全部就位
- `lib/prompts/test-siteprofile.ts` 实跑 F0 + Claude：爬到 3 篇少数派 Matrix 文章（3582/1215/3860 字），Claude 22.9s 返回，JSON 解析成功，11 个必填字段齐全；word_count_range 校验通过

## 踩坑
- 第一轮 Claude 在 JSON 字符串里夹了裸的 ASCII `"` 引号，JSON.parse 失败。修复：在 prompt 里明令字符串内部用中文「」引号、严禁裸 `"`，schema 示例同步改成「」。第二轮直接通过。
- F0 已经在 `lib/schema-additions.sql` 里创建了 `crawled_articles`（列名 `crawled_at` / `source_type` / `images_json`），与本任务原计划字段略有差异；本模块全程沿用 F0 的 schema，未重复建表。
