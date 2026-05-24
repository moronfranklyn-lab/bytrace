import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { AuthorDetailV3, type FingerprintV3 } from '@/components/authors/AuthorDetailV3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface AuthorRow {
  id: string;
  name: string;
  platform: string | null;
  avatar_emoji: string | null;
  created_at: number;
  last_used_at: number | null;
}

interface FingerprintRow {
  id: string;
  author_id: string;
  fingerprint_json: string;
  source_articles_json: string;
  created_at: number;
  hit_count: number;
  version: number | null;
  parent_id: string | null;
  article_count: number | null;
}

interface CrawledArticleRow {
  id: string;
  url: string;
  title: string | null;
  category: string | null;
  used_in_fingerprint_id: string | null;
  crawled_at: number;
  // 部分老 db 可能没有这两列，所以单独 try 取
  platform?: string | null;
  domain?: string | null;
}

function safeParseFp(json: string): FingerprintV3 {
  try {
    return JSON.parse(json) as FingerprintV3;
  } catch {
    return {};
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * /authors/[id] —— 博主详情页（K 第三轮重做）
 *
 * 4 个 tab：
 *  1. 平台分组指纹（按 platform_fingerprints 分组渲染）
 *  2. 领域差异（domain_variations）
 *  3. 跨平台对比（cross_platform_report，仅 2+ 平台时显示）
 *  4. 策略碎片库（strategy_fragments，支持按 tag / platform / domain 筛选）
 *
 * 兼容 v1 / v2：如果 fingerprint_json 没有 platform_fingerprints，
 * AuthorDetailV3 会自动把老字段当作"单平台"渲染。
 */
export default async function AuthorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();

  const author = db
    .prepare(
      `SELECT id, name, platform, avatar_emoji, created_at, last_used_at
       FROM authors WHERE id = ?`,
    )
    .get(id) as AuthorRow | undefined;
  if (!author) notFound();

  // 最新指纹版本（按 version desc, created_at desc）
  const latestFp = db
    .prepare(
      `SELECT id, author_id, fingerprint_json, source_articles_json,
              created_at, hit_count, version, parent_id, article_count
       FROM fingerprints
       WHERE author_id = ?
       ORDER BY COALESCE(version, 1) DESC, created_at DESC
       LIMIT 1`,
    )
    .get(id) as FingerprintRow | undefined;

  if (!latestFp) {
    notFound();
  }

  const fp = safeParseFp(latestFp.fingerprint_json);
  const isV3 = !!fp.platform_fingerprints;

  // 全部相关 crawled_articles —— 用来按平台统计篇数
  // 兼容老 schema 没有 platform / domain 列的情况：先 PRAGMA 看一眼
  const colNames = new Set(
    (db.prepare(`PRAGMA table_info(crawled_articles)`).all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  const hasPlatformCol = colNames.has('platform');
  const hasDomainCol = colNames.has('domain');

  const selectExtra = [
    hasPlatformCol ? 'platform' : `NULL AS platform`,
    hasDomainCol ? 'domain' : `NULL AS domain`,
  ].join(', ');

  const articleRows = db
    .prepare(
      `SELECT id, url, title, category, used_in_fingerprint_id, crawled_at, ${selectExtra}
       FROM crawled_articles
       WHERE author_id = ?
       ORDER BY crawled_at DESC`,
    )
    .all(id) as CrawledArticleRow[];

  // 按平台统计已学习篇数
  const platformStudiedCount: Record<string, number> = {};
  for (const art of articleRows) {
    if (!art.used_in_fingerprint_id) continue;
    const p = art.platform || author.platform || '未指定';
    platformStudiedCount[p] = (platformStudiedCount[p] ?? 0) + 1;
  }

  // 总学习篇数：优先 article_count，回退 source_articles_json 长度
  const totalStudied =
    latestFp.article_count ??
    (() => {
      try {
        const arr = JSON.parse(latestFp.source_articles_json);
        return Array.isArray(arr) ? arr.length : 0;
      } catch {
        return 0;
      }
    })();

  const avatarChar = author.avatar_emoji || author.name.slice(0, 1).toUpperCase();

  // 顶部 chip 显示的平台清单：v3 用 platforms_analyzed，否则用 author.platform
  const platformsChip =
    isV3 && Array.isArray(fp.platforms_analyzed) && fp.platforms_analyzed.length > 0
      ? fp.platforms_analyzed
      : [author.platform || '未指定'];

  return (
    <>
      <HomeNav activePath="/fingerprints" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="fp-page-head">
          <div className="fp-page-head-left">
            <h1 className="fp-page-title">
              <span
                className="fp-avatar"
                style={{ width: 56, height: 56, marginBottom: 0, fontSize: 22 }}
              >
                {avatarChar}
              </span>
              <span>{author.name}</span>
            </h1>
            <div className="fp-page-meta">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {platformsChip.map((p) => (
                  <span key={p} className="tag tag-lang">{p}</span>
                ))}
              </div>
              <span className="meta-sep">·</span>
              <span>总学习 {totalStudied} 篇</span>
              <span className="meta-sep">·</span>
              <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
                指纹 v{latestFp.version ?? 1}
              </span>
              <span className="meta-sep">·</span>
              <span>建于 {formatDate(author.created_at)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link
              href={`/compose?fingerprint=${latestFp.id}`}
              className="btn btn-secondary"
            >
              拿这个风格写一篇
              <span className="btn-arrow">→</span>
            </Link>
            <Link
              href={`/authors/${id}/optimize`}
              className="btn btn-primary"
            >
              再加文章优化指纹
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        </div>

        <AuthorDetailV3
          authorId={id}
          authorName={author.name}
          fingerprint={fp}
          fingerprintId={latestFp.id}
          platformStudiedCount={platformStudiedCount}
          fallbackPlatform={author.platform || '未指定'}
          totalStudied={totalStudied}
        />
      </main>
    </>
  );
}
