import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';
import { ArticleSearch } from './ArticleSearch';
import { ArticleCard } from './ArticleCard';
import { getPlatform, resolvePlatformKey, type PlatformKey } from '@/lib/platforms';
import { parseRefineVersions, type RefineVersionEntry } from '@/lib/refine-versions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
}

interface ArticleRow {
  id: string;
  title: string | null;
  platform_target: string | null;
  layout_theme: string | null;
  content_md: string | null;
  refine_versions_json: string | null;
  created_at: number;
  author_name: string | null;
  author_avatar: string | null;
}

export interface PlatformVersion {
  key: PlatformKey;
  name: string;
  /** 是否是这篇文章最初生成的那个平台版本（卡片默认选中它） */
  is_primary: boolean;
  content_md: string;
  word_count: number;
  paragraph_count: number;
  excerpt: string;
}

export interface ArticleCardData {
  id: string;
  title: string;
  author_name: string | null;
  author_avatar: string | null;
  layout_theme: string | null;
  created_at: number;
  /** 这篇文章存在的所有平台版本（按 PlatformKey 去重，取每个平台最新一版） */
  versions: PlatformVersion[];
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function countCjkWords(md: string): number {
  // 去 markdown 标记后按字符计——CJK 一字一词
  const stripped = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~\-]/g, '')
    .replace(/\s+/g, '');
  return stripped.length;
}

function countParagraphs(md: string): number {
  return md.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
}

function buildExcerpt(md: string): string {
  const stripped = md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[*_`~]/g, '')
    .trim();
  return stripped.slice(0, 140);
}

function buildCardData(row: ArticleRow): ArticleCardData | null {
  const primaryKey = resolvePlatformKey(row.platform_target);
  const baseMd = row.content_md ?? '';

  // 按 PlatformKey 收集版本，同平台多次改写取最新一条
  const byKey = new Map<PlatformKey, { content_md: string; ts: number }>();
  if (primaryKey && baseMd.length > 0) {
    byKey.set(primaryKey, { content_md: baseMd, ts: row.created_at });
  }

  // 统一归一：兼容 draft route 写的 dict 形态和 refine route 写的 array 形态
  const refineVersions: RefineVersionEntry[] = parseRefineVersions(
    row.refine_versions_json,
    { fallbackTs: row.created_at, mainPlatform: row.platform_target ?? undefined },
  );

  for (const v of refineVersions) {
    const key = resolvePlatformKey(v.target_platform);
    if (!key) continue;
    if (!v.content_md) continue;
    const prev = byKey.get(key);
    if (!prev || v.ts > prev.ts) {
      byKey.set(key, { content_md: v.content_md, ts: v.ts });
    }
  }

  if (byKey.size === 0) return null;

  const versions: PlatformVersion[] = Array.from(byKey.entries())
    .map(([key, { content_md }]) => {
      const trait = getPlatform(key);
      return {
        key,
        name: trait.name,
        is_primary: key === primaryKey,
        content_md,
        word_count: countCjkWords(content_md),
        paragraph_count: countParagraphs(content_md),
        excerpt: buildExcerpt(content_md),
      };
    })
    // 主平台排前面，其它按字数从大到小（深度文优先看）
    .sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return b.word_count - a.word_count;
    });

  return {
    id: row.id,
    title: row.title?.trim() || '（无标题草稿）',
    author_name: row.author_name,
    author_avatar: row.author_avatar,
    layout_theme: row.layout_theme,
    created_at: row.created_at,
    versions,
  };
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  ensureComposeColumns();
  const db = getDb();

  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    where.push(`(art.title LIKE ? OR art.user_prompt LIKE ? OR art.content_md LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT art.id, art.title, art.platform_target, art.layout_theme,
              art.content_md, art.refine_versions_json, art.created_at,
              a.name AS author_name, a.avatar_emoji AS author_avatar
       FROM articles art
       LEFT JOIN fingerprints f ON f.id = art.fingerprint_id
       LEFT JOIN authors a ON a.id = f.author_id
       ${whereSql}
       ORDER BY art.created_at DESC`,
    )
    .all(...args) as ArticleRow[];

  const cards = rows
    .map(buildCardData)
    .filter((c): c is ArticleCardData => c !== null);

  return (
    <>
      <HomeNav activePath="/articles" />

      <main className="container articles-page" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <header style={{ marginBottom: 28 }}>
          <h1 className="hero-title" style={{ fontSize: 38, margin: '0 0 10px' }}>
            <em>历史</em>文章
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15, maxWidth: 620 }}>
            每一次「生成」都会落到这里。点平台 chip 可以看同一篇在不同平台调整了什么。
          </p>
        </header>

        <ArticleSearch initialQ={q} />

        {cards.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 24 }}>
            <p className="empty-state-title">
              {q ? '没找到符合条件的文章' : '历史里还没有文章'}
            </p>
            <p className="empty-state-desc">
              {q ? '换一个关键词试试' : '去 /compose 写一篇，写完会自动归档到这里'}
            </p>
            <Link href="/compose" className="btn btn-primary">
              开始写一篇
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        ) : (
          <ul className="article-card-grid enter-stagger">
            {cards.map((c) => (
              <li key={c.id}>
                <ArticleCard data={c} dateLabel={fmtDate(c.created_at)} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
