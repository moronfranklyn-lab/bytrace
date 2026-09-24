'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SampleMeta {
  url: string | null;
  title: string | null;
  added_at_label: string;
  iteration: number;
  source_mode: string;
  platform: string | null;
  primary_category: string | null;
  category_confidence: string | null;
}

interface Props {
  fingerprintId: string;
  iterationCount: number;
  samples: SampleMeta[];
}

interface PatchResponse {
  newly_added_count: number;
  skipped_count: number;
  skipped?: { url: string | null; reason: string }[];
  failed?: { url: string | null; reason: string }[];
  total_samples: number;
  iteration?: number;
  reextracted: boolean;
  platforms_analyzed?: string[];
  strategy_count?: number;
  message?: string;
  error?: string;
}

/**
 * 博主指纹「加样本 · 重提炼」面板。
 *
 * 行为：
 * 1. 列出已分析过的样本（前 5 条预览，可展开）
 * 2. textarea 多行粘贴 URL（一行一个）→ PATCH /api/fingerprint/v3/:id
 * 3. 显示「新增 X 篇 · 跳过 Y 篇 · 已迭代到第 N 轮」反馈
 * 4. 成功后 router.refresh() 让 server 组件重拉
 */
export function AddFingerprintSamplesPanel({ fingerprintId, iterationCount, samples }: Props) {
  const router = useRouter();
  const [pasted, setPasted] = useState('');
  const [authorUrl, setAuthorUrl] = useState('');
  const [phase, setPhase] = useState<'idle' | 'fetching'>('idle');
  const [report, setReport] = useState<PatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [activeUrlCount, setActiveUrlCount] = useState(0);
  const [activeMode, setActiveMode] = useState<'paste' | 'author'>('paste');

  const visible = showAll ? samples : samples.slice(0, 5);
  const progress = useMemo(() => {
    if (phase !== 'fetching') return 0;
    // 旧 PATCH 接口没有真实分阶段事件：用体感进度避免用户误以为卡死。
    // 指纹重提炼一般更慢，进度最多停在 92%，等服务端返回后再完成。
    return Math.min(92, 6 + Math.floor(elapsedSec * 0.95));
  }, [elapsedSec, phase]);
  const progressText = useMemo(() => {
    if (activeMode === 'author') {
      if (elapsedSec < 4) return '正在读取作者主页，自动发现文章列表…';
      if (elapsedSec < 18) return '正在按时间线逐篇抓正文，自动跳过已分析过的文章…';
    } else if (elapsedSec < 4) {
      return `已收到 ${activeUrlCount} 个 URL，正在逐篇抓取正文…`;
    }
    if (elapsedSec < 18) return '正在清洗正文、分类、写入样本库…';
    if (elapsedSec < 45) return '正在跑 stage1：抽取写作策略和结构习惯…';
    if (elapsedSec < 80) return '正在跑 stage2/stage3：合成指纹、修复 JSON、生成类别画像…';
    return '仍在等待模型完成。样本多或文章长时可能超过 2 分钟，只要秒数还在走就没卡死。';
  }, [activeMode, activeUrlCount, elapsedSec]);

  useEffect(() => {
    if (phase !== 'fetching' || !startedAt) return;
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [phase, startedAt]);

  // 按 host 推断 platform（跟 fingerprints/new 保持一致）
  const inferPlatformFromUrl = (url: string): string => {
    try {
      const h = new URL(url).hostname;
      if (/zhihu\.com$/i.test(h)) return 'zhihu';
      if (/sspai\.com$/i.test(h)) return 'sspai';
      if (/uisdc\.com$/i.test(h)) return 'uisdc';
      if (/woshipm\.com$/i.test(h)) return 'wechat';
      if (/(bilibili\.com|b23\.tv)$/i.test(h)) return 'bilibili';
      if (/(youtube\.com|youtu\.be)$/i.test(h)) return 'youtube';
      if (/xiaohongshu\.com$/i.test(h)) return 'xhs';
      if (/douyin\.com$/i.test(h)) return 'douyin';
    } catch {/* ignore */}
    return 'wechat';
  };

  const submit = async (mode: 'paste' | 'author' = 'paste') => {
    const urls = pasted
      .split(/[\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    const cleanAuthorUrl = authorUrl.trim();
    if (mode === 'paste' && urls.length === 0) {
      setError('粘的 URL 一个都没识别出来，看看格式');
      return;
    }
    if (mode === 'author' && !/^https?:\/\//i.test(cleanAuthorUrl)) {
      setError('作者主页 URL 格式不对，需要以 http:// 或 https:// 开头');
      return;
    }
    setPhase('fetching');
    setStartedAt(Date.now());
    setElapsedSec(0);
    setActiveUrlCount(mode === 'paste' ? urls.length : 0);
    setActiveMode(mode);
    setError(null);
    setReport(null);

    try {
      const res = await fetch(`/api/fingerprint/v3/${fingerprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'author'
          ? { author_url: cleanAuthorUrl }
          : {
              articles: urls.map((url) => ({
                mode: 'url' as const,
                url,
                platform: inferPlatformFromUrl(url),
              })),
            }),
      });
      const json = (await res.json().catch(() => null)) as PatchResponse | null;
      if (!res.ok) {
        throw new Error(json?.error ?? json?.message ?? `HTTP ${res.status}`);
      }
      if (!json) throw new Error('响应空');
      setReport(json);
      if (json.reextracted) {
        setPasted('');
        if (mode === 'author') setAuthorUrl('');
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase('idle');
      setStartedAt(null);
      setActiveUrlCount(0);
    }
  };

  return (
    <section className="add-samples-panel" style={{ marginTop: 36 }}>
      <header className="add-samples-head">
        <h2 className="fp-grid-section-title" style={{ marginBottom: 4 }}>
          扩充样本 · 重提炼指纹
        </h2>
        <p className="fp-grid-section-sub" style={{ marginBottom: 0 }}>
          已迭代 {iterationCount} 轮 · 当前累计 {samples.length} 篇样本。新加的会跟历史样本一起重跑 stage1+stage2+stage3，越加越准（上限 20 篇）。
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
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? '收起' : `展开全部 ${samples.length} 篇`}
              </button>
            )}
          </div>
          <ul>
            {visible.map((s) => {
              const catChip = s.primary_category ? (
                <span
                  className="tag"
                  style={{
                    marginRight: 6,
                    fontWeight: s.category_confidence === 'high' ? 600 : 400,
                    opacity: s.category_confidence === 'low' ? 0.55 : 1,
                  }}
                  title={s.category_confidence ? `置信度 ${s.category_confidence}` : undefined}
                >
                  {s.primary_category}
                </span>
              ) : (
                <span className="tag" style={{ marginRight: 6, opacity: 0.5 }}>未分类</span>
              );
              return (
                <li key={(s.url ?? '') + s.added_at_label}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="add-samples-row">
                      <span className="add-samples-title">
                        {catChip}
                        {s.title?.trim() || s.url}
                      </span>
                      <span className="add-samples-iter">第 {s.iteration} 轮 · {s.source_mode === 'paste' ? '手贴' : s.platform || ''} · {s.added_at_label}</span>
                    </a>
                  ) : (
                    <div className="add-samples-row">
                      <span className="add-samples-title">
                        {catChip}
                        {s.title?.trim() || '（手贴样本）'}
                      </span>
                      <span className="add-samples-iter">第 {s.iteration} 轮 · 手贴 · {s.added_at_label}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="add-samples-actions">
        <div className="add-samples-paste">
          <label className="add-samples-paste-label">作者主页 / 专栏 URL（自动扒最近文章）：</label>
          <input
            className="intake-input"
            placeholder="https://www.woshipm.com/u/12345 或作者主页/专栏页"
            value={authorUrl}
            onChange={(e) => setAuthorUrl(e.target.value)}
            disabled={phase === 'fetching'}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => submit('author')}
            disabled={phase === 'fetching' || authorUrl.trim().length === 0}
          >
            {phase === 'fetching' && activeMode === 'author'
              ? '正在自动扒作者文章…'
              : '自动扒作者文章并重提炼'}
          </button>
        </div>
        <div className="add-samples-paste">
          <label className="add-samples-paste-label">手贴额外 URL（一行一个），自动按域名推断 platform：</label>
          <textarea
            className="intake-input"
            rows={3}
            placeholder={'https://www.woshipm.com/ai/xxxxxx.html\nhttps://sspai.com/post/12345'}
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
            {phase === 'fetching' && activeMode === 'paste' ? '正在抓取并重跑三阶段提炼…（可能 30s~2 分钟）' : '加这些 URL 并重提炼'}
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
          <p>正在抓取 + 重跑三阶段提炼。这里显示体感进度；服务端完成后会自动刷新结果。</p>
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
                  report.reextracted
                    ? `指纹已迭代到第 ${report.iteration ?? '?'} 轮`
                    : '提炼失败但样本已存（看 error）'
                }`
              : `没新增样本 · 跳过 ${report.skipped_count} 篇 · 失败 ${report.failed?.length ?? 0} 篇`}
          </p>
          {report.message && <p className="add-samples-feedback-msg">{report.message}</p>}
          {report.error && <p className="add-samples-feedback-msg">{report.error}</p>}
          {report.skipped && report.skipped.length > 0 && (
            <details className="add-samples-feedback-detail">
              <summary>已分析过的 {report.skipped.length} 篇（跳过详情）</summary>
              <ul>
                {report.skipped.map((s, i) => (
                  <li key={i}>{s.url || '(无 URL)'} · {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
          {report.failed && report.failed.length > 0 && (
            <details className="add-samples-feedback-detail">
              <summary>{report.failed.length} 篇没爬到</summary>
              <ul>
                {report.failed.map((f, i) => (
                  <li key={i}>{f.url || '(无 URL)'} · {f.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
