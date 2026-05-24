'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

/* ----------------------------------------------------------------- */
/* v3 schema (与 lib/prompts/fingerprint-v3-stage2.ts 对齐)            */
/* J 没完成的时候这些字段都会缺失；UI 层做完整 fallback。              */
/* ----------------------------------------------------------------- */

export interface PlatformFingerprint {
  fingerprint_summary?: string;
  language?: {
    sentence_length?: string;
    vocabulary_register?: string;
    verbal_tics?: string[];
  };
  structure?: {
    opening_hook?: string;
    transition_style?: string;
    closing_pattern?: string;
  };
  topic?: {
    topic_preference?: string;
    viewpoint_density?: string;
    argumentation?: string;
  };
  visual?: {
    image_style?: string;
    emoji_usage?: string;
    layout_preference?: string;
  };
  platform_specific_traits?: string[];
  strengths?: string[];
  weaknesses?: string[];
  /** 该平台已学习的样本篇数（K 在外面算好传进来） */
  studiedCount?: number;
}

export interface DomainVariation {
  differences_from_default?: string;
  preferred_structure?: string;
  tone_shift?: string;
}

export interface CrossComparison {
  topic_example?: string;
  platform_a?: string;
  platform_a_treatment?: string;
  platform_b?: string;
  platform_b_treatment?: string;
  why_adjusted?: string;
}

export interface CrossPlatformReport {
  summary?: string;
  comparisons?: CrossComparison[];
  transferable_patterns?: string[];
}

export interface StrategyFragment {
  tag?: string;
  platform_scope?: string[];
  domain_scope?: string[];
  title?: string;
  description?: string;
  example?: string;
  when_to_use?: string;
  why_works?: string;
}

export interface FingerprintV3 {
  // v3
  author_summary?: string;
  user_facing_summary?: string;
  platforms_analyzed?: string[];
  domains_analyzed?: string[];
  platform_fingerprints?: Record<string, PlatformFingerprint>;
  domain_variations?: Record<string, DomainVariation>;
  cross_platform_report?: CrossPlatformReport;
  strategy_fragments?: StrategyFragment[];

  // v1/v2 老字段（降级用）
  fingerprint_summary?: string;
  language?: PlatformFingerprint['language'];
  structure?: PlatformFingerprint['structure'];
  topic?: PlatformFingerprint['topic'];
  visual?: PlatformFingerprint['visual'];
  do_list?: string[];
  dont_list?: string[];
  strategies?: Array<{
    tag?: string;
    scope?: string[];
    description?: string;
    example?: string;
    when_to_use?: string;
  }>;
  strengths?: string[];
  weaknesses?: string[];
  category_variance?: Record<string, string>;
}

interface Props {
  authorId: string;
  authorName: string;
  fingerprint: FingerprintV3;
  fingerprintId: string;
  /** 用于 Tab 1：每个平台下已学习的篇数（按平台聚合后的数字） */
  platformStudiedCount: Record<string, number>;
  /** v1/v2 老指纹时，至少给一个 platform 名（用 author.platform 回退） */
  fallbackPlatform: string;
  /** 总学习篇数（用于顶部展示） */
  totalStudied: number;
}

const TABS = [
  { id: 'platforms', label: '平台分组指纹' },
  { id: 'domains', label: '领域差异' },
  { id: 'cross', label: '跨平台对比' },
  { id: 'fragments', label: '策略碎片库' },
] as const;
type TabId = typeof TABS[number]['id'];

