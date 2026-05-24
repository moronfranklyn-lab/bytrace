CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,                  -- nanoid
  name TEXT NOT NULL,
  platform TEXT,                        -- '公众号' / '知乎' / ...
  avatar_emoji TEXT,                    -- 单个汉字做 avatar（"半"）
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS fingerprints (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  source_articles_json TEXT NOT NULL,   -- 拆解时用的原始文章数组（JSON）
  fingerprint_json TEXT NOT NULL,       -- 12 维度结果（JSON）
  raw_response TEXT,                    -- Claude 原始流式输出（debug 用）
  model_version TEXT,
  created_at INTEGER NOT NULL,
  hit_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  fingerprint_id TEXT REFERENCES fingerprints(id) ON DELETE SET NULL,
  platform_target TEXT,
  layout_theme TEXT,                    -- 'standard' / 'lively' / 'minimal'
  title TEXT,
  content_md TEXT,
  content_html TEXT,
  user_prompt TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fp_author ON fingerprints(author_id);
CREATE INDEX IF NOT EXISTS idx_article_fp ON articles(fingerprint_id);
