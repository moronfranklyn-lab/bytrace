import { getDb } from './db';

export interface FingerprintRow {
  id: string;
  author_id: string;
  fingerprint_json: string;
  source_articles_json: string;
  created_at: number;
  hit_count: number;
  author_name: string;
  platform: string | null;
  avatar_emoji: string | null;
  last_used_at: number | null;
}

export interface FingerprintListItem {
  id: string;
  authorName: string;
  platform: string | null;
  avatarChar: string;
  studied: number;
  hitCount: number;
  createdAt: number;
  lastUsedAt: number | null;
  radar: { lang: number; struct: number; topic: number; visual: number };
}

/**
 * 取最近 N 个指纹（按 author.last_used_at desc，回退到 fingerprint.created_at desc）。
 */
export function listRecentFingerprints(limit = 4): FingerprintListItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.id, f.author_id, f.fingerprint_json, f.source_articles_json,
              f.created_at, f.hit_count,
              a.name AS author_name, a.platform, a.avatar_emoji, a.last_used_at
       FROM fingerprints f
       JOIN authors a ON a.id = f.author_id
       ORDER BY COALESCE(a.last_used_at, f.created_at) DESC
       LIMIT ?`,
    )
    .all(limit) as FingerprintRow[];
  return rows.map(toListItem);
}

export function listAllFingerprints(): FingerprintListItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.id, f.author_id, f.fingerprint_json, f.source_articles_json,
              f.created_at, f.hit_count,
              a.name AS author_name, a.platform, a.avatar_emoji, a.last_used_at
       FROM fingerprints f
       JOIN authors a ON a.id = f.author_id
       ORDER BY COALESCE(a.last_used_at, f.created_at) DESC`,
    )
    .all() as FingerprintRow[];
  return rows.map(toListItem);
}

function toListItem(row: FingerprintRow): FingerprintListItem {
  let articleCount = 0;
  let sourceUrls: string[] = [];
  try {
    const arr = JSON.parse(row.source_articles_json);
    if (Array.isArray(arr)) {
      articleCount = arr.length;
      sourceUrls = arr
        .map((x) => (x && typeof x === 'object' ? (x as { url?: unknown }).url : null))
        .filter((x): x is string => typeof x === 'string');
    }
  } catch {/* ignore */}

  // 雷达条目前没有真实的"维度得分"——基于指纹 JSON 长度做一个稳定可视化
  let fpJson: Record<string, unknown> = {};
  try { fpJson = JSON.parse(row.fingerprint_json); } catch {/* ignore */}
  const radar = deriveRadar(fpJson);

  return {
    id: row.id,
    authorName: row.author_name,
    platform: displayPlatform(row.platform, sourceUrls),
    avatarChar: row.avatar_emoji || row.author_name.slice(0, 1).toUpperCase(),
    studied: articleCount,
    hitCount: row.hit_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    radar,
  };
}

function deriveRadar(fp: Record<string, unknown>) {
  const len = (obj: unknown): number => {
    if (!obj) return 0;
    if (typeof obj === 'string') return obj.length;
    if (Array.isArray(obj)) {
      return obj.reduce<number>((s, x) => s + len(x), 0);
    }
    if (typeof obj === 'object') {
      return Object.values(obj as Record<string, unknown>).reduce<number>(
        (s, x) => s + len(x),
        0,
      );
    }
    return 0;
  };
  // 把绝对长度映射到 30-95 之间
  const scale = (n: number) => Math.max(30, Math.min(95, Math.round(30 + n / 8)));
  return {
    lang: scale(len((fp as { language?: unknown }).language)),
    struct: scale(len((fp as { structure?: unknown }).structure)),
    topic: scale(len((fp as { topic?: unknown }).topic)),
    visual: scale(len((fp as { visual?: unknown }).visual)),
  };
}

/* ----------------------------------------------------------------- */
/* Agent K 第三轮 · 博主聚合视图                                       */
/* 把"按指纹版本铺"改成"按博主铺"。v3 指纹会携带 platforms_analyzed     */
/* 数组（多平台）；v1/v2 老指纹回退到 author.platform 单值。            */
/* ----------------------------------------------------------------- */

interface AuthorAggRow {
  id: string;
  name: string;
  platform: string | null;
  avatar_emoji: string | null;
  created_at: number;
  last_used_at: number | null;
  fingerprint_count: number;
  latest_fp_id: string | null;
  latest_fp_json: string | null;
  latest_fp_version: number | null;
  latest_fp_created: number | null;
}

export interface AuthorListItem {
  id: string;
  name: string;
  avatarChar: string;
  /** 已学习平台（去重后），优先取 v3 的 platforms_analyzed，回退 author.platform */
  platforms: string[];
  /** 全部指纹的策略碎片总数（v3 strategy_fragments + v2 strategies 聚合） */
  fragmentCount: number;
  /** 最近一次拆解/优化的时间，回退到 created_at */
  lastTouchedAt: number;
  /** 博主创建时间 */
  createdAt: number;
  /** 指纹版本总数 */
  versionCount: number;
  /** 最新一版指纹的 id，用于"用这个风格写一篇"快捷入口 */
  latestFpId: string | null;
  /** 最新一版的版本号（v1/v2/v3...） */
  latestVersion: number;
  /** 是否已经是 v3 结构（决定列表是否展示「多平台」标签） */
  isV3: boolean;
}

