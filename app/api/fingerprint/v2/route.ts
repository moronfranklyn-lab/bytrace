import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { streamClaude } from '@/lib/claude';
import {
  buildFingerprintV2Stage1Prompt,
  type FingerprintV2Article,
} from '@/lib/prompts/fingerprint-v2-stage1';
import {
  buildFingerprintV2Stage2Prompt,
  type FingerprintV2Stage1Output,
} from '@/lib/prompts/fingerprint-v2-stage2';
import { crawlArticle, isCrawlError } from '@/lib/crawler';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingArticleInput {
  mode?: 'url' | 'paste';
  url?: string;
  title?: string;
  content?: string; // 正文模式必填
  category?: string;
}
interface IncomingPayload {
  author_name?: string;
  platform?: string;
  articles?: IncomingArticleInput[];
}

const MIN_ARTICLES = 5;
const MAX_ARTICLES = 12;
const MIN_CONTENT_CHARS = 80;
const STAGE1_CONCURRENCY = 3;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
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

function pickAvatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'A';
  const cjk = trimmed.match(/[一-鿿]/);
  if (cjk) return cjk[0];
  return trimmed.slice(0, 1).toUpperCase();
}

interface PreparedArticle extends FingerprintV2Article {
  source: 'url' | 'paste';
  url?: string;
  url_hash?: string;
  image_count?: number;
}

/**
 * URL 模式：用 crawler 抓回正文。失败抛错（由调用方变成 SSE error）。
 */
async function prepareArticle(input: IncomingArticleInput, idx: number): Promise<PreparedArticle> {
  const mode = input.mode === 'url' ? 'url' : 'paste';
  const category = (input.category ?? '').trim() || '未分类';

  if (mode === 'url') {
    const url = (input.url ?? '').trim();
    if (!url) {
      throw new Error(`第 ${idx + 1} 篇的 URL 是空的，要么填上要么切到正文模式`);
    }
    const crawled = await crawlArticle(url);
    if (isCrawlError(crawled)) {
      throw new Error(
        `第 ${idx + 1} 篇 URL 抓不下来（${crawled.reason}）：${crawled.message}。建议切到正文模式贴一下。`,
      );
    }
    const content = crawled.content.trim();
    if (content.length < MIN_CONTENT_CHARS) {
      throw new Error(
        `第 ${idx + 1} 篇抓到的正文太短（${content.length} 字），可能没抓全。切到正文模式手贴吧。`,
      );
    }
    return {
      title: crawled.title || input.title?.trim() || undefined,
      content,
      category,
      source: 'url',
      url: crawled.url,
      url_hash: crawled.url_hash,
      image_count: crawled.images.length,
    };
  }

  const content = (input.content ?? '').trim();
  if (content.length < MIN_CONTENT_CHARS) {
    throw new Error(
      `第 ${idx + 1} 篇正文不足 ${MIN_CONTENT_CHARS} 字，再多贴一点`,
    );
  }
  return {
    title: input.title?.trim() || undefined,
    content,
    category,
    source: 'paste',
  };
}

/**
 * 用并发上限跑 stage1。每篇成功后调 onItemDone，失败抛错。
 */
async function runStage1WithConcurrency(
  prepared: PreparedArticle[],
  signal: AbortSignal,
  onItemStart: (i: number) => void,
  onItemDone: (i: number, rawJson: string) => void,
  onChunk: (i: number, text: string) => void,
): Promise<FingerprintV2Stage1Output[]> {
  const outputs: (FingerprintV2Stage1Output | null)[] = prepared.map(() => null);
  let cursor = 0;

  async function worker() {
    while (true) {
      if (signal.aborted) return;
      const idx = cursor++;
      if (idx >= prepared.length) return;
      onItemStart(idx);
      const prompt = buildFingerprintV2Stage1Prompt(prepared[idx], idx, prepared.length);
      const raw = await streamClaude(prompt, {
        signal,
        onChunk: (text) => onChunk(idx, text),
      });
      const cleaned = stripJsonFence(raw);
      outputs[idx] = {
        index: idx,
        category: prepared[idx].category || '未分类',
        title: prepared[idx].title,
        rawJson: cleaned,
      };
      onItemDone(idx, cleaned);
    }
  }

  const n = Math.min(STAGE1_CONCURRENCY, prepared.length);
  const workers = Array.from({ length: n }, () => worker());
  await Promise.all(workers);

  return outputs.filter((o): o is FingerprintV2Stage1Output => o !== null);
}

