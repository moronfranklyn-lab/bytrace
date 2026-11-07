'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';

type Phase = 'idle' | 'crawling' | 'extracting' | 'done' | 'error';

interface ErrorState {
  message: string;
  detail?: string;
}

interface ProfileResult {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  source_article_count: number | null;
  failed_count: number;
  profile: {
    site_name?: string;
    section?: string;
    url_pattern?: string;
    preferred_topics?: string[];
    title_patterns?: string[];
    word_count_range?: [number, number];
    image_density?: string;
    opening_pattern?: string;
    closing_pattern?: string;
    tone?: string;
    key_phrases?: string[];
  };
}

export default function NewSiteProfilePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [section, setSection] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== 'crawling' && phase !== 'extracting') {
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      return;
    }
    const t0 = Date.now();
    setElapsed(0);
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => {
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [phase]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const canSubmit = url.trim().length > 0 && phase !== 'crawling' && phase !== 'extracting';

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setPhase('crawling');
    setErrorState(null);
    setResult(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 切到 extracting 状态的最早触发：从一个 setTimeout 在 5s 后切换文案
    const phaseTimer = window.setTimeout(() => {
      setPhase((p) => (p === 'crawling' ? 'extracting' : p));
    }, 8_000);

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          section: section.trim() || undefined,
        }),
        signal: ctrl.signal,
      });
      window.clearTimeout(phaseTimer);

      if (!res.ok) {
        let msg = '';
        try {
          const j = await res.json();
          msg = j?.error || '';
        } catch {
          // ignore
        }
        setPhase('error');
        setErrorState({
          message: msg || `后端这次没接住（HTTP ${res.status}）`,
        });
        return;
      }

      const data = (await res.json()) as ProfileResult;
      setResult(data);
      setPhase('done');
    } catch (err) {
      window.clearTimeout(phaseTimer);
      if ((err as Error).name === 'AbortError') {
        setPhase('idle');
        return;
      }
      setPhase('error');
      setErrorState({
        message: '没连上后端，看看 dev server 还在跑吗',
        detail: (err as Error).message,
      });
    }
  }, [url, section, canSubmit]);

  const handleAbort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
  };

  const handleRetry = () => {
    setErrorState(null);
    setPhase('idle');
  };

  return (
    <>
      <HomeNav activePath="/sites" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 880 }}>
        <header style={{ marginBottom: 32 }}>
          <h1 className="hero-title" style={{ fontSize: 38, margin: '0 0 12px' }}>
            扩充<em>站点画像</em>
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15 }}>
            给一个站点/板块的 URL，工具会爬最近 5-10 篇文章，提炼出"这个板块发文偏好"
            ——典型字数、标题套路、配图密度、收尾方式。下次生成会按画像调引导语。
          </p>
        </header>

        {phase !== 'done' && (
          <section className="intake-form">
            <div className="intake-row">
              <label className="intake-label" htmlFor="site-url">板块或作者主页 URL</label>
              <input
                id="site-url"
                className="intake-input"
                placeholder="比如：https://sspai.com/matrix · https://www.zhihu.com/people/xxx"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                disabled={phase === 'crawling' || phase === 'extracting'}
              />
              <span className="intake-hint">
                目前支持少数派、知乎、优设、人人都是产品经理。公众号反爬较硬，工具不爬。
              </span>
            </div>

            <div className="intake-row">
              <label className="intake-label" htmlFor="site-section">板块名（选填）</label>
              <input
                id="site-section"
                className="intake-input"
                placeholder="比如：效率板块、科技专栏"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                autoComplete="off"
                disabled={phase === 'crawling' || phase === 'extracting'}
              />
              <span className="intake-hint">
                同一站点不同板块编辑偏好差异很大。记一下，方便回头查。
              </span>
            </div>

            {phase === 'idle' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                >
                  开始爬取并提取画像
                  <span className="btn-arrow">→</span>
                </button>
                <span className="intake-hint">约 1.5–2 分钟。整个过程不会发到任何远程服务，只本地跑。</span>
              </div>
            )}

            {(phase === 'crawling' || phase === 'extracting') && (
              <section className="streaming-layout" style={{ marginTop: 12 }}>
                <div className="stream-output" style={{ minHeight: 180 }}>
                  {phase === 'crawling' ? (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      正在爬最近 5–10 篇文章。同站点的请求会间隔 1 秒发出，避免被站点拦截。
                      <br />
                      <br />
                      第一篇通常 2-5 秒；如果是知乎，可能要再等一下网页 JS 渲染。
                      <span className="caret-blink" />
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      爬完了。现在让模型读这一批文章，提炼这个板块的"发文偏好"。
                      <br />
                      <br />
                      模型会拢一下：典型字数、标题套路、开篇方式、收尾方式、配图密度、整体基调。
                      <span className="caret-blink" />
                    </span>
                  )}
                </div>
                <aside className="stream-status">
                  <div className="stream-status-head">
                    <span className="pulse-dot pulse-soft" />
                    <span>{phase === 'crawling' ? '爬取中' : '提炼画像中'}</span>
                  </div>
                  <div className="stream-status-meta">
                    <div>站点：{(() => { try { return new URL(url).hostname; } catch { return url; } })()}</div>
                    {section && <div>板块：{section}</div>}
                    <div>已用时：{elapsed}s</div>
                    <div>typical：90–120s</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAbort}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    中止
                  </button>
                </aside>
              </section>
            )}

            {phase === 'error' && errorState && (
              <ErrorCard error={errorState} onRetry={handleRetry} />
            )}
          </section>
        )}

        {phase === 'done' && result && (
          <ResultCard result={result} onView={() => router.push(`/sites/${result.id}`)} />
        )}
      </main>
    </>
  );
}

