import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude';
import { buildTopicRecommendPrompt } from '@/lib/prompts/topic-recommend';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FingerprintRow {
  id: string;
  fingerprint_json: string;
  author_name: string;
  platform: string | null;
}
interface ArticleTitleRow {
  title: string | null;
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

/**
 * GET /api/topics/recommend → SSE
 * 流：open → chunk * N → done { topics: [...] } | error
 */
export async function GET(req: NextRequest) {
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
        } catch {/* ignore */}
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {/* ignore */}
      };

      try {
        send('open', { ok: true });
        const db = getDb();

        const fpRows = db
          .prepare(
            `SELECT f.id, f.fingerprint_json,
                    a.name AS author_name, a.platform
             FROM fingerprints f JOIN authors a ON a.id = f.author_id
             ORDER BY COALESCE(a.last_used_at, f.created_at) DESC
             LIMIT 12`,
          )
          .all() as FingerprintRow[];

        if (fpRows.length === 0) {
          send('done', {
            topics: [],
            empty_reason: '指纹库还是空的，先去 /fingerprints/new 拆一个博主就有了',
          });
          closeStream();
          return;
        }

        const fingerprints = fpRows.map((r) => {
          let fp: Record<string, unknown> = {};
          try { fp = JSON.parse(r.fingerprint_json); } catch {/* ignore */}
          return {
            fingerprint_id: r.id,
            author_name: r.author_name,
            platform: r.platform,
            fingerprint_summary:
              (fp.fingerprint_summary as string) ||
              (fp.author_summary as string) ||
              '（无摘要）',
            strengths: Array.isArray(fp.strengths)
              ? (fp.strengths as string[])
              : [],
            topic_preference:
              (fp.topic as { topic_preference?: string })?.topic_preference,
          };
        });

        const recentRows = db
          .prepare(
            `SELECT title FROM articles
             WHERE title IS NOT NULL AND length(trim(title)) > 0
             ORDER BY created_at DESC LIMIT 12`,
          )
          .all() as ArticleTitleRow[];
        const recentTitles = recentRows
          .map((r) => (r.title || '').trim())
          .filter(Boolean);

        const prompt = buildTopicRecommendPrompt({ fingerprints, recentTitles });

        let raw = '';
        try {
          raw = await streamClaude(prompt, {
            signal: abortCtrl.signal,
            onChunk: (text) => send('chunk', { text }),
          });
        } catch (err) {
          send('error', { message: (err as Error).message || '模型没回来', phase: 'claude' });
          closeStream();
          return;
        }

        const cleaned = stripJsonFence(raw);
        try {
          const parsed = JSON.parse(cleaned) as { topics?: unknown[] };
          send('done', { topics: parsed.topics ?? [] });
        } catch (parseErr) {
          send('error', {
            message: '模型输出不是合法 JSON',
            phase: 'parse',
            detail: (parseErr as Error).message,
            sample: cleaned.slice(0, 280),
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
