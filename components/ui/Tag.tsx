import type { ReactNode } from 'react';

type TagTint = 'lang' | 'struct' | 'topic' | 'visual';

interface TagProps {
  tint?: TagTint;
  children: ReactNode;
}

/**
 * 通用 tag chip。tint 控制 4 个深度维度配色。
 */
export function Tag({ tint, children }: TagProps) {
  // 首页用 tag-lang/tag-struct/tag-topic/tag-visual，compose 页用 tag.lang/.struct/.visual
  // 两套 class 都加上以兼容两份 CSS
  const tintClass = tint ? ` tag-${tint} ${tint}` : '';
  return <span className={`tag${tintClass}`}>{children}</span>;
}
