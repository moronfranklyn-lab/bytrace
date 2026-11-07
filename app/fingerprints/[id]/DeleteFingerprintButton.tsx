'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  fingerprintId: string;
  authorName: string;
}

/**
 * 删除指纹按钮。
 * 两段式确认：第一次点击 → 按钮变红「确认删除」；3 秒内再点 → 真删；
 * 否则自动恢复，避免误操作。
 */
export function DeleteFingerprintButton({ fingerprintId, authorName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startConfirm = () => {
    setConfirming(true);
    setError(null);
    // 3 秒内不点就撤销
    setTimeout(() => setConfirming((prev) => prev), 3000);
    setTimeout(() => {
      setConfirming(false);
    }, 3000);
  };

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/fingerprint/v3/${fingerprintId}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      // 删除成功 → 回到指纹列表页
      router.push('/fingerprints');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      {confirming ? (
        <button
          type="button"
          onClick={doDelete}
          disabled={deleting}
          className="btn"
          style={{
            background: 'var(--danger, #c0392b)',
            color: '#fff',
            border: 'none',
          }}
          title={`确认删除「${authorName}」这份指纹（含所有样本和策略碎片）`}
        >
          {deleting ? '正在删除…' : '确认删除（3 秒内再次点击）'}
        </button>
      ) : (
        <button
          type="button"
          onClick={startConfirm}
          className="btn btn-ghost"
          style={{ color: 'var(--danger, #c0392b)' }}
          title="删除这份指纹"
        >
          删除指纹
        </button>
      )}
      {error && (
        <span style={{ fontSize: 12, color: 'var(--danger, #c0392b)' }}>{error}</span>
      )}
    </div>
  );
}
