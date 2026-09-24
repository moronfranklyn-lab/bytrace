import Link from 'next/link';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

interface ComposeNavProps {
  /** 面包屑当前页文字 */
  currentLabel: string;
  /** 自动保存提示文字（不传则不显示） */
  saveHint?: string;
}

/**
 * /compose 等次级页面用的导航：logo + 面包屑 + 保存提示 + 主题 + 退出。
 * Server Component。
 */
export function ComposeNav({ currentLabel, saveHint = '已自动保存' }: ComposeNavProps) {
  return (
    <nav className="nav">
      <div className="nav-inner" style={{ maxWidth: 1480, gap: 24 }}>
        <div className="nav-left">
          <Link href="/" className="logo">
            <span className="logo-mark">A</span>
            笔迹 ByTrace
          </Link>
          <div className="breadcrumb">
            <Link href="/">工作台</Link>
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <span className="breadcrumb-current">{currentLabel}</span>
          </div>
        </div>
        <div className="nav-right">
          {saveHint && (
            <span className="save-indicator">
              <span className="save-dot" />
              {saveHint}
            </span>
          )}
          <ThemeSwitcher />
          <Link href="/" className="btn btn-ghost">
            退出
          </Link>
        </div>
      </div>
    </nav>
  );
}
