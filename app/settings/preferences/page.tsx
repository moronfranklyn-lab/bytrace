'use client';

import { useCallback, useEffect, useState } from 'react';
import { HomeNav } from '@/components/nav/HomeNav';
import { useToastStore } from '@/stores/toast-store';
import { useThemeStore, type ThemeId } from '@/stores/theme-store';

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
      </main>
    </>
  );
}
