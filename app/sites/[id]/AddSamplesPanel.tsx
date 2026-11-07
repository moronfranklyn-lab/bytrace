'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SampleMeta {
  url: string;
  title: string | null;
  added_at_label: string;
  publish_time_label?: string | null;
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
  newly_added?: { title: string | null; url: string; publish_time: string | null }[];
  total_samples: number;
  max_new_per_round?: number;
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [activeJob, setActiveJob] = useState<{ mode: 'recrawl' | 'paste'; urlCount: number } | null>(null);

  const visibleSamples = showAllSamples ? samples : samples.slice(0, 5);
  const progress = useMemo(() => {
    if (phase !== 'fetching') return 0;
    // 这是长任务的“体感进度”：抓取 + 重提炼无法从旧 PATCH 接口拿真实阶段，先让用户看到还活着。
    // 30s 到 70%，90s 到 90%，最后等服务端返回再直接完成。
    return Math.min(92, 8 + Math.floor(elapsedSec * 1.15));
  }, [elapsedSec, phase]);
  const progressText = useMemo(() => {
    if (!activeJob) return '准备开始…';
    if (elapsedSec < 4) return activeJob.mode === 'recrawl' ? '正在按时间线查找最近一个月的文章…' : `已收到 ${activeJob.urlCount} 个 URL，正在逐篇抓取…`;
    if (elapsedSec < 18) return '正在抽正文、发布时间、去重并保存样本…';
    if (elapsedSec < 45) return '正在合并历史样本并重提炼站点画像…';
    if (elapsedSec < 90) return '模型还在工作，长文章/多 URL 会慢一点，请别关页面…';
    return '仍在等待服务端返回，通常是爬取站点慢或模型输出较长…';
  }, [activeJob, elapsedSec]);

  useEffect(() => {
    if (phase !== 'fetching' || !startedAt) return;
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [phase, startedAt]);

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
    setStartedAt(Date.now());
    setElapsedSec(0);
    setActiveJob({ mode, urlCount: mode === 'paste' ? article_urls.length : 0 });
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
      setStartedAt(null);
      setActiveJob(null);
    }
  };

  return (
    <section className="add-samples-panel">
      <header className="add-samples-head">
        <h2 className="fp-grid-section-title" style={{ marginBottom: 4 }}>
          扩充样本 · 重提炼画像
        </h2>
        <p className="fp-grid-section-sub" style={{ marginBottom: 0 }}>
          已迭代 {iterationCount} 轮 · 当前累计 {samples.length} 篇样本。从原 URL 再爬时按时间线抓最近一个月文章；新加进来的会跟历史样本一起重提炼。
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
                  <span className="add-samples-iter">
                    第 {s.iteration} 轮 · {s.publish_time_label ? `写于 ${s.publish_time_label}` : '写作时间未知'} · 抓于 {s.added_at_label}
                  </span>
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

      {phase === 'fetching' && (
        <div className="add-samples-progress" role="status" aria-live="polite">
          <div className="add-samples-progress-top">
            <strong>{progressText}</strong>
            <span>{elapsedSec}s · {progress}%</span>
          </div>
          <div className="add-samples-progress-track">
            <div className="add-samples-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p>当前步骤没有逐条日志接口，所以这里显示体感进度；只要秒数还在走，就不是卡死。</p>
        </div>
      )}

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
          {report.newly_added && report.newly_added.length > 0 && (
            <details className="add-samples-feedback-detail" open>
              <summary>本轮抓到的 {report.newly_added.length} 篇（含写作时间）</summary>
              <ul>
                {report.newly_added.map((a) => (
                  <li key={a.url}>
                    {a.title?.trim() || a.url} · {a.publish_time ? `写于 ${a.publish_time}` : '写作时间未知'}
                  </li>
                ))}
              </ul>
            </details>
          )}
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
