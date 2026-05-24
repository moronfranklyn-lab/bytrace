import { getApifyUsage } from '@/lib/apify/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/apify/usage
 *
 * 返回 ApifyUsageReport：账户启用状态、本月用量、最近 20 次 run。
 * 失败 / 无 token → 禁用态（enabled=false），状态码仍 200，让前端统一处理。
 */
export async function GET() {
  const report = await getApifyUsage();
  return Response.json(report, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
