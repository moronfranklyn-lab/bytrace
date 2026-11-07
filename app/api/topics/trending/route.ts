import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude';
import { buildTopicTrendingPrompt, type TrendingKeyword } from '@/lib/prompts/topic-trending';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CrawledRow {
  title: string | null;
  content: string;
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
 * 简易中文 + 英文 token 频率统计。
 * - 英文单词按空格 / 标点切分
 * - 中文按 2 字 / 3 字滑窗（粗糙，但够用，毕竟我们之后让 Claude 合并语义相近词）
 */
const STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '你', '他', '她', '它', '我们', '你们', '他们',
  '这', '那', '就是', '可以', '没有', '一个', '一些', '还是', '但是', '因为',
  'the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'to', 'is', 'are', 'be', 'for',
  'with', 'by', 'as', 'at', 'this', 'that', 'it', 'you', 'we', 'they',
]);

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 英文 / 数字
  const enTokens = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];
  for (const t of enTokens) {
    const low = t.toLowerCase();
    if (!STOPWORDS.has(low)) tokens.push(low);
  }
  // 中文 2-3 字滑窗
  const cnRegions = text.match(/[一-鿿]+/g) ?? [];
  for (const region of cnRegions) {
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i + len <= region.length; i++) {
        const w = region.slice(i, i + len);
        if (!STOPWORDS.has(w)) tokens.push(w);
      }
    }
  }
  return tokens;
}

interface TitleScore {
  title: string;
  tokens: Set<string>;
}

function computeTopKeywords(rows: CrawledRow[], topN = 20): TrendingKeyword[] {
  if (rows.length === 0) return [];

  const docTokens: TitleScore[] = rows.map((r) => {
    const title = r.title || '';
    // 标题权重 ×3
    const text = title + ' ' + title + ' ' + title + ' ' + (r.content?.slice(0, 800) || '');
    const tokens = tokenize(text);
    return { title, tokens: new Set(tokens) };
  });

  const tf = new Map<string, number>();
  for (const r of rows) {
    const text = (r.title || '') + ' ' + (r.content?.slice(0, 800) || '');
    for (const t of tokenize(text)) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
  }

  const df = new Map<string, number>();
  for (const doc of docTokens) {
    for (const t of doc.tokens) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const N = docTokens.length;
  const scored: { word: string; score: number; count: number }[] = [];
  for (const [word, count] of tf.entries()) {
    if (count < 2) continue;
    const docFreq = df.get(word) ?? 1;
    const idf = Math.log((1 + N) / (1 + docFreq)) + 1;
    const score = count * idf;
    scored.push({ word, score, count });
  }
  scored.sort((a, b) => b.score - a.score);

  // 去掉被更长词包含的短词（粗糙合并），保留更长那个
  const filtered: typeof scored = [];
  const longer = scored.map((s) => s.word);
  for (const s of scored) {
    const longerContains = longer.some(
      (x) => x !== s.word && x.includes(s.word) && x.length > s.word.length,
    );
    if (longerContains) continue;
    filtered.push(s);
    if (filtered.length >= topN) break;
  }

  return filtered.map((s) => {
    const sampleTitles = docTokens
      .filter((d) => d.tokens.has(s.word))
      .map((d) => d.title)
      .filter(Boolean)
      .slice(0, 3);
    return { keyword: s.word, count: s.count, sample_titles: sampleTitles };
  });
}

/**
 * GET /api/topics/trending → SSE
 * 流程：本地统计高频关键词 → Claude 起趋势题 → done。
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
        try { controller.enqueue(encoder.encode(payload)); } catch {/* ignore */}
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {/* ignore */}
      };

      try {
        send('open', { ok: true });
        const db = getDb();

        let rows: CrawledRow[] = [];
        try {
          rows = db
            .prepare(
              `SELECT title, content FROM crawled_articles
               ORDER BY crawled_at DESC LIMIT 80`,
            )
            .all() as CrawledRow[];
        } catch {/* 表可能不存在 */}

        if (rows.length === 0) {
          send('done', {
            topics: [],
            empty_reason: '还没有爬过任何文章，先去 /fingerprints/new 用 URL 模式拆几个博主，热点池就有数据了',
          });
          closeStream();
          return;
        }

        const keywords = computeTopKeywords(rows, 20);
        send('phase', { phase: 'tfidf', keyword_count: keywords.length });

        if (keywords.length < 3) {
          send('done', {
            topics: [],
            empty_reason: '样本太少，关键词聚不出趋势。再多拆几个博主再来。',
          });
          closeStream();
          return;
        }

        const prompt = buildTopicTrendingPrompt(keywords);
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
          send('done', {
            topics: parsed.topics ?? [],
            keywords: keywords.slice(0, 10),
          });
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
