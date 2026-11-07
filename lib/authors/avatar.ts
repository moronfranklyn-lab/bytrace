/**
 * 从博主名挑头像字符。
 * - 优先取第一个 CJK 字
 * - 其次取第一个字符大写
 * - 全空 → 'A'
 */
export function pickAvatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'A';
  const cjk = trimmed.match(/[一-鿿]/);
  if (cjk) return cjk[0];
  return trimmed.slice(0, 1).toUpperCase();
}
