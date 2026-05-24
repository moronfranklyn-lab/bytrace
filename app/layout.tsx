import type { Metadata } from 'next';
import './globals.css';
import { ClientThemeProvider } from '@/components/theme/ClientThemeProvider';
import { ToastContainer } from '@/components/ui/Toast';
import { getSetting } from '@/lib/db';
import type { ThemeId } from '@/stores/theme-store';

export const metadata: Metadata = {
  title: 'AutoArticle',
  description: '本地写作工具：风格指纹 + 智能仿写',
};

// 避免 build 阶段 prerender 把 default_theme 烤进静态 HTML 后失去 settings 表实时性。
// 主题决定 html data-theme，必须每次请求都重新读。
export const dynamic = 'force-dynamic';

const ALLOWED_THEMES: ThemeId[] = ['B', 'C', 'D'];
const FALLBACK_THEME: ThemeId = 'D';

function resolveServerDefaultTheme(): ThemeId {
  const raw = getSetting('default_theme');
  if (raw && (ALLOWED_THEMES as string[]).includes(raw)) {
    return raw as ThemeId;
  }
  return FALLBACK_THEME;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const serverDefaultTheme = resolveServerDefaultTheme();
  // 服务端把 default_theme 直接写到 <html data-theme>，避免首屏闪烁。
  // 客户端 ClientThemeProvider 挂载后，如果 localStorage 里有用户手动选过的主题就再覆盖。
  return (
    <html lang="zh-CN" data-theme={serverDefaultTheme} suppressHydrationWarning>
      <body className="font-body bg-bg text-text antialiased">
        <ClientThemeProvider serverDefaultTheme={serverDefaultTheme}>
          {children}
        </ClientThemeProvider>
        <ToastContainer />
      </body>
    </html>
  );
}
