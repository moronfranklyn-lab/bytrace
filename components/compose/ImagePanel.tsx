'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ImagePanel —— 自动配图面板内容。
 *
 * 由 E 的 compose 页作为 <Panel> 的 children 挂载。Panel 自己负责折叠/标题/图标，
 * 这里只负责面板内的状态、检索来源勾选、缩略图网格、候选切换。
 *
 * Props 接口签名（导出给 E 用）：
 *   - articleContent: 已生成的成稿文章正文（必传，触发自动配图时用）
 *   - fingerprintId:  当前用的指纹 id（可选；用于读 visual.image_style）
 *   - slotCount:      建议插入张数（默认 3）
 *   - localAssetCount: 当前本地素材库数量（来自 server props）
 *   - onSelectionChange?: 选中候选变化时回调（让 E 把图回填到预览）
 */

export type ImageSource = 'local' | 'unsplash';

export interface SlotCandidate {
  source: ImageSource;
  id: string;
  preview_url: string;
  full_url: string;
  alt: string | null;
  author?: string | null;
  author_url?: string | null;
}

export interface Slot {
  slot_index: number;
  position_anchor: string;
  intent_zh: string;
  intent_en: string;
  caption: string;
  candidates: SlotCandidate[];
  selected_index: number; // index into candidates
}

export interface ImagePanelProps {
  articleContent: string;
  fingerprintId?: string | null;
  slotCount?: number;
  localAssetCount?: number;
  unsplashConfigured?: boolean;
  onSelectionChange?: (slots: Slot[]) => void;
  /** 设为 true 时：组件挂载后若 articleContent 够长且还没跑过，自动 trigger 一次配图。Step 7 draft 完成后接进来用 */
  autoStart?: boolean;
}

interface AutoResponse {
  ok: boolean;
  error?: string;
  visual_style?: string | null;
  unsplash_configured?: boolean;
  slot_count?: number;
  slots?: Array<Omit<Slot, 'selected_index'>>;
}

export function ImagePanel({
  articleContent,
  fingerprintId,
  slotCount = 3,
  localAssetCount = 0,
  unsplashConfigured = false,
  onSelectionChange,
  autoStart = false,
}: ImagePanelProps) {
  const [useLocal, setUseLocal] = useState(true);
  const [useUnsplash, setUseUnsplash] = useState(unsplashConfigured);
  const [useCrawl, setUseCrawl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [visualStyle, setVisualStyle] = useState<string | null>(null);
  // autoStart 只触发一次：防止 articleContent 后续变化重复跑
  const autoStartedRef = useRef(false);

  // 通知父组件
  useEffect(() => {
    onSelectionChange?.(slots);
  }, [slots, onSelectionChange]);

  const runAuto = useCallback(async () => {
    if (!articleContent || articleContent.trim().length < 50) {
      setError('先把文章写出来再配图');
      return;
    }
    const sources: ImageSource[] = [];
    if (useLocal) sources.push('local');
    if (useUnsplash) sources.push('unsplash');
    if (sources.length === 0) {
      setError('至少勾一个检索来源');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/images/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_content: articleContent,
          fingerprint_id: fingerprintId ?? undefined,
          slot_count: slotCount,
          sources,
        }),
      });
      const data = (await res.json()) as AutoResponse;
      if (!res.ok || !data.ok) {
        setError(data.error || '配图这次没成，再试一次');
        setLoading(false);
        return;
      }
      const ss: Slot[] = (data.slots ?? []).map((s) => ({
        ...s,
        selected_index: 0,
      }));
      setSlots(ss);
      setVisualStyle(data.visual_style ?? null);
    } catch (err) {
      setError(`网络错了：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [articleContent, useLocal, useUnsplash, fingerprintId, slotCount]);

  // autoStart：draft 完成后 Step 7 挂上来时自动跑一次
  useEffect(() => {
    if (!autoStart) return;
    if (autoStartedRef.current) return;
    if (loading) return;
    if (slots.length > 0) return;
    if (articleContent.trim().length < 50) return;
    autoStartedRef.current = true;
    void runAuto();
  }, [autoStart, articleContent, loading, slots.length, runAuto]);

  function cycleSlotCandidate(slotIdx: number) {
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i !== slotIdx) return s;
        if (s.candidates.length === 0) return s;
        return {
          ...s,
          selected_index: (s.selected_index + 1) % s.candidates.length,
        };
      }),
    );
  }

  const matchedLocal = slots.reduce(
    (n, s) => n + (s.candidates[s.selected_index]?.source === 'local' ? 1 : 0),
    0,
  );
  const matchedUnsplash = slots.reduce(
    (n, s) => n + (s.candidates[s.selected_index]?.source === 'unsplash' ? 1 : 0),
    0,
  );

  return (
    <div>
      {/* 状态区 */}
      <div className="img-status">
        <span className="img-status-icon" aria-hidden="true">
          {slots.length > 0 ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          )}
        </span>
        <span className="img-status-text">
          {slots.length === 0 ? (
            <>
              还没配图 ·{' '}
              <strong>{localAssetCount}</strong> 张本地素材已就绪
            </>
          ) : (
            <>
              已按{' '}
              <strong>{visualStyle ? visualStyle : '默认'}</strong> 配图风格匹配{' '}
              {slots.length} 张
              <br />
              <span style={{ color: 'var(--text-muted)' }}>
                来源 · 本地 {matchedLocal} 张 + Unsplash {matchedUnsplash} 张
              </span>
            </>
          )}
        </span>
      </div>

      {/* 缩略图网格 */}
      {slots.length > 0 ? (
        <div className="img-thumbs">
          {slots.map((s, i) => {
            const cand = s.candidates[s.selected_index];
            return (
              <button
                type="button"
                key={s.slot_index}
                className="img-thumb"
                title={`${s.intent_zh} · ${cand?.source ?? '无候选'}（点击切换候选）`}
                onClick={() => cycleSlotCandidate(i)}
                style={
                  cand?.preview_url
                    ? {
                        backgroundImage: `url(${cand.preview_url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        opacity: 1,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : null}

      {error ? (
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 12,
            color: 'var(--error)',
            lineHeight: 1.5,
          }}
        >
          {error}
        </p>
      ) : null}

      {/* 操作按钮 */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={runAuto}
          disabled={loading}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          {loading
            ? '匹配中…'
            : slots.length > 0
              ? '重新匹配'
              : '开始自动配图'}
        </button>
      </div>

      {/* 来源勾选 */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}
      >
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            margin: '0 0 8px',
          }}
        >
          检索来源
        </p>
        <div className="img-options">
          <label className="img-option">
            <input
              type="checkbox"
              checked={useLocal}
              onChange={(e) => setUseLocal(e.target.checked)}
            />
            <div className="img-option-text">
              <strong>本地素材库</strong>
              优先匹配 · {localAssetCount} 张已打标
            </div>
          </label>
          <label className="img-option">
            <input
              type="checkbox"
              checked={useUnsplash}
              onChange={(e) => setUseUnsplash(e.target.checked)}
              disabled={!unsplashConfigured}
            />
            <div className="img-option-text">
              <strong>免费图库</strong>
              {unsplashConfigured
                ? 'Unsplash · 商用免费'
                : '未配置 Unsplash key · 暂不可用'}
            </div>
          </label>
          <label className="img-option">
            <input
              type="checkbox"
              checked={useCrawl}
              onChange={(e) => setUseCrawl(e.target.checked)}
              disabled
            />
            <div className="img-option-text">
              <strong>站点爬取</strong>
              从指定网站抓图入本地库 · 在站点页配置
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
