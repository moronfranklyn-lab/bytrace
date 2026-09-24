/**
 * SSE 工具：给 compose / recommend / refine 几个 route 用统一格式。
 * 与 /api/fingerprint 完全一致：event: chunk | done | error | open
 */

export type SseSend = (event: string, data: unknown) => void;

export function createSseStream(
  onStart: (send: SseSend, close: () => void, abortSignal: AbortSignal) => Promise<void> | void,
  reqSignal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const abortCtrl = new AbortController();
  if (reqSignal) {
    if (reqSignal.aborted) abortCtrl.abort();
    else reqSignal.addEventListener('abort', () => abortCtrl.abort(), { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastActivity = Date.now();

      const send: SseSend = (event, data) => {
        if (closed) return;
        lastActivity = Date.now();
        const payload =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // ignore enqueue-after-close
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {/* ignore */}
      };

      // 心跳机制：每 10 秒发送一次 ping，防止长时间无数据导致连接超时
      const heartbeatInterval = setInterval(() => {
        if (closed) {
          clearInterval(heartbeatInterval);
          return;
        }
        // 只在 15 秒内没有其他数据时才发送心跳
        if (Date.now() - lastActivity > 15_000) {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            clearInterval(heartbeatInterval);
          }
        }
      }, 10_000);

      try {
        await onStart(send, close, abortCtrl.signal);
      } catch (err) {
        send('error', {
          message: (err as Error).message || '未知错误',
          phase: 'unknown',
        });
      } finally {
        clearInterval(heartbeatInterval);
        close();
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

/** 从 Claude 完整输出里剥掉 ```json ... ``` 围栏 */
export function stripJsonFence(raw: string): string {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  // 退一步：抓首个完整 JSON 主体
  const firstBrace = raw.search(/[\[{]/);
  const lastBrace = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return raw.trim();
}

/**
 * 去掉模型偶尔会包裹的 ```markdown ... ```。
 * 必须同时锚定 ^ 和 $：只剥"整段输出被单个围栏完整包裹"的情况。
 * 老版本只锚定 $，正文若以 fenced code block 结尾（技术文/调研报告常见），
 * 会从文中第一个 ``` 匹配起，把代码块之前的全部正文截掉。
 */
export function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}
