'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SampleMeta {
  url: string;
  title: string | null;
  added_at_label: string;
  iteration: number;
}

interface Props {
  siteId: string;
  sourceUrl: string | null;
  iterationCount: number;
  samples: SampleMeta[];
}

interface PatchResponse {
  newly_added_count: number;
  skipped_count: number;
  skipped_samples?: { url: string; existing_title: string | null }[];
  failed?: { url: string; reason: string }[];
  total_samples: number;
  iteration?: number;
  reextracted: boolean;
  message?: string;
}

/**
 * 站点详情页底部面板：
 * 1. 列出已有样本（精简版表格）
 * 2. 「从原 URL 再爬」按钮（仅在有 source_url 时显示）
 * 3. 「手贴额外 URL」文本框 + 提交
 * 4. 每次操作后展示结果摘要（新增几篇 / 跳过几篇 / 失败几篇）
 */
export function AddSamplesPanel({ siteId, sourceUrl, iterationCount, samples }: Props) {
  const router = useRouter();
  const [pasted, setPasted] = useState('');
  const [phase, setPhase] = useState<'idle' | 'fetching'>('idle');
  const [report, setReport] = useState<PatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllSamples, setShowAllSamples] = useState(false);

  const visibleSamples = showAllSamples ? samples : samples.slice(0, 5);

  const submit = async (mode: 'recrawl' | 'paste') => {
    const article_urls =
      mode === 'paste'
        ? pasted
            .split(/[\n\s]+/)
            .map((s) => s.trim())
            .filter((s) => /^https?:\/\//i.test(s))
        : [];

    if (mode === 'paste' && article_urls.length === 0) {
      setError('粘的 URL 一个都没识别出来，看看是不是格式不对');
      return;
    }

    setPhase('fetching');
    setError(null);
    setReport(null);

    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, article_urls }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setReport(json as PatchResponse);
      if ((json as PatchResponse).reextracted) {
        setPasted('');
        // 触发 server component 重新拉数据
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  return (
    <section className="add-samples-panel">
      <header className="add-samples-head">
        <h2 className="fp-grid-section-title" style={{ marginBottom: 4 }}>
          扩充样本 · 重提炼画像
        </h2>
        <p className="fp-grid-section-sub" style={{ marginBottom: 0 }}>
          已迭代 {iterationCount} 轮 · 当前累计 {samples.length} 篇样本。新加进来的会跟历史样本一起重提炼，越加越准。
        </p>
      </header>

      {samples.length > 0 && (
        <div className="add-samples-list">
          <div className="add-samples-list-head">
            <span>已分析的样本</span>
            {samples.length > 5 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setShowAllSamples((v) => !v)}
              >
                {showAllSamples ? '收起' : `展开全部 ${samples.length} 篇`}
              </button>
            )}
          </div>
          <ul>
            {visibleSamples.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="add-samples-row">
                  <span className="add-samples-title">{s.title?.trim() || s.url}</span>
                  <span className="add-samples-iter">第 {s.iteration} 轮 · {s.added_at_label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="add-samples-actions">
        {sourceUrl && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => submit('recrawl')}
            disabled={phase === 'fetching'}
            title={`从 ${sourceUrl} 再爬一次，自动跳过已分析过的`}
          >
            {phase === 'fetching' ? '正在拉新文章…' : '从原 URL 再爬一遍'}
          </button>
        )}
        <div className="add-samples-paste">
          <label className="add-samples-paste-label">手贴额外 URL（一行一个）：</label>
          <textarea
            className="intake-input"
            rows={3}
            placeholder="https://www.woshipm.com/ai/xxxxxx.html"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={phase === 'fetching'}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit('paste')}
            disabled={phase === 'fetching' || pasted.trim().length === 0}
          >
            {phase === 'fetching' ? '正在处理…' : '加这些 URL 并重提炼'}
          </button>
        </div>
      </div>

      {error && (
        <div className="add-samples-feedback add-samples-feedback-error">
          <strong>这次没成：</strong>{error}
        </div>
      )}

      {report && (
        <div className="add-samples-feedback">
          <p className="add-samples-feedback-headline">
            {report.newly_added_count > 0
              ? `新加 ${report.newly_added_count} 篇 · 跳过 ${report.skipped_count} 篇 · ${
                  report.reextracted ? `画像已迭代到第 ${report.iteration ?? '?'} 轮` : '画像未变'
                }`
              : `没新增样本 · 跳过 ${report.skipped_count} 篇 · 失败 ${report.failed?.length ?? 0} 篇`}
          </p>
          {report.message && <p className="add-samples-feedback-msg">{report.message}</p>}
          {report.skipped_samples && report.skipped_samples.length > 0 && (
            <details className="add-samples-feedback-detail">
              <summary>已分析过的 {report.skipped_samples.length} 篇（跳过详情）</summary>
              <ul>
                {report.skipped_samples.map((s) => (
                  <li key={s.url}>
                    {s.existing_title?.trim() || s.url}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {report.failed && report.failed.length > 0 && (
            <details className="add-samples-feedback-detail">
              <summary>{report.failed.length} 篇没爬到</summary>
              <ul>
                {report.failed.map((f) => (
                  <li key={f.url}>
                    {f.url} · {f.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
