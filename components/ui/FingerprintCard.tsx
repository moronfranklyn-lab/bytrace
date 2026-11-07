import Link from 'next/link';

export interface FingerprintCardData {
  id: string;
  authorName: string;
  avatarChar: string;
  /** 学习了几篇文章 */
  studied: number;
  /** 被命中（用作生成参考）几次 */
  hitCount: number;
  /** 四维度雷达条高度（0-100） */
  radar?: {
    lang?: number;
    struct?: number;
    topic?: number;
    visual?: number;
  };
  /** 不同卡片使用不同色调的头像渐变（cycle 4 种） */
  variant?: 0 | 1 | 2 | 3;
}

const AVATAR_GRADIENTS = [
  // 0 默认 lang -> visual
  undefined,
  'linear-gradient(135deg, var(--tint-structure), var(--tint-topic))',
  'linear-gradient(135deg, var(--tint-topic), var(--tint-visual))',
  'linear-gradient(135deg, var(--tint-visual), var(--tint-language))',
];

/**
 * 博主指纹小卡片：5 列 rail / 列表共用。
 * 不带交互 state —— 点击跳详情。
 */
export function FingerprintCard({ data }: { data: FingerprintCardData }) {
  const variant = (data.variant ?? 0) % 4;
  const avatarStyle = AVATAR_GRADIENTS[variant]
    ? { background: AVATAR_GRADIENTS[variant] }
    : undefined;

  const radar = data.radar ?? {};
  const bars = [
    { cls: 'lang' as const, h: clamp(radar.lang ?? 70) },
    { cls: 'struct' as const, h: clamp(radar.struct ?? 65) },
    { cls: 'topic' as const, h: clamp(radar.topic ?? 75) },
    { cls: 'visual' as const, h: clamp(radar.visual ?? 55) },
  ];

  return (
    <Link href={`/fingerprints/${data.id}`} className="fp-card">
      <div className="fp-avatar" style={avatarStyle}>
        {data.avatarChar}
      </div>
      <h3 className="fp-name">{data.authorName}</h3>
      <p className="fp-stats">
        已学习 {data.studied} 篇 · 命中 {data.hitCount} 次
      </p>
      <div className="fp-radar" aria-hidden>
        {bars.map((b) => (
          <div key={b.cls} className={`fp-bar ${b.cls}`} style={{ height: `${b.h}%` }} />
        ))}
      </div>
    </Link>
  );
}

export function AddFingerprintCard({ hint = '3-5 篇文 · 约 40s' }: { hint?: string }) {
  return (
    <Link href="/fingerprints/new" className="fp-card add-card">
      <div className="add-icon" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <div className="add-label">拆解新博主</div>
      <div className="add-hint">{hint}</div>
    </Link>
  );
}

function clamp(n: number) {
  if (Number.isNaN(n)) return 60;
  return Math.max(15, Math.min(100, Math.round(n)));
}
