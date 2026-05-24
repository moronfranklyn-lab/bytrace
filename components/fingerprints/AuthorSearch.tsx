'use client';

/**
 * 博主名搜索面板（Agent I · 第三轮修复）。
 *
 * 挂在 /fingerprints/new 顶部（不改 H 写好的卡片表单）。
 *
 * **第三轮修复**：之前把所有搜索结果都当主页去 crawlAuthorIndex 拉列表，
 * 但 DDG/Google 返回的多数是文章详情页（zhihu.com/p/xxx、bilibili.com/video/BVxxx），
 * 拉列表自然全失败。现在改成按 candidate.kind 分流：
 *
 *   - kind='article'  → 直接进「可灌卡」列表，用户勾选 → 灌进父组件的 ArticleCard
 *   - kind='index'    → 仍走「先拉列表」流程（少数情况：space.bilibili.com、user 主页）
 *   - kind='unknown'  → 默认按 article 处理（试爬失败再让用户切正文模式）
 *
 * 状态机：idle → searching → results(直接显示文章 URL + 主页) → done
 */

import { useCallback, useState } from 'react';

type CandidateUI = {
  name: string;
  url: string;
  platform: string;
  medium: 'text' | 'video' | 'mixed';
  snippet: string;
  confidence: number;
  source: 'duckduckgo' | 'google';
  kind: 'article' | 'index' | 'unknown';
  risk: 'blocked' | 'limited' | null;
  risk_hint: string | null;
  selected: boolean;
};

type IndexEntry = {
  homepage: string;
  platform: string;
  author_name: string | null;
  article_urls: { url: string; selected: boolean }[];
  error: string | null;
};

type Phase =
  | 'idle'
  | 'searching'
  | 'results'
  | 'fetching-index'
  | 'urls-ready'
  | 'error';

interface Props {
  /** 用户点「灌入文章卡」时回调；URLs 已经是用户勾选过滤过的。 */
  onArticleUrlsSelected: (urls: string[]) => void;
  /** 用户搜出博主名后回调；让父组件把 authorName 填到主表单。 */
  onAuthorNameDetected?: (name: string) => void;
  /** 父组件正在拆解时禁用。 */
  disabled?: boolean;
}