export function AuthorDetailV3({
  authorId,
  authorName,
  fingerprint,
  fingerprintId,
  platformStudiedCount,
  fallbackPlatform,
  totalStudied,
}: Props) {
  const [tab, setTab] = useState<TabId>('platforms');

  const isV3 = !!fingerprint.platform_fingerprints;
  const crossAvailable =
    !!fingerprint.cross_platform_report &&
    (fingerprint.platforms_analyzed?.length ?? 0) >= 2;

  // 把 v1/v2 老结构「拍扁」成单平台 platform_fingerprints，便于 Tab 1 复用同一套渲染
  const platformGroups: Record<string, PlatformFingerprint> = useMemo(() => {
    if (isV3 && fingerprint.platform_fingerprints) {
      return fingerprint.platform_fingerprints;
    }
    // 降级：把老字段塞进一个虚拟平台
    const legacy: PlatformFingerprint = {
      fingerprint_summary: fingerprint.fingerprint_summary,
      language: fingerprint.language,
      structure: fingerprint.structure,
      topic: fingerprint.topic,
      visual: fingerprint.visual,
      platform_specific_traits: fingerprint.do_list,
      strengths: fingerprint.strengths,
      weaknesses: fingerprint.weaknesses,
    };
    return { [fallbackPlatform || '未指定']: legacy };
  }, [fingerprint, isV3, fallbackPlatform]);

  // 策略碎片：v3 用 strategy_fragments；老版回退 strategies
  const fragments: StrategyFragment[] = useMemo(() => {
    if (isV3 && Array.isArray(fingerprint.strategy_fragments)) {
      return fingerprint.strategy_fragments;
    }
    const old = fingerprint.strategies ?? [];
    return old.map<StrategyFragment>((s) => ({
      tag: s.tag,
      title: s.description?.slice(0, 14) || '未命名碎片',
      description: s.description,
      example: s.example,
      when_to_use: s.when_to_use,
      domain_scope: s.scope,
      platform_scope: [fallbackPlatform || '未指定'],
    }));
  }, [fingerprint, isV3, fallbackPlatform]);

  // 领域差异：v3 用 domain_variations；老版回退 category_variance
  const domainEntries: Array<[string, DomainVariation]> = useMemo(() => {
    if (isV3 && fingerprint.domain_variations) {
      return Object.entries(fingerprint.domain_variations);
    }
    const cv = fingerprint.category_variance ?? {};
    return Object.entries(cv).map<[string, DomainVariation]>(([k, v]) => [
      k,
      { differences_from_default: v },
    ]);
  }, [fingerprint, isV3]);

  return (
    <>
      {/* 顶部 user_facing_summary（仅 v3 有；v1/v2 用 fingerprint_summary） */}
      {(fingerprint.user_facing_summary || fingerprint.author_summary) && (
        <div className="dna-card">
          <div className="dna-eyebrow">写作 DNA · 总览</div>
          {fingerprint.author_summary && (
            <p className="dna-summary">{fingerprint.author_summary}</p>
          )}
          {fingerprint.user_facing_summary && (
            <p className="dna-fingerprint">{fingerprint.user_facing_summary}</p>
          )}
        </div>
      )}

      <div
        className="topic-tabs"
        role="tablist"
        style={{ marginTop: 28, marginBottom: 24 }}
      >
        {TABS.map((t) => {
          const disabled = t.id === 'cross' && !crossAvailable;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              disabled={disabled}
              className={`topic-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              title={
                disabled ? '该博主只学习了 1 个平台，无跨平台数据' : undefined
              }
              style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              {t.label}
              {t.id === 'fragments' && fragments.length > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.5 }}>· {fragments.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'platforms' && (
        <PlatformsPanel
          groups={platformGroups}
          studiedCount={platformStudiedCount}
          totalStudied={totalStudied}
          isV3={isV3}
        />
      )}

      {tab === 'domains' && (
        <DomainsPanel
          entries={domainEntries}
          authorId={authorId}
        />
      )}

      {tab === 'cross' && crossAvailable && fingerprint.cross_platform_report && (
        <CrossPanel
          report={fingerprint.cross_platform_report}
          platforms={fingerprint.platforms_analyzed ?? []}
        />
      )}

      {tab === 'fragments' && (
        <FragmentsPanel
          fragments={fragments}
          authorName={authorName}
          fingerprintId={fingerprintId}
        />
      )}

      <div style={{ marginTop: 28 }}>
        <Link
          href={`/fingerprints/${fingerprintId}`}
          className="link"
          style={{ fontSize: 13 }}
        >
          打开指纹原始视图 →
        </Link>
      </div>
    </>
  );
}

/* ============================================================== */
/* Tab 1 · 平台分组指纹                                            */
/* ============================================================== */

function PlatformsPanel({
  groups,
  studiedCount,
  totalStudied,
  isV3,
}: {
  groups: Record<string, PlatformFingerprint>;
  studiedCount: Record<string, number>;
  totalStudied: number;
  isV3: boolean;
}) {
  const platforms = Object.keys(groups);

  if (platforms.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">还没有任何平台指纹</p>
        <p className="empty-state-desc">
          这通常出现在指纹 JSON 解析失败、或拆解过程中途断开时。
          再去补几篇试试 v3 拆解，会自动按平台分组。
        </p>
      </div>
    );
  }

  return (
    <div>
      {!isV3 && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: '0 0 14px',
            padding: '8px 12px',
            background: 'var(--surface-light)',
            borderRadius: 8,
            border: '1px dashed var(--border)',
          }}
        >
          这是 v1 / v2 老指纹，只有单平台数据。后续做 v3 优化拆解时，会自动按平台分组学习。
        </p>
      )}
      {platforms.map((p) => {
        const fp = groups[p];
        const studied =
          studiedCount[p] ?? (platforms.length === 1 ? totalStudied : undefined);
        return (
          <section key={p} className="platform-block">
            <div className="platform-block-head">
              <h3 className="platform-block-name">{p}</h3>
              {typeof studied === 'number' && (
                <span className="platform-block-meta">
                  已学习 {studied} 篇
                </span>
              )}
            </div>

            {fp.fingerprint_summary && (
              <p className="platform-block-summary">{fp.fingerprint_summary}</p>
            )}

            <h4 className="fp-grid-section-title" style={{ marginTop: 8 }}>
              四象限拆解
            </h4>
            <div className="fp-grid">
              <Quadrant
                tint="language"
                title="语言"
                eyebrow="LANGUAGE"
                rows={[
                  { label: '句长', value: fp.language?.sentence_length },
                  { label: '词性', value: fp.language?.vocabulary_register },
                  {
                    label: '口头禅',
                    value: fp.language?.verbal_tics?.length
                      ? fp.language?.verbal_tics?.join(' / ')
                      : undefined,
                  },
                ]}
              />
              <Quadrant
                tint="structure"
                title="结构"
                eyebrow="STRUCTURE"
                rows={[
                  { label: '开篇钩子', value: fp.structure?.opening_hook },
                  { label: '段落转场', value: fp.structure?.transition_style },
                  { label: '收尾套路', value: fp.structure?.closing_pattern },
                ]}
              />
              <Quadrant
                tint="topic"
                title="题材"
                eyebrow="TOPIC"
                rows={[
                  { label: '偏爱题材', value: fp.topic?.topic_preference },
                  { label: '观点密度', value: fp.topic?.viewpoint_density },
                  { label: '论证方式', value: fp.topic?.argumentation },
                ]}
              />
              <Quadrant
                tint="visual"
                title="视觉"
                eyebrow="VISUAL"
                rows={[
                  { label: '配图风格', value: fp.visual?.image_style },
                  { label: 'Emoji', value: fp.visual?.emoji_usage },
                  { label: '版式偏好', value: fp.visual?.layout_preference },
                ]}
              />
            </div>

            {/* 平台特有 traits + 优势 + 失灵 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
                marginTop: 18,
              }}
              className="platform-traits-grid"
            >
              <ListMiniCard
                title="该平台独特动作"
                items={fp.platform_specific_traits ?? []}
                emptyHint="（暂无）"
              />
              <ListMiniCard
                title="在该平台的优势"
                items={fp.strengths ?? []}
                emptyHint="（暂无）"
              />
              <ListMiniCard
                title="在该平台会失灵的场景"
                items={fp.weaknesses ?? []}
                emptyHint="（暂无）"
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Quadrant({
  tint,
  title,
  eyebrow,
  rows,
}: {
  tint: 'language' | 'structure' | 'topic' | 'visual';
  title: string;
  eyebrow: string;
  rows: Array<{ label: string; value?: string }>;
}) {
  return (
    <article className="fp-quadrant" data-tint={tint}>
      <div className="fp-q-head">
        <h3 className="fp-q-title">{title}</h3>
        <span className="fp-q-eyebrow">{eyebrow}</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="fp-q-row">
          <span className="fp-q-label">{r.label}</span>
          <span className="fp-q-value">{r.value || '—'}</span>
        </div>
      ))}
    </article>
  );
}

function ListMiniCard({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: string[];
  emptyHint: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {emptyHint}
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
          }}
        >
          {items.map((it, i) => (
            <li key={i}>· {it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================== */
/* Tab 2 · 领域差异                                                */
/* ============================================================== */

function DomainsPanel({
  entries,
  authorId,
}: {
  entries: Array<[string, DomainVariation]>;
  authorId: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">还没有领域差异数据</p>
        <p className="empty-state-desc">
          v3 拆解会按博主在不同领域（商业观察 / 情感 / 教学 等）写法的偏移
          自动归纳。再补几篇不同领域的文章，重新拆解一次就能看到。
        </p>
        <Link href={`/authors/${authorId}/optimize`} className="btn btn-primary">
          再加文章优化指纹
          <span className="btn-arrow">→</span>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p
        className="fp-grid-section-sub"
        style={{ margin: '0 0 14px' }}
      >
        同一位博主，写不同领域时的微调。
      </p>
      {entries.map(([name, dv]) => (
        <div key={name} className="domain-card">
          <h3 className="domain-card-name">{name}</h3>
          {dv.differences_from_default && (
            <div className="domain-card-row">
              <span className="domain-card-row-label">相对默认</span>
              <span className="domain-card-row-value">{dv.differences_from_default}</span>
            </div>
          )}
          {dv.preferred_structure && (
            <div className="domain-card-row">
              <span className="domain-card-row-label">偏爱结构</span>
              <span className="domain-card-row-value">{dv.preferred_structure}</span>
            </div>
          )}
          {dv.tone_shift && (
            <div className="domain-card-row">
              <span className="domain-card-row-label">口吻偏移</span>
              <span className="domain-card-row-value">{dv.tone_shift}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================== */
/* Tab 3 · 跨平台对比                                              */
/* ============================================================== */

function CrossPanel({
  report,
  platforms,
}: {
  report: CrossPlatformReport;
  platforms: string[];
}) {
  return (
    <div>
      <p
        className="fp-grid-section-sub"
        style={{ margin: '0 0 16px' }}
      >
        已学习平台：{platforms.join(' / ') || '—'}
      </p>

      {report.summary && (
        <div className="cross-summary">{report.summary}</div>
      )}

      {Array.isArray(report.comparisons) && report.comparisons.length > 0 && (
        <>
          <h3 className="fp-grid-section-title">逐条对比</h3>
          {report.comparisons.map((c, i) => (
            <div key={i}>
              {c.topic_example && (
                <p className="cmp-topic-example">题材 · {c.topic_example}</p>
              )}
              <div className="cmp-row">
                <div className="cmp-side">
                  <p className="cmp-side-platform">{c.platform_a || '平台 A'}</p>
                  <p className="cmp-side-treatment">
                    {c.platform_a_treatment || '—'}
                  </p>
                </div>
                <div className="cmp-arrow">→</div>
                <div className="cmp-side">
                  <p className="cmp-side-platform">{c.platform_b || '平台 B'}</p>
                  <p className="cmp-side-treatment">
                    {c.platform_b_treatment || '—'}
                  </p>
                </div>
              </div>
              {c.why_adjusted && <div className="cmp-why">为什么调：{c.why_adjusted}</div>}
            </div>
          ))}
        </>
      )}

      {Array.isArray(report.transferable_patterns) &&
        report.transferable_patterns.length > 0 && (
          <>
            <h3 className="fp-grid-section-title">可跨平台保留的模式</h3>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {report.transferable_patterns.map((p, i) => (
                <li
                  key={i}
                  style={{
                    padding: '12px 16px',
                    background: 'var(--surface-light)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: 'var(--text-secondary)',
                  }}
                >
                  · {p}
                </li>
              ))}
            </ul>
          </>
        )}
    </div>
  );
}

/* ============================================================== */
/* Tab 4 · 策略碎片库                                              */
/* ============================================================== */

const FAV_STORAGE_KEY = 'autoarticle:fav-fragments';

function loadFavs(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(FAV_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveFavs(s: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(Array.from(s)));
  } catch {/* ignore */}
}

function FragmentsPanel({
  fragments,
  authorName,
  fingerprintId,
}: {
  fragments: StrategyFragment[];
  authorName: string;
  fingerprintId: string;
}) {
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [favs, setFavs] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFavs(loadFavs());
  }, []);

  // 收集所有 tag / platform / domain 选项
  const allTags = useMemo(() => {
    const s = new Set<string>();
    fragments.forEach((f) => { if (f.tag) s.add(f.tag); });
    return Array.from(s).sort();
  }, [fragments]);

  const allPlatforms = useMemo(() => {
    const s = new Set<string>();
    fragments.forEach((f) => (f.platform_scope ?? []).forEach((p) => s.add(p)));
    return Array.from(s).sort();
  }, [fragments]);

  const allDomains = useMemo(() => {
    const s = new Set<string>();
    fragments.forEach((f) => (f.domain_scope ?? []).forEach((d) => s.add(d)));
    return Array.from(s).sort();
  }, [fragments]);

  const filtered = useMemo(() => {
    return fragments.filter((f) => {
      if (tagFilter !== 'all' && f.tag !== tagFilter) return false;
      if (platformFilter !== 'all') {
        const ps = f.platform_scope ?? [];
        if (!ps.includes(platformFilter)) return false;
      }
      if (domainFilter !== 'all') {
        const ds = f.domain_scope ?? [];
        if (!ds.includes(domainFilter)) return false;
      }
      return true;
    });
  }, [fragments, tagFilter, platformFilter, domainFilter]);

  function fragmentKey(f: StrategyFragment, i: number): string {
    return `${fingerprintId}::${f.title ?? ''}::${i}`;
  }

  function toggleFav(key: string) {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavs(next);
      return next;
    });
  }

  if (fragments.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">还没有策略碎片</p>
        <p className="empty-state-desc">
          v3 拆解会按博主跨篇综合出 15-25 条可复用碎片（开篇 / 收尾 / 转场 / 论证 等等）。
          v1 老指纹没有这一字段——补几篇再拆解一次就能看到。
        </p>
      </div>
    );
  }

  return (
    <div>
      <p
        className="fp-grid-section-sub"
        style={{ margin: '0 0 14px' }}
      >
        从「{authorName}」身上拆出来的 {fragments.length} 条可复用写作策略。
        喜欢的可以收藏，写文章时会优先调用。
      </p>

      <div className="fragments-toolbar">
        <span className="fragments-toolbar-label">tag</span>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="all">全部</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        {allPlatforms.length > 0 && (
          <>
            <span className="fragments-toolbar-label" style={{ marginLeft: 12 }}>
              适用平台
            </span>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
            >
              <option value="all">全部</option>
              {allPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        )}

        {allDomains.length > 0 && (
          <>
            <span className="fragments-toolbar-label" style={{ marginLeft: 12 }}>
              适用领域
            </span>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
            >
              <option value="all">全部</option>
              {allDomains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </>
        )}

        <span style={{ flex: 1 }} />
        <span className="fragments-toolbar-label">
          {filtered.length === fragments.length
            ? `共 ${fragments.length} 条`
            : `${filtered.length} / ${fragments.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 13,
          }}
        >
          当前筛选下没有匹配的碎片。
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {filtered.map((f, i) => {
            const key = fragmentKey(f, i);
            const faved = favs.has(key);
            return (
              <div key={key} className="fragment-card">
                <div className="fragment-card-head">
                  {f.tag && <span className="tag tag-lang">{f.tag}</span>}
                  <h4 className="fragment-card-title">{f.title || '未命名碎片'}</h4>
                </div>

                {f.description && (
                  <p className="fragment-card-desc">{f.description}</p>
                )}

                {f.example && (
                  <div className="fragment-card-example">{f.example}</div>
                )}

                {(f.when_to_use || f.why_works) && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      fontSize: 12,
                      color: 'var(--text-tertiary)',
                      lineHeight: 1.7,
                    }}
                  >
                    {f.when_to_use && <div>何时用：{f.when_to_use}</div>}
                    {f.why_works && <div>为什么有效：{f.why_works}</div>}
                  </div>
                )}

                <div className="fragment-card-meta">
                  {(f.platform_scope ?? []).length > 0 && (
                    <div className="fragment-card-meta-row">
                      <span>适用平台</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {(f.platform_scope ?? []).join(' / ')}
                      </span>
                    </div>
                  )}
                  {(f.domain_scope ?? []).length > 0 && (
                    <div className="fragment-card-meta-row">
                      <span>适用领域</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {(f.domain_scope ?? []).join(' / ')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="fragment-card-foot">
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {faved ? '已收藏 · 写文章时优先用' : ''}
                  </span>
                  <button
                    type="button"
                    className={`fragment-fav-btn${faved ? ' faved' : ''}`}
                    onClick={() => toggleFav(key)}
                  >
                    {faved ? '★ 已收藏' : '☆ 收藏'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
