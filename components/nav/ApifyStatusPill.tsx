'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatUsd } from '@/lib/format-cost';

interface ApifyRun {
  runId: string;
  actorName: string;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  costUsd: number;
}

interface ApifyUsage {
  enabled: boolean;
  username: string | null;
  plan: string | null;
  monthlyUsageUsd: number;
  monthlyLimitUsd: number | null;
  recentRuns: ApifyRun[];
}

type LoadState = 'loading' | 'ready' | 'error';

const REFRESH_MS = 60_000;

/**
 * 顶部导航条上的 Apify 状态药丸。
 *
 * 三态：
 *   - 未配置 token       灰点 + 「Apify 未开」  → 跳 /settings/preferences#apify
 *   - 已用 >= 限额        红点 + 「额度用尽」
 *   - 正常                绿点 + 「$X.XX / $5.00」或「$X.XX」
 *
 * hover/click 展开 popover：用户名、套餐、本月用量、最近 5 次 run。
 * 每 60 秒静默刷新一次。
 */
export function ApifyStatusPill() {
  const [usage, setUsage] = useState<ApifyUsage | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 轮询拉取
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/apify/usage', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ApifyUsage;
        if (cancelled) return;
        setUsage(data);
        setState('ready');
      } catch {
        if (cancelled) return;
        setState('error');
      }
    }
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // 外部点击关闭
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

  // 派生 UI 状态
  const enabled = usage?.enabled === true;
  const monthlyUsage = usage?.monthlyUsageUsd ?? 0;
  const monthlyLimit = usage?.monthlyLimitUsd ?? null;
  const exhausted =
    enabled &&
    monthlyLimit !== null &&
    monthlyLimit > 0 &&
    monthlyUsage >= monthlyLimit;

  // 未配置：渲染成 Link，点击直接跳走，不需要 popover
  if (state === 'ready' && !enabled) {
    return (
      <Link
        href="/settings/preferences#apify"
        title="点击去配置 Apify token"
        style={pillStyle('muted')}
      >
        <span style={dotStyle('var(--text-muted)')} />
        <span style={labelStyle}>Apify 未开</span>
      </Link>
    );
  }

  // 颜色 & 文案
  let dotColor = 'var(--text-muted)';
  let label = '…';
  if (state === 'loading') {
    dotColor = 'var(--text-muted)';
    label = '…';
  } else if (state === 'error') {
    dotColor = 'var(--text-muted)';
    label = 'Apify ?';
  } else if (exhausted) {
    dotColor = '#dc2626';
    label = '额度用尽';
  } else if (enabled) {
    dotColor = '#16a34a';
    label =
      monthlyLimit !== null
        ? `${formatUsd(monthlyUsage)} / ${formatUsd(monthlyLimit)}`
        : formatUsd(monthlyUsage);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        title="Apify 用量"
        aria-label="Apify 用量"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          ...pillStyle(exhausted ? 'danger' : 'normal'),
          border: 'none',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        <span style={dotStyle(dotColor)} />
        <span style={labelStyle}>{label}</span>
      </button>

      {open && usage && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 50,
            width: 280,
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            fontSize: 12,
            color: 'var(--text)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 13 }}>
              {usage.username ?? '—'}
            </strong>
            <span style={{ color: 'var(--text-muted)' }}>
              {usage.plan ?? '—'}
            </span>
          </div>

          <div style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
            本月：
            <strong style={{ color: 'var(--text)' }}>
              {formatUsd(monthlyUsage)}
            </strong>
            {monthlyLimit !== null && (
              <> / {formatUsd(monthlyLimit)}</>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 8,
              marginBottom: 6,
              color: 'var(--text-muted)',
              fontSize: 11,
            }}
          >
            最近 5 次 run
          </div>
          {usage.recentRuns.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              暂无记录
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {usage.recentRuns.slice(0, 5).map((r) => (
                <li
                  key={r.runId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '4px 0',
                    borderBottom: '1px dashed var(--border)',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={r.actorName}
                  >
                    {r.actorName}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTime(r.startedAt)}
                  </span>
                  <span
                    style={{
                      width: 56,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatUsd(r.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/settings/preferences#apify"
            onClick={() => setOpen(false)}
            style={{
              display: 'block',
              marginTop: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              textAlign: 'right',
            }}
          >
            管理 token →
          </Link>
        </div>
      )}
    </div>
  );
}

// ---- 内部小工具 ----

function pillStyle(variant: 'normal' | 'danger' | 'muted'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    padding: '0 10px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1,
    textDecoration: 'none',
    maxWidth: 160,
  };
  if (variant === 'danger') {
    return { ...base, borderColor: '#dc2626', color: '#dc2626' };
  }
  if (variant === 'muted') {
    return { ...base, color: 'var(--text-muted)' };
  }
  return base;
}

function dotStyle(color: string): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  };
}

const labelStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
