import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { AddSamplesPanel } from './AddSamplesPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface SiteRow {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  profile_json: string;
  source_url: string | null;
  source_article_count: number | null;
  created_at: number;
  updated_at: number | null;
  iteration_count: number | null;
}

interface SampleRow {
  url: string;
  title: string | null;
  added_at: number;
  iteration: number;
}

interface SiteProfile {
  site_name?: string;
  section?: string;
  url_pattern?: string;
  preferred_topics?: string[];
  title_patterns?: string[];
  word_count_range?: [number, number];
  image_density?: string;
  opening_pattern?: string;
  closing_pattern?: string;
  tone?: string;
  key_phrases?: string[];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default async function SiteDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, site_name, section, url_pattern, profile_json,
              source_url, source_article_count, created_at, updated_at,
              iteration_count
       FROM sites
       WHERE id = ?`,
    )
    .get(id) as SiteRow | undefined;

  if (!row) {
    notFound();
  }

  let profile: SiteProfile = {};
  try {
    profile = JSON.parse(row.profile_json) as SiteProfile;
  } catch {
    profile = {};
  }

  const samples = db
    .prepare(
      `SELECT url, title, added_at, iteration FROM site_articles
       WHERE site_id = ? ORDER BY added_at DESC`,
    )
    .all(id) as SampleRow[];

  return (
    <>
      <HomeNav activePath="/sites" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="fp-page-head">
          <div className="fp-page-head-left">
            <h1 className="fp-page-title">
              <span>{row.site_name}</span>
              {row.section && (
                <span style={{ color: 'var(--text-tertiary)', fontSize: 22, marginLeft: 8 }}>
                  · {row.section}
                </span>
              )}
            </h1>
            <div className="fp-page-meta">
              {row.url_pattern && (
                <>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{row.url_pattern}</span>
                  <span className="meta-sep">·</span>
                </>
              )}
              <span>样本 {samples.length || row.source_article_count || '—'} 篇</span>
              <span className="meta-sep">·</span>
              <span>建于 {formatDate(row.created_at)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/sites" className="btn btn-secondary">
              ← 返回画像库
            </Link>
          </div>
        </div>

        {/* 顶部基调 */}
        <div className="dna-card">
          <div className="dna-eyebrow">站点基调</div>
          {profile.tone ? (
            <p className="dna-summary">{profile.tone}</p>
          ) : (
            <p className="dna-summary" style={{ color: 'var(--text-muted)' }}>—</p>
          )}
        </div>

        {/* 四象限：题材 / 结构 / 标题 / 字数配图 */}
        <h2 className="fp-grid-section-title">画像四维度</h2>
        <p className="fp-grid-section-sub">
          下次生成时这些会被叠加在 system prompt 里——字数走这个区间、标题套这些模板、开篇收尾按这个套路。
        </p>
        <div className="fp-grid">
          <article className="fp-quadrant" data-tint="topic">
            <div className="fp-q-head">
              <h3 className="fp-q-title">题材偏好</h3>
              <span className="fp-q-eyebrow">TOPIC</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">关键词</span>
              {profile.preferred_topics?.length ? (
                <div className="fp-tics">
                  {profile.preferred_topics.map((t, i) => (
                    <span key={i} className="fp-tic">{t}</span>
                  ))}
                </div>
              ) : (
                <span className="fp-q-value">—</span>
              )}
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">高频短语</span>
              {profile.key_phrases?.length ? (
                <div className="fp-tics">
                  {profile.key_phrases.map((t, i) => (
                    <span key={i} className="fp-tic">{t}</span>
                  ))}
                </div>
              ) : (
                <span className="fp-q-value">—</span>
              )}
            </div>
          </article>

          <article className="fp-quadrant" data-tint="structure">
            <div className="fp-q-head">
              <h3 className="fp-q-title">结构套路</h3>
              <span className="fp-q-eyebrow">STRUCTURE</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">开篇</span>
              <span className="fp-q-value">{profile.opening_pattern || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">收尾</span>
              <span className="fp-q-value">{profile.closing_pattern || '—'}</span>
            </div>
          </article>

          <article className="fp-quadrant" data-tint="language">
            <div className="fp-q-head">
              <h3 className="fp-q-title">标题模板</h3>
              <span className="fp-q-eyebrow">TITLE PATTERNS</span>
            </div>
            {profile.title_patterns?.length ? (
              <ul className="do-dont-list" style={{ marginTop: 4 }}>
                {profile.title_patterns.map((t, i) => (
                  <li key={i} className="do-dont-item" style={{ paddingLeft: 0 }}>
                    <span
                      style={{
                        color: 'var(--text-tertiary)',
                        minWidth: 18,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>—</p>
            )}
          </article>

          <article className="fp-quadrant" data-tint="visual">
            <div className="fp-q-head">
              <h3 className="fp-q-title">字数与配图</h3>
              <span className="fp-q-eyebrow">VISUAL</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">字数区间</span>
              <span className="fp-q-value">
                {profile.word_count_range
                  ? `${profile.word_count_range[0]}–${profile.word_count_range[1]} 字`
                  : '—'}
              </span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">配图密度</span>
              <span className="fp-q-value">{profile.image_density || '—'}</span>
            </div>
          </article>
        </div>

        <AddSamplesPanel
          siteId={row.id}
          sourceUrl={row.source_url}
          iterationCount={row.iteration_count ?? 1}
          samples={samples.map((s) => ({
            url: s.url,
            title: s.title,
            added_at_label: formatDate(s.added_at),
            iteration: s.iteration,
          }))}
        />

        <details className="raw-json-panel">
          <summary className="raw-json-summary">
            <span>原始画像 JSON（开发者）</span>
            <span style={{ fontSize: 10 }}>展开 ▾</span>
          </summary>
          <pre className="raw-json-body">{JSON.stringify(profile, null, 2)}</pre>
        </details>
      </main>
    </>
  );
}