export function AuthorSearch({
  onArticleUrlsSelected,
  onAuthorNameDetected,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateUI[]>([]);
  const [indexes, setIndexes] = useState<IndexEntry[]>([]);
  const [open, setOpen] = useState(false);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setPhase('searching');
    setErrorMsg(null);
    setCandidates([]);
    setIndexes([]);
    try {
      const res = await fetch('/api/search-authors?q=' + encodeURIComponent(q));
      const json = (await res.json()) as {
        ok: boolean;
        reason?: string;
        message?: string;
        candidates?: Omit<CandidateUI, 'selected'>[];
      };
      if (!json.ok) {
        setPhase('error');
        setErrorMsg(json.message || '没搜到');
        return;
      }
      // 默认勾选规则：
      //   - kind='index'（主页/合集）：默认不勾
      //   - risk='blocked'（已知反爬，如知乎）：默认不勾
      //   - 其他（含 risk='limited' 如 B 站可能无字幕）：默认勾
      const list = (json.candidates ?? []).map((c) => {
        const cc = c as Partial<CandidateUI>;
        const kind = cc.kind ?? 'unknown';
        const risk = cc.risk ?? null;
        return {
          ...c,
          kind,
          risk,
          risk_hint: cc.risk_hint ?? null,
          selected: kind !== 'index' && risk !== 'blocked',
        };
      });
      setCandidates(list);
      setPhase(list.length === 0 ? 'error' : 'results');
      if (list.length === 0) setErrorMsg('一个候选都没搜到，换个写法试试');
      // 顺便把 query 当做博主名提示给父组件
      if (onAuthorNameDetected && list.length > 0) {
        onAuthorNameDetected(q);
      }
    } catch (e) {
      setPhase('error');
      setErrorMsg('搜索请求失败：' + ((e as Error).message || '未知'));
    }
  }, [query, onAuthorNameDetected]);

  const toggleCandidate = (i: number) => {
    setCandidates((prev) => prev.map((c, idx) => (idx === i ? { ...c, selected: !c.selected } : c)));
  };

  /**
   * 用选中的主页 → 并发拉每个主页的 article 列表。
   * 走 /api/crawl-preview 的 mode=index 模式（用 POST + { mode: 'index' }）。
   */
  const fetchIndexes = useCallback(async () => {
    const picked = candidates.filter((c) => c.selected);
    if (picked.length === 0) return;
    setPhase('fetching-index');
    const results: IndexEntry[] = [];

    for (const c of picked) {
      try {
        const res = await fetch('/api/crawl-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: c.url, mode: 'index' }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          author_name?: string | null;
          platform?: string;
          article_urls?: string[];
          hint?: string;
        };
        if (!res.ok || !json.ok) {
          results.push({
            homepage: c.url,
            platform: c.platform,
            author_name: null,
            article_urls: [],
            error: json.hint || `拉不到 ${c.platform} 主页文章列表`,
          });
          continue;
        }
        const urls = (json.article_urls ?? []).slice(0, 30);
        results.push({
          homepage: c.url,
          platform: json.platform || c.platform,
          author_name: json.author_name ?? c.name,
          article_urls: urls.map((u, i) => ({ url: u, selected: i < 10 })), // 默认前 10 篇
          error: null,
        });
      } catch (e) {
        results.push({
          homepage: c.url,
          platform: c.platform,
          author_name: null,
          article_urls: [],
          error: '请求失败：' + ((e as Error).message || '未知'),
        });
      }
    }

    setIndexes(results);
    setPhase('urls-ready');
  }, [candidates]);

  const toggleArticle = (entryIdx: number, urlIdx: number) => {
    setIndexes((prev) =>
      prev.map((e, i) =>
        i !== entryIdx
          ? e
          : {
              ...e,
              article_urls: e.article_urls.map((a, j) =>
                j === urlIdx ? { ...a, selected: !a.selected } : a,
              ),
            },
      ),
    );
  };

  const sendToCards = () => {
    const urls = indexes.flatMap((e) => e.article_urls.filter((a) => a.selected).map((a) => a.url));
    if (urls.length === 0) return;
    onArticleUrlsSelected(urls);
    // 收起面板
    setOpen(false);
    setPhase('idle');
    setCandidates([]);
    setIndexes([]);
  };

  if (!open) {
    return (
      <div className="author-search-collapsed" style={collapsedStyle}>
        <div>
          <strong style={{ fontSize: 14 }}>还没想好谁？</strong>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 13 }}>
            搜个博主名，自动找候选主页和最近文章
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          搜个名字试试 →
        </button>
      </div>
    );
  }

  return (
    <section className="author-search-panel" style={panelStyle}>
      <header style={panelHeadStyle}>
        <strong>按博主名搜索</strong>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOpen(false);
            setPhase('idle');
            setErrorMsg(null);
          }}
          disabled={disabled || phase === 'fetching-index'}
          style={{ fontSize: 12 }}
        >
          收起 ×
        </button>
      </header>

      <div style={searchRowStyle}>
        <input
          className="intake-input"
          placeholder="比如：半佛仙人、老蒋巨靠谱、沈帅波"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSearch();
          }}
          disabled={disabled || phase === 'searching' || phase === 'fetching-index'}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={doSearch}
          disabled={disabled || phase === 'searching' || phase === 'fetching-index' || !query.trim()}
        >
          {phase === 'searching' ? '搜索中…' : '搜索'}
        </button>
      </div>

      {phase === 'error' && errorMsg && (
        <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{errorMsg}</p>
      )}

      {(phase === 'results' || phase === 'fetching-index' || phase === 'urls-ready') &&
        candidates.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={subHeadStyle}>
              <span>
                {(() => {
                  const articleCount = candidates.filter((c) => c.kind !== 'index').length;
                  const indexCount = candidates.length - articleCount;
                  const parts: string[] = [];
                  if (articleCount) parts.push(`${articleCount} 篇文章`);
                  if (indexCount) parts.push(`${indexCount} 个主页`);
                  return `搜到：${parts.join(' · ')}（勾选你要的，跳过主页）`;
                })()}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // 直接把所有勾中的 article+unknown URL 灌进卡片，不再走主页列表
                  const urls = candidates
                    .filter((c) => c.selected && c.kind !== 'index')
                    .map((c) => c.url);
                  if (urls.length === 0) return;
                  onArticleUrlsSelected(urls);
                  setOpen(false);
                  setPhase('idle');
                  setCandidates([]);
                  setIndexes([]);
                }}
                disabled={
                  disabled ||
                  candidates.filter((c) => c.selected && c.kind !== 'index').length === 0
                }
                style={{ fontSize: 13 }}
              >
                灌入选中的文章 →
              </button>
            </div>
            <ul style={candListStyle}>
              {candidates.map((c, i) => (
                <li key={c.url} style={candItemStyle}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={() => toggleCandidate(i)}
                      disabled={disabled || phase === 'fetching-index'}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14 }}>{c.name}</strong>
                        <span style={tagStyle}>{c.platform}</span>
                        <span style={mediumTag(c.medium)}>{labelOfMedium(c.medium)}</span>
                        {c.kind === 'index' && c.risk !== 'blocked' && (
                          <span style={{ ...tagStyle, color: 'var(--text-muted)' }} title="这是主页/合集页">
                            主页
                          </span>
                        )}
                        {c.risk === 'blocked' && (
                          <span
                            style={{ ...tagStyle, background: 'rgba(245, 158, 11, 0.14)', color: '#92560f', borderColor: 'rgba(245, 158, 11, 0.30)' }}
                            title={c.risk_hint || '已知反爬'}
                          >
                            反爬 · 推荐手贴
                          </span>
                        )}
                        {c.risk === 'limited' && (
                          <span
                            style={{ ...tagStyle, color: 'var(--text-muted)' }}
                            title={c.risk_hint || '内容可能不完整'}
                          >
                            可能不全
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          匹配度 {(c.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}
                      >
                        {c.url}
                      </a>
                      {c.snippet && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                          {c.snippet}
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

    </section>
  );
}

// ---- 局部样式（用内联以避免改全局 CSS）-----------------------------------
const collapsedStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  marginBottom: 16,
};

const panelStyle: React.CSSProperties = {
  padding: 16,
  border: '1px solid var(--border)',
  borderRadius: 10,
  marginBottom: 20,
  background: 'var(--bg-elevated, transparent)',
};

const panelHeadStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
};

const searchRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const subHeadStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  margin: '8px 0',
  fontSize: 13,
};

const candListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxHeight: 360,
  overflowY: 'auto',
};

const candItemStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
};

const tagStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '1px 6px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-muted)',
};

function mediumTag(m: 'text' | 'video' | 'mixed'): React.CSSProperties {
  const colorMap: Record<string, string> = {
    text: 'var(--text-muted)',
    video: 'var(--warning, #e2a000)',
    mixed: 'var(--info, #4b8df8)',
  };
  return {
    ...tagStyle,
    color: colorMap[m] || 'var(--text-muted)',
  };
}

function labelOfMedium(m: 'text' | 'video' | 'mixed'): string {
  return m === 'video' ? '视频' : m === 'mixed' ? '混合' : '文字';
}

const indexBlockStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  paddingTop: 10,
  marginTop: 10,
};

const articleListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 240,
  overflowY: 'auto',
};

const articleItemStyle: React.CSSProperties = {};
