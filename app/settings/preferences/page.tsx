'use client';

import { useCallback, useEffect, useState } from 'react';
import { HomeNav } from '@/components/nav/HomeNav';
import { useToastStore } from '@/stores/toast-store';
import { useThemeStore, type ThemeId } from '@/stores/theme-store';
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

const THEME_OPTIONS: Array<{ id: ThemeId; label: string; hint: string }> = [
  { id: 'B', label: 'B · 牛皮纸 · 朱砂', hint: '暖白底 + 朱砂点缀' },
  { id: 'C', label: 'C · 夜书房 · 鎏金', hint: '深色底 + 暖金高光' },
  { id: 'D', label: 'D · 极简 · 松石青', hint: '克制留白 + 松石青强调' },
];

/**
 * /settings/preferences · 全局偏好设置页（目前只承担"默认主题"）。
 *
 * 这里的"默认主题"≠ 浏览器顶部那个一键切换器。
 * 切换器改的是本机浏览器（localStorage），关掉无痕、换机器就丢。
 * 这一项写进 settings 表，决定新设备 / 无痕窗口首次进来时落在哪个主题。
 */
export default function PreferencesPage() {
  const showToast = useToastStore((s) => s.show);
  const currentTheme = useThemeStore((s) => s.theme);
  const setLocalTheme = useThemeStore((s) => s.setTheme);

  const [defaultTheme, setDefaultTheme] = useState<ThemeId>('D');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Apify 区块状态
  const [apifyToken, setApifyToken] = useState('');
  const [apifyTokenSaving, setApifyTokenSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [usage, setUsage] = useState<ApifyUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // 进入页面：去后端取一份当前 settings，把"默认主题"填进下拉。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Record<string, string>;
        if (cancelled) return;
        const v = data.default_theme;
        if (v === 'B' || v === 'C' || v === 'D') {
          setDefaultTheme(v);
        }
      } catch (err) {
        if (!cancelled) {
          showToast(`读取偏好失败：${(err as Error).message}`, 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'default_theme', value: defaultTheme }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      showToast(
        '已保存。下次新设备 / 无痕模式打开时会用这个主题。',
        'success',
      );
    } catch (err) {
      showToast(`保存失败：${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // 拉一次 Apify 用量（保存后也复用）
  const reloadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch('/api/apify/usage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApifyUsage;
      setUsage(data);
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadUsage();
  }, [reloadUsage]);

  async function handleSaveApifyToken(e: React.FormEvent) {
    e.preventDefault();
    if (apifyTokenSaving) return;
    setApifyTokenSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'apify_token', value: apifyToken }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      showToast('Apify token 已更新，下次爬取生效', 'success');
      setApifyToken('');
      // 重新拉一次用量，确认 token 生效
      void reloadUsage();
    } catch (err) {
      showToast(`保存失败：${(err as Error).message}`, 'error');
    } finally {
      setApifyTokenSaving(false);
    }
  }

  // 让"预览一下"按钮把本机主题也临时切过去——用户更直观。
  function handlePreview() {
    setLocalTheme(defaultTheme);
    showToast(
      `已临时切到 ${defaultTheme}。仅本浏览器生效，不影响默认主题。`,
      'info',
    );
  }

  return (
    <>
      <HomeNav />

      <main className="container" style={{ paddingTop: 64, paddingBottom: 96 }}>
        <div style={{ marginBottom: 32 }}>
          <h1 className="section-title" style={{ marginBottom: 8 }}>
            偏好设置
          </h1>
          <p className="section-subtitle">
            决定新设备、无痕窗口、清缓存后第一次打开时的初始外观。
          </p>
        </div>

        <form
          onSubmit={handleSave}
          style={{
            maxWidth: 560,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            padding: 24,
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
          }}
        >
          <div>
            <label
              htmlFor="default-theme"
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              默认主题
            </label>
            <select
              id="default-theme"
              value={defaultTheme}
              disabled={loading || saving}
              onChange={(e) => setDefaultTheme(e.target.value as ThemeId)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            >
              {THEME_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                marginTop: 6,
                lineHeight: 1.6,
              }}
            >
              {THEME_OPTIONS.find((o) => o.id === defaultTheme)?.hint}
              <br />
              本机当前正在显示：<strong>{currentTheme}</strong>
              （由顶部主题切换器控制，与默认主题独立）。
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handlePreview}
              disabled={loading}
            >
              在本机预览
            </button>
          </div>
        </form>

        {/* === Apify 接入 === */}
        <section
          id="apify"
          style={{
            maxWidth: 560,
            marginTop: 32,
            padding: 24,
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
            scrollMarginTop: 80,
          }}
        >
          <h2
            style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 4 }}
          >
            Apify 接入
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              margin: 0,
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            填入 Apify Personal API Token，用于云端爬取知乎 / B 站 / 公众号 / 小红书。
            免费账户每月 $5 额度。
          </p>

          <form
            onSubmit={handleSaveApifyToken}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <label
                htmlFor="apify-token"
                style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                APIFY_TOKEN
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="apify-token"
                  type={showToken ? 'text' : 'password'}
                  value={apifyToken}
                  onChange={(e) => setApifyToken(e.target.value)}
                  placeholder="apify_api_xxx"
                  autoComplete="off"
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    fontSize: 14,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowToken((v) => !v)}
                >
                  {showToken ? '隐藏' : '显示'}
                </button>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginTop: 6,
                  lineHeight: 1.6,
                }}
              >
                出于安全，token 不会回显当前值。留空保存等于不变。
              </p>
            </div>

            <div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={apifyTokenSaving || apifyToken.length === 0}
              >
                {apifyTokenSaving ? '保存中…' : '保存 token'}
              </button>
            </div>
          </form>

          {/* 用量明细 */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 20,
              borderTop: '1px solid var(--border)',
            }}
          >
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                margin: 0,
                marginBottom: 12,
              }}
            >
              当前用量
            </h3>

            {usageLoading ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                加载中…
              </p>
            ) : !usage || !usage.enabled ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                未配置 token，或 token 无效。保存后会自动刷新。
              </p>
            ) : (
              <ApifyUsageDetail usage={usage} />
            )}
          </div>
        </section>
      </main>
    </>
  );
}

/**
 * 把 Apify 用量详情拆出来：账户信息 + 进度条 + 最近 10 次 run 表格。
 */
function ApifyUsageDetail({ usage }: { usage: ApifyUsage }) {
  const { username, plan, monthlyUsageUsd, monthlyLimitUsd, recentRuns } =
    usage;
  const percent =
    monthlyLimitUsd && monthlyLimitUsd > 0
      ? Math.min(100, (monthlyUsageUsd / monthlyLimitUsd) * 100)
      : 0;
  const exhausted =
    monthlyLimitUsd !== null &&
    monthlyLimitUsd > 0 &&
    monthlyUsageUsd >= monthlyLimitUsd;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
        }}
      >
        <span>
          账户：<strong>{username ?? '—'}</strong>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          套餐：{plan ?? '—'}
        </span>
      </div>

      {monthlyLimitUsd !== null && monthlyLimitUsd > 0 ? (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--text-muted)',
              marginBottom: 6,
            }}
          >
            <span>本月用量</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatUsd(monthlyUsageUsd)} / {formatUsd(monthlyLimitUsd)}
              {' '}({percent.toFixed(1)}%)
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 8,
              borderRadius: 999,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: '100%',
                background: exhausted ? '#dc2626' : '#16a34a',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13 }}>
          本月用量：<strong>{formatUsd(monthlyUsageUsd)}</strong>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
            (无上限)
          </span>
        </div>
      )}

      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          最近 10 次 run
        </div>
        {recentRuns.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            还没有 run 记录。
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th style={thStyle}>时间</th>
                  <th style={thStyle}>Actor</th>
                  <th style={thStyle}>状态</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>成本</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.slice(0, 10).map((r) => (
                  <tr
                    key={r.runId}
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <td style={tdStyle}>{formatRunTime(r.startedAt)}</td>
                    <td
                      style={{
                        ...tdStyle,
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={r.actorName}
                    >
                      {r.actorName}
                    </td>
                    <td style={tdStyle}>
                      <span style={runStatusStyle(r.status)}>{r.status}</span>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatUsd(r.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  padding: '6px 8px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px',
  fontSize: 12,
};

function runStatusStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
  };
  const s = status.toUpperCase();
  if (s === 'SUCCEEDED') {
    return { ...base, background: 'rgba(22,163,74,0.12)', color: '#16a34a' };
  }
  if (s === 'FAILED' || s === 'ABORTED' || s === 'TIMED-OUT') {
    return { ...base, background: 'rgba(220,38,38,0.12)', color: '#dc2626' };
  }
  if (s === 'RUNNING' || s === 'READY') {
    return { ...base, background: 'rgba(59,130,246,0.12)', color: '#3b82f6' };
  }
  return {
    ...base,
    background: 'var(--border)',
    color: 'var(--text-muted)',
  };
}

function formatRunTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
