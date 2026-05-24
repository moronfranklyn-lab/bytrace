import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface Row {
  id: string;
  author_id: string;
  fingerprint_json: string;
  created_at: number;
  author_name: string;
  platform: string | null;
  avatar_emoji: string | null;
}

interface Strategy {
  tag?: string;
  scope?: string[];
  description?: string;
  example?: string;
  when_to_use?: string;
}
interface Fingerprint {
  author_summary?: string;
  language?: {
    sentence_length?: string;
    vocabulary_register?: string;
    verbal_tics?: string[];
  };
  structure?: {
    opening_hook?: string;
    transition_style?: string;
    closing_pattern?: string;
  };
  topic?: {
    topic_preference?: string;
    viewpoint_density?: string;
    argumentation?: string;
  };
  visual?: {
    image_style?: string;
    emoji_usage?: string;
    layout_preference?: string;
  };
  fingerprint_summary?: string;
  do_list?: string[];
  dont_list?: string[];
  // v2 新增
  strategies?: Strategy[];
  strengths?: string[];
  weaknesses?: string[];
  strategy_reasoning?: string;
  category_variance?: Record<string, string>;
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

// 复用首页风格的 icon —— Lucide check / x
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="do-dont-icon">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="do-dont-icon">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default async function FingerprintDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT f.id, f.author_id, f.fingerprint_json, f.created_at,
              a.name AS author_name, a.platform, a.avatar_emoji
       FROM fingerprints f
       JOIN authors a ON a.id = f.author_id
       WHERE f.id = ?`,
    )
    .get(id) as Row | undefined;

  if (!row) {
    notFound();
  }

  let fp: Fingerprint = {};
  try {
    fp = JSON.parse(row.fingerprint_json) as Fingerprint;
  } catch {
    // 容错：解析失败也要把页面渲出来，不能直接 404
    fp = {};
  }

  const avatarChar = row.avatar_emoji || row.author_name.slice(0, 1).toUpperCase();
  const tics = fp.language?.verbal_tics ?? [];
  const doList = fp.do_list ?? [];
  const dontList = fp.dont_list ?? [];

  return (
    <>
      <HomeNav activePath="/fingerprints" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="fp-page-head">
          <div className="fp-page-head-left">
            <h1 className="fp-page-title">
              <span className="fp-avatar" style={{ width: 44, height: 44, marginBottom: 0, fontSize: 18 }}>
                {avatarChar}
              </span>
              <span>{row.author_name}</span>
            </h1>
            <div className="fp-page-meta">
              <span>{row.platform || '未指定平台'}</span>
              <span className="meta-sep">·</span>
              <span>拆解于 {formatDate(row.created_at)}</span>
              <span className="meta-sep">·</span>
              <span>id {row.id.slice(0, 8)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link
              href={`/authors/${row.author_id}`}
              className="btn btn-secondary"
            >
              博主详情 / 版本历史
            </Link>
            <Link
              href={`/compose?fingerprint=${row.id}`}
              className="btn btn-primary"
            >
              拿这个风格写一篇
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        </div>

        {/* 写作 DNA 卡片 */}
        <div className="dna-card">
          <div className="dna-eyebrow">写作 DNA</div>
          {fp.author_summary && <p className="dna-summary">{fp.author_summary}</p>}
          {fp.fingerprint_summary && (
            <p className="dna-fingerprint">{fp.fingerprint_summary}</p>
          )}
        </div>

        {/* 四象限 */}
        <h2 className="fp-grid-section-title">四维度拆解</h2>
        <p className="fp-grid-section-sub">语言 · 结构 · 题材 · 视觉，每维都是跨篇稳定复现的特征。</p>
        <div className="fp-grid">
          {/* 语言 */}
          <article className="fp-quadrant" data-tint="language">
            <div className="fp-q-head">
              <h3 className="fp-q-title">语言</h3>
              <span className="fp-q-eyebrow">LANGUAGE</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">句长</span>
              <span className="fp-q-value">{fp.language?.sentence_length || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">词性</span>
              <span className="fp-q-value">{fp.language?.vocabulary_register || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">口头禅</span>
              {tics.length ? (
                <div className="fp-tics">
                  {tics.map((t, i) => <span key={i} className="fp-tic">{t}</span>)}
                </div>
              ) : (
                <span className="fp-q-value">—</span>
              )}
            </div>
          </article>

          {/* 结构 */}
          <article className="fp-quadrant" data-tint="structure">
            <div className="fp-q-head">
              <h3 className="fp-q-title">结构</h3>
              <span className="fp-q-eyebrow">STRUCTURE</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">开篇钩子</span>
              <span className="fp-q-value">{fp.structure?.opening_hook || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">段落转场</span>
              <span className="fp-q-value">{fp.structure?.transition_style || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">收尾套路</span>
              <span className="fp-q-value">{fp.structure?.closing_pattern || '—'}</span>
            </div>
          </article>

          {/* 题材 */}
          <article className="fp-quadrant" data-tint="topic">
            <div className="fp-q-head">
              <h3 className="fp-q-title">题材</h3>
              <span className="fp-q-eyebrow">TOPIC</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">偏爱题材</span>
              <span className="fp-q-value">{fp.topic?.topic_preference || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">观点密度</span>
              <span className="fp-q-value">{fp.topic?.viewpoint_density || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">论证方式</span>
              <span className="fp-q-value">{fp.topic?.argumentation || '—'}</span>
            </div>
          </article>

          {/* 视觉 */}
          <article className="fp-quadrant" data-tint="visual">
            <div className="fp-q-head">
              <h3 className="fp-q-title">视觉</h3>
              <span className="fp-q-eyebrow">VISUAL</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">配图风格</span>
              <span className="fp-q-value">{fp.visual?.image_style || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">Emoji 用法</span>
              <span className="fp-q-value">{fp.visual?.emoji_usage || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">版式偏好</span>
              <span className="fp-q-value">{fp.visual?.layout_preference || '—'}</span>
            </div>
          </article>
        </div>

        {/* 该做 vs 不该做 */}
        <h2 className="fp-grid-section-title">该做 vs 不该做</h2>
        <p className="fp-grid-section-sub">仿写时贴在显示器边上的那张便利贴。</p>
        <div className="do-dont">
          <section className="do-dont-card do-list">
            <h3 className="do-dont-title">
              <CheckIcon /> 做这些
            </h3>
            <ul className="do-dont-list">
              {doList.length === 0 && <li className="do-dont-item">—</li>}
              {doList.map((d, i) => (
                <li key={i} className="do-dont-item">
                  <CheckIcon />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="do-dont-card dont-list">
            <h3 className="do-dont-title">
              <XIcon /> 别做这些
            </h3>
            <ul className="do-dont-list">
              {dontList.length === 0 && <li className="do-dont-item">—</li>}
              {dontList.map((d, i) => (
                <li key={i} className="do-dont-item">
                  <XIcon />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* v2 · 策略集合 */}
        {Array.isArray(fp.strategies) && fp.strategies.length > 0 && (
          <>
            <h2 className="fp-grid-section-title">写作策略集合 · v2</h2>
            <p className="fp-grid-section-sub">跨篇综合后的可复用策略，标了适用场景。</p>
            <div className="strategies-grid">
              {fp.strategies.map((s, i) => (
                <div key={i} className="strategy-card">
                  <div className="strategy-card-head">
                    {s.tag && <span className="tag tag-lang">{s.tag}</span>}
                    {(s.scope ?? []).map((sc) => (
                      <span key={sc} className="tag">{sc}</span>
                    ))}
                  </div>
                  <div className="strategy-card-desc">{s.description}</div>
                  {s.example && (
                    <div className="strategy-card-example">「{s.example}」</div>
                  )}
                  {s.when_to_use && (
                    <div className="strategy-card-when">何时用：{s.when_to_use}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* v2 · 优劣 + 动机 */}
        {((fp.strengths && fp.strengths.length > 0) ||
          (fp.weaknesses && fp.weaknesses.length > 0) ||
          fp.strategy_reasoning) && (
          <>
            <h2 className="fp-grid-section-title">优劣 + 策略动机 · v2</h2>
            <p className="fp-grid-section-sub">理解他为什么这么写，比模仿表面更稳。</p>
            <div className="strength-weakness-grid">
              {fp.strengths && fp.strengths.length > 0 && (
                <div className="strength-card">
                  <h3 className="strength-card-title">优点</h3>
                  <ul className="strength-card-list">
                    {fp.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {fp.weaknesses && fp.weaknesses.length > 0 && (
                <div className="weakness-card">
                  <h3 className="weakness-card-title">在哪类题材会失灵</h3>
                  <ul className="weakness-card-list">
                    {fp.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
            {fp.strategy_reasoning && (
              <div className="strategy-reasoning-card">
                <div className="dna-eyebrow">策略动机</div>
                <p>{fp.strategy_reasoning}</p>
              </div>
            )}
          </>
        )}

        {/* v2 · 分类差异 */}
        {fp.category_variance && Object.keys(fp.category_variance).length > 0 && (
          <>
            <h2 className="fp-grid-section-title">不同分类下的差异 · v2</h2>
            <p className="fp-grid-section-sub">同一位博主，不同题材的微调。</p>
            <div className="variance-list">
              {Object.entries(fp.category_variance).map(([cat, desc]) => (
                <div key={cat} className="variance-row">
                  <span className="variance-cat">{cat}</span>
                  <span className="variance-desc">{desc}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 原始 JSON 折叠 */}
        <details className="raw-json-panel">
          <summary className="raw-json-summary">
            <span>原始指纹 JSON（开发者）</span>
            <span style={{ fontSize: 10 }}>展开 ▾</span>
          </summary>
          <pre className="raw-json-body">{JSON.stringify(fp, null, 2)}</pre>
        </details>
      </main>
    </>
  );
}
