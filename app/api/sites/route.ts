import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { streamClaude } from '@/lib/claude';
import { buildSiteProfilePrompt, type SiteProfileArticle } from '@/lib/prompts/siteprofile';
import {
  crawlArticle,
  crawlAuthorIndex,
  detectUrlType,
  isCrawlError,
  type CrawledArticle,
} from '@/lib/crawler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ARTICLES_FOR_PROFILE = 3;
const TARGET_ARTICLES_FOR_PROFILE = 8;
const MAX_ARTICLES_FOR_PROFILE = 10;
const PER_FETCH_SLEEP_MS = 1000;

interface SiteRow {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  profile_json: string;
  source_url: string | null;
  source_article_count: number | null;
  created_at: number;
  updated_at: number | null;
}

interface SiteListItem {
  id: string;
  site_name: string;
  section: string | null;
  url_pattern: string | null;
  source_article_count: number | null;
  created_at: number;
  preferred_topics: string[];
  word_count_range: [number, number] | null;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function jsonOk(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function stripJsonFence(raw: string): string {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return raw.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toListItem(row: SiteRow): SiteListItem {
  let preferred: string[] = [];
  let range: [number, number] | null = null;
  try {
    const profile = JSON.parse(row.profile_json) as Record<string, unknown>;
    if (Array.isArray(profile.preferred_topics)) {
      preferred = (profile.preferred_topics as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .slice(0, 6);
    }
    if (
      Array.isArray(profile.word_count_range) &&
      profile.word_count_range.length === 2 &&
      typeof profile.word_count_range[0] === 'number' &&
      typeof profile.word_count_range[1] === 'number'
    ) {
      range = [
        profile.word_count_range[0] as number,
        profile.word_count_range[1] as number,
      ];
    }
  } catch {
    // 容错：profile_json 解析失败也要列出来
  }
  return {
    id: row.id,
    site_name: row.site_name,
    section: row.section,
    url_pattern: row.url_pattern,
    source_article_count: row.source_article_count,
    created_at: row.created_at,
    preferred_topics: preferred,
    word_count_range: range,
  };
}

/** GET /api/sites —— 列出所有站点画像 */
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, site_name, section, url_pattern, profile_json,
                source_url, source_article_count, created_at, updated_at
         FROM sites
         ORDER BY COALESCE(updated_at, created_at) DESC`,
      )
      .all() as SiteRow[];
    return jsonOk({ items: rows.map(toListItem) });
  } catch (err) {
    return jsonError(`读取站点列表失败：${(err as Error).message}`, 500);
  }
}

/**
 * POST /api/sites —— 新建站点画像
 *
 * Body:
 *   { url: string, section?: string, article_urls?: string[] }
 *
 * 流程：
 * 1. 拿到 URL，先 detectUrlType 看看是不是公众号 / 支持
 * 2. 如果传了 article_urls，直接逐个 crawlArticle；否则 crawlAuthorIndex 拿一批
 * 3. 选前 8 篇，每篇之间 sleep 1s
 * 4. 拼 prompt 送 Claude，等完整输出
 * 5. 解析 JSON 入库
 *
 * 这是同步路由（不流式）——前端会显示 loading，~2 分钟。
 */
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    section?: string;
    article_urls?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const url = (body.url ?? '').trim();
  const section = (body.section ?? '').trim() || null;
  const explicitUrls = Array.isArray(body.article_urls)
    ? body.article_urls.map((u) => u.trim()).filter(Boolean)
    : [];

  if (!url) {
    return jsonError('站点 URL 不能为空');
  }

  // ---- 1. 平台识别 ----
  const urlType = detectUrlType(url);
  if (urlType.is_wechat) {
    return jsonError(
      urlType.hint || '公众号反爬较硬，工具不爬，请直接粘贴正文',
      400,
    );
  }

  // ---- 2. 收集文章 URL 列表 ----
  let candidateUrls: string[] = [];
  let sourceAuthorName: string | null = null;

  if (explicitUrls.length > 0) {
    candidateUrls = explicitUrls.slice(0, MAX_ARTICLES_FOR_PROFILE);
  } else {
    const index = await crawlAuthorIndex(url);
    if (isCrawlError(index)) {
      return jsonError(
        `没爬到这个站点的文章列表：${index.message}。可以试试直接传 article_urls 数组。`,
        400,
      );
    }
    sourceAuthorName = index.author_name;
    candidateUrls = index.article_urls.slice(0, MAX_ARTICLES_FOR_PROFILE);
  }

  if (candidateUrls.length < MIN_ARTICLES_FOR_PROFILE) {
    return jsonError(
      `这个站点只找到 ${candidateUrls.length} 篇可爬文章，至少需要 ${MIN_ARTICLES_FOR_PROFILE} 篇才能提画像。`,
      400,
    );
  }

  // ---- 3. 逐篇爬，每篇之间 sleep 1s 避免请求过急 ----
  const articles: SiteProfileArticle[] = [];
  const failedUrls: { url: string; reason: string }[] = [];
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // ignore
  }

  for (let i = 0; i < candidateUrls.length; i++) {
    if (articles.length >= TARGET_ARTICLES_FOR_PROFILE) break;
    if (i > 0) await sleep(PER_FETCH_SLEEP_MS);
    const articleUrl = candidateUrls[i];
    const a = await crawlArticle(articleUrl);
    if (isCrawlError(a)) {
      failedUrls.push({ url: articleUrl, reason: a.message });
      continue;
    }
    const ca = a as CrawledArticle;
    if (!ca.content || ca.content.length < 200) {
      failedUrls.push({ url: articleUrl, reason: '正文太短' });
      continue;
    }
    articles.push({
      title: ca.title ?? undefined,
      url: ca.url,
      content: ca.content,
    });
  }

  if (articles.length < MIN_ARTICLES_FOR_PROFILE) {
    return jsonError(
      `这一轮只爬到了 ${articles.length} 篇可用的文章（目标 ${MIN_ARTICLES_FOR_PROFILE} 篇起步）。失败：${failedUrls
        .slice(0, 3)
        .map((f) => f.reason)
        .join('；')}`,
      502,
    );
  }

  // ---- 4. 拼 prompt 调 Claude ----
  const prompt = buildSiteProfilePrompt(articles, {
    siteHost: host,
    sectionHint: section ?? undefined,
  });

  let raw = '';
  try {
    raw = await streamClaude(prompt, { timeoutMs: 240_000 });
  } catch (err) {
    return jsonError(
      `调模型失败：${(err as Error).message}`,
      502,
    );
  }

  const cleanedJson = stripJsonFence(raw);
  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(cleanedJson);
  } catch (err) {
    return jsonError(
      `模型输出了一段不太像 JSON 的东西：${(err as Error).message}`,
      502,
    );
  }

  // ---- 5. 落库 ----
  try {
    const db = getDb();
    const id = nanoid(14);
    const now = Date.now();
    const siteName =
      typeof profile.site_name === 'string' && profile.site_name
        ? (profile.site_name as string)
        : sourceAuthorName || host || '未命名站点';
    const sectionFinal =
      (typeof profile.section === 'string' && profile.section) ||
      section ||
      null;
    const urlPattern =
      typeof profile.url_pattern === 'string' && profile.url_pattern
        ? (profile.url_pattern as string)
        : host;

    db.prepare(
      `INSERT INTO sites
        (id, site_name, section, url_pattern, profile_json,
         source_url, source_article_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      siteName,
      sectionFinal,
      urlPattern,
      JSON.stringify(profile),
      url,
      articles.length,
      now,
      now,
    );

    return jsonOk({
      id,
      site_name: siteName,
      section: sectionFinal,
      url_pattern: urlPattern,
      source_article_count: articles.length,
      failed_count: failedUrls.length,
      profile,
    });
  } catch (err) {
    return jsonError(`本地数据库这次没接住：${(err as Error).message}`, 500);
  }
}
