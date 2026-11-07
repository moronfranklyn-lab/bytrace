-- =============================================================
-- Agent F · 站点画像表
-- =============================================================
-- 这个文件在 getDb() 启动时由 db.ts 在执行完 schema.sql 之后追加执行。
-- 所有语句都必须是 IF NOT EXISTS / 幂等，否则热重启会报错。
-- crawled_articles 表由 Agent F0 在 schema-additions.sql 中创建，本文件不动它。
-- fingerprints 的 version/parent_id/article_count 三列由 db.ts 通过 PRAGMA
-- 检测后 ALTER TABLE 加入（SQLite 不支持 ADD COLUMN IF NOT EXISTS）。
-- =============================================================

-- 一行 = 一个"站点 + 板块"画像
-- profile_json 形如：
--   { site_name, section, url_pattern, preferred_topics, title_patterns,
--     word_count_range, image_density, opening_pattern, closing_pattern,
--     tone, key_phrases }
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  site_name TEXT NOT NULL,
  section TEXT,
  url_pattern TEXT,
  profile_json TEXT NOT NULL,
  source_url TEXT,
  source_article_count INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sites_pattern ON sites(url_pattern);
CREATE INDEX IF NOT EXISTS idx_sites_created ON sites(created_at DESC);
