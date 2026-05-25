import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SiteRow {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  profile_json: string;
  source_article_count: number | null;
  created_at: number;
  updated_at: number | null;
  /** site_articles 表实时 COUNT，比 source_article_count 字段更可靠 */
  real_article_count: number;
}

interface DisplaySite {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  source_article_count: number | null;
  created_at: number;
  preferred_topics: string[];
  word_count_range: [number, number] | null;
  tone: string | null;
  image_density: string | null;
}

function loadSites(): DisplaySite[] {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT s.id, s.site_name, s.section, s.url_pattern, s.profile_json,
                s.source_article_count, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM site_articles sa WHERE sa.site_id = s.id) AS real_article_count
         FROM sites s
         ORDER BY COALESCE(s.updated_at, s.created_at) DESC`,
      )
      .all() as SiteRow[];

    return rows.map((row) => {
      let preferred: string[] = [];
      let range: [number, number] | null = null;
      let tone: string | null = null;
      let density: string | null = null;
      try {
        const p = JSON.parse(row.profile_json) as Record<string, unknown>;
        if (Array.isArray(p.preferred_topics)) {
          preferred = (p.preferred_topics as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .slice(0, 4);
        }
        if (
          Array.isArray(p.word_count_range) &&
          p.word_count_range.length === 2 &&
          typeof p.word_count_range[0] === 'number' &&
          typeof p.word_count_range[1] === 'number'
        ) {
          range = [
            p.word_count_range[0] as number,
            p.word_count_range[1] as number,
          ];
        }
        if (typeof p.tone === 'string') tone = p.tone;
        if (typeof p.image_density === 'string') density = p.image_density;
      } catch {
        // ignore
      }
      // 优先用实时 COUNT；row.source_article_count 是历史字段值（可能过时）
      const displayCount = row.real_article_count || row.source_article_count;
      return {
        id: row.id,
        site_name: row.site_name,
        section: row.section,
        url_pattern: row.url_pattern,
        source_article_count: displayCount,
        created_at: row.created_at,
        preferred_topics: preferred,
        word_count_range: range,
        tone,
        image_density: density,
      };
    });
  } catch {
    return [];
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 按 site_name 分组
function groupBySite(items: DisplaySite[]): Record<string, DisplaySite[]> {
  const map: Record<string, DisplaySite[]> = {};
  for (const it of items) {
    const key = it.site_name || '未命名站点';
    if (!map[key]) map[key] = [];
    map[key].push(it);
  }
  return map;
}

export default async function SitesPage() {
  const items = loadSites();
  const grouped = groupBySite(items);

  return (
    <>
      <HomeNav activePath="/sites" />
      <main className="container" style={{ paddingTop: 64, paddingBottom: 96 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 32,
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 className="section-title" style={{ marginBottom: 8 }}>
              站点画像库
            </h1>
            <p className="section-subtitle">
              {items.length > 0
                ? `已收录 ${items.length} 个站点/板块画像。生成文章时按画像调字数、调标题、调引导语。`
                : '把目标平台拆解成「站点画像」——同一站点不同板块编辑偏好差异很大，画像让生成更贴合发布场。'}
            </p>
          </div>
          <Link href="/sites/new" className="btn btn-primary">
            扩充新站点画像
            <span className="btn-arrow">→</span>
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">还没有站点画像</p>
            <p className="empty-state-desc">
              丢一个板块 URL 进来（比如少数派的 Matrix 板块、知乎某专栏），工具会自动爬最近 5-10
              篇，提炼出"这个板块发文偏好"——典型字数、标题套路、配图密度、收尾方式。
            </p>
            <Link href="/sites/new" className="btn btn-primary">
              扩充第一个站点画像
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        ) : (
          <div className="enter-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
            {Object.entries(grouped).map(([siteName, sectionList]) => (
              <section key={siteName}>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <h2
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 22,
                      fontWeight: 500,
                      color: 'var(--text)',
                      margin: 0,
                    }}
                  >
                    {siteName}
                  </h2>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {sectionList.length} 个板块
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 16,
                  }}
                >
                  {sectionList.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sites/${s.id}`}
                      className="card-compact"
                      style={{
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: 20,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <h3
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 16,
                            fontWeight: 500,
                            color: 'var(--text)',
                            margin: 0,
                          }}
                        >
                          {s.section || '主站'}
                        </h3>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {formatDate(s.created_at)}
                        </span>
                      </div>
                      {s.url_pattern && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          {s.url_pattern}
                        </div>
                      )}
                      {s.preferred_topics.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          {s.preferred_topics.map((t) => (
                            <span key={t} className="tag tag-topic">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        {s.word_count_range && (
                          <span>
                            字数 {s.word_count_range[0]}–{s.word_count_range[1]}
                          </span>
                        )}
                        {s.source_article_count && <span>样本 {s.source_article_count} 篇</span>}
                      </div>
                      {s.tone && (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '4px 0 0' }}>
                          {s.tone.length > 60 ? s.tone.slice(0, 60) + '…' : s.tone}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
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
