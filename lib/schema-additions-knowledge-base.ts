import type Database from 'better-sqlite3';

/**
 * 知识资料库表结构
 * 用于保存每次联网搜索整理后的素材，便于后续查询和复用
 */
export function ensureKnowledgeBaseTable(db: Database.Database) {
  // 主表：搜索资料条目
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      category TEXT,
      search_query TEXT NOT NULL,
      raw_results_json TEXT NOT NULL,
      organized_content_md TEXT NOT NULL,
      keywords_json TEXT,
      source_urls_json TEXT,
      char_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // 索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_topic ON knowledge_base(topic)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_created ON knowledge_base(created_at)`);

  // 标签关联表：一条资料可以有多个标签
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_base_tags (
      knowledge_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (knowledge_id, tag)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_tags_tag ON knowledge_base_tags(tag)`);
}
