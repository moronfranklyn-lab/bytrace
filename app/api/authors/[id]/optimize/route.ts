import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { streamClaude } from '@/lib/claude';
import { buildRefineFingerprintPrompt } from '@/lib/prompts/fingerprint-refine';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

interface IncomingArticle {
  title?: string;
  content?: string;
  /** 选择已有 crawled_articles 时给 id；新增手贴时不给。 */
  crawled_article_id?: string;
}

interface IncomingPayload {
  articles?: IncomingArticle[];
}

interface FingerprintRow {
  id: string;
  author_id: string;
  fingerprint_json: string;
  source_articles_json: string;
  version: number | null;
  parent_id: string | null;
  article_count: number | null;
  created_at: number;
  version_schema: string | null;
}

interface CrawledArticleRow {
  id: string;
  title: string | null;
  content: string;
}

const MIN_ARTICLES = 1;
const MAX_ARTICLES = 10;
const MIN_CONTENT_CHARS = 100;

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

/**
 * POST /api/authors/[id]/optimize —— 在该博主当前最新指纹基础上追加文章，输出 v(N+1) 指纹。
 *
 * Body:
 *   { articles: [
 *       { crawled_article_id: 'xxx' } |        // 选已有 crawled_articles
 *       { title?, content: '...' }             // 手贴
 *     ] }
 *
 * SSE 事件：
 *   open / chunk(text) / done(fingerprint_id, version) / error(message, phase)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id: authorId } = await params;
  if (!authorId) {
    return new Response(JSON.stringify({ error: '缺少 author id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法 JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const incoming = Array.isArray(body.articles) ? body.articles : [];
  if (incoming.length < MIN_ARTICLES) {
    return new Response(JSON.stringify({ error: '至少选 1 篇新文章再来优化' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (incoming.length > MAX_ARTICLES) {
    return new Response(
      JSON.stringify({ error: `一次最多追加 ${MAX_ARTICLES} 篇` }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // ---- 准备：解析 articles 来源（已有的 crawled_articles or 手贴）----
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `数据库打不开：${(err as Error).message}` }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // 先验证博主存在
  const author = db
    .prepare(`SELECT id, name FROM authors WHERE id = ?`)
    .get(authorId) as { id: string; name: string } | undefined;
  if (!author) {
    return new Response(JSON.stringify({ error: '找不到这位博主' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // 拿这位博主当前最新的指纹
  const latestFp = db
    .prepare(
      `SELECT id, author_id, fingerprint_json, source_articles_json,
              version, parent_id, article_count, created_at, version_schema
       FROM fingerprints
       WHERE author_id = ?
       ORDER BY COALESCE(version, 1) DESC, created_at DESC
       LIMIT 1`,
    )
    .get(authorId) as FingerprintRow | undefined;

  if (!latestFp) {
    return new Response(
      JSON.stringify({ error: '这位博主还没有指纹，先去完整拆解一次' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // v3 指纹不走这条老优化通道：这里用的是 v1 prompt，产出的新行 version_schema
  // 会是 v1 且 version 更高成为 latest，等于把 v3 多平台指纹遮蔽降级
  // （详情页四维度全空、compose 也读不到 platform_fingerprints_json）。
  if (latestFp.version_schema === 'v3') {
    return new Response(
      JSON.stringify({
        error:
          '这位博主用的是 v3 指纹，这条老优化通道会把它降回 v1，就不往下走了。去指纹详情页用「加样本重提炼」，新样本会累计进 v3 指纹里，效果一样还不丢东西。',
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // 把 incoming 还原成 { title?, content }，并记下要回填 used_in_fingerprint_id 的 crawled_articles ids
  const resolved: { title?: string; content: string }[] = [];
  const crawledIdsToBackfill: string[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const a = incoming[i] ?? {};
    if (a.crawled_article_id) {
      const row = db
        .prepare(
          `SELECT id, title, content FROM crawled_articles WHERE id = ? AND author_id = ?`,
        )
        .get(a.crawled_article_id, authorId) as
        | CrawledArticleRow
        | undefined;
      if (!row) {
        return new Response(
          JSON.stringify({
            error: `第 ${i + 1} 篇：找不到这篇 crawled_article（${a.crawled_article_id}）`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          },
        );
      }
      if ((row.content ?? '').trim().length < MIN_CONTENT_CHARS) {
        return new Response(
          JSON.stringify({
            error: `第 ${i + 1} 篇的正文太短了（< ${MIN_CONTENT_CHARS} 字）`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          },
        );
      }
      resolved.push({
        title: row.title ?? undefined,
        content: row.content,
      });
      crawledIdsToBackfill.push(row.id);
    } else {
      const content = (a.content ?? '').trim();
      if (content.length < MIN_CONTENT_CHARS) {
        return new Response(
          JSON.stringify({
            error: `第 ${i + 1} 篇手贴的正文太短了（< ${MIN_CONTENT_CHARS} 字）`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          },
        );
      }
      resolved.push({
        title: a.title?.trim() || undefined,
        content,
      });
    }
  }

  let currentFingerprint: Record<string, unknown> = {};
  try {
    currentFingerprint = JSON.parse(latestFp.fingerprint_json);
  } catch {
    currentFingerprint = {};
  }

  // ---- 开 SSE 流 ----
  const encoder = new TextEncoder();
  const abortCtrl = new AbortController();
  req.signal.addEventListener('abort', () => abortCtrl.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // ignore
        }
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      try {
        send('open', { ok: true, author_name: author.name });

        const prompt = buildRefineFingerprintPrompt(
          currentFingerprint,
          resolved,
        );

        let raw = '';
        try {
          // refine prompt 带旧指纹全文 + 最多 10 篇新样本，默认 180s 不够
          raw = await streamClaude(prompt, {
            signal: abortCtrl.signal,
            onChunk: (text: string) => {
              send('chunk', { text });
            },
            timeoutMs: 360_000,
          });
        } catch (err) {
          send('error', {
            message: (err as Error).message || '模型那边没回来',
            phase: 'claude',
          });
          closeStream();
          return;
        }

        const cleanedJson = stripJsonFence(raw);
        let fingerprint: Record<string, unknown>;
        try {
          fingerprint = JSON.parse(cleanedJson);
        } catch (parseErr) {
          send('error', {
            message: '模型输出了一段不太像 JSON 的东西，再试一次大概率就好',
            phase: 'parse',
            detail: (parseErr as Error).message,
            sample: cleanedJson.slice(0, 280),
          });
          closeStream();
          return;
        }

        // ---- 落库：新 fingerprint + 回填 crawled_articles.used_in_fingerprint_id ----
        try {
          const newFpId = nanoid(14);
          const now = Date.now();
          const oldVersion = latestFp.version ?? 1;
          const newVersion = oldVersion + 1;
          const oldCount = latestFp.article_count ?? safeLen(latestFp.source_articles_json);
          const newCount = oldCount + resolved.length;

          // 合并 source articles：保留旧的 + 追加新的
          let oldSources: unknown[] = [];
          try {
            const parsed = JSON.parse(latestFp.source_articles_json);
            if (Array.isArray(parsed)) oldSources = parsed;
          } catch {
            // ignore
          }
          const mergedSources = [...oldSources, ...resolved];

          const insertFp = db.prepare(
            `INSERT INTO fingerprints
              (id, author_id, source_articles_json, fingerprint_json,
               raw_response, model_version, created_at, hit_count,
               version, parent_id, article_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          );
          const updateAuthor = db.prepare(
            `UPDATE authors SET last_used_at = ? WHERE id = ?`,
          );
          const backfillCa = db.prepare(
            `UPDATE crawled_articles
             SET used_in_fingerprint_id = ?
             WHERE id = ? AND used_in_fingerprint_id IS NULL`,
          );

          const tx = db.transaction(() => {
            insertFp.run(
              newFpId,
              authorId,
              JSON.stringify(mergedSources),
              JSON.stringify(fingerprint),
              raw,
              'claude-code-cli',
              now,
              newVersion,
              latestFp.id,
              newCount,
            );
            updateAuthor.run(now, authorId);
            for (const caid of crawledIdsToBackfill) {
              backfillCa.run(newFpId, caid);
            }
          });
          tx();

          send('done', {
            fingerprint_id: newFpId,
            author_id: authorId,
            version: newVersion,
            article_count: newCount,
          });
        } catch (dbErr) {
          send('error', {
            message: '本地数据库这次没接住，看一眼 console 再来一遍',
            phase: 'db',
            detail: (dbErr as Error).message,
          });
        }
      } finally {
        closeStream();
      }
    },
    cancel() {
      abortCtrl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function safeLen(s: string): number {
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}
