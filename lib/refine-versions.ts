/**
 * articles.refine_versions_json 列的统一解析。
 * ------------------------------------------------------------
 * 这一列历史上存在两种格式：
 *   - draft route（多平台一次出 N 版）写 dict：{ [platform]: md }
 *   - refine route（润色追加历史）写 array：RefineVersionEntry[]
 * 早期三处读写各自只认 array，dict 数据会被当空处理，refine 落库时
 * 甚至会整列覆盖抹掉 dict 里的多平台版本。所以读这列必须走这里归一，
 * 别再在调用方手写 JSON.parse + Array.isArray。
 */

import { resolvePlatformKey, type PlatformKey } from '@/lib/platforms';

export interface RefineVersionEntry {
  ts: number;
  source_platform: PlatformKey;
  target_platform: PlatformKey;
  content_md: string;
}

export interface ParseRefineVersionsOptions {
  /** dict 形态没有时间戳，用文章 created_at 之类兜底；不传落 0 */
  fallbackTs?: number;
  /** dict 形态没有源平台，用文章主平台（platform_target）兜底；不传落 'wechat' */
  mainPlatform?: string;
}

/**
 * 安全解析 refine_versions_json：
 *   - array 形态原样返回（过滤掉结构不完整的条目）
 *   - dict 形态转成 array entry（ts / source_platform 用 opts 兜底，
 *     target_platform 用 dict key）
 *   - 其余情况（null / 坏 JSON / 标量）返回 []
 */
export function parseRefineVersions(
  raw: string | null | undefined,
  opts: ParseRefineVersionsOptions = {},
): RefineVersionEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  // refine route 写的 array 形态
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (v): v is RefineVersionEntry =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as RefineVersionEntry).target_platform === 'string' &&
        typeof (v as RefineVersionEntry).content_md === 'string',
    );
  }

  // draft route 写的 dict 形态：{ [platform]: md }
  if (parsed && typeof parsed === 'object') {
    const fallbackSource: PlatformKey =
      resolvePlatformKey(opts.mainPlatform) ?? 'wechat';
    const entries: RefineVersionEntry[] = [];
    for (const [platform, md] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof md !== 'string' || md.length === 0) continue;
      entries.push({
        ts: opts.fallbackTs ?? 0,
        // dict key 是 draft route 落的英文 PlatformKey；万一有脏数据保留原值不丢
        target_platform: resolvePlatformKey(platform) ?? (platform as PlatformKey),
        source_platform: fallbackSource,
        content_md: md,
      });
    }
    return entries;
  }

  return [];
}
