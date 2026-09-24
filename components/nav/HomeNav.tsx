'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

interface HomeNavProps {
  activePath?: string;
}

const LINKS: Array<{ href: string; label: string; match: string }> = [
  { href: '/', label: '工作台', match: '/' },
  { href: '/fingerprints', label: '博主指纹', match: '/fingerprints' },
  { href: '/sites', label: '站点画像', match: '/sites' },
  { href: '/recipes', label: '风格配方', match: '/recipes' },
  { href: '/topics', label: '选题中心', match: '/topics' },
  { href: '/articles', label: '历史文章', match: '/articles' },
];

/**
 * 工作台 / 列表页用的导航：logo + 5 link + 主题切换 + 「开始写作」CTA。
 * 移动端折叠为汉堡。
 */
export function HomeNav({ activePath = '/' }: HomeNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="logo">
          <span className="logo-mark">A</span>
          AutoArticle
        </Link>

        <div className="nav-links nav-links-desktop">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={`nav-link${l.match === activePath ? ' active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
          <div style={{ marginLeft: 8 }}>
            <ThemeSwitcher />
          </div>
          <Link
            href="/compose"
            className="btn btn-primary"
            style={{ marginLeft: 8, padding: '8px 16px', fontSize: 13 }}
          >
            开始写作
            <span className="btn-arrow">→</span>
          </Link>
        </div>

        <div className="nav-mobile">
          <ThemeSwitcher />
          <button
            type="button"
            className="nav-hamburger"
            aria-label={menuOpen ? '收起菜单' : '展开菜单'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="nav-mobile-drawer" role="menu">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={`nav-link${l.match === activePath ? ' active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/compose"
            className="btn btn-primary"
            onClick={() => setMenuOpen(false)}
            style={{ marginTop: 8, justifyContent: 'center' }}
          >
            开始写作
            <span className="btn-arrow">→</span>
          </Link>
        </div>
      )}
    </nav>
  );
}
