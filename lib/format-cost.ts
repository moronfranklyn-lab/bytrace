/**
 * 把美元金额格式化成 UI 友好的字符串。
 * - < $1：保留三位小数（爬虫单次成本常常是几分钱）
 * - >= $1：保留两位小数（月度合计 / 总额）
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  const v = Math.max(0, n);
  if (v < 1) {
    return `$${v.toFixed(3)}`;
  }
  return `$${v.toFixed(2)}`;
}
