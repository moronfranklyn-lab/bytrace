/**
 * Apify 账户用量查询。
 *
 * 数据源：
 *   GET /v2/users/me                  → username / plan / 限额
 *   GET /v2/users/me/usage/monthly    → 本月 USD 已用
 *   GET /v2/actor-runs?limit=20       → 最近 run 列表（含 usageTotalUsd）
 *
 * 失败一律返回禁用态，不抛错；status pill 安全降级。
 */

import got from 'got';
import { getApifyToken } from '@/lib/crawler/apify';

const APIFY_BASE = 'https://api.apify.com/v2';
const REQ_TIMEOUT = 8_000;

/** 我们用到的 4 个 Actor 的 ID → 中文标签映射（actor-runs 返回的是 actId）。 */
const ACTOR_ID_TO_LABEL: Record<string, string> = {
  // sian.agency 系列（贵：$0.23-0.53/run，仍用于知乎和公众号）
  wRRMsCFHVxeD165YW: '知乎',
  sRWsMl4PrFXFmxWJp: 'B站 · 旧贵', // sian.agency/bilibili-video-scraper（不再用）
  Ct5ksiTJmsdeP0Xdg: '公众号',
  // 小红书：zhorex（推荐）+ easyapi（早期测试，已弃用）
  svGBZz6n79YbeA3uS: '小红书',
  watk8sVZNzd40UtbQ: '小红书 · 旧',
  // zhorex/bilibili-scraper（$0.005/item，2026-05 起替换 sian.agency 的贵 B 站 actor）
  kHCsKyIcIsw79qC95: 'B站',
};

export type RecentRun = {
  runId: string;
  actorLabel: string;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  costUsd: number;
};

export type ApifyUsageReport = {
  enabled: boolean;
  username: string | null;
  plan: string | null;
  monthlyUsageUsd: number;
  monthlyLimitUsd: number | null;
  recentRuns: RecentRun[];
};

const DISABLED: ApifyUsageReport = {
  enabled: false,
  username: null,
  plan: null,
  monthlyUsageUsd: 0,
  monthlyLimitUsd: null,
  recentRuns: [],
};

async function apifyGet<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await got(`${APIFY_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: { request: REQ_TIMEOUT },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'json',
    });
    if (res.statusCode >= 400) return null;
    return res.body as T;
  } catch {
    return null;
  }
}

export async function getApifyUsage(): Promise<ApifyUsageReport> {
  const token = getApifyToken();
  if (!token) return DISABLED;

  // 三路并发拉
  const [meRes, monthlyRes, runsRes] = await Promise.all([
    apifyGet<{ data?: { username?: string; plan?: { id?: string; maxMonthlyUsageUsd?: number } } }>(
      '/users/me',
      token,
    ),
    apifyGet<{ data?: { monthlyUsageUsd?: number; usageCycle?: { totalUsd?: number } } }>(
      '/users/me/usage/monthly',
      token,
    ),
    apifyGet<{
      data?: {
        items?: Array<{
          id?: string;
          actId?: string;
          status?: string;
          startedAt?: string;
          finishedAt?: string | null;
          usageTotalUsd?: number;
        }>;
      };
    }>('/actor-runs?limit=20&desc=true', token),
  ]);

  // me 接口失败 = token 无效，直接报禁用
  if (!meRes?.data?.username) return DISABLED;

  const me = meRes.data;
  const plan = me.plan || {};

  const monthly = monthlyRes?.data || {};
  const monthlyUsageUsd =
    typeof monthly.monthlyUsageUsd === 'number'
      ? monthly.monthlyUsageUsd
      : typeof monthly.usageCycle?.totalUsd === 'number'
        ? monthly.usageCycle.totalUsd
        : sumRecentRunsAsFallback(runsRes?.data?.items || []);

  const runs: RecentRun[] = (runsRes?.data?.items || []).map((r) => ({
    runId: String(r.id || ''),
    actorLabel: ACTOR_ID_TO_LABEL[String(r.actId || '')] || String(r.actId || '未知'),
    startedAt: r.startedAt ? Date.parse(r.startedAt) : 0,
    finishedAt: r.finishedAt ? Date.parse(r.finishedAt) : null,
    status: String(r.status || ''),
    costUsd: Number(r.usageTotalUsd || 0),
  }));

  return {
    enabled: true,
    username: me.username || null,
    plan: plan.id || null,
    monthlyUsageUsd: Number(monthlyUsageUsd) || 0,
    monthlyLimitUsd:
      typeof plan.maxMonthlyUsageUsd === 'number' ? plan.maxMonthlyUsageUsd : null,
    recentRuns: runs,
  };
}

/** 如果 monthly endpoint 失败，至少用最近 20 次 run 累加得到一个近似值。 */
function sumRecentRunsAsFallback(
  items: Array<{ usageTotalUsd?: number }>,
): number {
  return items.reduce((acc, r) => acc + (Number(r.usageTotalUsd) || 0), 0);
}
