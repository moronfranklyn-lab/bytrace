# STATUS · Agent K（第三轮 · 博主详情页重做）

## 这一轮交付

### 1. 新页面与文件
- `app/authors/page.tsx`：博主聚合列表（一博主一卡）
- `app/authors/[id]/page.tsx`：详情页重做，4-tab 架构
- `components/authors/AuthorCard.tsx`：列表卡（顶部头像+平台 chips+碎片数+最近活跃）
- `components/authors/AuthorDetailV3.tsx`：详情 4-tab 全部逻辑（client 组件，含 localStorage 收藏）
- `app/fingerprints/page.tsx`：加 `?view=authors|versions` 顶部切换，默认 `authors`
- `lib/fingerprint-queries.ts`：新增 `listAuthorsAggregated()` + 类型 `AuthorListItem`
- 删除旧的 `components/authors/AuthorTabs.tsx`（已被 AuthorDetailV3 取代）
- `app/globals.css`：追加 author-card / platform-block / cmp-row / fragment-card / view-toggle 等样式

### 2. 4 个 tab
- **Tab 1 · 平台分组指纹**：遍历 `platform_fingerprints`，每个平台一个 `.platform-block`，含 fingerprint_summary 引言、四象限（language/structure/topic/visual）、底部三栏 mini-card（platform_specific_traits / strengths / weaknesses）。学习篇数从 `crawled_articles.platform` 列聚合（缺列时回退到 author.platform）。
- **Tab 2 · 领域差异**：读 `domain_variations`，每个领域一个 `.domain-card`，展示 differences_from_default / preferred_structure / tone_shift。
- **Tab 3 · 跨平台对比**：只在 `platforms_analyzed.length >= 2` 时可点（否则 tab 禁用并 hover 提示）。渲染 `cross_platform_report.summary` 大字 + comparisons（左 A / → / 右 B + 底部 why_adjusted）+ transferable_patterns 列表。
- **Tab 4 · 策略碎片库**：读 `strategy_fragments`，三种筛选（tag / platform_scope / domain_scope），自适应网格卡片，每卡显示 tag + title + description + example + when_to_use + why_works + 适用平台/领域元数据 + 收藏按钮（localStorage key `autoarticle:fav-fragments`）。

### 3. 兼容老指纹（v1 / v2）
判断：`fingerprint_json.platform_fingerprints` 不存在 → 老版降级。具体做法：
- Tab 1：把老的 `language/structure/topic/visual/do_list/strengths/weaknesses` 拍扁成单平台（key = `author.platform || '未指定'`），顶部用 dashed 提示条说明「这是 v1/v2 老指纹，只有单平台数据」。
- Tab 2：读 `category_variance`，把 `Record<string,string>` 转为 `{ differences_from_default: string }` 渲染。
- Tab 3：因 `platforms_analyzed.length < 2` 直接禁用。
- Tab 4：读 v2 `strategies[]`，映射为 `StrategyFragment`，title 截 description 前 14 字，platform_scope 回退到 `author.platform`。

### 4. 与 Agent J 的接口对齐
- 字段路径全部按 `lib/prompts/fingerprint-v3-stage2.ts` 输出 schema：`author_summary / user_facing_summary / platforms_analyzed / domains_analyzed / platform_fingerprints[name].{fingerprint_summary,language,structure,topic,visual,platform_specific_traits,strengths,weaknesses} / domain_variations[name].{differences_from_default,preferred_structure,tone_shift} / cross_platform_report.{summary,comparisons[].{topic_example,platform_a,platform_a_treatment,platform_b,platform_b_treatment,why_adjusted},transferable_patterns} / strategy_fragments[].{tag,platform_scope,domain_scope,title,description,example,when_to_use,why_works}`。
- 已用合成 JSON round-trip 验证 SQLite 读写 + 字段提取无误。
- 暂未对接 `/api/fingerprint/v3` 写入端（J 在做）。当 J 完成并跑通一条 v3 记录，详情页所有 4 个 tab 即刻有真实数据。

### 5. 目前没真实数据的状态
DB 现有两条均为 v1/v2 老指纹，可正常进入「降级模式」查看 Tab 1/2/4。**以下三处只有 J 跑通 v3 后才能完整看见**：
- Tab 1 多平台分组（现在只能看见单平台块）
- Tab 3 跨平台对比（现在永远禁用）
- Tab 4 fragments 的 platform_scope / domain_scope 筛选器（老版只有 domain_scope）

### 6. 验证
- `npm run build`：✓ 0 error，新路由 `/authors` `/authors/[id]` 体积分别 1.71 kB / 6.26 kB。
- DB sanity 脚本：插入合成 v3 fingerprint → 查询读出 `platform_fingerprints` / `domain_variations` / `cross_platform_report` / `strategy_fragments` 字段 → 删除测试行。全部通过。