/**
 * 列出所有博主（按最近活跃倒序）。每位博主一条记录，自带其最新指纹的 v3 聚合标签。
 */
export function listAuthorsAggregated(): AuthorListItem[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.platform, a.avatar_emoji, a.created_at, a.last_used_at,
              (SELECT COUNT(*) FROM fingerprints f1 WHERE f1.author_id = a.id) AS fingerprint_count,
              (SELECT f2.id FROM fingerprints f2
                 WHERE f2.author_id = a.id
                 ORDER BY COALESCE(f2.version, 1) DESC, f2.created_at DESC LIMIT 1) AS latest_fp_id,
              (SELECT f3.fingerprint_json FROM fingerprints f3
                 WHERE f3.author_id = a.id
                 ORDER BY COALESCE(f3.version, 1) DESC, f3.created_at DESC LIMIT 1) AS latest_fp_json,
              (SELECT COALESCE(f4.version, 1) FROM fingerprints f4
                 WHERE f4.author_id = a.id
                 ORDER BY COALESCE(f4.version, 1) DESC, f4.created_at DESC LIMIT 1) AS latest_fp_version,
              (SELECT f5.created_at FROM fingerprints f5
                 WHERE f5.author_id = a.id
                 ORDER BY COALESCE(f5.version, 1) DESC, f5.created_at DESC LIMIT 1) AS latest_fp_created
       FROM authors a
       ORDER BY COALESCE(a.last_used_at, a.created_at) DESC`,
    )
    .all() as AuthorAggRow[];

  return rows
    .filter((r) => r.fingerprint_count > 0) // 没有任何指纹的博主在列表里没什么用
    .map((r) => {
      let fp: Record<string, unknown> = {};
      try {
        if (r.latest_fp_json) fp = JSON.parse(r.latest_fp_json);
      } catch {/* ignore */}

      const isV3 = !!fp.platform_fingerprints && typeof fp.platform_fingerprints === 'object';

      const platforms = extractPlatforms(fp, r.platform, r.latest_fp_id);
      const fragmentCount = countFragments(fp);

      const lastTouchedAt = r.last_used_at ?? r.latest_fp_created ?? r.created_at;

      return {
        id: r.id,
        name: r.name,
        avatarChar: r.avatar_emoji || r.name.slice(0, 1).toUpperCase(),
        platforms,
        fragmentCount,
        lastTouchedAt,
        createdAt: r.created_at,
        versionCount: r.fingerprint_count,
        latestFpId: r.latest_fp_id,
        latestVersion: r.latest_fp_version ?? 1,
        isV3,
      };
    });
}

function displayPlatform(raw: string | null, sourceUrls: string[] = []): string {
  const hasWoshipm = sourceUrls.some((u) => /(^|\.)woshipm\.com\//i.test(u));
  if (hasWoshipm) return '人人都是产品经理';
  const v = raw?.trim();
  if (!v) return '未指定';
  const map: Record<string, string> = {
    wechat: '公众号',
    xhs: '小红书',
    zhihu: '知乎',
    sspai: '少数派',
    uisdc: '优设',
    bilibili: 'B 站',
    youtube: 'YouTube',
    douyin: '抖音',
  };
  return map[v] ?? v;
}

function sourceUrlsForFingerprint(fpId: string | null): string[] {
  if (!fpId) return [];
  try {
    const db = getDb();
    const rows = db
      .prepare(`SELECT url FROM fingerprint_articles WHERE fingerprint_id = ? AND url IS NOT NULL`)
      .all(fpId) as { url: string }[];
    return rows.map((r) => r.url).filter(Boolean);
  } catch {
    return [];
  }
}

function extractPlatforms(fp: Record<string, unknown>, fallback: string | null, fpId?: string | null): string[] {
  const pa = (fp as { platforms_analyzed?: unknown }).platforms_analyzed;
  const sourceUrls = sourceUrlsForFingerprint(fpId ?? null);
  if (Array.isArray(pa) && pa.length > 0) {
    const set = new Set<string>();
    for (const x of pa) {
      if (typeof x === 'string' && x.trim()) set.add(displayPlatform(x.trim(), sourceUrls));
    }
    if (set.size > 0) return Array.from(set);
  }
  const pf = (fp as { platform_fingerprints?: unknown }).platform_fingerprints;
  if (pf && typeof pf === 'object') {
    const keys = Object.keys(pf as Record<string, unknown>).filter((k) => k.trim());
    if (keys.length > 0) return keys.map((k) => displayPlatform(k, sourceUrls));
  }
  if (fallback && fallback.trim()) return [displayPlatform(fallback.trim(), sourceUrls)];
  return ['未指定'];
}

function countFragments(fp: Record<string, unknown>): number {
  const v3 = (fp as { strategy_fragments?: unknown }).strategy_fragments;
  if (Array.isArray(v3)) return v3.length;
  const v2 = (fp as { strategies?: unknown }).strategies;
  if (Array.isArray(v2)) return v2.length;
  return 0;
}