export async function POST(req: NextRequest) {
  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const authorName = (body.author_name ?? '').trim();
  const platform = (body.platform ?? '').trim() || null;
  const articles = Array.isArray(body.articles) ? body.articles : [];

  if (!authorName) {
    return jsonError('博主名不能为空');
  }
  if (articles.length < MIN_ARTICLES || articles.length > MAX_ARTICLES) {
    return jsonError(
      `文章数量需要在 ${MIN_ARTICLES} 到 ${MAX_ARTICLES} 篇之间，当前 ${articles.length} 篇`,
    );
  }

  const encoder = new TextEncoder();
  const abortCtrl = new AbortController();
  req.signal.addEventListener('abort', () => abortCtrl.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {/* controller closed */}
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {/* ignore */}
      };

      try {
        send('open', { ok: true, total: articles.length });

        // ---- Step 1: 准备文章（URL 抓取或正文校验） ----
        send('phase', { phase: 'prepare', message: '正在准备样本' });
        const prepared: PreparedArticle[] = [];
        for (let i = 0; i < articles.length; i++) {
          if (abortCtrl.signal.aborted) {
            send('error', { message: '已中止', phase: 'abort' });
            closeStream();
            return;
          }
          try {
            const p = await prepareArticle(articles[i], i);
            prepared.push(p);
            send('article', {
              index: i,
              status: 'ready',
              title: p.title || '（无标题）',
              category: p.category,
              source: p.source,
              chars: p.content.length,
              image_count: p.image_count,
            });
          } catch (err) {
            send('error', {
              message: (err as Error).message || '准备样本时出错',
              phase: 'prepare',
              index: i,
            });
            closeStream();
            return;
          }
        }

        // ---- Step 2: Stage1 并发 ----
        send('phase', { phase: 'stage1', message: '正在逐篇拆出局部策略' });
        let stage1Outputs: FingerprintV2Stage1Output[] = [];
        try {
          stage1Outputs = await runStage1WithConcurrency(
            prepared,
            abortCtrl.signal,
            (i) => send('article', { index: i, status: 'analyzing' }),
            (i, rawJson) => {
              // 验证一下这是个合法 JSON
              let okJson = true;
              try { JSON.parse(rawJson); } catch { okJson = false; }
              send('article', {
                index: i,
                status: okJson ? 'analyzed' : 'analyzed-loose',
              });
            },
            (i, text) => send('chunk', { stage: 'stage1', index: i, text }),
          );
        } catch (err) {
          send('error', {
            message:
              '某一篇拆解时模型没回来：' +
              ((err as Error).message || '未知错误'),
            phase: 'stage1',
          });
          closeStream();
          return;
        }

        // ---- Step 3: Stage2 综合 ----
        send('phase', { phase: 'stage2', message: '正在跨篇综合博主整体指纹' });
        let stage2Raw = '';
        try {
          const stage2Prompt = buildFingerprintV2Stage2Prompt(
            authorName,
            platform,
            stage1Outputs,
          );
          stage2Raw = await streamClaude(stage2Prompt, {
            signal: abortCtrl.signal,
            onChunk: (text) => send('chunk', { stage: 'stage2', text }),
          });
        } catch (err) {
          send('error', {
            message:
              '综合阶段模型没回来：' + ((err as Error).message || '未知错误'),
            phase: 'stage2',
          });
          closeStream();
          return;
        }

        // ---- Step 4: 解析 stage2 JSON ----
        const cleanedJson = stripJsonFence(stage2Raw);
        let fingerprint: Record<string, unknown>;
        try {
          fingerprint = JSON.parse(cleanedJson);
        } catch (parseErr) {
          send('error', {
            message: '模型综合输出不是合法 JSON，再试一次大概率就好',
            phase: 'parse',
            detail: (parseErr as Error).message,
            sample: cleanedJson.slice(0, 280),
          });
          closeStream();
          return;
        }

        // ---- Step 5: 落库 ----
        try {
          const db = getDb();
          const authorId = nanoid(12);
          const fingerprintId = nanoid(14);
          const now = Date.now();

          const insertAuthor = db.prepare(
            `INSERT INTO authors (id, name, platform, avatar_emoji, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          );
          const insertFingerprint = db.prepare(
            `INSERT INTO fingerprints
              (id, author_id, source_articles_json, fingerprint_json, raw_response, model_version, created_at, hit_count, version, article_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 2, ?)`,
          );
          const insertCrawled = db.prepare(
            `INSERT OR IGNORE INTO crawled_articles
              (id, author_id, url, url_hash, title, content, category, images_json, source_type, used_in_fingerprint_id, crawled_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const insertStrategy = db.prepare(
            `INSERT INTO strategies
              (id, fingerprint_id, tag, scope_json, description, example, when_to_use, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );

          const sourceArticlesSummary = prepared.map((p) => ({
            title: p.title,
            category: p.category,
            source: p.source,
            url: p.url,
            chars: p.content.length,
          }));

          const strategies = Array.isArray(
            (fingerprint as { strategies?: unknown[] }).strategies,
          )
            ? ((fingerprint as { strategies: unknown[] }).strategies as Record<string, unknown>[])
            : [];

          const tx = db.transaction(() => {
            insertAuthor.run(
              authorId,
              authorName,
              platform,
              pickAvatarChar(authorName),
              now,
              now,
            );
            insertFingerprint.run(
              fingerprintId,
              authorId,
              JSON.stringify(sourceArticlesSummary),
              JSON.stringify(fingerprint),
              stage2Raw,
              'claude-code-cli-v2',
              now,
              prepared.length,
            );
            // 写 crawled_articles（仅 URL 来源）
            for (const p of prepared) {
              if (p.source === 'url' && p.url && p.url_hash) {
                insertCrawled.run(
                  nanoid(14),
                  authorId,
                  p.url,
                  p.url_hash,
                  p.title || null,
                  p.content,
                  p.category,
                  JSON.stringify([]),
                  'crawl',
                  fingerprintId,
                  now,
                );
              }
            }
            // 写 strategies
            for (const s of strategies) {
              insertStrategy.run(
                nanoid(14),
                fingerprintId,
                (s.tag as string) || null,
                JSON.stringify(s.scope ?? []),
                (s.description as string) || null,
                (s.example as string) || null,
                (s.when_to_use as string) || null,
                now,
              );
            }
          });
          tx();

          send('done', {
            fingerprint_id: fingerprintId,
            author_id: authorId,
            strategy_count: strategies.length,
            article_count: prepared.length,
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
