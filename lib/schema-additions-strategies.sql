-- Agent H · strategies 表：跨篇综合后的「博主写作策略集合」
-- 由 lib/db.ts 启动时执行，CREATE TABLE IF NOT EXISTS 保证幂等。
-- 每条记录是一条可复用的写作策略，scope_json 标记适用于哪几类文章。
CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  fingerprint_id TEXT REFERENCES fingerprints(id) ON DELETE CASCADE,
  tag TEXT,                       -- 'opening' / 'transition' / 'closing' / 'argument' / 'language' / 'visual'
  scope_json TEXT,                -- JSON array, e.g. ["观点","评论"]
  description TEXT,
  example TEXT,
  when_to_use TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategies_fp ON strategies(fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_strategies_tag ON strategies(tag);
