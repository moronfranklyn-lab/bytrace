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
/**
 * 博主指纹 ↔ 已用样本的关联表（与 site_articles 同形态）。
 * - (fingerprint_id, url_hash) 唯一键 → 同一指纹内同一篇文章不会重复入库
 * - content 直接落表（不依赖 crawled_articles），方便 paste 模式
 * - iteration 1-based 计数，每次"加样本+重提炼"+1
 */
function ensureFingerprintArticlesTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fingerprint_articles (
      fingerprint_id TEXT NOT NULL,
      url_hash TEXT NOT NULL,
      url TEXT,
      title TEXT,
      content TEXT NOT NULL,
      platform TEXT,
      medium TEXT DEFAULT 'text',
      domain TEXT,
      source_mode TEXT NOT NULL DEFAULT 'url',
      added_at INTEGER NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (fingerprint_id, url_hash)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fp_articles_fp ON fingerprint_articles(fingerprint_id)`);
}

/**
 * fingerprint_articles 加分类列（Stage 0 自动标）。
 * - primary_category : 8 选 1 主类
 * - secondary_category : 副类，可空
 * - category_confidence : high/medium/low
 * 老样本未跑过 Stage 0 → 三列都为 NULL，UI 上会标"未分类"，重提炼时补跑。
 */
function ensureFingerprintArticlesCategoryColumns(db: Database.Database) {
  const cols = db
    .prepare(`PRAGMA table_info(fingerprint_articles)`)
    .all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('primary_category')) {
    db.exec(`ALTER TABLE fingerprint_articles ADD COLUMN primary_category TEXT`);
  }
  if (!names.has('secondary_category')) {
    db.exec(`ALTER TABLE fingerprint_articles ADD COLUMN secondary_category TEXT`);
  }
  if (!names.has('category_confidence')) {
    db.exec(`ALTER TABLE fingerprint_articles ADD COLUMN category_confidence TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fp_articles_primary_cat ON fingerprint_articles(primary_category)`);
}

/**
 * 按类别细分的指纹（博主 × 类别 → 一份独立指纹）。
 * 主指纹 fingerprints 表保留作为"全类别融合视图"，这张表是按类别的细分。
 * 只有该类别样本 ≥ 3 篇才生成行；样本不够的类别 UI 上提示"再加几篇这类的"。
 */
function ensureFingerprintCategoryProfilesTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fingerprint_category_profiles (
      fingerprint_id TEXT NOT NULL,
      category TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      sample_count INTEGER NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (fingerprint_id, category)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_fp_cat_profiles_cat ON fingerprint_category_profiles(category)`,
  );
}

/**
 * 跨博主可检索的策略碎片索引（写作时按类别 + tag 检索用）。
 * 每条碎片带"出处"：来自哪个博主、哪份指纹、原始证据片段。
 * 重写策略：每次 Stage 2 完成后，先 DELETE 该 fingerprint_id 的旧行，再批量插入新行。
 */
/**
 * 风格配方表（v3.2）：用户从 strategy_fragments_indexed 里挑碎片组成"配方"。
 * 一个配方绑一个 platform_key（必须）+ 可选 site_id。
 * 写作时按 platform_key 列出可用配方，选了之后碎片注入到 prompt。
 *
 * fragment_ids_json: ["fragId1", "fragId2", ...] —— 引用 strategy_fragments_indexed.id
 */
function ensureStyleRecipesTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS style_recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform_key TEXT NOT NULL,
      site_id TEXT,
      fragment_ids_json TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_style_recipes_platform ON style_recipes(platform_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_style_recipes_site ON style_recipes(site_id)`);
}

function ensureStrategyFragmentsIndexedTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_fragments_indexed (
      id TEXT PRIMARY KEY,
      fingerprint_id TEXT NOT NULL,
      author_name TEXT,
      category TEXT,
      tag TEXT,
      title TEXT,
      description TEXT,
      example TEXT,
      when_to_use TEXT,
      why_works TEXT,
      platform_scope_json TEXT,
      domain_scope_json TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_strat_frag_cat ON strategy_fragments_indexed(category)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_strat_frag_tag ON strategy_fragments_indexed(tag)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_strat_frag_fp ON strategy_fragments_indexed(fingerprint_id)`,
  );
}

/**
 * fingerprints 表的迭代计数列。
 * 每次"加样本+重提炼"自增 1，跟 fingerprint_articles.iteration 关联。
 */
function ensureFingerprintIterationColumn(db: Database.Database) {
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='fingerprints'`)
    .get();
  if (!tbl) return;
  const cols = db.prepare(`PRAGMA table_info(fingerprints)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('iteration_count')) {
    db.exec(`ALTER TABLE fingerprints ADD COLUMN iteration_count INTEGER DEFAULT 1`);
  }
}

/**
 * sites 表的迭代计数列。
 * 每次"加样本+重提炼"自增 1，方便 site_articles.iteration 关联。
 */
function ensureSitesIterationColumn(db: Database.Database) {
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sites'`)
    .get();
  if (!tbl) return;
  const cols = db.prepare(`PRAGMA table_info(sites)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('iteration_count')) {
    db.exec(`ALTER TABLE sites ADD COLUMN iteration_count INTEGER DEFAULT 1`);
  }
}

/**
 * 站点画像 ↔ 已用样本的关联表。
 * 让"加样本"流程知道哪些 url 已经分析过、可以跳过。
 *
 * - (site_id, url_hash) 唯一键 → 同 site 内同一 URL 不会被记两遍
 * - 文章正文存在 crawled_articles（按 url_hash 关联），不在此表重复
 * - added_at 用来对最新一批样本做"本轮新增了 N 篇"提示
 * - iteration 是 1-based 计数，每次更新画像 +1，便于看是哪一轮加进来的
 */
function ensureSiteArticlesTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_articles (
      site_id TEXT NOT NULL,
      url_hash TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      added_at INTEGER NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (site_id, url_hash)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_site_articles_site ON site_articles(site_id)`);
}

/**
 * 平台版本差异摘要缓存。
 * 一次 Claude 对比调用算两段 markdown 的"调整了什么"，结果按
 * (article_id, from_platform, to_platform) 唯一键缓存。
 * 老内容变动会让缓存失效——靠 from_hash / to_hash 校验。
 */
function ensureArticleDiffsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_diffs (
      article_id TEXT NOT NULL,
      from_platform TEXT NOT NULL,
      to_platform TEXT NOT NULL,
      from_hash TEXT NOT NULL,
      to_hash TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (article_id, from_platform, to_platform)
    )
  `);
}

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

  // 平台版本差异缓存表（幂等）
  ensureArticleDiffsTable(db);

  // 站点画像 ↔ 已用样本关联表（幂等）
  ensureSiteArticlesTable(db);
  ensureSitesIterationColumn(db);

  // 博主指纹 ↔ 已用样本关联表 + 迭代计数列（幂等）
  ensureFingerprintArticlesTable(db);
  ensureFingerprintIterationColumn(db);

  // v3.1 · 文章类别 + 按类别细分指纹 + 跨博主碎片索引（幂等）
  ensureFingerprintArticlesCategoryColumns(db);
  ensureFingerprintCategoryProfilesTable(db);
  ensureStrategyFragmentsIndexedTable(db);

  // v3.2 · 风格配方（用户挑碎片组成 platform 专属配方）（幂等）
  ensureStyleRecipesTable(db);

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
