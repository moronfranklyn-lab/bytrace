import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 单例 SQLite 连接。
 * 数据文件：<repo>/data/autoarticle.db
 * 启动时执行 lib/schema.sql。
 */

let _db: Database.Database | null = null;

function resolveDbPath(): string {
  // 在 Next.js 运行时 process.cwd() 指向项目根（autoarticle/）
  return join(process.cwd(), 'data', 'autoarticle.db');
}

function resolveSchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema.sql');
}

function resolveImageSchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema-additions-images.sql');
}

function resolveCrawlerSchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema-additions.sql');
}

function resolveSitesSchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema-additions-sites.sql');
}

function resolveStrategiesSchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema-additions-strategies.sql');
}

function resolveSettingsSchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema-additions-settings.sql');
}

function resolveV3SchemaPath(): string {
  return join(process.cwd(), 'lib', 'schema-additions-v3.sql');
}

function ensureDataDir(dbPath: string) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Agent F · 给 fingerprints 表幂等地补 version / parent_id / article_count 三列。
 * SQLite 不支持 ADD COLUMN IF NOT EXISTS，所以先 PRAGMA 看一眼现有列。
 */
function ensureFingerprintVersionColumns(db: Database.Database) {
  const cols = db
    .prepare(`PRAGMA table_info(fingerprints)`)
    .all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));

  if (!names.has('version')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN version INTEGER DEFAULT 1`);
  }
  if (!names.has('parent_id')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN parent_id TEXT`);
  }
  if (!names.has('article_count')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN article_count INTEGER`);
  }
}

/**
 * Agent J · 给 fingerprints 表幂等地补 v3 相关列。
 *   - version_schema  : 'v1' / 'v2' / 'v3'，用于区分老版指纹
 *   - platform_fingerprints_json : 按平台分组的指纹（仅 v3）
 *   - domain_variations_json     : 按领域分组的偏移（仅 v3）
 *   - cross_platform_report_json : 跨平台对比报告（仅 v3 且 ≥ 2 平台时有）
 *   - strategy_fragments_json    : 策略碎片库（仅 v3）
 */
function ensureFingerprintV3Columns(db: Database.Database) {
  const cols = db
    .prepare(`PRAGMA table_info(fingerprints)`)
    .all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));

  if (!names.has('version_schema')) {
    // 给老数据一个默认值 'v1'，新写入的 v2 / v3 路由会显式覆盖。
    db.exec(`ALTER TABLE fingerprints ADD COLUMN version_schema TEXT DEFAULT 'v1'`);
  }
  if (!names.has('platform_fingerprints_json')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN platform_fingerprints_json TEXT`);
  }
  if (!names.has('domain_variations_json')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN domain_variations_json TEXT`);
  }
  if (!names.has('cross_platform_report_json')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN cross_platform_report_json TEXT`);
  }
  if (!names.has('strategy_fragments_json')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN strategy_fragments_json TEXT`);
  }
}

/**
 * Agent J · 给 strategies 表幂等补 v3 列。
 *   - platform_scope_json : 策略适用平台数组
 *   - domain_scope_json   : 策略适用领域数组
 *   - why_works           : 策略生效原理
 *   - title               : 碎片名（v3 才有；v2 用 description 作名字）
 */
function ensureStrategyV3Columns(db: Database.Database) {
  // strategies 表由 schema-additions-strategies.sql 创建。若该 SQL 尚未执行（极端情况），
  // PRAGMA 会返回空数组——这时直接 return，等下一次 getDb() 重跑。
  const cols = db
    .prepare(`PRAGMA table_info(strategies)`)
    .all() as { name: string }[];
  if (cols.length === 0) return;
  const names = new Set(cols.map((c) => c.name));

  if (!names.has('platform_scope_json')) {
    db.exec(`ALTER TABLE strategies ADD COLUMN platform_scope_json TEXT`);
  }
  if (!names.has('domain_scope_json')) {
    db.exec(`ALTER TABLE strategies ADD COLUMN domain_scope_json TEXT`);
  }
  if (!names.has('why_works')) {
    db.exec(`ALTER TABLE strategies ADD COLUMN why_works TEXT`);
  }
  if (!names.has('title')) {
    db.exec(`ALTER TABLE strategies ADD COLUMN title TEXT`);
  }
}

/**
 * Agent I · 给 crawled_articles 表幂等补 medium 列（区分文字/视频博主）。
 * crawled_articles 表由 schema-additions.sql 创建；老库（F0 写时）没有这个字段。
 * 没表就跳过，等 schema-additions.sql 先执行一次 CREATE。
 */
function ensureCrawledArticlesMediumColumn(db: Database.Database) {
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='crawled_articles'`)
    .get();
  if (!tbl) return;
  const cols = db
    .prepare(`PRAGMA table_info(crawled_articles)`)
    .all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('medium')) {
    db.exec(`ALTER TABLE crawled_articles ADD COLUMN medium TEXT DEFAULT 'text'`);
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  ensureDataDir(dbPath);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(resolveSchemaPath(), 'utf-8');
  db.exec(schema);

  // Apply image-related additions (Agent G). Optional file — if missing we
  // silently skip so devs without the file aren't blocked.
  const imageSchemaPath = resolveImageSchemaPath();
  if (existsSync(imageSchemaPath)) {
    const imgSchema = readFileSync(imageSchemaPath, 'utf-8');
    db.exec(imgSchema);
  }

  // Apply crawler-related additions (Agent F0). 同样幂等，缺文件就跳过。
  const crawlerSchemaPath = resolveCrawlerSchemaPath();
  if (existsSync(crawlerSchemaPath)) {
    const crawlerSchema = readFileSync(crawlerSchemaPath, 'utf-8');
    db.exec(crawlerSchema);
  }

  // Agent F · 站点画像表。
  const sitesSchemaPath = resolveSitesSchemaPath();
  if (existsSync(sitesSchemaPath)) {
    const sitesSchema = readFileSync(sitesSchemaPath, 'utf-8');
    db.exec(sitesSchema);
  }

  // Agent H · 跨篇综合的策略表（v2 拆解会写入）。
  const strategiesSchemaPath = resolveStrategiesSchemaPath();
  if (existsSync(strategiesSchemaPath)) {
    const strategiesSchema = readFileSync(strategiesSchemaPath, 'utf-8');
    db.exec(strategiesSchema);
  }

  // Agent M · 全局偏好设置（settings key/value 表）。
  const settingsSchemaPath = resolveSettingsSchemaPath();
  if (existsSync(settingsSchemaPath)) {
    const settingsSchema = readFileSync(settingsSchemaPath, 'utf-8');
    db.exec(settingsSchema);
  }

  // Agent J · v3 schema 占位文件（CREATE TABLE 都没有，但保留 hook 方便未来扩）。
  const v3SchemaPath = resolveV3SchemaPath();
  if (existsSync(v3SchemaPath)) {
    const v3Schema = readFileSync(v3SchemaPath, 'utf-8');
    db.exec(v3Schema);
  }

  // Agent F · fingerprints 表新增三列（幂等）
  ensureFingerprintVersionColumns(db);

  // Agent J · fingerprints / strategies 表的 v3 列扩展（幂等）
  ensureFingerprintV3Columns(db);
  ensureStrategyV3Columns(db);

  // Agent I · crawled_articles.medium 列扩展（幂等）
  ensureCrawledArticlesMediumColumn(db);

  _db = db;
  return db;
}

/**
 * 测试 / 热重载时手动关闭。
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/* ----------------------------------------------------------------- */
/* Agent M · settings helpers                                         */
/* ----------------------------------------------------------------- */

/**
 * 读取一条偏好设置。不存在返回 null。
 * 用法：getSetting('default_theme') -> 'B' | 'C' | 'D' | null
 */
export function getSetting(key: string): string | null {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    // 极端情况下（如 build 阶段无 data 目录）静默回 null，避免拖垮 layout 渲染。
    return null;
  }
}

/**
 * 写入一条偏好设置（upsert）。
 */
export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}

/**
 * 列出所有设置。
 */
export function listSettings(): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare(`SELECT key, value FROM settings`)
    .all() as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
