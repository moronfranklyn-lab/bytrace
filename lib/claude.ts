import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';

const FALLBACK_CLAUDE_PATH = '/Users/nan/.npm-global/bin/claude';
const DEFAULT_TIMEOUT_MS = 180_000;

export interface StreamClaudeOptions {
  /** Called with every text delta as it streams in. */
  onChunk?: (text: string) => void;
  /** External abort signal. Kills the spawned process with SIGTERM. */
  signal?: AbortSignal;
  /** Hard timeout in milliseconds. Defaults to 180_000 (3 minutes). */
  timeoutMs?: number;
  /** Override the claude binary path (mostly for testing). */
  claudeBin?: string;
}

/**
 * Spawn the local Claude Code CLI with stream-json + partial-messages, feed the
 * prompt as a single user message, and stream text deltas back as plain text.
 *
 * Why stream-json instead of plain `claude -p`:
 *   - `claude -p` buffers the entire response and emits it at the end → UI
 *     shows "已 0 字" for 60-180 seconds. Bad UX, looks broken.
 *   - `--output-format stream-json --input-format stream-json --include-partial-messages`
 *     emits one JSON line per event; the relevant ones carry text_delta payloads.
 *     First token shows up in ~3-6 seconds.
 *
 * The contract for callers stays the same: onChunk receives plain text strings,
 * and the resolved string is the full concatenated assistant text.
 *
 * Input shape (per CLI docs):
 *   {"type": "user", "message": {"role": "user", "content": [{"type":"text","text": "..."}]}}\n
 *
 * Output lines we care about:
 *   {"type":"stream_event","event":{"type":"content_block_delta",
 *      "delta":{"type":"text_delta","text":"..."}}}
 *
 * Everything else (system / rate_limit_event / assistant / result / message_stop)
 * is metadata — ignore.
 */
export function streamClaude(
  prompt: string,
  options: StreamClaudeOptions = {},
): Promise<string> {
  const {
    onChunk,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    claudeBin,
  } = options;

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('streamClaude aborted before start'));
      return;
    }

    let proc: ChildProcessWithoutNullStreams;
    let usedFallback = false;

    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--verbose', // required by CLI when output-format is stream-json
    ];

    const trySpawn = (cmd: string): ChildProcessWithoutNullStreams => {
      return spawn(cmd, cliArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env, // subscription token discovery lives in env
      });
    };

    const primaryCmd = claudeBin ?? 'claude';
    try {
      proc = trySpawn(primaryCmd);
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn '${primaryCmd}': ${(err as Error).message}`,
        ),
      );
      return;
    }

    let assembledText = '';   // accumulated assistant text (return value)
    let lineBuf = '';         // partial JSON line buffer
    let stderrBuf = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const settleResolve = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
      } catch {/* ignore */}
      settleReject(new Error('streamClaude aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {/* ignore */}
      settleReject(
        new Error(
          `streamClaude timed out after ${timeoutMs}ms. stderr=${stderrBuf.slice(-500)}`,
        ),
      );
    }, timeoutMs);

    const processLine = (line: string) => {
      if (!line) return;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        // 非 JSON 行（极少；CLI 偶尔会有警告打 stdout）—— 跳过
        return;
      }
      if (!obj || typeof obj !== 'object') return;
      const o = obj as { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } } };
      if (o.type !== 'stream_event' || !o.event) return;
      // 关注 content_block_delta -> text_delta
      if (o.event.type === 'content_block_delta' && o.event.delta?.type === 'text_delta') {
        const text = o.event.delta.text ?? '';
        if (!text) return;
        assembledText += text;
        try {
          onChunk?.(text);
        } catch {
          // 调用方回调异常不影响流
        }
      }
    };

    const attachHandlers = (p: ChildProcessWithoutNullStreams) => {
      p.stdout.setEncoding('utf8');
      p.stderr.setEncoding('utf8');

      p.stdout.on('data', (chunk: string) => {
        lineBuf += chunk;
        const parts = lineBuf.split('\n');
        lineBuf = parts.pop() ?? '';
        for (const line of parts) {
          processLine(line.trim());
        }
      });

      p.stderr.on('data', (chunk: string) => {
        // 防止极端情况下 stderr 无限增长
        if (stderrBuf.length < 8000) {
          stderrBuf += chunk;
        }
      });

      p.on('error', (err: NodeJS.ErrnoException) => {
        // ENOENT -> claude not in PATH, try the known fallback once.
        if (
          err.code === 'ENOENT' &&
          !usedFallback &&
          !claudeBin &&
          existsSync(FALLBACK_CLAUDE_PATH)
        ) {
          usedFallback = true;
          try {
            proc = trySpawn(FALLBACK_CLAUDE_PATH);
            attachHandlers(proc);
            writePromptAsJsonLine(proc);
            return;
          } catch (fallbackErr) {
            settleReject(
              new Error(
                `claude not found in PATH and fallback ${FALLBACK_CLAUDE_PATH} also failed: ${(fallbackErr as Error).message}`,
              ),
            );
            return;
          }
        }
        settleReject(
          new Error(
            `claude process error: ${err.message}${stderrBuf ? ` | stderr=${stderrBuf.slice(-500)}` : ''}`,
          ),
        );
      });

      p.on('close', (code: number | null, sigtype: NodeJS.Signals | null) => {
        // flush 末尾未换行的行
        if (lineBuf.trim()) {
          processLine(lineBuf.trim());
          lineBuf = '';
        }
        if (code === 0) {
          settleResolve(assembledText);
          return;
        }
        const stderrTail = stderrBuf ? ` | stderr=${stderrBuf.slice(-1000)}` : '';
        settleReject(
          new Error(
            `claude exited with code=${code} signal=${sigtype ?? 'none'}${stderrTail}`,
          ),
        );
      });
    };

    const writePromptAsJsonLine = (p: ChildProcessWithoutNullStreams) => {
      const msg = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      };
      try {
        p.stdin.write(JSON.stringify(msg) + '\n', 'utf8');
        p.stdin.end();
      } catch (err) {
        settleReject(
          new Error(`Failed writing prompt to stdin: ${(err as Error).message}`),
        );
      }
    };

    attachHandlers(proc);
    writePromptAsJsonLine(proc);
  });
}
