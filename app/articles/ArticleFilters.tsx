'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

interface Props {
  q: string;
  fingerprint: string;
  platform: string;
  layout: string;
  fingerprints: { id: string; author_name: string }[];
  platforms: string[];
  layouts: string[];
}

export function ArticleFilters({
  q,
  fingerprint,
  platform,
  layout,
  fingerprints,
  platforms,
  layouts,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [qDraft, setQDraft] = useState(q);
  const [fp, setFp] = useState(fingerprint);
  const [plat, setPlat] = useState(platform);
  const [lay, setLay] = useState(layout);

  const push = (params: Record<string, string>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const tail = qs.toString();
    startTransition(() => {
      router.push(tail ? `/articles?${tail}` : '/articles');
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    push({ q: qDraft, fingerprint: fp, platform: plat, layout: lay });
  };

  const onSelectChange = (next: { fp?: string; plat?: string; lay?: string }) => {
    const nextFp = next.fp ?? fp;
    const nextPlat = next.plat ?? plat;
    const nextLay = next.lay ?? lay;
    setFp(nextFp);
    setPlat(nextPlat);
    setLay(nextLay);
    push({ q: qDraft, fingerprint: nextFp, platform: nextPlat, layout: nextLay });
  };

  const clearAll = () => {
    setQDraft('');
    setFp('');
    setPlat('');
    setLay('');
    push({});
  };

  return (
    <form onSubmit={onSubmit} className="article-filters">
      <input
        className="intake-input article-search"
        type="search"
        placeholder="搜标题、搜思路…"
        value={qDraft}
        onChange={(e) => setQDraft(e.target.value)}
      />
      <select
        className="intake-select"
        value={fp}
        onChange={(e) => onSelectChange({ fp: e.target.value })}
        aria-label="按指纹筛选"
      >
        <option value="">全部博主</option>
        {fingerprints.map((f) => (
          <option key={f.id} value={f.id}>{f.author_name}</option>
        ))}
      </select>
      <select
        className="intake-select"
        value={plat}
        onChange={(e) => onSelectChange({ plat: e.target.value })}
        aria-label="按平台筛选"
      >
        <option value="">全部平台</option>
        {platforms.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        className="intake-select"
        value={lay}
        onChange={(e) => onSelectChange({ lay: e.target.value })}
        aria-label="按版式筛选"
      >
        <option value="">全部版式</option>
        {layouts.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      <button type="submit" className="btn btn-secondary article-search-btn">
        搜索
      </button>
      {(q || fp || plat || lay) && (
        <button type="button" className="btn btn-ghost" onClick={clearAll}>
          清掉筛选
        </button>
      )}
    </form>
  );
}
