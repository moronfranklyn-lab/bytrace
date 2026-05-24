import { notFound } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { OptimizeFlow } from '@/components/authors/OptimizeFlow';

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
}

interface FingerprintRow {
  id: string;
  version: number | null;
  article_count: number | null;
  created_at: number;
}

interface CrawledArticleRow {
  id: string;
  title: string | null;
  url: string;
  category: string | null;
  crawled_at: number;
  content_len: number;
}

export default async function OptimizePage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();

  const author = db
    .prepare(
      `SELECT id, name, platform, avatar_emoji FROM authors WHERE id = ?`,
    )
    .get(id) as AuthorRow | undefined;
  if (!author) notFound();

  const latestFp = db
    .prepare(
      `SELECT id, version, article_count, created_at
       FROM fingerprints
       WHERE author_id = ?
       ORDER BY COALESCE(version, 1) DESC, created_at DESC
       LIMIT 1`,
    )
    .get(id) as FingerprintRow | undefined;
  if (!latestFp) notFound();

  // 未被任何 fingerprint 学习过的 crawled_articles
  const unusedArticles = db
    .prepare(
      `SELECT id, title, url, category, crawled_at, LENGTH(content) AS content_len
       FROM crawled_articles
       WHERE author_id = ? AND used_in_fingerprint_id IS NULL
       ORDER BY crawled_at DESC`,
    )
    .all(id) as CrawledArticleRow[];

  const currentVersion = latestFp.version ?? 1;
  const nextVersion = currentVersion + 1;
  const avatarChar = author.avatar_emoji || author.name.slice(0, 1).toUpperCase();

  return (
    <>
      <HomeNav activePath="/fingerprints" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 960 }}>
        <header style={{ marginBottom: 28 }}>
          <h1 className="hero-title" style={{ fontSize: 36, margin: '0 0 12px' }}>
            <em>{author.name}</em> · 优化指纹
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15 }}>
            选 1-10 篇新文章，工具会在 v{currentVersion} 基础上输出 v{nextVersion} —— 不是从头重学，是「在现有指纹基础上增强 / 修正 / 补充」。
          </p>
        </header>

        <OptimizeFlow
          authorId={id}
          authorName={author.name}
          avatarChar={avatarChar}
          currentVersion={currentVersion}
          nextVersion={nextVersion}
          unusedArticles={unusedArticles}
        />
      </main>
    </>
  );
}
