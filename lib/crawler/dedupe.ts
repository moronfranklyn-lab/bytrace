import crypto from 'node:crypto';

// 追踪参数白名单：utm_* / spm / share_* 通用；chksm / scene / srcid / sharer_* 是公众号分享参数；
// spm_id_from / vd_source 是 B 站分享参数；xtrack 是小红书 / 通用埋点参数
const TRACKING_PARAM_RE =
  /^(utm_|spm$|share_|from$|src$|ref$|fr$|chksm$|scene$|srcid$|sharer_|spm_id_from$|vd_source$|xtrack$)/i;

/**
 * 标准化 URL：lower-case host、去 fragment、去 tracking 参数。
 * 然后 sha1，取前 16 个 hex 字符。
 */
export function hashUrl(url: string): string {
  const normalized = normalizeUrl(url);
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

/** 标准化 URL：lower-case host、去 fragment、去 tracking 参数。 */
export function normalizeUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.trim().toLowerCase();
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  // 删 tracking 参数
  const toDelete: string[] = [];
  u.searchParams.forEach((_v, k) => {
    if (TRACKING_PARAM_RE.test(k)) toDelete.push(k);
  });
  toDelete.forEach((k) => u.searchParams.delete(k));
  // 排序，让相同语义的 URL 落到同一个 hash
  const sorted = new URLSearchParams();
  Array.from(u.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, v]) => sorted.append(k, v));
  u.search = sorted.toString() ? '?' + sorted.toString() : '';
  // 去末尾的 /
  let s = u.toString();
  if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
  return s;
}
