/**
 * gather_runs 表 · compose 主流程的 Codex 联网搜集缓存
 * ------------------------------------------------------------
 * 每个 idea（按文本哈希）只跑一次 codex 联网搜集，命中缓存的请求直接返回。
 *
 * 为什么按 idea_hash 缓存而不是按 article_id：
 *   - codex exec 6 分钟超时是真实成本；同一选题用户在 compose 流程里可能反复进退
 *     （回 Step 2 改 idea、再回来重跑），不缓存等于每次都烧一遍
 *   - 一个 idea 对应多个最终 article（你跑出不同风格组合的稿子），但素材包是同一份
 *   - 退到极端：一周后回来用同一 idea，缓存仍有效 —— 时效性问题用 created_at 在 UI 上提示
 *
 * 缓存策略：
 *   - 命中 = idea_hash 已存在
 *   - 由前端决定要不要强制 refetch（v1 不做，用户改 idea 即换 hash 自然失效）
 *
 * 不存 source_hint：用户在 compose 里没有暴露这个参数；研究后期要加再说。
 */

import type Database from 'better-sqlite3';

export function ensureGatherRunsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gather_runs (
      idea_hash TEXT PRIMARY KEY,
      idea TEXT NOT NULL,
      material_md TEXT NOT NULL,
      chars INTEGER NOT NULL,
      elapsed_ms INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gather_runs_created ON gather_runs(created_at DESC)`);
}
