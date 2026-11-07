-- ============================================================
-- Agent E (compose) additions to the articles table.
-- ============================================================
-- SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，所以
-- 这些语句必须由代码先用 PRAGMA table_info(articles) 看一下
-- 再决定要不要 exec。lib/compose-schema.ts 干这件事。
--
-- 这里只是记录"我们对 articles 表新增了哪些列"，**不**直接被
-- db.ts 里的 schema.sql 加载流程吃。
-- ============================================================

-- 用了哪些指纹、各自权重，序列化的 Composition
ALTER TABLE articles ADD COLUMN composition_json TEXT;

-- 用户确认时使用的大纲
ALTER TABLE articles ADD COLUMN outline_json TEXT;

-- 用户最初输入的题材思路
ALTER TABLE articles ADD COLUMN idea TEXT;

-- 改写历史（按平台存改写后的 markdown），JSON: { wechat: "...", xhs: "..." }
ALTER TABLE articles ADD COLUMN refine_versions_json TEXT;
