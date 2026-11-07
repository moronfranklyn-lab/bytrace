import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

export interface NavLinkItem {
  href: string;
  label: string;
  active?: boolean;
}

interface NavProps {
  /** 用于首页样式 · 5 个导航链接 + CTA */
  links?: NavLinkItem[];
  /** compose 页面的面包屑（左侧）会替换 links */
  leftSlot?: ReactNode;
  /** 导航右侧自定义槽位（用于 compose 的「已自动保存」/「退出」），会在 ThemeSwitcher 前后插入 */
  rightBefore?: ReactNode;
  rightAfter?: ReactNode;
  /** compose 页用更宽的容器 */
  wide?: boolean;
}

/**
 * 顶部全局导航：Server Component。
 * 通过 children/slot 注入页面差异化内容。
 */
export function Nav({ links, leftSlot, rightBefore, rightAfter, wide = false }: NavProps) {
  return (
    <nav className="nav">
      <div className="nav-inner" style={wide ? { maxWidth: 1480, gap: 24 } : undefined}>
        <div className="nav-left">
          <Link href="/" className="logo">
            <span className="logo-mark">A</span>
            笔迹 ByTrace
          </Link>
          {leftSlot}
        </div>
        <div className="nav-right">
          {rightBefore}
          {links && (
            <div className="nav-links">
              {links.map((l) => (
                <Link
                  key={l.href + l.label}
                  href={l.href}
                  className={`nav-link${l.active ? ' active' : ''}`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          )}
          <ThemeSwitcher />
          {rightAfter}
        </div>
      </div>
    </nav>
  );
}
