# STATUS-E · 文章生成核心

## 新建 / 修改文件

新建：
- `lib/composition.ts` — Composition 类型 + `buildCompositionSystemSnippet`
- `lib/sse.ts` — 共享 SSE helper + `stripJsonFence` / `stripMarkdownFence`
- `lib/compose-schema.ts` — 自动给 articles 加 4 列
- `lib/schema-additions-compose.sql` — 同上 SQL 记录
- `lib/prompts/recommend.ts` + `outline.ts` + `article.ts` + `refine.ts`
- `lib/prompts/test-recommend.ts` + `test-outline.ts` — 真调 Claude 验证
- `app/api/recommend/route.ts`
- `app/api/compose/{outline,draft,refine}/route.ts`
- `app/api/fingerprints/names/route.ts` — 给 Step 3 还原博主名

重写：
- `app/compose/page.tsx` — 6 步工作流（Stepper + 6 个 Step 子组件 + 复用 Panel/Toast）
- `app/globals.css` — 追加 stepper / step-card / recommend-grid / tune-grid / outline-editor / draft-layout / cursor-blink

## 4 个 API route 的 prompt 一句话描述

- `/api/recommend` · `buildRecommendPrompt` 把"题材思路 + 全量指纹清单"喂给 Claude，要求输出 3 个互不相同的风格组合 JSON（单博主或多博主融合，每个含 `selected_authors[].weight` + `composition_summary` + `why_match`）
- `/api/compose/outline` · `buildOutlinePrompt` 把"题材 + 组合（已展开成 system snippet）"丢给 Claude，要求输出大纲 JSON（working_title / hook_idea / sections[].{title,bullets,word_budget} / closing_idea / total_words_estimate）
- `/api/compose/draft` · `buildArticlePrompt` 在 outline 基础上要求**直接吐 Markdown**（不是 JSON），强禁 emoji / 表格 / 装饰符号 / 图片引用，只准 `#`/`##`/段落/列表/引用/强调
- `/api/compose/refine` · `buildRefinePrompt` 把已有正文 + 目标平台简报（wechat/xhs/zhihu/sspai 各自有字数范围 + voice + do/dont）丢给 Claude，要求改写为目标平台风格

## 两个测试脚本输出

- `test-recommend.ts` · 真调 Claude 用 3 个 mock 指纹（半佛/刘润/蔡崇信观察）+ 题材"为什么越努力越穷"。耗时 **39.9 s**，1 个 chunk，原始 1923 字。`normalizeRecommendations` 解析得到 **3 个组合**：单博主（半佛 100%）/ 双博主（半佛 55 + 刘润 45）/ 三博主（蔡 50 + 刘 25 + 半 25），无 emoji。
- `test-outline.ts` · 同题材，组合 = 半佛 0.7 + 刘润 0.3（仅取 structure/do_list 维度）。耗时 **29.2 s**，1 个 chunk，原始 1556 字。`normalizeOutline` 解析得到 working_title「越努力越穷的真相：你卖的不是时间，是议价权」+ 5 个章节 + 总 4050 字，无 emoji。

## /compose 6 步 UI 状态

- **Step 1 · 题材思路** · 大文本框（思源宋体 / `.workbench-textarea`）+ 字数计 + 3 个示例 chip + 30 字下限
- **Step 2 · 风格推荐** · loading banner + 流式原文 pre + 3 张 `.recommend-card`（label / 博主权重 chip / summary / why）+ 「我自己挑」跳过 + 指纹库空时直接转 Step 4
- **Step 3 · 微调组合** · 每位博主一行 `.tune-row`（checkbox + 名字 / 平台 / reason + slider + 百分比）+ `custom_notes` 文本域
- **Step 4 · 大纲编辑** · loading 时流式 pre；得到 outline 后是 working_title / hook / closing / 总字数 + 每个章节卡片（标题可编辑 + budget 可编辑 + bullets 只读）+ 重新生成按钮
- **Step 5 · 流式正文** · 上方控制条（脉动点 + 字数 + 中止 / 重写）+ 双栏（左 sticky 大纲高亮当前 `##` 数对应章节 + 右 `<pre>` 流式 + `cursor-blink` 闪烁光标）+ 自动滚到底
- **Step 6 · 预览导出** · 复用 C 的 `.compose-layout` + 4 个 Panel：切平台调 `/api/compose/refine` 缓存到 `refineMap[platform]` / 切排版纯前端 / 配图占位说明 / 导出 HTML/MD/纯文本到剪贴板

Stepper 支持点已完成的步骤回退。

## 入库

`articles` 表自动 ALTER 加 `composition_json` / `outline_json` / `idea` / `refine_versions_json` 四列（由 `ensureComposeColumns` 在每次 compose 路由入口幂等执行）。draft 完成时落 (id, fingerprint_id=主博主, platform_target='wechat', layout_theme='standard', title, content_md, content_html, user_prompt=idea, idea, composition_json, outline_json, created_at)，并把每个用到的指纹 `hit_count + 1`、对应 author.last_used_at 刷新。

## 验证

`rm -rf .next && npm run build` · 0 error 通过，`/compose` 路由 10.9 kB · First Load 118 kB。

## 给 H 的提示

H 做 `/articles` 列表需要从 `articles` 表查。我把 schema 扩展成：
- 原有列：`id` `fingerprint_id` `platform_target` `layout_theme` `title` `content_md` `content_html` `user_prompt` `created_at`
- 我新增：`composition_json`（TEXT · JSON Composition）/ `outline_json`（TEXT · JSON Outline）/ `idea`（TEXT · 用户最初输入）/ `refine_versions_json`（TEXT · JSON { wechat,xhs,zhihu,sspai → md }，目前为 null）

`fingerprint_id` 存的是 composition 中**主博主**（权重最大那位）的 fingerprint_id；多博主全量信息在 `composition_json`。`title` 是从生成的 Markdown 首行 `# ` 提取的（兜底用 outline.working_title）。列表展示建议至少 join `fingerprints + authors` 拿主博主名。导出全文用 `content_md`，预览渲染用 `content_html`（极简 markdown 渲染，没有图片）。`ensureComposeColumns()` 在 `lib/compose-schema.ts`，幂等可重复调用。
