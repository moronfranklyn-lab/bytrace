'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PlatformKey } from '@/lib/platforms';
import { getPlatform } from '@/lib/platforms';

/**
 * Step 7 · 右抽屉「拆解此文产出逻辑」面板内容。
 *
 * 数据来源：
 *   - props.compositionSummary / props.whyMatch（推荐时返回的，前端透传）
 *   - GET /api/articles/:id（取 composition / outline / fingerprints / strategy_fragments）
 *
 * 默认折叠由父组件（Panel）控制；本组件只负责面板 body。
 */

interface CompositionExplainerProps {
  articleId: string | null;
  /** 推荐时返回的 composition_summary（生成完文章后透传过来；可能为空） */
  compositionSummary?: string | null;
  /** 推荐时返回的 why_match */
  whyMatch?: string | null;
  /** 目标平台（用于"为目标平台做了什么调整"段） */
  targetPlatform: PlatformKey | null;
  /** 文章正文 markdown（用于估算策略碎片出现位置） */
  contentMd: string;
}

interface FingerprintInfo {
  fingerprint_id: string;
  author_id: string;
  author_name: string;
  platform: string | null;
  weight: number;
  has_v3: boolean;
  strategy_fragments: Array<{
    tag?: string;
    platform_scope?: string[];
    title?: string;
    description?: string;
    when_to_use?: string;
  }>;
}

interface OutlineSection {
  index: number;
  title: string;
  word_budget: number;
}

interface ArticleDetail {
  id: string;
  title: string;
  platform_target: string | null;
  composition: { selected_authors?: Array<{ author_id: string; fingerprint_id: string; weight: number }> };
  outline: { sections?: OutlineSection[]; working_title?: string } | null;
  fingerprints: FingerprintInfo[];
}

export function CompositionExplainer({
  articleId,
  compositionSummary,
  whyMatch,
  targetPlatform,
  contentMd,
}: CompositionExplainerProps) {
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!articleId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/articles/${articleId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ArticleDetail | { error: string };
      })
      .then((j) => {
        if (cancelled) return;
        if ('error' in j) {
          setError(j.error);
        } else {
          setDetail(j);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  // 估算每条 strategy_fragment 在文章哪个章节出现：用很朴素的关键词命中（fragment.title 出现在哪个 ## 后）
  function estimateAnchor(title: string | undefined): string {
    if (!title || !contentMd) return '全文';
    // 取 fragment.title 前 4 字做关键词
    const kw = title.slice(0, 4);
    if (!kw) return '全文';
    const idx = contentMd.indexOf(kw);
    if (idx < 0) return '全文（未明显命中）';
    // 找在 idx 之前的最近一个 ## 标题
    const before = contentMd.slice(0, idx);
    const h2s = before.match(/^##\s+(.+)$/gm) ?? [];
    if (h2s.length === 0) return '开篇';
    const last = h2s[h2s.length - 1].replace(/^##\s+/, '').trim();
    return last;
  }

  if (!articleId) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
        文章保存后会在这里告诉你它是怎么调出来的。
      </p>
    );
  }
  if (loading) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
        正在拉这篇的配方解释…
      </p>
    );
  }
  if (error) {
    return (
      <p style={{ fontSize: 12, color: 'var(--error)', margin: 0 }}>
        拿不到这篇的配方：{error}
      </p>
    );
  }
  if (!detail) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
        没找到对应的文章记录。
      </p>
    );
  }

  const fingerprints = detail.fingerprints ?? [];
  const weightSum = fingerprints.reduce((s, f) => s + (Number.isFinite(f.weight) ? f.weight : 0), 0) || 1;
  const target = targetPlatform ? getPlatform(targetPlatform) : null;

  // 选 6 条最有代表性的策略碎片：优先 platform_scope 命中目标平台
  const allFragments: Array<{ author: FingerprintInfo; frag: FingerprintInfo['strategy_fragments'][number] }> = [];
  for (const fp of fingerprints) {
    for (const f of fp.strategy_fragments) {
      allFragments.push({ author: fp, frag: f });
    }
  }
  const targetCn = target?.name ?? null;
  const sortedFragments = [...allFragments].sort((a, b) => {
    const hitA = targetCn && a.frag.platform_scope?.includes(targetCn) ? 1 : 0;
    const hitB = targetCn && b.frag.platform_scope?.includes(targetCn) ? 1 : 0;
    return hitB - hitA;
  });
  const shownFragments = sortedFragments.slice(0, 8);

  return (
    <div className="composition-explainer">
      <h4 className="explainer-h4">这篇文章是怎么调出来的</h4>

      {fingerprints.length > 0 && (
        <section className="explainer-section">
          <p className="explainer-label">用了哪几位博主</p>
          <ul className="explainer-author-list">
            {fingerprints.map((f) => {
              const pct = Math.round((f.weight / weightSum) * 100);
              return (
                <li key={f.fingerprint_id} className="explainer-author-row">
                  <Link href={`/authors/${f.author_id}`} className="explainer-author-link">
                    {f.author_name}
                  </Link>
                  <span className="explainer-author-platform">{f.platform ?? '未标平台'}</span>
                  {f.has_v3 && <span className="explainer-author-badge">v3</span>}
                  <span className="explainer-author-weight">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {compositionSummary && (
        <section className="explainer-section">
          <p className="explainer-label">配方概述</p>
          <p className="explainer-paragraph">{compositionSummary}</p>
        </section>
      )}

      {whyMatch && (
        <section className="explainer-section">
          <p className="explainer-label">为什么选这套配方</p>
          <p className="explainer-paragraph">{whyMatch}</p>
        </section>
      )}

      {shownFragments.length > 0 && (
        <section className="explainer-section">
          <p className="explainer-label">用到了哪些策略碎片</p>
          <ul className="explainer-fragment-list">
            {shownFragments.map((entry, i) => {
              const f = entry.frag;
              const anchor = estimateAnchor(f.title);
              return (
                <li key={i} className="explainer-fragment-row">
                  {f.tag && <span className="explainer-fragment-tag">{f.tag}</span>}
                  <span className="explainer-fragment-title">{f.title ?? '—'}</span>
                  <span className="explainer-fragment-author">来自 {entry.author.author_name}</span>
                  <span className="explainer-fragment-anchor">出现在「{anchor}」</span>
                  {f.description && <span className="explainer-fragment-desc">{f.description}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {target && (
        <section className="explainer-section">
          <p className="explainer-label">为目标平台「{target.name}」做了什么调整</p>
          <ul className="explainer-adjust-list">
            <li>字数压在 {target.word_range_min.toLocaleString()}–{target.word_range_max.toLocaleString()} 字之间</li>
            <li>节奏按「{target.pacing}」调密度</li>
            <li>钩子按「{target.hook_position}」摆位置</li>
            <li>结构对齐「{target.structure}」</li>
            {target.do_extra.slice(0, 2).map((d, i) => (
              <li key={`do-${i}`}>额外动作：{d}</li>
            ))}
          </ul>
        </section>
      )}

      {detail.outline?.sections && detail.outline.sections.length > 0 && (
        <section className="explainer-section">
          <p className="explainer-label">大纲骨架</p>
          <ol className="explainer-outline-list">
            {detail.outline.sections.map((s) => (
              <li key={s.index}>
                {s.title}
                <span className="explainer-outline-budget">约 {s.word_budget} 字</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
