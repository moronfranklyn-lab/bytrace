'use client';

import { useEffect, useState } from 'react';

interface Fragment {
  id: string;
  fingerprint_id: string;
  author_name: string | null;
  category: string | null;
  tag: string | null;
  title: string | null;
  description: string | null;
  example: string | null;
  when_to_use: string | null;
  why_works: string | null;
  platform_scope: string[];
  domain_scope: string[];
}

interface SearchResp {
  count: number;
  items: Fragment[];
  by_tag: Record<string, Fragment[]>;
}

const TAGS = [
  { key: '', label: '全部' },
  { key: 'opening', label: '开篇' },
  { key: 'transition', label: '转场' },
  { key: 'closing', label: '收尾' },
  { key: 'argument', label: '论证' },
  { key: 'language', label: '语言' },
  { key: 'hook', label: '钩子' },
  { key: 'pacing', label: '节奏' },
  { key: 'visual', label: '视觉' },
];

const PLATFORMS = ['', '公众号', '知乎', 'B 站', '小红书', '少数派', '优设'];

interface Props {
  categories: string[];
}

export function StrategyScout({ categories }: Props) {
  const [category, setCategory] = useState<string>(categories[0] ?? '科技');
  const [tag, setTag] = useState('');
  const [platform, setPlatform] = useState('');
  const [data, setData] = useState<SearchResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (tag) params.set('tag', tag);
    if (platform) params.set('platform', platform);
    params.set('limit', '30');
    fetch(`/api/strategies/search?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SearchResp) => setData(d))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [category, tag, platform]);

  return (
    <div>
      {/* 过滤条 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 6 }}>类别</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={'tag' + (category === c ? ' tag-active' : '')}
                onClick={() => setCategory(c)}
                style={{
                  cursor: 'pointer',
                  fontWeight: category === c ? 600 : 400,
                  border: category === c ? '1.5px solid currentColor' : '1px solid transparent',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 6 }}>手法</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TAGS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={'tag' + (tag === t.key ? ' tag-active' : '')}
                onClick={() => setTag(t.key)}
                style={{
                  cursor: 'pointer',
                  fontWeight: tag === t.key ? 600 : 400,
                  border: tag === t.key ? '1.5px solid currentColor' : '1px solid transparent',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 6 }}>平台</div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6 }}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p || '全部'}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div style={{ opacity: 0.7 }}>检索中…</div>}
      {error && (
        <div style={{ color: 'var(--danger, #c0392b)', marginBottom: 16 }}>
          检索失败：{error}
        </div>
      )}
      {!loading && data && data.count === 0 && (
        <div style={{ opacity: 0.7, padding: '32px 0' }}>
          这个组合下还没有碎片。多拆几个博主，或换一组筛选。
        </div>
      )}

      {!loading && data && data.count > 0 && (
        <>
          <div style={{ opacity: 0.65, fontSize: 13, marginBottom: 12 }}>
            找到 {data.count} 条 · 按手法分组
          </div>
          {Object.entries(data.by_tag).map(([tagKey, items]) => (
            <section key={tagKey} style={{ marginBottom: 28 }}>
              <h3 className="fp-grid-section-title" style={{ fontSize: 18, marginBottom: 8 }}>
                {TAGS.find((t) => t.key === tagKey)?.label || tagKey}
                <span style={{ opacity: 0.5, fontSize: 13, marginLeft: 8 }}>
                  · {items.length} 条
                </span>
              </h3>
              <div className="strategies-grid">
                {items.map((f) => (
                  <article key={f.id} className="strategy-card">
                    <div className="strategy-card-head">
                      {f.title && (
                        <span className="tag tag-lang" style={{ fontWeight: 600 }}>
                          {f.title}
                        </span>
                      )}
                      {f.author_name && (
                        <span className="tag" style={{ opacity: 0.75 }}>
                          {f.author_name}
                        </span>
                      )}
                      {f.platform_scope.length > 0 &&
                        f.platform_scope.slice(0, 2).map((p) => (
                          <span key={p} className="tag">{p}</span>
                        ))}
                    </div>
                    {f.description && (
                      <div className="strategy-card-desc">{f.description}</div>
                    )}
                    {f.example && (
                      <div className="strategy-card-example">「{f.example}」</div>
                    )}
                    {f.when_to_use && (
                      <div className="strategy-card-when">
                        <strong>何时用：</strong>{f.when_to_use}
                      </div>
                    )}
                    {f.why_works && (
                      <div className="strategy-card-when" style={{ opacity: 0.75 }}>
                        <strong>为什么有效：</strong>{f.why_works}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
