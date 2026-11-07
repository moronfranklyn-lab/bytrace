'use client';

import { useState } from 'react';

const TABS = ['风格推荐', '热点聚合'] as const;
type Tab = (typeof TABS)[number];

interface TopicTabsProps {
  defaultTab?: Tab;
}

/**
 * 「今天的选题」section 顶部 tab 切换。
 * 当前只是视觉态切换（没有数据差异）。
 */
export function TopicTabs({ defaultTab = '风格推荐' }: TopicTabsProps) {
  const [active, setActive] = useState<Tab>(defaultTab);
  return (
    <div className="topic-tabs">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          className={`topic-tab${active === t ? ' active' : ''}`}
          onClick={() => setActive(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
