import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { ArticleFilters } from './ArticleFilters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  fingerprint?: string;
  platform?: string;
  layout?: string;
}

interface ArticleListRow {
  id: string;
  title: string | null;
  platform_target: string | null;
  layout_theme: string | null;
  created_at: number;
  fingerprint_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  excerpt: string | null;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const fp = (sp.fingerprint ?? '').trim();
  const platform = (sp.platform ?? '').trim();
  const layout = (sp.layout ?? '').trim();

  const db = getDb();

  // 取所有筛选下拉选项
  const allFps = db
    .prepare(
      `SELECT f.id, a.name AS author_name
       FROM fingerprints f JOIN authors a ON a.id = f.author_id
       ORDER BY a.last_used_at DESC`,
    )
    .all() as { id: string; author_name: string }[];

  const distinctPlatforms = db
    .prepare(
      `SELECT DISTINCT platform_target FROM articles WHERE platform_target IS NOT NULL AND platform_target != ''`,
    )
    .all() as { platform_target: string }[];
  const distinctLayouts = db
    .prepare(
      `SELECT DISTINCT layout_theme FROM articles WHERE layout_theme IS NOT NULL AND layout_theme != ''`,
    )
    .all() as { layout_theme: string }[];

  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    where.push(`(art.title LIKE ? OR art.user_prompt LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`);
  }
  if (fp) {
    where.push(`art.fingerprint_id = ?`);
    args.push(fp);
  }
  if (platform) {
    where.push(`art.platform_target = ?`);
    args.push(platform);
  }
  if (layout) {
    where.push(`art.layout_theme = ?`);
    args.push(layout);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT art.id, art.title, art.platform_target, art.layout_theme, art.created_at,
              art.fingerprint_id,
              substr(coalesce(art.content_md, art.user_prompt, ''), 1, 140) AS excerpt,
              a.name AS author_name, a.avatar_emoji AS author_avatar
       FROM articles art
       LEFT JOIN fingerprints f ON f.id = art.fingerprint_id
       LEFT JOIN authors a ON a.id = f.author_id
       ${whereSql}
       ORDER BY art.created_at DESC`,
    )
    .all(...args) as ArticleListRow[];

  return (
    <>
      <HomeNav activePath="/articles" />

      <main className="container articles-page" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <header style={{ marginBottom: 28 }}>
          <h1 className="hero-title" style={{ fontSize: 38, margin: '0 0 10px' }}>
            <em>历史</em>文章
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15, maxWidth: 620 }}>
            每一次「生成」都会落到这里。可以按博主、平台、版式筛，也能按标题搜。
          </p>
        </header>

        <ArticleFilters
          q={q}
          fingerprint={fp}
          platform={platform}
          layout={layout}
          fingerprints={allFps}
          platforms={distinctPlatforms.map((p) => p.platform_target)}
          layouts={distinctLayouts.map((l) => l.layout_theme)}
        />

        {rows.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 24 }}>
            <p className="empty-state-title">
              {q || fp || platform || layout ? '没找到符合条件的文章' : '历史里还没有文章'}
            </p>
            <p className="empty-state-desc">
              {q || fp || platform || layout
                ? '换一个关键词或清掉筛选试试'
                : '去 /compose 写一篇，写完会自动归档到这里'}
            </p>
            <Link href="/compose" className="btn btn-primary">
              开始写一篇
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        ) : (
          <ul className="article-timeline enter-stagger">
            {rows.map((r) => {
              const title = r.title?.trim() || '（无标题草稿）';
              return (
                <li key={r.id} className="article-row">
                  <Link href={`/articles/${r.id}`} className="article-row-link">
                    <div className="article-row-head">
                      <h3 className="article-row-title">{title}</h3>
                      <div className="article-row-meta">
                        {r.author_name && (
                          <span className="tag tag-lang">{r.author_avatar || r.author_name.slice(0, 1)} · {r.author_name}</span>
                        )}
                        {r.platform_target && (
                          <span className="tag">{r.platform_target}</span>
                        )}
                        {r.layout_theme && (
                          <span className="tag tag-struct">{r.layout_theme}</span>
                        )}
                        <span className="article-row-date">{fmtDate(r.created_at)}</span>
                      </div>
                    </div>
                    {r.excerpt && (
                      <p className="article-row-excerpt">{r.excerpt.trim().slice(0, 140)}…</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
