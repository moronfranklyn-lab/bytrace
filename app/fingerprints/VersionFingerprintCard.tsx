'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface RadarBars {
  lang: number;
  struct: number;
  topic: number;
  visual: number;
}

interface Props {
  id: string;
  authorName: string;
  avatarChar: string;
  platformText: string;
  studied: number;
  dateText: string;
  radar: RadarBars;
  gradient?: string;
}

/**
 * 列表页 versions 视图的单卡：原来的 Link 卡 + 右上角 hover 出现的删除小图标。
 * 两段式确认：第一次点击图标 → 卡内浮出红色「再次点击删除」条；3 秒内再点 → 真删；
 * 否则自动撤回。复用 DELETE /api/fingerprint/v3/:id（已存在的级联删接口）。
 */
export function VersionFingerprintCard({
  id, authorName, avatarChar, platformText, studied, dateText, radar, gradient,
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onTrashClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setConfirming(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setConfirming(false), 3000);
  };

  const onCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const onConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/fingerprint/v3/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="fp-card-wrap" style={{ position: 'relative' }}>
      <Link href={`/fingerprints/${id}`} className="fp-card">
        <div
          className="fp-avatar"
          style={gradient ? { background: gradient } : undefined}
        >
          {avatarChar}
        </div>
        <h3 className="fp-name">{authorName}</h3>
        <p className="fp-stats">
          {platformText} · {studied} 篇 · {dateText}
        </p>
        <div className="fp-radar">
          <div className="fp-bar lang" style={{ height: `${radar.lang}%` }} />
          <div className="fp-bar struct" style={{ height: `${radar.struct}%` }} />
          <div className="fp-bar topic" style={{ height: `${radar.topic}%` }} />
          <div className="fp-bar visual" style={{ height: `${radar.visual}%` }} />
        </div>
      </Link>

      {!confirming && (
        <button
          type="button"
          onClick={onTrashClick}
          className="fp-card-trash"
          aria-label={`删除「${authorName}」这份指纹`}
          title="删除这份指纹"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      )}

      {confirming && (
        <div className="fp-card-confirm" role="alertdialog" aria-label={`确认删除${authorName}`}>
          <button
            type="button"
            onClick={onConfirmDelete}
            disabled={deleting}
            className="fp-card-confirm-yes"
          >
            {deleting ? '正在删除…' : '再点一次删除'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="fp-card-confirm-no"
            aria-label="取消"
          >
            取消
          </button>
        </div>
      )}

      {error && (
        <p className="fp-card-error" role="alert">{error}</p>
      )}
    </div>
  );
}
