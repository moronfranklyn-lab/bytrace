import { NextRequest } from 'next/server';
import { createSseStream } from '@/lib/sse';
import { runResearchLoop } from '@/lib/research';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Payload {
  topic?: string;
  source_hint?: string;
}

const MIN_TOPIC_CHARS = 8;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: NextRequest) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const topic = (body.topic ?? '').trim();
  if (topic.length < MIN_TOPIC_CHARS) {
    return jsonError(`选题至少 ${MIN_TOPIC_CHARS} 字`);
  }
  const sourceHint = (body.source_hint ?? '').trim() || undefined;

  // 提前 touch 一下 DB（getDb 启动时会幂等建 research_reports / research_runs 表）
  try {
    getDb();
  } catch (err) {
    return jsonError(`数据库初始化失败：${(err as Error).message}`, 500);
  }

  return createSseStream(async (send, _close, abortSignal) => {
    send('open', { topic });
    try {
      await runResearchLoop({ topic, prefs: { sourceHint }, signal: abortSignal, send });
    } catch (err) {
      // runResearchLoop 内部已对各阶段 send 过具体 error，这里只兜底
      send('error', { phase: 'loop', message: (err as Error).message || '调研中断' });
    }
  }, req.signal);
}
