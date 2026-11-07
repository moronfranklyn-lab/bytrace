-- =============================================================
-- Agent J · v3 指纹扩展
-- =============================================================
-- 这个文件在 getDb() 启动时由 db.ts 在 schema.sql、schema-additions-images.sql、
-- schema-additions.sql、schema-additions-sites.sql、schema-additions-strategies.sql
-- 之后追加执行。
--
-- 由于 SQLite 不支持 ADD COLUMN IF NOT EXISTS，所有 ALTER 都改在 lib/db.ts 里
-- 用 PRAGMA table_info 检测后再执行（见 ensureFingerprintV3Columns / ensureStrategyV3Columns）。
-- 本文件只放 CREATE TABLE / CREATE INDEX 这类幂等语句。
-- =============================================================

-- v3 没有新增表，只是给 fingerprints / strategies 补列。
-- 为了让本文件 db.exec 时不报错，留一句无副作用的 SELECT 占位（SQLite 允许）。
SELECT 1;
