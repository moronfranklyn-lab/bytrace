# UI Migration Status

日期：2026-05-24 · 执行者：Agent C（UI 迁移）

## 新建 / 修改

新建：
- `app/compose/page.tsx`
- `app/fingerprints/page.tsx`
- `components/nav/HomeNav.tsx`
- `components/nav/ComposeNav.tsx`
- `components/theme/ThemeSwitcher.tsx`
- `components/home/TopicTabs.tsx`
- `components/compose/Panel.tsx`
- `components/compose/Toast.tsx`
- `components/ui/Button.tsx`
- `components/ui/Tag.tsx`

修改：
- `app/page.tsx`（覆盖占位）
- `app/globals.css`（仅在文件末尾追加组件级样式，未动三主题色板）

## 构建

`npm run build` 0 error 通过。所有 4 个页面静态预渲染：`/`、`/compose`、`/fingerprints`、`/_not-found`。`/api/fingerprint`（D 写的）保持 ƒ dynamic。

## 主题切换验证

启了一次 dev server（3001 端口），`/` 和 `/compose` 都 200，`theme-trigger`、`theme-menu` DOM 已渲染；`ThemeSwitcher` 通过 zustand store 写入，由 `ClientThemeProvider` 同步到 `<html data-theme>`，两个页面共享同一 store 与 persist。手动验证完已关 dev server。

## 可复用组件

`ThemeSwitcher` · `HomeNav` · `ComposeNav` · `TopicTabs` · `Panel` · `Toast` · `Button/ButtonLink` · `Tag`。

## 踩坑

1. React 19 下 `JSX.Element` 全局命名空间不再默认导出，build 报 `Cannot find namespace 'JSX'`。改用 `import { type ReactElement } from 'react'`。
2. Compose 页交互重 + 内部多个面板/平台/导出按钮需要共享 toast，整页 `'use client'`，子面板抽成轻量组件，符合楠的「整页 client」预期。
3. 原型里两份 HTML 的 tag class 命名不一致（首页 `tag-lang`，compose 页 `tag.lang`），样式表里两套都写了，便于不改 markup 复用。
