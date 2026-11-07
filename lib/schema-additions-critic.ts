/**
 * critic_runs 表 · Reflection Loop 评分记录
 * ------------------------------------------------------------
 * 每次草稿过一遍 critic 都在此表加一行。一篇文章可以有多行（attempt=1/2/3）。
 *
 * 为什么不把评分塞到 articles 表里：
 *   - 一稿一评分会落 5 个 score 列，但 reflection 是多次的，列数不够
 *   - 跨次的对比（attempt=1 vs 2）需要独立行，方便后续做"评测面板"统计
 *   - 单独成表后，要"看这个月 critic 重试率"只需 group by article_id 取 max(attempt)
 *
 * 字段设计：
 *   - 主键 (article_id, attempt)：天然支持"覆盖写"语义，重试时 UPSERT
 *   - platform：多平台 N 个版本里，每个平台的草稿都会独立跑 critic，
 *     需要区分是哪个平台的评分。一篇 articles 行下，会出现多个 (platform, attempt) 组合
 *   - rewrite_hint 落整段，方便面试 demo 时拉出来给评审看"为什么改"
 *   - elapsed_ms 落每次 critic 耗时，做性能复盘
 */

import type Database from 'better-sqlite3';

export function ensureCriticRunsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS critic_runs (
      article_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      structure_score INTEGER NOT NULL,
      structure_reason TEXT,
      depth_score INTEGER NOT NULL,
      depth_reason TEXT,
      analogy_score INTEGER NOT NULL,
      analogy_reason TEXT,
      punchline_score INTEGER NOT NULL,
      punchline_reason TEXT,
      taboo_score INTEGER NOT NULL,
      taboo_reason TEXT,
      total_score INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      weakest TEXT,
      rewrite_hint TEXT,
      elapsed_ms INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (article_id, platform, attempt)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_critic_runs_article ON critic_runs(article_id)`,
  );
}
