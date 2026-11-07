'use client';

import { useEffect, useRef } from 'react';
import { useThemeStore, type ThemeId } from '@/stores/theme-store';

interface Props {
  children: React.ReactNode;
  /**
   * 服务端从 settings 表读出的默认主题。
   * 仅当本地 localStorage 里**没有**用户手动选择记录时，才会用这个值覆盖 store。
   */
  serverDefaultTheme?: ThemeId;
}

/**
 * 客户端主题挂载器。
 *
 * 工作流：
 * 1. 进程启动：layout 服务端从 settings 表读 `default_theme` → `serverDefaultTheme` prop。
 *    同时 layout 也把它直接写到 <html data-theme="...">，避免 hydration 闪烁。
 * 2. 首次挂载：检查 zustand persist 是否真的从 localStorage 取到值；
 *    没取到（新设备 / 无痕模式）就把 serverDefaultTheme 写进 store。
 * 3. 之后 store.theme 任何变化都同步到 <html data-theme>。
 */
export function ClientThemeProvider({ children, serverDefaultTheme }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const initRef = useRef(false);

  // 首挂：判断 localStorage 是否真有 user choice。
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if (typeof window === 'undefined') return;
    let hasLocalChoice = false;
    try {
      const raw = window.localStorage.getItem('autoarticle-theme');
      // zustand/persist 结构：{ state: { theme: 'X' }, version: 0 }
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { theme?: string } };
        if (parsed?.state?.theme) hasLocalChoice = true;
      }
    } catch {
      // ignore
    }

    if (!hasLocalChoice && serverDefaultTheme && serverDefaultTheme !== theme) {
      setTheme(serverDefaultTheme);
    }
    // 仅依赖 serverDefaultTheme；setTheme 来自 zustand 是稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDefaultTheme]);

  // store 变 → DOM 同步
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return <>{children}</>;
}
