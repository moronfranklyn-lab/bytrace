import { NextRequest } from 'next/server';
import { crawlArticle, crawlAuthorIndex, detectUrlType, isCrawlError } from '@/lib/crawler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReqBody {
  url?: string;
  /** Agent I 增：'index' 时调 crawlAuthorIndex，否则按原行为爬单篇。 */
  mode?: 'article' | 'index';
}

/**
 * POST /api/crawl-preview
 * 给拆解页「试爬」按钮用：传一个 URL，返回 title / 预览 / 图片数 / 是否支持。
 * 失败时给温暖的 error message 让前端展示「切到正文模式」提示。
 *
 * Agent I 扩展：mode='index' 时改调 crawlAuthorIndex，返回
 *   { ok, author_name, platform, article_urls[] }
 * 用于 AuthorSearch 面板灌入文章卡。
 */
export async function POST(req: NextRequest) {
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const url = (body.url ?? '').trim();
  const mode = body.mode === 'index' ? 'index' : 'article';
  if (!url) {
    return jsonError('URL 不能为空');
  }

  const typeInfo = detectUrlType(url);
  if (!typeInfo.is_supported_for_crawl) {
    return new Response(
      JSON.stringify({
        ok: false,
        platform: typeInfo.platform,
        is_wechat: typeInfo.is_wechat,
        hint:
          typeInfo.hint ||
          (typeInfo.is_wechat
            ? '公众号文章爬不动，麻烦切到正文模式贴一下'
            : '这个链接不太对劲，再检查一下'),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  try {
    if (mode === 'index') {
      // Agent I · 拉作者主页文章列表
      const idx = await crawlAuthorIndex(url);
      if (isCrawlError(idx)) {
        return new Response(
          JSON.stringify({
            ok: false,
            platform: typeInfo.platform,
            reason: idx.reason,
            hint: idx.message,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          platform: idx.platform,
          author_name: idx.author_name,
          article_urls: idx.article_urls,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
      );
    }

    const result = await crawlArticle(url);
    if (isCrawlError(result)) {
      return new Response(
        JSON.stringify({
          ok: false,
          platform: typeInfo.platform,
          reason: result.reason,
          hint: result.message,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    const preview = result.content.slice(0, 200);
    return new Response(
      JSON.stringify({
        ok: true,
        platform: typeInfo.platform,
        title: result.title,
        preview,
        full_length: result.content.length,
        image_count: result.images.length,
        url: result.url,
        url_hash: result.url_hash,
        medium: result.medium ?? 'text',
        // 走 Apify 时附带本次成本，前端 toast 可显示「本次消耗 $X」
        apify_cost_usd: result.apify_cost_usd ?? null,
        apify_platform: result.apify_platform ?? null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        platform: typeInfo.platform,
        hint:
          '抓这一条的时候网络抽风了：' + ((err as Error).message || '未知原因'),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
