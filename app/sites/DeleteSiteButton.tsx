'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  siteId: string;
  siteName: string;
}

export function DeleteSiteButton({ siteId, siteName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      window.setTimeout(() => setConfirming(false), 3500);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-delete-wrap">
      <button
        type="button"
        className={`site-delete-btn${confirming ? ' confirming' : ''}`}
        onClick={onDelete}
        disabled={busy}
        title={confirming ? `确认删除「${siteName}」` : '删除这个站点画像'}
      >
        {busy ? '删中…' : confirming ? '再点确认删除' : '删除'}
      </button>
      {error && <span className="site-delete-error">{error}</span>}
    </div>
  );
}
