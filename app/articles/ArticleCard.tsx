'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleCardData, PlatformVersion } from './page';

interface DiffSummary {
  overview: string;
  adjustments: string[];
}

interface Props {
  data: ArticleCardData;
  dateLabel: string;
}

/**
 * 一篇文章 = 一张卡。
 *
 * 卡里行为：
 * - 平台 chip 一排：每个平台对应一个版本，点击切换
 * - 切到非主平台时，触发 /api/articles/:id/diff 拿"调整了什么"摘要
 * - 摘要按 (from, to) 缓存在状态里，切回来不重复请求
 * - 卡片始终显示该版本的字数 / 段落数 / 前 140 字节选
 */
export function ArticleCard({ data, dateLabel }: Props) {
  const primary = useMemo(() => data.versions.find((v) => v.is_primary) ?? data.versions[0], [data.versions]);
  const [activeKey, setActiveKey] = useState(primary.key);
  const active = data.versions.find((v) => v.key === activeKey) ?? primary;

  const hasMultiple = data.versions.length >= 2;

  // diff 状态：按 "from→to" 缓存
  const [diffMap, setDiffMap] = useState<Record<string, DiffSummary>>({});
  const [diffLoading, setDiffLoading] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const aborterRef = useRef<AbortController | null>(null);

  const diffKey = active.is_primary ? null : `${primary.key}→${active.key}`;
  const diff = diffKey ? diffMap[diffKey] ?? null : null;

  useEffect(() => {
    if (!diffKey) {
      setDiffError(null);
      return;
    }
    if (diffMap[diffKey]) {
      setDiffError(null);
      return;
    }
    if (diffLoading === diffKey) return;

    aborterRef.current?.abort();
    const ac = new AbortController();
    aborterRef.current = ac;
    setDiffLoading(diffKey);
    setDiffError(null);

    fetch(`/api/articles/${data.id}/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: primary.key, to: active.key }),
      signal: ac.signal,
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
        if (!json?.summary) throw new Error('返回格式不对');
        setDiffMap((m) => ({ ...m, [diffKey]: json.summary as DiffSummary }));
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setDiffError((err as Error).message);
      })
      .finally(() => {
        setDiffLoading((cur) => (cur === diffKey ? null : cur));
      });

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffKey, data.id, primary.key, active.key]);

  return (
    <article className="article-card">
      <header className="article-card-head">
        <Link href={`/articles/${data.id}`} className="article-card-title-link">
          <h3 className="article-card-title">{data.title}</h3>
        </Link>
        <div className="article-card-meta">
          {data.author_name && (
            <span className="tag tag-lang">
              {data.author_avatar || data.author_name.slice(0, 1)} · {data.author_name}
            </span>
          )}
          {data.layout_theme && <span className="tag tag-struct">{data.layout_theme}</span>}
          <span className="article-card-date">{dateLabel}</span>
        </div>
      </header>

      {hasMultiple && (
        <div className="article-card-chips" role="tablist" aria-label="平台版本切换">
          {data.versions.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === activeKey}
              className={'platform-chip' + (v.key === activeKey ? ' active' : '')}
              onClick={() => setActiveKey(v.key)}
              title={`${v.name} · ${v.word_count} 字`}
            >
              {v.name}
              {v.is_primary && <span className="platform-chip-mark" aria-label="原版">·原</span>}
            </button>
          ))}
        </div>
      )}

      <div className="article-card-body">
        <div className="article-card-stats">
          <span>{active.word_count.toLocaleString()} 字</span>
          <span>·</span>
          <span>{active.paragraph_count} 段</span>
          {active.paragraph_count > 0 && (
            <>
              <span>·</span>
              <span>平均 {Math.round(active.word_count / active.paragraph_count)} 字/段</span>
            </>
          )}
        </div>

        {diffKey && (
          <div className="article-card-diff" aria-live="polite">
            {diffLoading === diffKey && (
              <p className="article-card-diff-loading">正在对比 {primary.name} 和 {active.name}…</p>
            )}
            {diffError && !diffLoading && (
              <p className="article-card-diff-error">这次没成：{diffError}。点别的 chip 再切回来重试。</p>
            )}
            {diff && !diffLoading && (
              <>
                <p className="article-card-diff-overview">{diff.overview}</p>
                <ul className="article-card-diff-list">
                  {diff.adjustments.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <p className="article-card-excerpt">{active.excerpt}…</p>
      </div>

      <footer className="article-card-foot">
        <Link href={`/articles/${data.id}`} className="article-card-more">
          看全文 →
        </Link>
        <Link
          href={`/compose?article_id=${data.id}`}
          className="btn btn-secondary"
          style={{ marginLeft: 'auto', fontSize: 14, padding: '6px 14px' }}
        >
          预览导出
        </Link>
      </footer>
    </article>
  );
}
