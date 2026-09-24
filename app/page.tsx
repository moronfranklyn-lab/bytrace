import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';
import { TopicTabs } from '@/components/home/TopicTabs';
import { listRecentFingerprints, type FingerprintListItem } from '@/lib/fingerprint-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TopicCard {
  tagTint: 'lang' | 'struct' | 'topic' | 'visual';
  tagDepth: string;
  tagExtra: string;
  title: string;
  angle: string;
  source: string;
}

const TOPICS: TopicCard[] = [
  {
    tagTint: 'lang',
    tagDepth: '语言深度',
    tagExtra: '符合 · 半佛仙人',
    title: '为什么你越努力越穷？— 谈劳动剩余价值的现代变形',
    angle: '从"打工人自嘲"切入，落到经济学层面的剥削机制，用理性吐槽 + 冷数据风格。',
    source: '公众号 / 半佛仙人',
  },
  {
    tagTint: 'struct',
    tagDepth: '结构深度',
    tagExtra: '符合 · 少数派 · 效率板块',
    title: 'Cursor 用了 3 个月，我把它从 IDE 用成了"第二大脑"',
    angle: '少数派典型"工作流复盘"：场景→痛点→工具组合→落地步骤→局限。',
    source: '少数派 / 效率板块',
  },
  {
    tagTint: 'topic',
    tagDepth: '题材热点',
    tagExtra: '热度 ↑ 优设',
    title: '2026 春夏 UI 配色趋势：奶油白与暖橘的新组合',
    angle: '近 7 天优设、UI 中国出现 12 篇暖色调相关文章，配 8-10 个最新作品集案例。',
    source: '优设 / 7 天 12 篇',
  },
  {
    tagTint: 'visual',
    tagDepth: '视觉深度',
    tagExtra: '符合 · 设计癖',
    title: '为什么 Apple 的网站永远没有"广告感"？拆解 5 层视觉克制术',
    angle: '从 Apple.com 实际截图入手，按"留白/字号/字距/动效/色彩"拆 5 层。',
    source: '公众号 / 设计癖',
  },
];

const AVATAR_GRADIENTS = [
  undefined,
  'linear-gradient(135deg, var(--tint-structure), var(--tint-topic))',
  'linear-gradient(135deg, var(--tint-topic), var(--tint-visual))',
  'linear-gradient(135deg, var(--tint-visual), var(--tint-language))',
];

