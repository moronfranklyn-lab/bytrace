-- Image / asset tables for Agent G (auto-image feature).
-- Loaded by lib/db.ts after the base schema. Must be idempotent.

CREATE TABLE IF NOT EXISTS local_assets (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  file_name TEXT,
  folder TEXT,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  tags_json TEXT,                  -- JSON array, e.g. ["工作场景", "桌面"]
  visual_style TEXT,               -- 实拍 / 插画 / 截图 / 数据图 / 其他
  source TEXT NOT NULL,            -- 'local' / 'crawled' / 'unsplash-cache'
  source_url TEXT,
  indexed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_tags ON local_assets(tags_json);
CREATE INDEX IF NOT EXISTS idx_assets_source ON local_assets(source);
CREATE INDEX IF NOT EXISTS idx_assets_folder ON local_assets(folder);

CREATE TABLE IF NOT EXISTS article_images (
  id TEXT PRIMARY KEY,
  article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  slot_index INTEGER,
  position_text TEXT,              -- 段落开头 30 字 hash
  image_source TEXT,               -- 'local' / 'unsplash'
  asset_id TEXT,                   -- local_assets.id when image_source='local'
  external_url TEXT,               -- when image_source='unsplash'
  caption TEXT,
  selected_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_article_images_article ON article_images(article_id);
