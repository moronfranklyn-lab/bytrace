import type Database from 'better-sqlite3';

/**
 * 深度调研流程的落库表（v4 · research）。
 * 与 critic_runs 同形态：一次调研一行总表 + 每轮起草/审查一行明细表。
 * 幂等：CREATE TABLE IF NOT EXISTS，由 lib/db.ts 的 getDb() 末尾统一调用。
 */
export function ensureResearchTables(db: Database.Database) {
  // 一次调研 = 一行（最终产物）
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_reports (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      source_hint TEXT,
      gathered_md TEXT,
      final_report_md TEXT,
      final_attempt INTEGER NOT NULL DEFAULT 1,
      passed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // 每一轮（起草 + 审查）一行明细，主键 (report_id, attempt) 支持覆盖写
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      report_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      draft_md TEXT,
      review_json TEXT,
      verdict TEXT,
      issue_count INTEGER NOT NULL DEFAULT 0,
      high_count INTEGER NOT NULL DEFAULT 0,
      elapsed_ms INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (report_id, attempt)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_research_runs_report ON research_runs(report_id)`);

  // 幂等补 total_score 列（pass 标准 v2：codex 给 0-100 总分，best-of-N 用它选稿）
  const runCols = db.prepare(`PRAGMA table_info(research_runs)`).all() as { name: string }[];
  if (!runCols.some((c) => c.name === 'total_score')) {
    db.exec(`ALTER TABLE research_runs ADD COLUMN total_score INTEGER`);
  }
}
