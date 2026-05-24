'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ArticleRow {
  id: string;
  title: string | null;
  url: string;
  category: string | null;
  crawled_at: number;
  content_len: number;
}

interface ManualArticle {
  title: string;
  content: string;
}

interface OptimizeFlowProps {
  authorId: string;
  authorName: string;
  avatarChar: string;
  currentVersion: number;
  nextVersion: number;
  unusedArticles: ArticleRow[];
}

type Phase = 'idle' | 'streaming' | 'error';

interface ErrorState {
  message: string;
  detail?: string;
  sample?: string;
}

const MIN_CONTENT_CHARS = 100;
const MAX_TOTAL = 10;

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// SSE 解析器（与 fingerprints/new 一致的实现）
async function* readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!block.trim()) continue;
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      let data: unknown = dataLines.join('\n');
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        // ignore
      }
      yield { event, data };
    }
    if (done) {
      const tail = buffer + decoder.decode();
      if (tail.trim()) {
        const lines = tail.split('\n');
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) {
          let data: unknown = dataLines.join('\n');
          try {
            data = JSON.parse(dataLines.join('\n'));
          } catch {
            // ignore
          }
          yield { event, data };
        }
      }
      return;
    }
  }
}

export function OptimizeFlow({
  authorId,
  authorName,
  currentVersion,
  nextVersion,
  unusedArticles,
}: OptimizeFlowProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualArticles, setManualArticles] = useState<ManualArticle[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamText, setStreamText] = useState('');
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLDivElement>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight;
    }
  }, [streamText]);

  useEffect(() => {
    if (phase !== 'streaming') {
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
    }, 250);
    return () => {
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const totalSelected = selected.size;
  const validManual = manualArticles.filter(
    (m) => m.content.trim().length >= MIN_CONTENT_CHARS,
  );
  const totalChosen = totalSelected + validManual.length;
  const canSubmit = totalChosen >= 1 && totalChosen <= MAX_TOTAL && phase !== 'streaming';

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addManual = () => {
    if (manualArticles.length + totalSelected >= MAX_TOTAL) return;
    setManualArticles((prev) => [...prev, { title: '', content: '' }]);
  };
  const updateManual = (i: number, patch: Partial<ManualArticle>) => {
    setManualArticles((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const removeManual = (i: number) => {
    setManualArticles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setPhase('streaming');
    setStreamText('');
    setErrorState(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const payload = {
      articles: [
        ...Array.from(selected).map((id) => ({ crawled_article_id: id })),
        ...validManual.map((m) => ({
          title: m.title.trim() || undefined,
          content: m.content.trim(),
        })),
      ],
    };

    let res: Response;
    try {
      res = await fetch(`/api/authors/${authorId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (err) {
      setPhase('error');
      setErrorState({
        message: (err as Error).name === 'AbortError'
          ? '已中止这次优化'
          : '没连上后端，看看 dev server 还在跑吗',
      });
      return;
    }

    if (!res.ok || !res.body) {
      let serverMsg = '';
      try {
        const j = await res.json();
        serverMsg = j?.error || '';
      } catch {/* ignore */}
      setPhase('error');
      setErrorState({
        message: serverMsg || `后端这次没接住（HTTP ${res.status}）`,
      });
      return;
    }

    const reader = res.body.getReader();
    try {
      for await (const evt of readSseEvents(reader)) {
        if (ctrl.signal.aborted) break;
        if (evt.event === 'chunk') {
          const data = evt.data as { text?: string };
          if (typeof data?.text === 'string') {
            setStreamText((prev) => prev + data.text);
          }
        } else if (evt.event === 'done') {
          const data = evt.data as { fingerprint_id?: string };
          if (data?.fingerprint_id) {
            await new Promise((r) => setTimeout(r, 200));
            router.push(`/authors/${authorId}?tab=fingerprint`);
            return;
          }
        } else if (evt.event === 'error') {
          const data = evt.data as ErrorState;
          setPhase('error');
          setErrorState({
            message: data.message || '这次没成，换个角度再来',
            detail: data.detail,
            sample: data.sample,
          });
          return;
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) {
        setPhase('idle');
        return;
      }
      setPhase('error');
      setErrorState({
        message: '流式传输中途断了，再试一次',
        detail: (err as Error).message,
      });
    }
  }, [canSubmit, authorId, selected, validManual, router]);

  const handleAbort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
  };
  const handleRetry = () => {
    setErrorState(null);
    setPhase('idle');
  };

  // 按 category 分组未学习文章
  const groupedUnused = useMemo(() => {
    const map: Record<string, ArticleRow[]> = {};
    for (const a of unusedArticles) {
      const k = a.category || '未分类';
      if (!map[k]) map[k] = [];
      map[k].push(a);
    }
    return map;
  }, [unusedArticles]);

  if (phase === 'streaming') {
    return (
      <section className="streaming-layout">
        <div className="stream-output" ref={streamBoxRef}>
          {streamText ? (
            <span>
              {streamText}
              <span className="caret-blink" />
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              正在让模型对照 v{currentVersion} 读这一批新文。
              <br />
              第一字之前通常 3-5 秒静默
              <span className="caret-blink" />
            </span>
          )}
        </div>
        <aside className="stream-status">
          <div className="stream-status-head">
            <span className="pulse-dot pulse-soft" />
            <span>v{currentVersion} → v{nextVersion}</span>
          </div>
          <div className="stream-status-meta">
            <div>博主：{authorName}</div>
            <div>新增：{totalChosen} 篇</div>
            <div>已用时：{elapsed}s</div>
            <div>typical：40–80s</div>
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
    );
  }

  return (
    <section className="intake-form">
      {unusedArticles.length > 0 && (
        <div className="intake-row">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="intake-label">从「未学习」的爬取文章里挑</span>
            <span className="intake-hint">
              已选 {totalSelected} 篇 · 可选 {unusedArticles.length} 篇
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
            {Object.entries(groupedUnused).map(([cat, list]) => (
              <div key={cat}>
                <h4
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 15,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    margin: '0 0 8px',
                  }}
                >
                  {cat}
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {list.length}
                  </span>
                </h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {list.map((a) => {
                    const checked = selected.has(a.id);
                    return (
                      <li key={a.id}>
                        <label
                          className="card-compact"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 14px',
                            cursor: 'pointer',
                            borderColor: checked ? 'var(--accent)' : undefined,
                            background: checked ? 'var(--accent-soft)' : undefined,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(a.id)}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                          <span style={{ flex: 1, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.title || '（无标题）'}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {a.content_len} 字
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {formatDate(a.crawled_at)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {unusedArticles.length === 0 && (
        <div className="empty-state" style={{ marginTop: 0 }}>
          <p className="empty-state-title">这位博主暂时没有"待学习"的爬取文章</p>
          <p className="empty-state-desc">
            手贴几篇新文也行——下方手动粘贴文章一样能进入 v{nextVersion} 的优化流程。
          </p>
        </div>
      )}

      <div className="intake-row">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="intake-label">或者手贴几篇新文</span>
          <span className="intake-hint">
            {validManual.length}/{manualArticles.length} 篇满足 ≥ {MIN_CONTENT_CHARS} 字
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          {manualArticles.map((m, i) => {
            const len = m.content.trim().length;
            const ok = len >= MIN_CONTENT_CHARS;
            return (
              <div key={i} className="article-card">
                <div className="article-card-head">
                  <span className="article-card-idx">手贴 {String(i + 1).padStart(2, '0')}</span>
                  <div className="article-card-meta">
                    <span style={{ color: ok ? 'var(--success)' : 'var(--text-muted)' }}>
                      {len} 字
                    </span>
                    <button
                      type="button"
                      className="article-card-remove"
                      onClick={() => removeManual(i)}
                      aria-label="移除"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      <span>移除</span>
                    </button>
                  </div>
                </div>
                <input
                  className="intake-input"
                  placeholder="标题（可选）"
                  value={m.title}
                  onChange={(e) => updateManual(i, { title: e.target.value })}
                />
                <textarea
                  className="intake-textarea"
                  placeholder="把正文整段粘过来，至少 100 字"
                  value={m.content}
                  onChange={(e) => updateManual(i, { content: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="add-article-btn"
          onClick={addManual}
          disabled={manualArticles.length + totalSelected >= MAX_TOTAL}
          style={{ marginTop: 8 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>再贴一篇</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={canSubmit ? '' : `选 1-${MAX_TOTAL} 篇（已选 ${totalChosen} 篇）`}
        >
          开始优化（生成 v{nextVersion}）
          <span className="btn-arrow">→</span>
        </button>
        <span className="intake-hint">
          {canSubmit
            ? `准备好。一共 ${totalChosen} 篇加进 v${currentVersion} 一起重学。`
            : `至少选 1 篇 · 最多 ${MAX_TOTAL} 篇 · 当前 ${totalChosen} 篇`}
        </span>
      </div>

      {phase === 'error' && errorState && (
        <ErrorCard error={errorState} onRetry={handleRetry} />
      )}
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
        <span>这次模型卡住了，我们换个角度再试一次</span>
      </div>
      <p className="warm-error-desc">{error.message}</p>
      {error.detail && <pre className="warm-error-detail">{error.detail}</pre>}
      {error.sample && (
        <pre className="warm-error-detail">模型输出片段（前 280 字）：{'\n'}{error.sample}</pre>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          回到选择，重来一次
        </button>
      </div>
    </div>
  );
}