function ResultCard({
  result,
  onView,
}: {
  result: ProfileResult;
  onView: () => void;
}) {
  const p = result.profile;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="dna-card">
        <div className="dna-eyebrow">站点画像 · 提取完成</div>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            fontWeight: 500,
            color: 'var(--text)',
            margin: '8px 0',
          }}
        >
          {p.site_name || result.site_name}
          {p.section && <span style={{ color: 'var(--text-tertiary)', fontSize: 16, marginLeft: 8 }}>· {p.section}</span>}
        </h2>
        {p.tone && <p className="dna-summary">{p.tone}</p>}
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap', marginTop: 6 }}>
          <span>样本 {result.source_article_count} 篇</span>
          {result.failed_count > 0 && <span>· {result.failed_count} 篇没爬动（跳过）</span>}
          {p.url_pattern && <span>· {p.url_pattern}</span>}
        </div>
      </div>

      <div className="fp-grid">
        <article className="fp-quadrant" data-tint="topic">
          <div className="fp-q-head">
            <h3 className="fp-q-title">题材偏好</h3>
            <span className="fp-q-eyebrow">TOPIC</span>
          </div>
          <div className="fp-q-row">
            <span className="fp-q-label">关键词</span>
            {p.preferred_topics?.length ? (
              <div className="fp-tics">
                {p.preferred_topics.map((t, i) => (
                  <span key={i} className="fp-tic">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <span className="fp-q-value">—</span>
            )}
          </div>
          <div className="fp-q-row">
            <span className="fp-q-label">高频短语</span>
            {p.key_phrases?.length ? (
              <div className="fp-tics">
                {p.key_phrases.slice(0, 6).map((t, i) => (
                  <span key={i} className="fp-tic">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <span className="fp-q-value">—</span>
            )}
          </div>
        </article>

        <article className="fp-quadrant" data-tint="structure">
          <div className="fp-q-head">
            <h3 className="fp-q-title">结构套路</h3>
            <span className="fp-q-eyebrow">STRUCTURE</span>
          </div>
          <div className="fp-q-row">
            <span className="fp-q-label">开篇</span>
            <span className="fp-q-value">{p.opening_pattern || '—'}</span>
          </div>
          <div className="fp-q-row">
            <span className="fp-q-label">收尾</span>
            <span className="fp-q-value">{p.closing_pattern || '—'}</span>
          </div>
        </article>

        <article className="fp-quadrant" data-tint="language">
          <div className="fp-q-head">
            <h3 className="fp-q-title">标题模板</h3>
            <span className="fp-q-eyebrow">TITLE PATTERNS</span>
          </div>
          {p.title_patterns?.length ? (
            <ul className="do-dont-list" style={{ marginTop: 4 }}>
              {p.title_patterns.map((t, i) => (
                <li key={i} className="do-dont-item" style={{ paddingLeft: 0 }}>
                  <span style={{ color: 'var(--text-tertiary)', minWidth: 16, fontFamily: 'var(--font-mono)' }}>{i + 1}.</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>—</p>
          )}
        </article>

        <article className="fp-quadrant" data-tint="visual">
          <div className="fp-q-head">
            <h3 className="fp-q-title">字数与配图</h3>
            <span className="fp-q-eyebrow">VISUAL</span>
          </div>
          <div className="fp-q-row">
            <span className="fp-q-label">字数</span>
            <span className="fp-q-value">
              {p.word_count_range ? `${p.word_count_range[0]}–${p.word_count_range[1]} 字` : '—'}
            </span>
          </div>
          <div className="fp-q-row">
            <span className="fp-q-label">配图密度</span>
            <span className="fp-q-value">{p.image_density || '—'}</span>
          </div>
        </article>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" className="btn btn-primary" onClick={onView}>
          查看完整画像
          <span className="btn-arrow">→</span>
        </button>
      </div>
    </section>
  );
}

function ErrorCard({ error, onRetry }: { error: ErrorState; onRetry: () => void }) {
  return (
    <div className="warm-error" role="alert">
      <div className="warm-error-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--error)' }}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>这次没成。换个角度再来一次。</span>
      </div>
      <p className="warm-error-desc">{error.message}</p>
      {error.detail && <pre className="warm-error-detail">{error.detail}</pre>}
      <p className="warm-error-desc" style={{ marginTop: 8 }}>
        如果是公众号或反爬太硬的站点，可以直接去博主页面手贴几篇文章建指纹——那条路一直走得通。
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          回到输入，换个 URL
        </button>
      </div>
    </div>
  );
}
