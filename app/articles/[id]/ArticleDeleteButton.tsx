'use client';

import { useRouter } from 'next/navigation';
import { DeleteConfirm } from '@/components/ui/DeleteConfirm';
import { useToastStore } from '@/stores/toast-store';

interface Props {
  id: string;
  title: string;
}

export function ArticleDeleteButton({ id, title }: Props) {
  const router = useRouter();
  return (
    <DeleteConfirm
      trigger={<button type="button" className="btn btn-ghost article-delete-trigger">删除这篇</button>}
      itemName={title}
      hint="删了就找不回来了。如果只是不想再看到，留着也行。"
      onConfirm={async () => {
        try {
          const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' });
          const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
          if (!res.ok || !json.ok) {
            useToastStore.getState().show(json.message || '删除失败', 'error');
            return;
          }
          useToastStore.getState().show('已删除', 'success');
          router.push('/articles');
        } catch (err) {
          useToastStore.getState().show(`删除失败：${(err as Error).message}`, 'error');
        }
      }}
    />
  );
}
