import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';

const FALLBACK_CLAUDE_PATH = '/Users/nan/.npm-global/bin/claude';
const DEFAULT_TIMEOUT_MS = 180_000;

export interface StreamClaudeOptions {
  /** Called with every stdout text chunk as it streams in. */
  onChunk?: (text: string) => void;
  /** External abort signal. Kills the spawned process with SIGTERM. */
  signal?: AbortSignal;
  /** Hard timeout in milliseconds. Defaults to 180_000 (3 minutes). */
  timeoutMs?: number;
  /** Override the claude binary path (mostly for testing). */
  claudeBin?: string;
}

/**
 * Spawn the local Claude Code CLI with `claude -p`, feed the prompt over stdin,
 * and stream stdout back. Uses subscription auth (the CLI handles tokens), so
 * the parent env MUST be inherited verbatim.
 *
 * Why stdin instead of argv: long Chinese prompts blow past argv length limits
 * and get mangled by shell escaping. stdin is binary-clean.
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

    const trySpawn = (cmd: string): ChildProcessWithoutNullStreams => {
      return spawn(cmd, ['-p'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env, // subscription token discovery lives in env
      });
    };

    const primaryCmd = claudeBin ?? 'claude';
    try {
      proc = trySpawn(primaryCmd);
    } catch (err) {
      // synchronous spawn errors are rare; bail early
      reject(
        new Error(
          `Failed to spawn '${primaryCmd}': ${(err as Error).message}`,
        ),
      );
      return;
    }

    let stdoutBuf = '';
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
      } catch {
        // ignore
      }
      settleReject(new Error('streamClaude aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      settleReject(
        new Error(
          `streamClaude timed out after ${timeoutMs}ms. stderr=${stderrBuf.slice(-500)}`,
        ),
      );
    }, timeoutMs);

    const attachHandlers = (p: ChildProcessWithoutNullStreams) => {
      p.stdout.setEncoding('utf8');
      p.stderr.setEncoding('utf8');

      p.stdout.on('data', (chunk: string) => {
        stdoutBuf += chunk;
        try {
          onChunk?.(chunk);
        } catch {
          // user callback failure must not crash the stream
        }
      });

      p.stderr.on('data', (chunk: string) => {
        stderrBuf += chunk;
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
            // re-pipe prompt
            proc.stdin.write(prompt, 'utf8');
            proc.stdin.end();
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
        if (code === 0) {
          settleResolve(stdoutBuf);
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

    attachHandlers(proc);

    // Write prompt to stdin. utf8 explicit — defensive against locale weirdness.
    try {
      proc.stdin.write(prompt, 'utf8');
      proc.stdin.end();
    } catch (err) {
      settleReject(
        new Error(`Failed writing prompt to stdin: ${(err as Error).message}`),
      );
    }
  });
}
