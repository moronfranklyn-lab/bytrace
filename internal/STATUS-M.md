# STATUS-M · 默认主题持久化

## 已完成

1. `lib/schema-additions-settings.sql` 新建 `settings(key,value,updated_at)` 表，幂等写入 `default_theme=D`。
2. `lib/db.ts` 加载链补 settings schema；导出 `getSetting / setSetting / listSettings`。
3. `stores/theme-store.ts` 默认值 `B → D`。
4. `components/theme/ClientThemeProvider.tsx` 改造：接收 layout 注入的 `serverDefaultTheme`，仅在 localStorage 无用户选择时回落它。
5. `app/layout.tsx` 服务端读 `getSetting('default_theme')`，直接写到 `<html data-theme>` 避免闪烁，并下发到 Provider。
6. `app/api/settings/route.ts` GET 全量 + PATCH 白名单 (`default_theme`) + 取值校验。
7. `app/settings/preferences/page.tsx` 偏好设置页（下拉 + 保存 + 本机预览）。
8. `components/theme/ThemeSwitcher.tsx` 菜单底部加「偏好设置 →」链接，HomeNav 未动。

## 验证

- `npx tsc --noEmit` 整库 0 error。
- `npm run build` 编译阶段 0 error；Agent M 的 `/api/settings/route.js` 与 `/settings/preferences/page.js` 均产出。后续 page-data collection 报 `/api/compose/draft` 模块缺失，**属其他 Agent 范围**。
- `sqlite3 data/autoarticle.db "SELECT * FROM settings"` → `default_theme|D|...`。

## 边界

未触碰 I/J/K/L/N 文件、未装新依赖、未做"自定义颜色"。
