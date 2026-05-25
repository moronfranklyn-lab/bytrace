import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { AddFingerprintSamplesPanel } from './AddFingerprintSamplesPanel';
import { AuthorMetaEditor } from './AuthorMetaEditor';
import { DeleteFingerprintButton } from './DeleteFingerprintButton';

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
  iteration_count: number | null;
  version_schema: string | null;
}

interface SampleRow {
  url: string | null;
  title: string | null;
  added_at: number;
  iteration: number;
  source_mode: string;
  platform: string | null;
  primary_category: string | null;
  secondary_category: string | null;
  category_confidence: string | null;
}

interface CategoryProfileRow {
  category: string;
  profile_json: string;
  sample_count: number;
  iteration: number;
  updated_at: number;
}

interface CategoryProfileData {
  category?: string;
  sample_count?: number;
  summary?: string;
  what_makes_this_category_unique?: string;
  preferred_opening?: string;
  preferred_argumentation?: string;
  preferred_closing?: string;
  tone_for_this_category?: string;
  category_specific_fragments?: Array<{
    tag?: string;
    title?: string;
    description?: string;
    example?: string;
    when_to_use?: string;
    why_works?: string;
  }>;
  recommended_when?: string;
}

interface Strategy {
  tag?: string;
  scope?: string[];
  description?: string;
  example?: string;
  when_to_use?: string;
}
interface PlatformBlock {
  fingerprint_summary?: string;
  language?: Fingerprint['language'];
  structure?: Fingerprint['structure'];
  topic?: Fingerprint['topic'];
  visual?: Fingerprint['visual'];
  platform_specific_traits?: string[];
  strengths?: string[];
  weaknesses?: string[];
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
  // v3 新增：按平台分组
  platform_fingerprints?: Record<string, PlatformBlock>;
  platforms_analyzed?: string[];
  user_facing_summary?: string;
  // v3.3 新增：结构能力
  structure_repertoire?: {
    dominant_shape?: string;
    shapes?: Array<{
      shape?: string;
      share?: string;
      execution_traits?: string[];
    }>;
  };
  depth_pattern?: {
    average_layers?: number;
    max_layers?: number;
    drilling_phrases?: string[];
    drilling_observation?: string;
  };
  analogy_bank?: string[];
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
              f.iteration_count, f.version_schema,
              a.name AS author_name, a.platform, a.avatar_emoji
       FROM fingerprints f
       JOIN authors a ON a.id = f.author_id
       WHERE f.id = ?`,
    )
    .get(id) as Row | undefined;

  if (!row) {
    notFound();
  }

  const samples = db
    .prepare(
      `SELECT url, title, added_at, iteration, source_mode, platform,
              primary_category, secondary_category, category_confidence
       FROM fingerprint_articles WHERE fingerprint_id = ?
       ORDER BY added_at DESC`,
    )
    .all(id) as SampleRow[];

  // 按类别细分指纹
  const categoryRows = db
    .prepare(
      `SELECT category, profile_json, sample_count, iteration, updated_at
       FROM fingerprint_category_profiles WHERE fingerprint_id = ?
       ORDER BY sample_count DESC`,
    )
    .all(id) as CategoryProfileRow[];

  const categoryProfiles: Array<{
    category: string;
    sample_count: number;
    data: CategoryProfileData;
  }> = categoryRows.map((r) => {
    let data: CategoryProfileData = {};
    try { data = JSON.parse(r.profile_json) as CategoryProfileData; } catch { /* keep empty */ }
    return { category: r.category, sample_count: r.sample_count, data };
  });

  // 按主类别统计样本分布（包含未分类）
  const categoryDistribution = new Map<string, number>();
  for (const s of samples) {
    const k = s.primary_category || '未分类';
    categoryDistribution.set(k, (categoryDistribution.get(k) ?? 0) + 1);
  }
  const sortedDistribution = Array.from(categoryDistribution.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  const isV3 = row.version_schema === 'v3';

  let fp: Fingerprint = {};
  try {
    fp = JSON.parse(row.fingerprint_json) as Fingerprint;
  } catch {
    // 容错：解析失败也要把页面渲出来，不能直接 404
    fp = {};
  }

  // v3 兼容：language/structure/topic/visual 嵌在 platform_fingerprints.<平台>。
  // 老的"四维度"卡用第一个平台的字段做 fallback，否则全空。
  const platformBlocks = fp.platform_fingerprints ?? {};
  const platformKeys = Object.keys(platformBlocks);
  const primaryPlatformKey = platformKeys[0] ?? null;
  const primaryBlock: PlatformBlock | null = primaryPlatformKey
    ? platformBlocks[primaryPlatformKey] ?? null
    : null;
  const dim = {
    language: fp.language ?? primaryBlock?.language ?? {},
    structure: fp.structure ?? primaryBlock?.structure ?? {},
    topic: fp.topic ?? primaryBlock?.topic ?? {},
    visual: fp.visual ?? primaryBlock?.visual ?? {},
    fingerprint_summary: fp.fingerprint_summary ?? primaryBlock?.fingerprint_summary ?? '',
    strengths: fp.strengths ?? primaryBlock?.strengths ?? [],
    weaknesses: fp.weaknesses ?? primaryBlock?.weaknesses ?? [],
  };

  const avatarChar = row.avatar_emoji || row.author_name.slice(0, 1).toUpperCase();
  const tics = dim.language.verbal_tics ?? [];
  const doList = fp.do_list ?? [];
  const dontList = fp.dont_list ?? [];

  return (
    <>
      <HomeNav activePath="/fingerprints" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="fp-page-head">
          <AuthorMetaEditor
            authorId={row.author_id}
            authorName={row.author_name}
            platform={row.platform}
            avatarChar={avatarChar}
            createdAtLabel={formatDate(row.created_at)}
            fingerprintIdShort={row.id.slice(0, 8)}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <DeleteFingerprintButton
              fingerprintId={row.id}
              authorName={row.author_name}
            />
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
          {(dim.fingerprint_summary || fp.user_facing_summary) && (
            <p className="dna-fingerprint">{dim.fingerprint_summary || fp.user_facing_summary}</p>
          )}
        </div>

        {/* 四象限 */}
        <h2 className="fp-grid-section-title">
          四维度拆解
          {primaryPlatformKey && platformKeys.length === 1 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 12, fontWeight: 400 }}>
              · 来自「{primaryPlatformKey}」
            </span>
          )}
          {platformKeys.length > 1 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 12, fontWeight: 400 }}>
              · 展示「{primaryPlatformKey}」（共 {platformKeys.length} 个平台，下方按平台分组看完整）
            </span>
          )}
        </h2>
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
              <span className="fp-q-value">{dim.language.sentence_length || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">词性</span>
              <span className="fp-q-value">{dim.language.vocabulary_register || '—'}</span>
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
              <span className="fp-q-value">{dim.structure.opening_hook || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">段落转场</span>
              <span className="fp-q-value">{dim.structure.transition_style || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">收尾套路</span>
              <span className="fp-q-value">{dim.structure.closing_pattern || '—'}</span>
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
              <span className="fp-q-value">{dim.topic.topic_preference || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">观点密度</span>
              <span className="fp-q-value">{dim.topic.viewpoint_density || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">论证方式</span>
              <span className="fp-q-value">{dim.topic.argumentation || '—'}</span>
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
              <span className="fp-q-value">{dim.visual.image_style || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">Emoji 用法</span>
              <span className="fp-q-value">{dim.visual.emoji_usage || '—'}</span>
            </div>
            <div className="fp-q-row">
              <span className="fp-q-label">版式偏好</span>
              <span className="fp-q-value">{dim.visual.layout_preference || '—'}</span>
            </div>
          </article>
        </div>

        {/* v3.3 · 结构能力 */}
        {(() => {
          const sr = fp.structure_repertoire;
          const dp = fp.depth_pattern;
          const ab = fp.analogy_bank;
          const hasSr = sr && (sr.dominant_shape || (sr.shapes && sr.shapes.length > 0));
          const hasDp = dp && (
            typeof dp.average_layers === 'number' ||
            typeof dp.max_layers === 'number' ||
            (dp.drilling_phrases && dp.drilling_phrases.length > 0) ||
            dp.drilling_observation
          );
          const hasAb = Array.isArray(ab) && ab.length > 0;
          if (!hasSr && !hasDp && !hasAb) return null;

          const shapes = sr?.shapes ?? [];
          const drillingPhrases = dp?.drilling_phrases ?? [];
          const analogies = ab ?? [];
          const visibleAnalogies = analogies.slice(0, 12);
          const overflowAnalogies = Math.max(0, analogies.length - visibleAnalogies.length);

          return (
            <>
              <h2 className="fp-grid-section-title">结构能力 · 论证骨架</h2>
              <p className="fp-grid-section-sub">他擅长哪种骨架、挖多深、有哪些物件类比可以复用。这些直接决定写作时的纵深感。</p>
              {(hasSr || hasDp) && (
                <div className="strategies-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {hasSr && (
                    <div className="strategy-card">
                      <div className="strategy-card-head">
                        <span className="tag tag-lang" style={{ fontWeight: 600 }}>骨架库</span>
                        {sr?.dominant_shape && (
                          <span className="tag">主力：{sr.dominant_shape}</span>
                        )}
                      </div>
                      {shapes.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                          {shapes.map((sh, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div className="strategy-card-head">
                                {sh.shape && <span className="tag">{sh.shape}</span>}
                                {sh.share && <span className="tag">{sh.share}</span>}
                              </div>
                              {sh.execution_traits && sh.execution_traits.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                  {sh.execution_traits.map((t, j) => (
                                    <span key={j} className="tag">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {hasDp && (
                    <div className="strategy-card">
                      <div className="strategy-card-head">
                        <span className="tag tag-lang" style={{ fontWeight: 600 }}>挖掘深度</span>
                      </div>
                      <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>
                            {typeof dp?.average_layers === 'number' ? dp.average_layers : '—'}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>平均层级</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>
                            {typeof dp?.max_layers === 'number' ? dp.max_layers : '—'}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>最大层级</span>
                        </div>
                      </div>
                      {dp?.drilling_observation && (
                        <div className="strategy-card-desc" style={{ marginTop: 12 }}>
                          {dp.drilling_observation}
                        </div>
                      )}
                      {drillingPhrases.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {drillingPhrases.map((p, i) => (
                            <span key={i} className="tag">{p}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {hasAb && (
                <div className="strategies-grid" style={{ marginTop: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  {visibleAnalogies.map((a, i) => (
                    <div key={i} className="strategy-card">
                      <div className="strategy-card-desc">「{a}」</div>
                    </div>
                  ))}
                  {overflowAnalogies > 0 && (
                    <div className="strategy-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                      +{overflowAnalogies} 更多
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}

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
        {(dim.strengths.length > 0 || dim.weaknesses.length > 0 || fp.strategy_reasoning) && (
          <>
            <h2 className="fp-grid-section-title">优劣 + 策略动机</h2>
            <p className="fp-grid-section-sub">理解他为什么这么写，比模仿表面更稳。</p>
            <div className="strength-weakness-grid">
              {dim.strengths.length > 0 && (
                <div className="strength-card">
                  <h3 className="strength-card-title">优点</h3>
                  <ul className="strength-card-list">
                    {dim.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {dim.weaknesses.length > 0 && (
                <div className="weakness-card">
                  <h3 className="weakness-card-title">在哪类题材会失灵</h3>
                  <ul className="weakness-card-list">
                    {dim.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
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

        {/* 类别分布 + 按类别配方（v3.1） */}
        {isV3 && sortedDistribution.length > 0 && (
          <>
            <h2 className="fp-grid-section-title">类别分布</h2>
            <p className="fp-grid-section-sub">
              他在哪些题材类别下被你拆解过。≥ 3 篇的类别会自动生成专属配方。
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {sortedDistribution.map(([cat, n]) => (
                <span
                  key={cat}
                  className="tag"
                  style={{
                    background: n >= 3 ? 'var(--accent-bg, #e8e2d6)' : undefined,
                    fontWeight: n >= 3 ? 600 : 400,
                  }}
                >
                  {cat} · {n} 篇
                </span>
              ))}
            </div>
          </>
        )}

        {isV3 && categoryProfiles.length > 0 && (
          <>
            <h2 className="fp-grid-section-title">按类别拆解配方</h2>
            <p className="fp-grid-section-sub">
              他写不同类别时套路有差。写文章时按类别挑配方，比用"博主整体风格"更精准。
            </p>
            <div className="strategies-grid">
              {categoryProfiles.map((cp) => (
                <div key={cp.category} className="strategy-card">
                  <div className="strategy-card-head">
                    <span className="tag tag-lang" style={{ fontWeight: 600 }}>
                      {cp.category}
                    </span>
                    <span className="tag">{cp.sample_count} 篇样本</span>
                  </div>
                  {cp.data.summary && (
                    <div className="strategy-card-desc" style={{ fontWeight: 500 }}>
                      {cp.data.summary}
                    </div>
                  )}
                  {cp.data.what_makes_this_category_unique && (
                    <div className="strategy-card-when" style={{ marginTop: 8 }}>
                      <strong>与其他类的差异：</strong>
                      {cp.data.what_makes_this_category_unique}
                    </div>
                  )}
                  {cp.data.preferred_opening && (
                    <div className="strategy-card-when">
                      <strong>开篇：</strong>{cp.data.preferred_opening}
                    </div>
                  )}
                  {cp.data.preferred_argumentation && (
                    <div className="strategy-card-when">
                      <strong>论证：</strong>{cp.data.preferred_argumentation}
                    </div>
                  )}
                  {cp.data.preferred_closing && (
                    <div className="strategy-card-when">
                      <strong>收尾：</strong>{cp.data.preferred_closing}
                    </div>
                  )}
                  {cp.data.recommended_when && (
                    <div
                      className="strategy-card-when"
                      style={{ marginTop: 8, opacity: 0.85 }}
                    >
                      <strong>何时用：</strong>{cp.data.recommended_when}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* 加样本 · 持续优化（仅 v3 指纹） */}
        {isV3 && (
          <AddFingerprintSamplesPanel
            fingerprintId={row.id}
            iterationCount={row.iteration_count ?? 1}
            samples={samples.map((s) => ({
              url: s.url,
              title: s.title,
              added_at_label: formatDate(s.added_at),
              iteration: s.iteration,
              source_mode: s.source_mode,
              platform: s.platform,
              primary_category: s.primary_category,
              category_confidence: s.category_confidence,
            }))}
          />
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
