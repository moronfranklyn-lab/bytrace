import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { streamClaude } from '@/lib/claude';
import { buildFingerprintPrompt } from '@/lib/prompts/fingerprint';
import { getDb } from '@/lib/db';

// 必须 nodejs runtime —— better-sqlite3 + child_process.spawn 都依赖 Node API
export const runtime = 'nodejs';
// 禁缓存：SSE 响应不能被任何中间层缓存
export const dynamic = 'force-dynamic';

interface IncomingArticle {
  title?: string;
  content?: string;
}
interface IncomingPayload {
  author_name?: string;
  platform?: string;
  articles?: IncomingArticle[];
}

const MIN_ARTICLES = 3;
const MAX_ARTICLES = 10;
const MIN_CONTENT_CHARS = 100;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * 从 Claude 完整输出里剥掉 ```json ... ``` 围栏。
 * 容错：没有围栏时直接尝试解析整段。
 */
function stripJsonFence(raw: string): string {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  // 退一步：找第一段 { ... } 直到最后一个 }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return raw.trim();
}

/**
 * 取一个汉字作为头像字符（avatar_emoji 字段名是历史遗留，实际存的是单个汉字）
 */
function pickAvatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'A';
  // 优先取第一个中文字符
  const cjk = trimmed.match(/[一-鿿]/);
  if (cjk) return cjk[0];
  return trimmed.slice(0, 1).toUpperCase();
}

export async function POST(req: NextRequest) {
  // ---- 1. 解析 + 校验入参 ----
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
  const cleaned: { title?: string; content: string }[] = [];
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i] ?? {};
    const content = (a.content ?? '').trim();
    if (content.length < MIN_CONTENT_CHARS) {
      return jsonError(
        `第 ${i + 1} 篇文章内容太短了（不足 ${MIN_CONTENT_CHARS} 字），再多粘一点`,
      );
    }
    cleaned.push({
      title: a.title?.trim() || undefined,
      content,
    });
  }

  // ---- 2. 构造 SSE 流 ----
  const encoder = new TextEncoder();
  const abortCtrl = new AbortController();

  // 客户端断开 -> 同步把 Claude 子进程杀掉
  req.signal.addEventListener('abort', () => {
    abortCtrl.abort();
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const payload =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // 控制器可能已关闭，吞掉
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
        const prompt = buildFingerprintPrompt(cleaned);

        // 立刻发一个心跳，确认通道是通的（前端能更早进入流式态）
        send('open', { ok: true });

        let raw = '';
        try {
          // streamClaude 内部会累加 stdout 并最终 resolve 为完整字符串；
          // onChunk 仅用于把增量片段转发给前端实时显示。
          raw = await streamClaude(prompt, {
            signal: abortCtrl.signal,
            onChunk: (text: string) => {
              send('chunk', { text });
            },
          });
        } catch (err) {
          const msg = (err as Error).message || '模型那边没回来';
          send('error', {
            message: msg,
            phase: 'claude',
          });
          closeStream();
          return;
        }

        // ---- 3. 解析 JSON ----
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

        // ---- 4. 落库 ----
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
              (id, author_id, source_articles_json, fingerprint_json, raw_response, model_version, created_at, hit_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          );

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
              JSON.stringify(cleaned),
              JSON.stringify(fingerprint),
              raw,
              'claude-code-cli',
              now,
            );
          });
          tx();

          send('done', {
            fingerprint_id: fingerprintId,
            author_id: authorId,
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
      // Disable nginx-style buffering if behind a proxy
      'X-Accel-Buffering': 'no',
    },
  });
}
