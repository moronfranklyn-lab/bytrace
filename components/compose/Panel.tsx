'use client';

import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * 右抽屉单个折叠面板。
 * grid-template-rows 0fr → 1fr 实现高度过渡（沿用原型）。
 */
export function Panel({ title, icon, open, onToggle, children }: PanelProps) {
  return (
    <div className={`panel${open ? ' open' : ''}`}>
      <div className="panel-head" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="panel-title">
          <span className="panel-icon">{icon}</span>
          {title}
        </div>
        <span className="panel-caret">▾</span>
      </div>
      <div className="panel-body">
        <div className="panel-body-inner">{children}</div>
      </div>
    </div>
  );
}
