'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

interface Props {
  initialQ: string;
}

export function ArticleSearch({ initialQ }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(initialQ);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const tail = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    startTransition(() => router.push(`/articles${tail}`));
  };

  const clear = () => {
    setQ('');
    startTransition(() => router.push('/articles'));
  };

  return (
    <form onSubmit={submit} className="article-search-bar">
      <input
        className="intake-input"
        type="search"
        placeholder="搜标题、搜思路、搜正文…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit" className="btn btn-secondary">搜索</button>
      {initialQ && (
        <button type="button" className="btn btn-ghost" onClick={clear}>清掉</button>
      )}
    </form>
  );
}
