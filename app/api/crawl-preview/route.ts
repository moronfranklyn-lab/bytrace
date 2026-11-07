import { NextRequest } from 'next/server';
import { crawlArticle, crawlAuthorIndex, detectUrlType, detectUrlKind, isCrawlError } from '@/lib/crawler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReqBody {
  url?: string;
  /**
   * 'article'：单篇（默认 / 旧行为）
   * 'index'：作者主页/板块页拉文章列表
   * 'auto'：先 detectUrlKind，是 index 就走 index 模式，是 article 就走 article；
   *         unknown 时按 article 兜底——给前端 hint 提示用户切换
   */
  mode?: 'article' | 'index' | 'auto';
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
  if (!url) {
    return jsonError('URL 不能为空');
  }
  let mode: 'article' | 'index' = 'article';
  let autoDetected: 'article' | 'index' | 'unknown' | null = null;
  if (body.mode === 'index') {
    mode = 'index';
  } else if (body.mode === 'auto') {
    autoDetected = detectUrlKind(url);
    mode = autoDetected === 'index' ? 'index' : 'article';
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
          mode: 'index',
          platform: idx.platform,
          author_name: idx.author_name,
          article_urls: idx.article_urls,
          auto_detected_kind: autoDetected,
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
        mode: 'article',
        platform: typeInfo.platform,
        title: result.title,
        preview,
        full_length: result.content.length,
        image_count: result.images.length,
        url: result.url,
        url_hash: result.url_hash,
        medium: result.medium ?? 'text',
        auto_detected_kind: autoDetected,
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
