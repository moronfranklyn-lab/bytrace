# Integration Status · Agent D（拆解流程端到端串联）

日期：2026-05-24
执行者：Agent D
范围：把 B（Claude 调用层）+ A（DB / 主题）+ C（首页 / 组件）串成「拆解新博主」端到端流程。

---

## 实现的文件清单

### 复制（B 的产物，未改动核心逻辑）
- `lib/claude.ts` ← `claude-adapter-work/claude.ts`
- `lib/prompts/fingerprint.ts` ← `claude-adapter-work/prompts/fingerprint.ts`
- `lib/prompts/fingerprint.example.json` ← `claude-adapter-work/test-output.json`

### 新增（业务逻辑）
- `app/api/fingerprint/route.ts` — Next 15 SSE 路由（`ReadableStream` + `TextEncoder`），`runtime=nodejs`，`dynamic=force-dynamic`。校验入参 / 调 `streamClaude` / 剥 ```json fence / `JSON.parse` / 三表事务落库 / 发 `open|chunk|done|error` 四类事件。客户端断开会通过 `req.signal` → 内部 `AbortController` 杀掉 Claude 子进程。
- `app/fingerprints/new/page.tsx` — `'use client'`。输入态（博主名 + 平台下拉 + 动态 3-10 篇文章卡片）/ 拆解中态（左侧 mono 字 stream-output 自动滚到底 + 右侧 `pulse-soft` 呼吸指示 + 中止按钮）/ 错误态（warm-error 卡片，文案温暖）。手写 SSE 解码（按 `\n\n` 切 event 块），完成后 `router.push('/fingerprints/[id]')`。
- `app/fingerprints/[id]/page.tsx` — Server Component。从 SQLite JOIN authors + fingerprints 取数据，渲染：页头 + 「拿这个风格写一篇」CTA / 写作 DNA 卡片 / 四象限（语言 / 结构 / 题材 / 视觉，配 `--tint-*` 4 色）/ 该做 vs 不该做（Lucide check / x SVG，无 emoji）/ 折叠 raw JSON 面板。id 不存在 → `notFound()`。
- `app/fingerprints/page.tsx` — 真列表，按 `last_used_at desc` JOIN authors 查全部，空状态保留。
- `app/page.tsx` — 把 C 写的「最近用过的风格」段落里的硬编码 `FINGERPRINTS` 替换为 `listRecentFingerprints(4)`，空数据时显示 empty-state。Hero / 选题 / 日常入口 三段保持 C 的原貌。
- `lib/fingerprint-queries.ts` — `listRecentFingerprints(n)` / `listAllFingerprints()`，把 row 折成 list-item，雷达条由 fingerprint_json 各维度字符长度推导（稳定可视化）。
- `components/ui/FingerprintCard.tsx` — 可复用卡片组件（首页和列表页目前直接 inline 复用了 `.fp-card` 样式，组件本身留作下游 compose 页参考）。

### 改动（C 已有产物）
- 把 `new` / `[id]` 两页的导航从我最初引用的 `<Nav>` 改成 C 提供的 `<HomeNav>`，保持站点风格统一。
- `app/globals.css` 补充 `intake-*`、`article-card-*`、`streaming-layout`、`stream-output`、`pulse-soft` / `caret-blink` 动画、`warm-error`、`fp-quadrant[data-tint]`、`do-dont-card.do-list/.dont-list`、`raw-json-panel`、`fp-page-*` 等拆解 / 详情页专属类。C 的首页 / 列表 / compose 样式没动。

---

## 端到端跑通了吗？耗时？

**跑通**。

`npm run build`：0 error / 0 warning，5 个 route（含 `/api/fingerprint`、`/fingerprints/new`、`/fingerprints/[id]`、`/fingerprints`、`/`）。

`PORT=3100 npm run dev` 启动，真实 Claude CLI 调用：
- 输入：3 段「半佛仙人式」反共识商业文（每段 130-135 字）
- 流式输出：`event: open` 立刻到（< 100ms），随后 `event: chunk` 一次性下发 1.5KB 的 ```json``` 块，`event: done` 紧接其后
- **总耗时 29.96 秒**（curl `time_total`），落在 prompt 文案标注的 "~ 40s" 区间内
- `fingerprint_id: aZo3GpMMoBZARM` / `author_id: 4O-2gsNyaaQ_`

注意：本次 Claude CLI 是把整段 JSON 在 close 前一次性 flush 的（chunk 数 = 1）。SSE 框架本身没问题——`onChunk` 每来 1 个 stdout 块就 forward 1 个 `chunk` event，长输出会自然碎成多块。

---

## SQLite 入库验证

```
$ sqlite3 data/autoarticle.db "select id, author_id, length(fingerprint_json), length(source_articles_json), length(raw_response) from fingerprints"
aZo3GpMMoBZARM|4O-2gsNyaaQ_|1029|505|1197

$ sqlite3 data/autoarticle.db "select id, name, platform, avatar_emoji from authors"
4O-2gsNyaaQ_|半佛仙人测试|公众号|半
```

- authors / fingerprints 各 1 行
- `avatar_emoji` 正确取到首个汉字「半」
- `source_articles_json` 505 字 / `fingerprint_json` 1029 字 / `raw_response` 1197 字（含 ```json 围栏），三者长度符合预期
- 写入由一个 `db.transaction(() => { insertAuthor; insertFingerprint; })()` 包住，任一失败整体回滚

刷新 `/` 和 `/fingerprints` 都看到了这条新记录，详情页 `/fingerprints/aZo3GpMMoBZARM` 渲染四象限正常（包含「你拆开看」「fingerprint_summary」等字段），HTTP 200 / 66KB。

---

## 与 C 的接口对齐

- C 提供的 `<HomeNav activePath="...">` 直接复用，3 个新页面统一站点头部。
- C 的 `<ThemeSwitcher>`、`<TopicTabs>` 没改。
- C 写的首页里硬编码的 `FINGERPRINTS` 数组改成 `listRecentFingerprints(4)`，其它（hero / 选题 / 日常入口三个 section）原样保留。
- C 写的 `globals.css` 已经把 `.nav` / `.btn` / `.tag` / `.fp-card` / `.empty-state` / `compose-layout` 等基础组件类都补齐了，我只追加了拆解流程专属的新类，没动他的。

---

## 遗留 / 未实现

1. **Claude CLI 单 chunk flush 行为**：本次测试的 ~1KB JSON 一次性返回，前端虽然能正确显示但「流式逐字」的视觉感弱。生产环境长输出会自动碎块，无需处理。
2. **last_used_at 更新**：拆解时只写 `created_at = last_used_at = now`，后续「带入生成」流程应在 compose 页命中时 update `authors.last_used_at` 和 `fingerprints.hit_count++`。Phase 1 不在我职责内。
3. **`/compose?fingerprint=<id>` 参数对接**：详情页的「拿这个风格写一篇」按钮跳过去了，但 compose 页消费参数不归我。
4. **不存在的 fingerprint id 走 `notFound()`**：用 Next 默认 404 页，没做温暖的自定义 404（可加 `app/fingerprints/[id]/not-found.tsx`，Phase 1 暂缓）。
5. **FingerprintCard 组件未真正在主页/列表页使用**（两页直接内联了 `.fp-card` JSX 以匹配 C 的 enter-stagger 动画顺序），保留组件用于后续抽离。
