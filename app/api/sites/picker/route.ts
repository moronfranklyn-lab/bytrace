import { getDb } from '@/lib/db';
import { PLATFORMS, type PlatformKey } from '@/lib/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sites/picker
 *
 * 给 compose Step 1 用的卡片列表。
 * 输出按 PlatformKey 分组：
 *   {
 *     items: [
 *       { kind: 'site',    platform_key, site_id, title, section, word_range, ... },
 *       { kind: 'generic', platform_key, title, word_range, ... },  // 没 site 的平台 fallback
 *       ...
 *     ]
 *   }
 *
 * 排序：先 site 卡（按 source_article_count desc），再 generic 卡（按 PLATFORMS 顺序）。
 *
 * 设计意图：用户「选目标平台」时，看到的是自己拆过的具体板块/站点，而不是空泛的平台名。
 * 没拆过的平台用通用画像兜底，避免空白。
 */

interface SiteRow {
  id: string;
  site_name: string;
  section: string | null;
  source_article_count: number | null;
  profile_json: string;
  updated_at: number | null;
  created_at: number;
}

interface ProfileShape {
  tone?: string;
  word_count_range?: [number, number];
  preferred_topics?: string[];
  opening_pattern?: string;
}

// site_name → platform_key 的简单映射。后续可改成在 site 里显式存。
const SITE_NAME_TO_PLATFORM: Record<string, PlatformKey> = {
  人人都是产品经理: 'wechat',
  公众号: 'wechat',
  知乎: 'zhihu',
  知乎专栏: 'zhihu',
  少数派: 'sspai',
  优设: 'uisdc',
  小红书: 'xhs',
  'B 站': 'bilibili',
  B站: 'bilibili',
};

function inferPlatformKey(siteName: string): PlatformKey {
  const trimmed = siteName.trim();
  if (trimmed in SITE_NAME_TO_PLATFORM) return SITE_NAME_TO_PLATFORM[trimmed];
  // 模糊匹配
  for (const k in SITE_NAME_TO_PLATFORM) {
    if (trimmed.includes(k) || k.includes(trimmed)) return SITE_NAME_TO_PLATFORM[k];
  }
  return 'custom';
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, site_name, section, source_article_count, profile_json,
              updated_at, created_at
       FROM sites
       ORDER BY COALESCE(source_article_count, 0) DESC, updated_at DESC, created_at DESC`,
    )
    .all() as SiteRow[];

  // 已有 site 的平台 key 集合
  const sitePlatformKeys = new Set<PlatformKey>();
  const siteItems = rows.map((r) => {
    let profile: ProfileShape = {};
    try {
      profile = JSON.parse(r.profile_json) as ProfileShape;
    } catch {/* keep empty */}
    const platformKey = inferPlatformKey(r.site_name);
    sitePlatformKeys.add(platformKey);
    const wc = Array.isArray(profile.word_count_range) ? profile.word_count_range : null;
    return {
      kind: 'site' as const,
      platform_key: platformKey,
      site_id: r.id,
      site_name: r.site_name,
      section: r.section,
      sample_count: r.source_article_count ?? 0,
      word_range_min: wc ? wc[0] : null,
      word_range_max: wc ? wc[1] : null,
      tone_hint: profile.tone ? profile.tone.slice(0, 28) : null,
      preferred_topics: (profile.preferred_topics ?? []).slice(0, 3),
      updated_at: r.updated_at ?? r.created_at,
    };
  });

  // 没拆过站点画像的平台用 PLATFORMS 常量兜底，让用户仍能选
  const genericItems = PLATFORMS.filter((p) => !sitePlatformKeys.has(p.key)).map((p) => ({
    kind: 'generic' as const,
    platform_key: p.key,
    title: p.name,
    word_range_min: p.word_range_min,
    word_range_max: p.word_range_max,
    pacing: p.pacing,
    tone_tag: p.tone_tag,
    ui_hint: p.ui_hint,
  }));

  return Response.json({
    items: [...siteItems, ...genericItems],
    site_count: siteItems.length,
    generic_count: genericItems.length,
  });
}
