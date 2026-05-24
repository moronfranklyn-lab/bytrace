import { getDb } from './db';

/**
 * 给 articles 表补齐 compose 流程需要的列。
 * SQLite 不支持 `ADD COLUMN IF NOT EXISTS`，所以这里手动用
 * PRAGMA table_info 检查再决定要不要 ALTER。
 *
 * 在每个 compose 路由的入口调用一次（idempotent）。
 */
export function ensureComposeColumns(): void {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info(articles)`).all() as Array<{
    name: string;
  }>;
  const existing = new Set(cols.map((c) => c.name));

  const wanted: Array<{ name: string; ddl: string }> = [
    { name: 'composition_json', ddl: `ALTER TABLE articles ADD COLUMN composition_json TEXT` },
    { name: 'outline_json', ddl: `ALTER TABLE articles ADD COLUMN outline_json TEXT` },
    { name: 'idea', ddl: `ALTER TABLE articles ADD COLUMN idea TEXT` },
    { name: 'refine_versions_json', ddl: `ALTER TABLE articles ADD COLUMN refine_versions_json TEXT` },
  ];

  for (const w of wanted) {
    if (!existing.has(w.name)) {
      db.exec(w.ddl);
    }
  }
}
