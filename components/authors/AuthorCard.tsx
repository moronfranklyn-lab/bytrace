import Link from 'next/link';
import type { AuthorListItem } from '@/lib/fingerprint-queries';

const AVATAR_GRADIENTS = [
  undefined,
  'linear-gradient(135deg, var(--tint-structure), var(--tint-topic))',
  'linear-gradient(135deg, var(--tint-topic), var(--tint-visual))',
  'linear-gradient(135deg, var(--tint-visual), var(--tint-language))',
];

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  item: AuthorListItem;
  /** 列表里第几个（用来挑头像渐变） */
  index?: number;
}

/**
 * 博主列表卡片：一博主一卡。展示头像、平台 chips、碎片数、最近活跃。
 * 点整张卡跳 /authors/[id]。
 */
export function AuthorCard({ item, index = 0 }: Props) {
  const gradient = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  return (
    <Link href={`/authors/${item.id}`} className="fp-card author-card">
      <div className="author-card-head">
        <div
          className="fp-avatar"
          style={gradient ? { background: gradient, marginBottom: 0 } : { marginBottom: 0 }}
        >
          {item.avatarChar}
        </div>
        <div className="author-card-name-block">
          <h3 className="fp-name" style={{ margin: 0 }}>{item.name}</h3>
          <p className="fp-stats" style={{ margin: '2px 0 0' }}>
            {item.versionCount > 1 ? `${item.versionCount} 版指纹` : '首版指纹'}
            {' · '}
            {formatDate(item.lastTouchedAt)}
          </p>
        </div>
      </div>

      <div className="author-card-platforms">
        {item.platforms.map((p) => (
          <span key={p} className="tag tag-lang">
            {p}
          </span>
        ))}
        {item.isV3 && (
          <span className="tag tag-topic" title="该博主已采用 v3 多平台指纹">
            v3
          </span>
        )}
      </div>

      <div className="author-card-foot">
        <span className="author-card-foot-num">{item.fragmentCount}</span>
        <span className="author-card-foot-label">
          {item.fragmentCount > 0 ? '条可复用策略碎片' : '暂无策略碎片'}
        </span>
      </div>
    </Link>
  );
}
