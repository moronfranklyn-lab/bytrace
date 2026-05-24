# STATUS-L · compose 7 步流程 + 平台感知 + 拆解面板

## 完成

- `lib/platforms.ts`：新建。9 个平台 trait（公众号 / B 站 / 知乎 / 少数派 / 优设 / 小红书 / 抖音 / YouTube / 自定义），含 word_range / voice / pacing / hook_position / do_extra / dont_extra。提供 `pickV3PlatformFingerprint` 把英文 key 映射到 v3 中文 platform_fingerprints。
- `lib/composition.ts`：FingerprintShape 扩展 v3 可选字段（platform_fingerprints / strategy_fragments / cross_platform_report / user_facing_summary）。新增 `buildPlatformAwareSnippet` + `judgePlatformMatchQuality`（exact / cross-platform / generic 三档），全程 v2 向后兼容。
- `lib/prompts/recommend.ts`：升级支持 target_platform；prompt 在每条指纹后注入平台匹配档位；输出 `platform_match_quality`，并由 `normalizeRecommendations` 用真指纹做反向校正（不信任模型）。
- `lib/prompts/outline.ts`：注入平台 traits + buildPlatformAwareSnippet；按平台动态给章节数 / 单节字数 / 总字数区间（抖音 3-5 节 300-800 字，知乎 4-8 节 4500-8500 字 等）。
- `lib/prompts/article.ts`：注入"目标平台风格约束"段（最高优先级），把博主的命中专属指纹 / 跨平台策略碎片塞到 prompt 里。
- `lib/prompts/refine.ts`：彻底重写。源平台 → 目标平台双向标注；接受 crossHints（从 v3 fingerprint 抽出），命中专属指纹直接套用，没命中走 transferable_patterns。
- `app/api/recommend/route.ts`、`app/api/compose/{outline,draft,refine}/route.ts`：均接受 target_platform；draft 把 platform_target 写真值；refine 路由读 article 的 composition_json → 拉指纹 → 抽 crossHints → 改写完毕 append 到 articles.refine_versions_json 数组。
- `app/api/articles/[id]/route.ts`：新增 GET，返回 explainer 需要的 composition + outline + 指纹浅信息 + strategy_fragments。
- `components/compose/PlatformPicker.tsx`、`components/compose/CompositionExplainer.tsx`：新建。
- `app/compose/page.tsx`：6 步 → 7 步。新增 Step1Platform；其余步骤号 +1；Step3Recommend 推荐卡显示匹配徽章；Step7Preview 右抽屉加 explainer Panel（默认折叠），切平台面板接真 refine（带 source_platform + article_id），原文标记"原文"角标。
- `app/globals.css`：追加 platform-picker / match-badge / composition-explainer 三组样式。

## 验证

`npm run build` 通过，0 error，0 warning。test-recommend/outline 旧脚本签名向后兼容（新参数全部 optional）。未运行真 Claude（避免烧 token，按"如有需要"条款裁掉）。

## 兼容性

老 v1/v2 指纹无 platform_fingerprints / strategy_fragments → 自动降级到通用 snippet；判定结果 = generic；前端徽章正确展示。
