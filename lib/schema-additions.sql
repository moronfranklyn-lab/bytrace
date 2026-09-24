-- F0 爬虫层新增表：crawled_articles
-- 由 lib/db.ts 在每次启动时执行，CREATE TABLE IF NOT EXISTS 保证幂等。
CREATE TABLE IF NOT EXISTS crawled_articles (
  id TEXT PRIMARY KEY,
  author_id TEXT REFERENCES authors(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  title TEXT,
  content TEXT NOT NULL,
  category TEXT,
  images_json TEXT,
  source_type TEXT NOT NULL,
  used_in_fingerprint_id TEXT,
  crawled_at INTEGER NOT NULL,
  publish_time TEXT,
  -- Agent I 增：内容载体 text / video / mixed；ALTER 添加见 lib/db.ts。
  medium TEXT DEFAULT 'text'
);

CREATE INDEX IF NOT EXISTS idx_crawled_author ON crawled_articles(author_id);
CREATE INDEX IF NOT EXISTS idx_crawled_url ON crawled_articles(url_hash);