export default async function HomePage() {
  const recent: FingerprintListItem[] = listRecentFingerprints(4);

  return (
    <>
      <HomeNav activePath="/" />

      {/* Hero */}
      <section className="hero">
        <div className="container">
          <div className="enter-stagger">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                本地运行 · 数据留在本机 · 模型可换
              </div>
            </div>
            <h1 className="hero-title">
              只给一段思路，
              <br />
              用你喜欢的<em>博主风格</em>写出一篇有深度的文章。
            </h1>
            <p className="hero-subtitle">
              把你喜欢的博主拆解成「风格指纹」，把目标平台拆解成「站点画像」。
              <br />
              下次写作，你只需要提供一段话 —— 题材、角度、核心观点。
            </p>
            <div className="hero-actions">
              <Link href="/compose" className="btn btn-primary">
                开始写一篇新文章
                <span className="btn-arrow">→</span>
              </Link>
              <Link href="/fingerprints" className="btn btn-secondary">
                管理我的风格库
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 今天的选题 */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">今天的选题</h2>
              <p className="section-subtitle">基于你订阅的博主风格 + 各平台近 7 天热度聚合</p>
            </div>
            <TopicTabs />
          </div>

          <div className="topic-list enter-stagger">
            {TOPICS.map((t) => (
              <Link key={t.title} href="/compose" className="topic-card">
                <div className="topic-meta">
                  <span className={`tag tag-${t.tagTint}`}>{t.tagDepth}</span>
                  <span className="tag">{t.tagExtra}</span>
                </div>
                <h3 className="topic-title">{t.title}</h3>
                <p className="topic-angle">{t.angle}</p>
                <div className="topic-footer">
                  <span className="topic-source">{t.source}</span>
                  <span className="topic-action">带入生成 →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 最近用过的风格 —— 真实 DB 数据 */}
      <section className="section section-alt">
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">最近用过的风格</h2>
              <p className="section-subtitle">
                {recent.length > 0
                  ? '点击任一指纹，下次生成会自动带入'
                  : '指纹库还是空的，拆一个博主就有了'}
              </p>
            </div>
            {recent.length > 0 && (
              <Link href="/fingerprints" className="section-action">
                查看全部 →
              </Link>
            )}
          </div>

          <div className="fp-rail enter-stagger">
            {recent.map((fp, i) => {
              const gradient = AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length];
              return (
                <Link key={fp.id} href={`/fingerprints/${fp.id}`} className="fp-card">
                  <div
                    className="fp-avatar"
                    style={gradient ? { background: gradient } : undefined}
                  >
                    {fp.avatarChar}
                  </div>
                  <h3 className="fp-name">{fp.authorName}</h3>
                  <p className="fp-stats">
                    已学习 {fp.studied} 篇 · 命中 {fp.hitCount} 次
                  </p>
                  <div className="fp-radar">
                    <div className="fp-bar lang" style={{ height: `${fp.radar.lang}%` }} />
                    <div className="fp-bar struct" style={{ height: `${fp.radar.struct}%` }} />
                    <div className="fp-bar topic" style={{ height: `${fp.radar.topic}%` }} />
                    <div className="fp-bar visual" style={{ height: `${fp.radar.visual}%` }} />
                  </div>
                </Link>
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

          {recent.length === 0 && (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <h3 className="empty-state-title">还没有指纹</h3>
              <p className="empty-state-desc">
                粘三五篇你喜欢的博主的文章，工具会把他的开篇套路、口头禅、收尾方式拆给你看。下一次写作，只需要一段思路。
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 日常入口 */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <div>
              <h2 className="section-title">日常入口</h2>
              <p className="section-subtitle">写得越多，工具越懂你</p>
            </div>
          </div>

          <div className="grid-features enter-stagger">
            <Link href="/fingerprints/new" className="card-feature">
              <div className="feature-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <circle cx="11.5" cy="14.5" r="2.5" />
                  <line x1="13.27" y1="16.27" x2="15" y2="18" />
                </svg>
              </div>
              <h3 className="feature-title">拆解一个新博主</h3>
              <p className="feature-desc">
                粘 3–5 篇他的文章，工具会输出完整的《风格指纹》——开篇套路、句长偏好、口头禅、收尾方式、论证习惯、<strong>配图风格</strong>。
              </p>
              <div className="feature-meta">
                <span>FINGERPRINT</span>
                <span>·</span>
                <span>~ 40s</span>
              </div>
            </Link>

            <Link href="/sites/new" className="card-feature">
              <div className="feature-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <h3 className="feature-title">扩充站点画像</h3>
              <p className="feature-desc">
                同一站点不同板块编辑偏好差异很大。给一个板块 URL，工具自动爬最近文章，建立板块级 + 编辑级的画像。
              </p>
              <div className="feature-meta">
                <span>SITE PROFILE</span>
                <span>·</span>
                <span>~ 2 min</span>
              </div>
            </Link>

            <Link href="#" className="card-feature">
              <div className="feature-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
              <h3 className="feature-title">素材库 · 配图风格</h3>
              <p className="feature-desc">
                本地已有 247 张配图，按博主风格自动打标。可用免费图库（Unsplash/Pexels）<strong>补全缺类</strong>，也支持指定网站爬图建库。
              </p>
              <div className="feature-meta">
                <span>ASSET LIBRARY</span>
                <span>·</span>
                <span>247 张</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <footer className="footer">
        笔迹 ByTrace · 本地工具 · 数据存在 ./data/autoarticle.db
      </footer>
    </>
  );
}
