# Agent J · Status

日期：2026-05-24 · 执行者：Agent J（指纹拆解 v3：按平台 + 按领域 + 跨平台对比）

## v3 与 v2 的核心差异（一句话）

v2 输出「博主整体一份指纹」，v3 改成「按平台分组的 N 份子指纹 + 按领域偏移 + 跨平台调整报告 + 15-25 条可独立调用的策略碎片」。

## 真调测试

`npx tsx lib/prompts/test-fingerprint-v3.ts` · 3 篇样本（公众号商业观察 / B 站长视频商业观察 / 知乎个人成长）

- Stage 1（3 篇并发）：**44.8s**
- Stage 2（综合按平台分组）：**132.9s**
- Stage 3（跨平台对比）：**45.3s**
- **合计 223.0s**

校验结果：所有必填字段齐全，JSON 可解析，无 emoji。18 条 strategy_fragments，3 个 platform_fingerprints，4 个 cross_platform_report.comparisons。完整输出在 `lib/prompts/test-output-v3.json`。

## 给 K 的接口提示（博主详情页怎么读 v3 字段）

从 `fingerprints` 表读出来后：

```ts
// version_schema 字段判定版本
if (row.version_schema === 'v3') {
  const fp = JSON.parse(row.fingerprint_json);
  fp.platform_fingerprints   // Record<平台名, { fingerprint_summary, language, structure, topic, visual, platform_specific_traits[], strengths[], weaknesses[] }>
  fp.domain_variations       // Record<领域名, { differences_from_default, preferred_structure, tone_shift }>
  fp.cross_platform_report   // { summary, comparisons: [{ topic_example, platform_a, platform_a_treatment, platform_b, platform_b_treatment, why_adjusted }], transferable_patterns[] }
  fp.strategy_fragments      // [{ tag, platform_scope[], domain_scope[], title, description, example, when_to_use, why_works }]
  fp.user_facing_summary     // 一段直接展示给用户的话
}
```

或直接读独立列（已在 `lib/db.ts:ensureFingerprintV3Columns` 通过 PRAGMA + ALTER 加好）：
- `platform_fingerprints_json` / `domain_variations_json` / `cross_platform_report_json` / `strategy_fragments_json`

策略碎片在 `strategies` 表里也按 v3 字段写入了：新增 `title / platform_scope_json / domain_scope_json / why_works`（见 `ensureStrategyV3Columns`），v2 旧记录不受影响。

UI 建议：
- 顶部「跨平台报告」横向 carousel，每张 card 对应一个 comparison
- 中段「平台子指纹」tab，按 `platforms_analyzed` 顺序切
- 底部「策略碎片库」可按 platform_scope / domain_scope / tag 三维筛选

## 文件清单

新建：
- `lib/prompts/fingerprint-v3-stage1.ts`
- `lib/prompts/fingerprint-v3-stage2.ts`
- `lib/prompts/fingerprint-v3-cross-platform.ts`
- `lib/prompts/test-fingerprint-v3.ts`
- `lib/prompts/test-output-v3.json`（测试产物）
- `lib/schema-additions-v3.sql`（占位文件，实际列扩展全在 db.ts PRAGMA 路径）
- `app/api/fingerprint/v3/route.ts`

修改：
- `lib/db.ts` 追加 `resolveV3SchemaPath / ensureFingerprintV3Columns / ensureStrategyV3Columns`，并在 `getDb()` 内串接

## Build 验证

`npm run build`：**0 error / 0 warning**，v3 路由出现在路由列表 `ƒ /api/fingerprint/v3`。

## 不动的边界

- v2 路由 `/api/fingerprint/v2` 完全保留，所有 v2 字段/写库行为不变
- 没碰 `lib/search/`、`lib/crawler/adapters/{bilibili,youtube}.ts`、`app/authors/`、`components/authors/`、`app/compose/`、`app/api/compose/`、`lib/prompts/article*`、`refine.ts`、`recommend.ts`、`outline.ts`、`lib/db.ts` 的 settings 段、`app/page.tsx` Hero
- 未装新依赖
