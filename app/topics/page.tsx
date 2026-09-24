'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeNav } from '@/components/nav/HomeNav';

type Tab = 'recommend' | 'trending';

interface RecommendTopic {
  fingerprint_id: string;
  author_name: string;
  title: string;
  angle: string;
  why_match: string;
}

interface TrendingTopic {
  title: string;
  angle: string;
  related_keywords?: string[];
  heat_hint?: string;
}

interface TabState {
  loading: boolean;
  topics: RecommendTopic[] | TrendingTopic[];
  emptyReason: string | null;
  error: string | null;
  rawTail: string;
}

const INITIAL: TabState = {
  loading: false,
  topics: [],
  emptyReason: null,
  error: null,
  rawTail: '',
};

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
      const dataStr = dataLines.join('\n');
      let data: unknown = dataStr;
      try { data = JSON.parse(dataStr); } catch {/* keep string */}
      yield { event, data };
    }
    if (done) return;
  }
}

export default function TopicsPage() {
  const [tab, setTab] = useState<Tab>('recommend');
  const [recState, setRecState] = useState<TabState>(INITIAL);
  const [trState, setTrState] = useState<TabState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const state = tab === 'recommend' ? recState : trState;
  const setState = tab === 'recommend' ? setRecState : setTrState;

  const fetchTab = useCallback(async (which: Tab) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const setter = which === 'recommend' ? setRecState : setTrState;
    setter({ ...INITIAL, loading: true });

    let res: Response;
    try {
      res = await fetch(
        which === 'recommend' ? '/api/topics/recommend' : '/api/topics/trending',
        { method: 'GET', signal: ctrl.signal, headers: { Accept: 'text/event-stream' } },
      );
    } catch (err) {
      // 切 tab / 重新生成会主动 abort 上一轮请求，这是正常操作，不展示红色错误框。
      if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) {
        setter((s) => ({ ...s, loading: false, rawTail: '' }));
        return;
      }
      setter({
        ...INITIAL,
        error: '连不上后端，看看 dev 是不是挂了',
      });
      return;
    }

    if (!res.ok || !res.body) {
      setter({ ...INITIAL, error: `后端没接住（HTTP ${res.status}）` });
      return;
    }

    const reader = res.body.getReader();
    try {
      for await (const evt of readSseEvents(reader)) {
        if (ctrl.signal.aborted) {
          setter((s) => ({ ...s, loading: false, rawTail: '' }));
          break;
        }
        if (evt.event === 'chunk') {
          const t = (evt.data as { text?: string }).text || '';
          setter((s) => ({ ...s, rawTail: (s.rawTail + t).slice(-400) }));
        } else if (evt.event === 'done') {
          const d = evt.data as { topics?: unknown[]; empty_reason?: string };
          setter({
            loading: false,
            topics: (d.topics ?? []) as RecommendTopic[] | TrendingTopic[],
            emptyReason: d.empty_reason ?? null,
            error: null,
            rawTail: '',
          });
        } else if (evt.event === 'error') {
          const d = evt.data as { message?: string };
          setter({
            ...INITIAL,
            error: d.message || '这次没成，换个时间再试',
          });
        }
      }
    } catch (err) {
      // 主动取消不算失败，不要显示“卡住了”。
      if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) {
        setter((s) => ({ ...s, loading: false, rawTail: '' }));
        return;
      }
      setter({
        ...INITIAL,
        error: '生成中断：' + (err as Error).message,
      });
    }
  }, []);

  useEffect(() => {
    fetchTab('recommend');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (next: Tab) => {
    if (tab === next) return;
    setTab(next);
    const target = next === 'recommend' ? recState : trState;
    if (target.topics.length === 0 && !target.loading && !target.error && !target.emptyReason) {
      fetchTab(next);
    }
  };

  return (
    <>
      <HomeNav activePath="/topics" />
      <main className="container topics-page" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <header style={{ marginBottom: 24 }}>
          <h1 className="hero-title" style={{ fontSize: 38, margin: '0 0 10px' }}>
            今天<em>写什么</em>
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15, maxWidth: 620 }}>
            两个切入：左边是基于你订阅的博主风格出的推荐，右边是从最近爬到的文章里聚的热点。
          </p>
        </header>

        <div className="topics-tabs">
          <button
            type="button"
            className={`topics-tab${tab === 'recommend' ? ' active' : ''}`}
            onClick={() => switchTab('recommend')}
          >
            风格推荐
          </button>
          <button
            type="button"
            className={`topics-tab${tab === 'trending' ? ' active' : ''}`}
            onClick={() => switchTab('trending')}
          >
            热点聚合
          </button>
          <button
            type="button"
            className="btn btn-ghost topics-refresh"
            onClick={() => fetchTab(tab)}
            disabled={state.loading}
          >
            {state.loading ? '正在想…' : '重新生成'}
          </button>
        </div>

        {state.loading && (
          <div className="topics-loading">
            <span className="pulse-dot pulse-soft" />
            <span>
              {tab === 'recommend'
                ? '正在结合你的指纹库 + 最近写过的，给你挑选题…'
                : '正在做关键词聚合 + 趋势提炼…'}
            </span>
            {state.rawTail && (
              <pre className="topics-stream-tail">{state.rawTail}</pre>
            )}
          </div>
        )}

        {state.error && (
          <div className="warm-error" style={{ marginTop: 16 }}>
            <div className="warm-error-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--error)' }}>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
              </svg>
              <span>这次没生成出来</span>
            </div>
            <p className="warm-error-desc">{state.error}</p>
          </div>
        )}

        {state.emptyReason && state.topics.length === 0 && !state.loading && (
          <div className="empty-state" style={{ marginTop: 16 }}>
            <p className="empty-state-title">还没有素材</p>
            <p className="empty-state-desc">{state.emptyReason}</p>
            <Link href="/fingerprints/new" className="btn btn-primary">
              去拆一个新博主
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        )}

        {!state.loading && state.topics.length > 0 && (
          <div className="topic-list enter-stagger" style={{ marginTop: 24 }}>
            {tab === 'recommend' &&
              (state.topics as RecommendTopic[]).map((t, i) => (
                <Link
                  key={i}
                  href={`/compose?fingerprint=${encodeURIComponent(t.fingerprint_id)}&topic=${encodeURIComponent(t.title)}`}
                  className="topic-card"
                >
                  <div className="topic-meta">
                    <span className="tag tag-lang">{t.author_name} 风</span>
                  </div>
                  <h3 className="topic-title">{t.title}</h3>
                  <p className="topic-angle">{t.angle}</p>
                  {t.why_match && (
                    <p className="topic-angle" style={{ color: 'var(--text-muted)' }}>
                      为什么挑这个：{t.why_match}
                    </p>
                  )}
                  <div className="topic-footer">
                    <span className="topic-source">{t.author_name}</span>
                    <span className="topic-action">带入生成 →</span>
                  </div>
                </Link>
              ))}
            {tab === 'trending' &&
              (state.topics as TrendingTopic[]).map((t, i) => (
                <Link
                  key={i}
                  href={`/compose?topic=${encodeURIComponent(t.title)}`}
                  className="topic-card"
                >
                  <div className="topic-meta">
                    <span className="tag tag-topic">热点</span>
                    {(t.related_keywords ?? []).slice(0, 3).map((k) => (
                      <span key={k} className="tag">{k}</span>
                    ))}
                  </div>
                  <h3 className="topic-title">{t.title}</h3>
                  <p className="topic-angle">{t.angle}</p>
                  {t.heat_hint && (
                    <p className="topic-angle" style={{ color: 'var(--text-muted)' }}>
                      {t.heat_hint}
                    </p>
                  )}
                  <div className="topic-footer">
                    <span className="topic-source">来自爬取数据 · TF-IDF</span>
                    <span className="topic-action">带入生成 →</span>
                  </div>
                </Link>
              ))}
          </div>
        )}
      </main>
    </>
  );
}
