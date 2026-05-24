import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';
import { listAuthorsAggregated } from '@/lib/fingerprint-queries';
import { AuthorCard } from '@/components/authors/AuthorCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /authors —— 按博主聚合的列表。一博主一卡，点进 /authors/[id] 看详情。
 *
 * 与 /fingerprints 的区别：
 * - /authors 这页：以「人」为单位，看的是博主有几套配方
 * - /fingerprints?view=versions：以「指纹版本」为单位，旧视图
 */
export default async function AuthorsPage() {
  const items = listAuthorsAggregated();

  return (
    <>
      <HomeNav activePath="/fingerprints" />
      <main className="container" style={{ paddingTop: 64, paddingBottom: 96 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 32,
          }}
        >
          <div>
            <h1 className="section-title" style={{ marginBottom: 8 }}>
              我学习过的博主
            </h1>
            <p className="section-subtitle">
              {items.length > 0
                ? `${items.length} 位博主。点进任意一位，看 ta 在不同平台、不同领域怎么写。`
                : '一博主一卡。详情页里按平台分组、按领域分组、还有跨平台对比报告。'}
            </p>
          </div>
          <Link href="/fingerprints/new" className="btn btn-primary">
            拆解一个新博主
            <span className="btn-arrow">→</span>
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">还没拆解过任何博主</p>
            <p className="empty-state-desc">
              先去拆解一个新博主，工具会自动学习 ta 的开篇套路、句长偏好、口头禅、配图风格。
              v3 拆解还会按平台 / 领域分别分析。
            </p>
            <Link href="/fingerprints/new" className="btn btn-primary">
              拆解一个新博主
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        ) : (
          <div className="authors-rail enter-stagger">
            {items.map((it, i) => (
              <AuthorCard key={it.id} item={it} index={i} />
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        AutoArticle · 本地工具 · v0.1 · 数据存在 ./data/autoarticle.db
      </footer>
    </>
  );
}
