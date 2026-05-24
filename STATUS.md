# AutoArticle Scaffold Status

初始化日期：2026-05-24
执行者：Agent B（脚手架）

---

## 已安装版本

| 依赖 | package.json 声明 | 实际安装 |
| --- | --- | --- |
| next | ^15.1.0 | **15.5.18** |
| react | ^19.0.0 | **19.2.6** |
| react-dom | ^19.0.0 | **19.2.6** |
| typescript | ^5.6.3 | **5.9.3** |
| better-sqlite3 | ^11.3.0 | **11.10.0** |
| @types/better-sqlite3 | ^7.6.11 | 7.6.13 |
| zustand | ^5.0.1 | **5.0.13** |
| nanoid | ^5.0.7 | **5.1.11** |
| tailwindcss | ^3.4.14 | **3.4.19** |
| autoprefixer | ^10.4.20 | 10.4.21 |
| postcss | ^8.4.49 | 8.5.x |
| @types/node | ^22.9.0 | 22.x |
| @types/react | ^19.0.0 | 19.x |
| @types/react-dom | ^19.0.0 | 19.x |

Node 24.15.0 / npm 11.12.1。

---

## 目录树（深度 2，剔除 node_modules、.next）

```
autoarticle/
├── .gitignore
├── STATUS.md
├── app/
│   ├── api/                       # 空，留给 Agent C/D 加 route
│   ├── globals.css                # 三主题 CSS 变量 + 共享 token + 字体
│   ├── layout.tsx                 # 挂 ClientThemeProvider，默认 data-theme="B"
│   └── page.tsx                   # 占位首页
├── components/
│   ├── nav/                       # 空
│   ├── theme/
│   │   └── ClientThemeProvider.tsx
│   └── ui/                        # 空
├── data/                          # SQLite 数据目录（.db 文件已 ignore）
├── hooks/                         # 空
├── lib/
│   ├── db.ts                      # better-sqlite3 单例 + WAL/foreign_keys
│   └── schema.sql                 # authors / fingerprints / articles
├── next-env.d.ts
├── next.config.ts                 # serverExternalPackages: ['better-sqlite3']
├── package-lock.json
├── package.json
├── postcss.config.mjs
├── public/
├── stores/
│   └── theme-store.ts             # zustand + persist(localStorage)
├── tailwind.config.ts             # 把 CSS 变量映射成 Tailwind colors / fontFamily / radius
└── tsconfig.json                  # strict: true，path alias "@/*"
```

---

## 验证结果

- `npm install`：成功，144 packages，better-sqlite3 native 编译通过（~4 分钟）。
- better-sqlite3 烟测：`new Database(':memory:')` + 建表/插入/查询，正常返回。
- `npm run build`：**成功**。
  - Compiled successfully in 2.1s
  - TypeScript strict 模式 0 报错
  - 静态预渲染 2 个页面（`/`、`/_not-found`）
  - First Load JS shared：102 kB

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      123 B         102 kB
└ ○ /_not-found                            995 B         103 kB
```

- 未启动 dev server（按约定留给 Agent D）。

---

## 与原始要求的差异 & 注意点

1. **Next 版本从指定的 15.0.3 升到 15.1+**：原因是 `next@15.0.3` 的 peerDependency 不接受 `react@19.0.0` 正式版（只接受 RC），会触发 ERESOLVE。改为 `^15.1.0` 后实际锁到 15.5.18，React 19 GA 正式支持。`package.json` 写成 caret，未来 Agent C 可按需收窄。
2. **`@types/better-sqlite3` 已加入 devDependencies**：原任务清单没明确列，但 TypeScript 严格模式下使用 `Database.Database` 类型必需，否则 lib/db.ts 编译报错。
3. **`serverExternalPackages: ['better-sqlite3']`**：在 `next.config.ts` 里加了这条，否则 Server Components 引用 db.ts 时 Next 会尝试 webpack 打包 native 模块导致失败。Agent C 写 API route 时直接 `import { getDb } from '@/lib/db'` 即可。
4. **`<ClientThemeProvider />` 而非 `useEffect` 在 layout 内联**：layout 是 Server Component 不能用 hook，所以单独拆了一个 `'use client'` 组件挂 `useEffect`。
5. **首次 SSR 默认渲染 `data-theme="B"`**：`<html>` 上写死 `data-theme="B"`，客户端挂载后 Provider 会用 localStorage 里的值覆盖。`suppressHydrationWarning` 已加，避免主题不一致时 React 警告。
6. **`globals.css` 用 `@import` 拉 Google Fonts**：按设计规范走 CDN。生产环境如需自托管字体，Agent C 可换 `next/font/google`。
7. **`hooks/`、`components/{ui,nav}/`、`app/api/`、`public/` 都用 `.gitkeep` 占位**：方便 git 提交空目录结构。

---

## 已知遗留 / 风险

- `npm audit` 报 2 个 moderate 漏洞（来自 prebuild-install 依赖链），不影响构建，按下不表。
- 未跑 ESLint：`next lint` 在 Next 15 已 deprecated，需要单独配置 `eslint.config.js`。Agent C 接手时按需补。
- `data/autoarticle.db` 尚未生成（首次调用 `getDb()` 才会创建），已 ignore。
- 未做任何业务代码（指纹/API/UI 页面）—— 按任务约束，留给 Agent C。
