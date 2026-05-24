'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { useToastStore } from '@/stores/toast-store';
import { AuthorSearch } from '@/components/fingerprints/AuthorSearch';

type Mode = 'url' | 'paste';
type CardStatus =
  | 'idle'         // 还没填 / 还没爬
  | 'crawling'     // 正在试爬
  | 'crawled'      // 爬到了，预览可见
  | 'crawl-failed' // 爬失败
  | 'ready'        // 正文模式且字数够（或 URL 成功）
  | 'analyzing'    // stage1 进行中
  | 'analyzed'     // stage1 完成
  | 'error';

interface CardData {
  id: number;             // local key
  mode: Mode;
  category: string;
  url: string;
  urlPreview: {
    title: string | null;
    snippet: string;
    image_count: number;
    full_length: number;
    platform: string | null;
  } | null;
  pasteTitle: string;
  pasteContent: string;
  status: CardStatus;
  message: string | null; // 试爬失败 / 分析失败的提示
}

const PLATFORM_OPTIONS = [
  { value: '', label: '不指定' },
  { value: '公众号', label: '公众号' },
  { value: '知乎', label: '知乎' },
  { value: '少数派', label: '少数派' },
  { value: '优设', label: '优设 / UI 中国' },
  { value: '小红书', label: '小红书' },
  { value: '博客', label: '个人博客' },
  { value: '其他', label: '其他' },
];

const CATEGORIES = ['观点', '案例', '教学', '评论', '杂感'];

const MIN_ARTICLES = 5;      // 点「开始拆解」的下限（5 篇起步才能拆出风格）
const INITIAL_CARDS = 1;     // 页面初始显示几张卡（轻盈一点，按需 +）
const MAX_ARTICLES = 12;
const MIN_PASTE_CHARS = 80;
const MIN_URL_CRAWL_CHARS = 200; // URL 爬到的内容低于这个字数视为「语料太少」，不计入就绪（如 B 站无字幕视频只能拿到标题+简介）

let _seq = 1;
function newCard(): CardData {
  return {
    id: _seq++,
    mode: 'url',
    category: '观点',
    url: '',
    urlPreview: null,
    pasteTitle: '',
    pasteContent: '',
    status: 'idle',
    message: null,
  };
}

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

