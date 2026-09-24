import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';
import {
  listAllFingerprints,
  listAuthorsAggregated,
  type FingerprintListItem,
} from '@/lib/fingerprint-queries';
import { AuthorCard } from '@/components/authors/AuthorCard';
import { VersionFingerprintCard } from './VersionFingerprintCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AVATAR_GRADIENTS = [
  undefined,
  'linear-gradient(135deg, var(--tint-structure), var(--tint-topic))',
  'linear-gradient(135deg, var(--tint-topic), var(--tint-visual))',
  'linear-gradient(135deg, var(--tint-visual), var(--tint-language))',
];

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

/**
 * /fingerprints —— 指纹库列表
 *
 * 顶部 view 切换：
 * - ?view=authors （默认）：按博主聚合，一博主一卡
 * - ?view=versions       ：旧视图，每个指纹版本一卡
 */
export default async function FingerprintsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const view = sp.view === 'versions' ? 'versions' : 'authors';

  return (
    <>
      <HomeNav activePath="/fingerprints" />

      <main className="container" style={{ paddingTop: 64, paddingBottom: 96 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 18,
          }}
        >
          <div>
            <h1 className="section-title" style={{ marginBottom: 8 }}>
              博主风格指纹库
            </h1>
            <p className="section-subtitle">
              {view === 'authors'
                ? '按博主聚合：一位博主一张卡，详情页里看 ta 在每个平台、每个领域怎么写。'
                : '按版本铺：每个指纹版本一张卡（旧视图）。'}
            </p>
          </div>
          <Link href="/fingerprints/new" className="btn btn-primary">
            拆解一个新博主
            <span className="btn-arrow">→</span>
          </Link>
        </div>

        <div className="view-toggle" role="tablist">
          <Link
            href="/fingerprints?view=authors"
            className={`view-toggle-btn${view === 'authors' ? ' active' : ''}`}
          >
            按博主
          </Link>
          <Link
            href="/fingerprints?view=versions"
            className={`view-toggle-btn${view === 'versions' ? ' active' : ''}`}
          >
            按版本（旧）
          </Link>
        </div>

        {view === 'authors' ? <AuthorsView /> : <VersionsView />}
      </main>

      <footer className="footer">
        笔迹 ByTrace · 本地工具 · 数据存在 ./data/autoarticle.db
      </footer>
    </>
  );
}

function AuthorsView() {
  const items = listAuthorsAggregated();
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">还没有任何指纹</p>
        <p className="empty-state-desc">
          先去拆解一个新博主，工具会自动学习 ta 的开篇套路、句长偏好、口头禅、配图风格。
        </p>
        <Link href="/fingerprints/new" className="btn btn-primary">
          拆解一个新博主
          <span className="btn-arrow">→</span>
        </Link>
      </div>
    );
  }
  return (
    <div className="authors-rail enter-stagger">
      {items.map((it, i) => (
        <AuthorCard key={it.id} item={it} index={i} />
      ))}
    </div>
  );
}

function VersionsView() {
  const items: FingerprintListItem[] = listAllFingerprints();
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">还没有任何指纹</p>
        <p className="empty-state-desc">
          先去拆解一个新博主，工具会自动学习 ta 的开篇套路、句长偏好、口头禅、配图风格。
        </p>
        <Link href="/fingerprints/new" className="btn btn-primary">
          拆解一个新博主
          <span className="btn-arrow">→</span>
        </Link>
      </div>
    );
  }
  return (
    <div className="fp-rail enter-stagger">
      {items.map((fp, i) => {
        const gradient = AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length];
        return (
          <VersionFingerprintCard
            key={fp.id}
            id={fp.id}
            authorName={fp.authorName}
            avatarChar={fp.avatarChar}
            platformText={fp.platform || '未指定'}
            studied={fp.studied}
            dateText={formatDate(fp.lastUsedAt ?? fp.createdAt)}
            radar={fp.radar}
            gradient={gradient}
          />
        );
      })}
      <Link href="/fingerprints/new" className="fp-card add-card">
        <div className="add-icon" aria-hidden>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <div className="add-label">拆解新博主</div>
        <div className="add-hint">3-5 篇文 · 约 40s</div>
      </Link>
    </div>
  );
}
