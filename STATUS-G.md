# STATUS · Agent G（自动配图）

日期：2026-05-24

## 本地扫描

`npx tsx scripts/scan-local-assets.ts` 跑通：

- 扫描根目录 `/Users/nan/ai资料合集/项目合集/公众号/公众号配图`
- 实际入库 **16 张**（spec 写 247，但目录里目前只有 16 个图片文件，其余可能还没归档）
- 字段：folder + 文件名生成的初始 tags（如 `["ai和魔法有什么区别","aLEsv"]`）、`visual_style` 启发式猜测（截图/插画/数据图/其他）、`size_bytes` 用 fs.statSync 拿、width/height 留 null。
- 二次扫描幂等：`skipped_existing=16, inserted=0`，UNIQUE(file_path) 兜底。

数据库验证：`countLocalAssets() = 16`，`searchLocalAssets(["ai"])` 返回 3 条命中（文件夹名匹配）。

## Unsplash 优雅降级

`UNSPLASH_ACCESS_KEY` 未配时 `isUnsplashConfigured()=false`、`searchUnsplash(...)` 直接 return `[]`，无 throw、无 console 噪音。`.env.local.example` 已提供，`.gitignore` 原本就盖了 `.env.local`。

## ImagePanel 接口（给 E 用）

```ts
import { ImagePanel, type ImagePanelProps, type Slot } from '@/components/compose/ImagePanel';

interface ImagePanelProps {
  articleContent: string;                    // 必传，成稿正文
  fingerprintId?: string | null;             // 用于读 visual.image_style
  slotCount?: number;                        // 默认 3
  localAssetCount?: number;                  // 服务端 countLocalAssets() 传入
  unsplashConfigured?: boolean;              // 服务端 isUnsplashConfigured() 传入
  onSelectionChange?: (slots: Slot[]) => void;
}
```

E 的 compose Step 6 把它作为 `<Panel>` 的 children 挂载。所有样式复用 C 已经写好的 `.img-status / .img-thumbs / .img-thumb / .img-options / .img-option`，不动 globals.css。

## 交付文件

- `lib/schema-additions-images.sql` · `lib/db.ts`（追加加载，与 F0 并行幂等）
- `lib/images/scanner.ts` · `lib/images/local.ts` · `lib/images/unsplash.ts`
- `lib/prompts/image-keywords.ts`（Claude 拆图意 prompt + JSON 围栏剥离）
- `app/api/assets/scan/route.ts` · `app/api/assets/file/route.ts`（按 ID 安全流出本地文件）
- `app/api/images/auto/route.ts`（端到端：指纹 → Claude → 本地 + Unsplash 候选）
- `app/api/images/search/route.ts`（混合搜索）
- `components/compose/ImagePanel.tsx`
- `scripts/scan-local-assets.ts` · `scripts/test-image-flow.ts`
- `.env.local.example`

## 验证

`npm run build` **0 error**，4 个新路由全部注册。`tsx scripts/test-image-flow.ts` 扫描 + 搜索 + Unsplash 空返全部 PASS。

## 已知 / 遗留

- 247→16：目录里目前只有 16 张，等Ethan把素材补齐后再跑一次脚本即可。
- 站点爬取勾选项暂禁用，等 F0 的 crawler 接通后改成 enabled。
- "进一步用 Claude 打 tag"按钮还没接，下一轮可以在 `/api/assets/scan` 加 `enrich=true` 参数让它读路径关键词再增补 tags。
