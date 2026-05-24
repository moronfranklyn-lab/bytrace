'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useThemeStore, type ThemeId } from '@/stores/theme-store';

interface ThemeOption {
  id: ThemeId;
  label: string;
}

const OPTIONS: ThemeOption[] = [
  { id: 'B', label: '牛皮纸 · 朱砂' },
  { id: 'C', label: '夜书房 · 鎏金' },
  { id: 'D', label: '极简 · 松石青' },
];

/**
 * 主题切换器：圆点按钮 + 下拉菜单。
 * 点击触发开/关，点外部关闭。
 * 切换写入 zustand store，由 <ClientThemeProvider /> 同步到 <html data-theme>。
 */
export function ThemeSwitcher() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  return (
    <div className="theme-dropdown" ref={wrapRef}>
      <button
        type="button"
        className="theme-trigger"
        title="切换主题"
        aria-label="切换主题"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span className={`current-dot dot-${theme.toLowerCase()}`} />
      </button>
      <div className={`theme-menu${open ? ' open' : ''}`}>
        <div className="theme-menu-title">主题</div>
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`theme-btn${theme === opt.id ? ' active' : ''}`}
            onClick={() => {
              setTheme(opt.id);
              setOpen(false);
            }}
          >
            <span className={`theme-dot dot-${opt.id.toLowerCase()}`} />
            <span>{opt.label}</span>
          </button>
        ))}
        <Link
          href="/settings/preferences"
          className="theme-btn theme-btn-link"
          onClick={() => setOpen(false)}
          style={{
            borderTop: '1px solid var(--border)',
            marginTop: 4,
            paddingTop: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
            justifyContent: 'space-between',
          }}
        >
          <span>偏好设置</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
