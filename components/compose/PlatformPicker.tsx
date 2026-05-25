'use client';

import { PLATFORMS, type PlatformKey } from '@/lib/platforms';

/**
 * Step 1（最前置）：目标平台选择卡片网格。
 * - 7 张卡：公众号 / 知乎 / 少数派 / 优设 / 小红书 / B 站 / 自定义
 * - 每张卡显示：平台名 + 字数推荐区间 + 节奏标签
 * - 点击即选中；由父组件控制何时进入下一步
 *
 * 视频平台（B 站 / 抖音 / YouTube）已从此列表移除，仅保留爬虫与历史数据兼容。
 */

interface PlatformPickerProps {
  value: PlatformKey | null;
  onChange: (key: PlatformKey) => void;
  /** 可选：点击某张卡的同时直接下一步（双击 / Enter 二次确认） */
  onConfirm?: (key: PlatformKey) => void;
}

export function PlatformPicker({ value, onChange, onConfirm }: PlatformPickerProps) {
  return (
    <div className="platform-picker-grid">
      {PLATFORMS.map((p) => {
        const active = value === p.key;
        return (
          <button
            key={p.key}
            type="button"
            className={'platform-picker-card' + (active ? ' active' : '')}
            onClick={() => onChange(p.key)}
            onDoubleClick={() => onConfirm?.(p.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (active && onConfirm) onConfirm(p.key);
                else onChange(p.key);
              }
            }}
            aria-pressed={active}
          >
            <div className="platform-picker-card-head">
              <span className="platform-picker-name">{p.name}</span>
              <span className="platform-picker-tag">{p.tone_tag}</span>
            </div>
            <div className="platform-picker-range">
              {p.word_range_min.toLocaleString()}–{p.word_range_max.toLocaleString()} 字
            </div>
            <div className="platform-picker-pacing">{p.pacing}</div>
            <div className="platform-picker-hint">{p.ui_hint}</div>
          </button>
        );
      })}
    </div>
  );
}
