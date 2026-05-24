-- Agent M · 全局偏好设置表（key/value）。
-- 用于持久化"默认主题"等跨设备/无痕窗口需要承袭的偏好。
-- 注意：用户在浏览器里手动切换的主题仍走 localStorage（zustand persist）；
-- 这张表只决定"没有 localStorage 时回落到哪个主题"。

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 默认主题：D（极简 · 松石青）。
-- 用 INSERT OR IGNORE 保证幂等：首次启动写入，之后不覆盖用户改过的值。
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('default_theme', 'D', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