export default function NewFingerprintPage() {
  const router = useRouter();
  const [authorName, setAuthorName] = useState('');
  const [platform, setPlatform] = useState('');
  const [cards, setCards] = useState<CardData[]>(() =>
    Array.from({ length: INITIAL_CARDS }, () => newCard()),
  );
  const [phase, setPhase] = useState<'input' | 'streaming' | 'error'>('input');
  const [streamLog, setStreamLog] = useState('');
  const [currentPhaseLabel, setCurrentPhaseLabel] = useState('');
  const [errorState, setErrorState] = useState<{ message: string; detail?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLDivElement>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight;
    }
  }, [streamLog]);

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

  const updateCard = (id: number, patch: Partial<CardData>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeCard = (id: number) => {
    setCards((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  };
  const addCard = () => {
    setCards((prev) => (prev.length >= MAX_ARTICLES ? prev : [...prev, newCard()]));
  };

  const cardIsReady = (c: CardData): boolean => {
    if (c.mode === 'url') {
      if (c.status !== 'crawled' && c.status !== 'ready') return false;
      // 爬到了但内容太短（B 站无字幕、知乎 placeholder 等）也不算就绪
      const len = c.urlPreview?.full_length ?? 0;
      return len >= MIN_URL_CRAWL_CHARS;
    }
    return c.pasteContent.trim().length >= MIN_PASTE_CHARS;
  };

  const canSubmit = useMemo(() => {
    if (!authorName.trim()) return false;
    if (cards.length < MIN_ARTICLES) return false;
    const ready = cards.filter(cardIsReady).length;
    return ready >= MIN_ARTICLES;
  }, [authorName, cards]);

  const tryCrawl = async (card: CardData) => {
    if (!card.url.trim()) {
      useToastStore.getState().show('先填 URL 再试爬', 'error');
      return;
    }
    updateCard(card.id, { status: 'crawling', message: null });
    try {
      const res = await fetch('/api/crawl-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: card.url.trim() }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        title?: string | null;
        preview?: string;
        image_count?: number;
        full_length?: number;
        platform?: string | null;
        hint?: string;
        apify_cost_usd?: number | null;
        apify_platform?: string | null;
      };
      if (!res.ok || !json.ok) {
        updateCard(card.id, {
          status: 'crawl-failed',
          message: json.hint || '抓不下来',
        });
        return;
      }
      updateCard(card.id, {
        status: 'crawled',
        message: null,
        urlPreview: {
          title: json.title ?? null,
          snippet: json.preview ?? '',
          image_count: json.image_count ?? 0,
          full_length: json.full_length ?? 0,
          platform: json.platform ?? null,
        },
      });
      // 走 Apify 抓的提醒一下成本，走本地的不打扰
      if (typeof json.apify_cost_usd === 'number' && json.apify_cost_usd > 0) {
        const cost =
          json.apify_cost_usd < 0.01
            ? `$${json.apify_cost_usd.toFixed(4)}`
            : `$${json.apify_cost_usd.toFixed(3)}`;
        const platform = json.platform || 'Apify';
        useToastStore.getState().show(`${platform} 抓完了，本次消耗 ${cost}`, 'success');
      }
    } catch (err) {
      updateCard(card.id, {
        status: 'crawl-failed',
        message: '网络抽风：' + ((err as Error).message || '未知'),
      });
    }
  };

  /**
   * 一键全部试爬：扫描所有 URL 模式 + 有 URL + 状态 idle/crawl-failed 的卡片，
   * 并发 3 个一组跑（避免本地请求队列拥挤）。
   * 已抓到（crawled）的不重试 —— 重抓在单卡上「重新抓」按钮里。
   */
  const tryCrawlAll = async () => {
    const pending = cards.filter(
      (c) => c.mode === 'url' && c.url.trim() && (c.status === 'idle' || c.status === 'crawl-failed'),
    );
    if (pending.length === 0) {
      useToastStore.getState().show('没有要爬的 URL 卡片', 'error');
      return;
    }
    useToastStore.getState().show(`开始批量试爬 ${pending.length} 张卡…`, 'success');
    const CONCURRENCY = 3;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((c) => tryCrawl(c)));
    }
    useToastStore.getState().show('全部跑完，看每张卡的状态', 'success');
  };

  const switchToPaste = (card: CardData) => {
    updateCard(card.id, {
      mode: 'paste',
      status: 'idle',
      message: null,
      urlPreview: null,
    });
  };

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    setPhase('streaming');
    setStreamLog('');
    setCurrentPhaseLabel('正在准备样本');
    setErrorState(null);
    // 重置每张卡的 status
    setCards((prev) =>
      prev.map((c) => ({
        ...c,
        status: cardIsReady(c) ? 'ready' : c.status,
        message: null,
      })),
    );

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const payload = {
      author_name: authorName.trim(),
      platform: platform || undefined,
      articles: cards.filter(cardIsReady).map((c) => {
        if (c.mode === 'url') {
          return {
            mode: 'url' as const,
            url: c.url.trim(),
            category: c.category,
            title: c.urlPreview?.title ?? undefined,
          };
        }
        return {
          mode: 'paste' as const,
          title: c.pasteTitle.trim() || undefined,
          content: c.pasteContent.trim(),
          category: c.category,
        };
      }),
    };

    let res: Response;
    try {
      res = await fetch('/api/fingerprint/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (err) {
      setPhase('error');
      setErrorState({
        message:
          (err as Error).name === 'AbortError'
            ? '已中止这次拆解'
            : '连不上后端，看看 dev 是不是挂了',
      });
      return;
    }

    if (!res.ok || !res.body) {
      let serverMsg = '';
      try {
        const j = (await res.json()) as { error?: string };
        serverMsg = j?.error || '';
      } catch {/* ignore */}
      setPhase('error');
      setErrorState({ message: serverMsg || `后端没接住（HTTP ${res.status}）` });
      return;
    }

    const reader = res.body.getReader();
    try {
      for await (const evt of readSseEvents(reader)) {
        if (ctrl.signal.aborted) break;
        if (evt.event === 'open') {
          // 就绪
        } else if (evt.event === 'phase') {
          const d = evt.data as { phase?: string; message?: string };
          if (d.message) setCurrentPhaseLabel(d.message);
          if (d.phase) setStreamLog((s) => s + `\n[ ${d.phase} ] ${d.message ?? ''}\n`);
        } else if (evt.event === 'article') {
          const d = evt.data as { index: number; status: string };
          setCards((prev) =>
            prev.map((c, i) =>
              i === d.index
                ? {
                    ...c,
                    status:
                      d.status === 'ready'
                        ? 'ready'
                        : d.status === 'analyzing'
                          ? 'analyzing'
                          : d.status === 'analyzed' || d.status === 'analyzed-loose'
                            ? 'analyzed'
                            : c.status,
                  }
                : c,
            ),
          );
        } else if (evt.event === 'chunk') {
          const d = evt.data as { stage?: string; index?: number; text?: string };
          if (typeof d.text === 'string') {
            const label =
              d.stage === 'stage2'
                ? '[stage2] '
                : d.stage === 'stage1'
                  ? `[stage1#${(d.index ?? 0) + 1}] `
                  : '';
            // 保留最后 12k 字，太长前端撑不住
            setStreamLog((s) => (s + label + d.text).slice(-12000));
          }
        } else if (evt.event === 'done') {
          const d = evt.data as { fingerprint_id?: string };
          if (d.fingerprint_id) {
            useToastStore.getState().show('拆解完成，跳详情页', 'success');
            await new Promise((r) => setTimeout(r, 220));
            router.push(`/fingerprints/${d.fingerprint_id}`);
            return;
          }
        } else if (evt.event === 'error') {
          const d = evt.data as { message?: string; detail?: string; phase?: string; index?: number };
          setPhase('error');
          setErrorState({
            message: d.message || '这次没成，换个角度再来',
            detail: d.detail,
          });
          if (typeof d.index === 'number') {
            setCards((prev) =>
              prev.map((c, i) =>
                i === d.index
                  ? { ...c, status: 'error', message: d.message ?? null }
                  : c,
              ),
            );
          }
          return;
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) {
        setPhase('input');
        return;
      }
      setPhase('error');
      setErrorState({
        message: '流式中断：' + (err as Error).message,
      });
    }
  }, [authorName, platform, cards, canSubmit, router]);

  const handleAbort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('input');
  };

  /**
   * Agent I · AuthorSearch 把搜到的文章 URL 灌进来。
   * 策略：从前往后找「空 URL 卡」填进去；不够就 push 新卡（不超过 MAX_ARTICLES）。
   * 卡片填完后用户仍需点「试爬」走原流程；这一步只负责把 URL 字段填上。
   */
  const handleSearchedUrls = useCallback((urls: string[]) => {
    if (urls.length === 0) return;
    setCards((prev) => {
      const next = [...prev];
      let cursor = 0;
      for (const url of urls) {
        // 找下一个 url 模式 + 空 URL 的卡
        while (cursor < next.length) {
          const c = next[cursor];
          if (c.mode === 'url' && !c.url.trim()) break;
          cursor += 1;
        }
        if (cursor >= next.length) {
          if (next.length >= MAX_ARTICLES) break;
          const fresh = newCard();
          fresh.url = url;
          next.push(fresh);
          cursor = next.length;
        } else {
          next[cursor] = {
            ...next[cursor],
            url,
            status: 'idle',
            urlPreview: null,
            message: null,
          };
          cursor += 1;
        }
      }
      return next;
    });
    useToastStore
      .getState()
      .show(`已把 ${urls.length} 条链接填到上方卡片，请点"试爬"逐个抓`, 'success');
  }, []);

  return (
    <>
      <HomeNav activePath="/fingerprints" />
      <main className="container intake-v2" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <header style={{ marginBottom: 24 }}>
          <h1 className="hero-title" style={{ fontSize: 38, margin: '0 0 10px' }}>
            拆解一个<em>新博主</em>
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15, maxWidth: 660 }}>
            5 篇起步。同一博主、不同类别（观点 / 案例 / 教学 / 评论 / 杂感）各来一篇，让工具能闻到他的全部味道。
            URL 模式优先；公众号不爬，留正文模式兜底。
          </p>
        </header>

        {/* Agent I · 博主名搜索入口（不破坏下方表单，只是先帮用户找 URL）。 */}
        <AuthorSearch
          onArticleUrlsSelected={handleSearchedUrls}
          onAuthorNameDetected={(name) => {
            if (!authorName.trim()) setAuthorName(name);
          }}
          disabled={phase === 'streaming'}
        />

        <section className="intake-form">
          <div className="intake-row">
            <label className="intake-label" htmlFor="author-name">这位博主叫什么？</label>
            <input
              id="author-name"
              className="intake-input"
              placeholder="比如：半佛仙人、辉哥奇谭"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              autoComplete="off"
              disabled={phase === 'streaming'}
            />
          </div>

          <div className="intake-row">
            <label className="intake-label" htmlFor="platform">他常在哪儿写？</label>
            <select
              id="platform"
              className="intake-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              disabled={phase === 'streaming'}
            >
              {PLATFORM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="intake-hint">公众号文章爬不动，请用正文模式贴。</span>
          </div>

          <div className="intake-row">
            <div className="cards-head">
              <span className="intake-label">把代表作粘进来 · 至少 5 篇</span>
              <span className="intake-hint">
                就绪 {cards.filter(cardIsReady).length} / 共 {cards.length} 张 · 上限 {MAX_ARTICLES}
              </span>
            </div>

            <div className="intake-cards">
              {cards.map((c, i) => (
                <ArticleCard
                  key={c.id}
                  card={c}
                  index={i}
                  onChangeMode={(mode) => updateCard(c.id, { mode, message: null })}
                  onChangeCategory={(cat) => updateCard(c.id, { category: cat })}
                  onChangeUrl={(url) => updateCard(c.id, { url, status: 'idle', urlPreview: null, message: null })}
                  onChangeTitle={(t) => updateCard(c.id, { pasteTitle: t })}
                  onChangeContent={(t) => updateCard(c.id, { pasteContent: t })}
                  onTryCrawl={() => tryCrawl(c)}
                  onSwitchToPaste={() => switchToPaste(c)}
                  onRemove={() => removeCard(c.id)}
                  removable={cards.length > 1}
                  disabled={phase === 'streaming'}
                />
              ))}
            </div>

            <button
              type="button"
              className="add-article-btn"
              onClick={addCard}
              disabled={cards.length >= MAX_ARTICLES || phase === 'streaming'}
              style={{ marginTop: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>再加一篇{cards.length >= MAX_ARTICLES ? `（已达 ${MAX_ARTICLES} 篇上限）` : ''}</span>
            </button>
            {(() => {
              const pendingCount = cards.filter(
                (c) => c.mode === 'url' && c.url.trim() && (c.status === 'idle' || c.status === 'crawl-failed'),
              ).length;
              const crawlingCount = cards.filter((c) => c.status === 'crawling').length;
              const busy = crawlingCount > 0 || phase === 'streaming';
              return (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={tryCrawlAll}
                  disabled={busy || pendingCount === 0}
                  style={{ marginTop: 8, marginLeft: 8 }}
                  title={pendingCount === 0 ? '没有待爬的 URL 卡片' : `并发爬 ${pendingCount} 张`}
                >
                  {crawlingCount > 0 ? `批量爬中（${crawlingCount}）…` : `一键试爬全部${pendingCount > 0 ? `（${pendingCount}）` : ''}`}
                </button>
              );
            })()}
          </div>

          <div className="intake-submit-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!canSubmit || phase === 'streaming'}
              title={canSubmit ? '' : `至少 ${MIN_ARTICLES} 张卡有内容 + 博主名填了`}
            >
              {phase === 'streaming' ? '正在拆解…' : '开始拆解'}
              <span className="btn-arrow">→</span>
            </button>
            {phase === 'streaming' && (
              <button type="button" className="btn btn-secondary" onClick={handleAbort}>
                中止
              </button>
            )}
            <span className="intake-hint">
              {canSubmit
                ? `就绪 ${cards.filter(cardIsReady).length} 篇 · 预计 80-120s`
                : `还差：博主名 + ${MIN_ARTICLES} 张就绪卡`}
            </span>
          </div>

          {phase === 'streaming' && (
            <div className="stream-section">
              <div className="stream-output" ref={streamBoxRef}>
                {streamLog ? (
                  <span>
                    {streamLog}
                    <span className="caret-blink" />
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>
                    正在唤醒模型，第一个字之前可能有几秒静默
                    <span className="caret-blink" />
                  </span>
                )}
              </div>
              <div className="stream-status">
                <div className="stream-status-head">
                  <span className="pulse-dot pulse-soft" />
                  <span>{currentPhaseLabel || '工作中'}</span>
                </div>
                <div className="stream-status-meta">
                  <div>就绪：{cards.filter(cardIsReady).length} 篇 · 已分析 {cards.filter((c) => c.status === 'analyzed').length}</div>
                  <div>已用时：{elapsed}s</div>
                  <div>典型：80-120s</div>
                </div>
              </div>
            </div>
          )}

          {phase === 'error' && errorState && (
            <div className="warm-error" role="alert">
              <div className="warm-error-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--error)' }}>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>这次卡住了，回到输入换个角度</span>
              </div>
              <p className="warm-error-desc">{errorState.message}</p>
              {errorState.detail && (
                <pre className="warm-error-detail">{errorState.detail}</pre>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { setPhase('input'); setErrorState(null); }}
                >
                  回到输入
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

interface CardProps {
  card: CardData;
  index: number;
  onChangeMode: (m: Mode) => void;
  onChangeCategory: (c: string) => void;
  onChangeUrl: (u: string) => void;
  onChangeTitle: (t: string) => void;
  onChangeContent: (t: string) => void;
  onTryCrawl: () => void;
  onSwitchToPaste: () => void;
  onRemove: () => void;
  removable: boolean;
  disabled: boolean;
}

function ArticleCard({
  card,
  index,
  onChangeMode,
  onChangeCategory,
  onChangeUrl,
  onChangeTitle,
  onChangeContent,
  onTryCrawl,
  onSwitchToPaste,
  onRemove,
  removable,
  disabled,
}: CardProps) {
  const statusLabel: Record<CardStatus, string> = {
    idle: '待填',
    crawling: '正在抓…',
    crawled: '已抓到',
    'crawl-failed': '抓失败',
    ready: '就绪',
    analyzing: '解析中',
    analyzed: '已完成',
    error: '出错',
  };
  const statusColor: Record<CardStatus, string> = {
    idle: 'var(--text-muted)',
    crawling: 'var(--warning)',
    crawled: 'var(--success)',
    'crawl-failed': 'var(--error)',
    ready: 'var(--success)',
    analyzing: 'var(--warning)',
    analyzed: 'var(--success)',
    error: 'var(--error)',
  };

  const pasteLen = card.pasteContent.trim().length;
  return (
    <div className={`article-card intake-card status-${card.status}`}>
      <div className="article-card-head intake-card-head">
        <span className="article-card-idx">文章 {String(index + 1).padStart(2, '0')}</span>
        <select
          className="intake-select intake-mini-select"
          value={card.category}
          onChange={(e) => onChangeCategory(e.target.value)}
          disabled={disabled}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="intake-mode-toggle">
          <button
            type="button"
            className={`mode-btn${card.mode === 'url' ? ' active' : ''}`}
            onClick={() => onChangeMode('url')}
            disabled={disabled}
          >URL</button>
          <button
            type="button"
            className={`mode-btn${card.mode === 'paste' ? ' active' : ''}`}
            onClick={() => onChangeMode('paste')}
            disabled={disabled}
          >正文</button>
        </div>
        <span className="intake-status-dot" style={{ color: statusColor[card.status] }}>
          ● {statusLabel[card.status]}
        </span>
        {removable && (
          <button
            type="button"
            className="article-card-remove"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`移除文章 ${index + 1}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>移除</span>
          </button>
        )}
      </div>

      {card.mode === 'url' ? (
        <>
          <div className="intake-url-row">
            <input
              className="intake-input"
              type="url"
              placeholder="粘文章 URL（公众号不支持，请切到正文模式）"
              value={card.url}
              onChange={(e) => onChangeUrl(e.target.value)}
              disabled={disabled || card.status === 'crawling'}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onTryCrawl}
              disabled={disabled || card.status === 'crawling' || !card.url.trim()}
            >
              {card.status === 'crawling' ? '抓取中…' : card.status === 'crawled' ? '重新抓' : '试爬'}
            </button>
          </div>
          {card.urlPreview && (
            <div className="intake-url-preview">
              <div className="intake-url-preview-head">
                <span className="intake-url-preview-title">
                  {card.urlPreview.title || '（无标题）'}
                </span>
                <span className="intake-url-preview-stats">
                  {card.urlPreview.full_length} 字 · {card.urlPreview.image_count} 张图
                </span>
              </div>
              <p className="intake-url-preview-snippet">{card.urlPreview.snippet}…</p>
              {card.urlPreview.full_length < MIN_URL_CRAWL_CHARS && (
                <div className="intake-card-hint warm-inline" style={{ marginTop: 8 }}>
                  <span>语料只有 {card.urlPreview.full_length} 字，太少（B 站可能没字幕）。换一个能拿到更多内容的，或切正文手贴。</span>
                  <button type="button" className="btn btn-ghost intake-switch-btn" onClick={onSwitchToPaste}>
                    切到正文模式 →
                  </button>
                </div>
              )}
            </div>
          )}
          {card.status === 'crawl-failed' && (
            <div className="intake-card-hint warm-inline" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span style={{ width: '100%' }}>{card.message || '抓不下来'}</span>
              <a
                href={card.url}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-ghost intake-switch-btn"
                style={{ textDecoration: 'none' }}
              >
                1. 打开链接 ↗
              </a>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>2. 在浏览器里复制正文</span>
              <button
                type="button"
                className="btn btn-ghost intake-switch-btn"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (!text || text.trim().length < MIN_PASTE_CHARS) {
                      alert(`剪贴板里只有 ${text?.length ?? 0} 字，少于 ${MIN_PASTE_CHARS} 字。请先在浏览器里完整复制正文再点这里。`);
                      return;
                    }
                    onChangeContent(text);
                    onSwitchToPaste();
                  } catch {
                    alert('读不到剪贴板。请手动点「切到正文模式」后粘贴。');
                  }
                }}
              >
                3. 点这里贴 →
              </button>
              <button type="button" className="btn btn-ghost intake-switch-btn" onClick={onSwitchToPaste}>
                或：手动切到正文模式
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <input
            className="intake-input"
            placeholder="标题（可选）"
            value={card.pasteTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            disabled={disabled}
          />
          <textarea
            className="intake-textarea"
            placeholder="把正文整段粘过来。最少 80 字，越长越准。"
            value={card.pasteContent}
            onChange={(e) => onChangeContent(e.target.value)}
            disabled={disabled}
          />
          <div className="intake-card-meta-line">
            <span style={{ color: pasteLen >= MIN_PASTE_CHARS ? 'var(--success)' : 'var(--text-muted)' }}>
              {pasteLen} 字 · {pasteLen >= MIN_PASTE_CHARS ? '就绪' : `还差 ${MIN_PASTE_CHARS - pasteLen} 字`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
