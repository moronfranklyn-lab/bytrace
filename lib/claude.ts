import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_API_KEY_KEYS,
  AGENT_ARTICLE_MODEL_KEYS,
  AGENT_BASE_URL_KEYS,
  AGENT_MODEL_KEYS,
  AGENT_PROVIDER_KEYS,
  CODEX_ARTICLE_MODEL_KEYS,
  CODEX_BIN_KEYS,
  CODEX_CWD_KEYS,
  CODEX_MODEL_KEYS,
  CLAUDE_BIN_KEYS,
  envStr,
  firstNonEmpty,
} from '@/lib/env';

/**
 * 本机 Claude CLI 的兜底搜索路径。
 *
 * 历史问题：这里曾经**硬编码** `/Users/mixingtumima0000/...`，换电脑必挂。
 * 现在改为按「用户无关」的方式推导：
 *   1. BYTRACE_CLAUDE_BIN / CLAUDE_BIN 显式指定（最高优先）
 *   2. `claude`（交给 PATH 解析）
 *   3. $HOME 下的常见安装位置（~/.local/bin、~/.npm-global/bin、~/.bun/bin、/opt/homebrew/bin）
 *
 * 注意：路径不存在不会立刻报错——spawn 会抛 ENOENT，届时按候选顺序回退。
 */
export const CLAUDE_BIN_CANDIDATES: string[] = (() => {
  const explicit = envStr(...CLAUDE_BIN_KEYS);
  const home = homedir();
  return [
    ...(explicit ? [explicit] : []),
    'claude',
    join(home, '.local', 'bin', 'claude'),
    join(home, '.npm-global', 'bin', 'claude'),
    join(home, '.bun', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
})();

/** 第一个真实存在于磁盘上的候选；都不存在时返回 'claude'（让 PATH 再试一次）。 */
export const CLAUDE_BIN: string =
  CLAUDE_BIN_CANDIDATES.find((p) => p === 'claude' || existsSync(p)) ??
  firstNonEmpty(envStr(...CLAUDE_BIN_KEYS)) ??
  'claude';

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * 文章产出（正文 draft / 润色 refine）默认给 claude-cli 传 sonnet。
 * API provider 会把这个别名映射到 BYTRACE_AGENT_ARTICLE_MODEL / AUTOARTICLE_LLM_ARTICLE_MODEL / AUTOARTICLE_LLM_MODEL。
 */
export const ARTICLE_MODEL = 'sonnet';

type LlmProvider = 'claude-cli' | 'codex-cli' | 'openai-compatible' | 'openai-responses';

export interface StreamClaudeOptions {
  /** Called with every text delta as it streams in. */
  onChunk?: (text: string) => void;
  /** External abort signal. Kills the spawned process with SIGTERM. */
  signal?: AbortSignal;
  /** Hard timeout in milliseconds. Defaults to 180_000 (3 minutes). */
  timeoutMs?: number;
  /** Override the claude binary path (mostly for testing). */
  claudeBin?: string;
  /**
   * 指定调用的模型：别名（如 'sonnet'）或完整名（如 'claude-sonnet-4-6'）。
   * 不传 → 走本机 CLI 订阅默认模型（当前 Opus 4.8）。
   * 文章产出传 ARTICLE_MODEL 降 AI 味；分析类（outline / critic）不传。
   */
  model?: string;
}

interface ApiStreamConfig {
  provider: Exclude<LlmProvider, 'claude-cli'>;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function normalizeProvider(raw = envStr(...AGENT_PROVIDER_KEYS)): LlmProvider {
  const provider = (raw || 'claude-cli').trim().toLowerCase();
  if (!provider || provider === 'claude' || provider === 'claude-cli') return 'claude-cli';
  if (provider === 'codex' || provider === 'codex-cli') return 'codex-cli';
  if (
    provider === 'api' ||
    provider === 'local-api' ||
    provider === 'local-openai' ||
    provider === 'openai-compatible' ||
    provider === 'lmstudio' ||
    provider === 'lm-studio' ||
    provider === 'ollama' ||
    provider === 'mimo' ||
    provider === 'doubao' ||
    provider === 'ark'
  ) {
    return 'openai-compatible';
  }
  if (
    provider === 'openai' ||
    provider === 'responses' ||
    provider === 'openai-responses' ||
    provider === 'responses-api'
  ) {
    return 'openai-responses';
  }
  throw new Error(
    `模型 provider "${raw}" 不支持。可用值：claude-cli / codex-cli / openai-compatible / openai-responses（也接受简写 mimo / doubao / ark）`,
  );
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveApiConfig(provider: Exclude<LlmProvider, 'claude-cli'>, requestedModel?: string): ApiStreamConfig {
  const isResponses = provider === 'openai-responses';
  const baseUrl = trimTrailingSlash(
    firstNonEmpty(
      envStr(...AGENT_BASE_URL_KEYS),
      isResponses ? 'https://api.openai.com/v1' : 'http://127.0.0.1:1234/v1',
    )!,
  );
  const apiKey = envStr(...AGENT_API_KEY_KEYS) ?? '';
  const modelFromRequest =
    requestedModel && requestedModel !== ARTICLE_MODEL ? requestedModel : '';
  const model =
    modelFromRequest ||
    (requestedModel === ARTICLE_MODEL ? envStr(...AGENT_ARTICLE_MODEL_KEYS) ?? '' : '') ||
    envStr(...AGENT_MODEL_KEYS) ||
    '';

  if (!model) {
    throw new Error(
      'API 模型未配置：请在 .env.local 设置 BYTRACE_AGENT_MODEL（正文可另设 BYTRACE_AGENT_ARTICLE_MODEL）。旧名 AUTOARTICLE_LLM_MODEL / OPENAI_MODEL 仍然兼容',
    );
  }
  if (isResponses && !apiKey) {
    throw new Error(
      'OpenAI Responses API 需要 API key：请在 .env.local 设置 BYTRACE_AGENT_API_KEY（旧名 AUTOARTICLE_LLM_API_KEY / OPENAI_API_KEY 仍兼容）',
    );
  }
  return { provider, baseUrl, apiKey, model };
}

function buildHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 1000);
  } catch {
    return '';
  }
}

function makeTimeoutSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
    didTimeout: () => timedOut,
  };
}

async function readSseTextStream(
  response: Response,
  provider: Exclude<LlmProvider, 'claude-cli'>,
  onChunk?: (text: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new Error('本机 API 没有返回可读取的流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let assembledText = '';
  let apiError: string | null = null;

  const emit = (text: string) => {
    if (!text) return;
    assembledText += text;
    try {
      onChunk?.(text);
    } catch {
      // 调用方回调异常不影响模型流。
    }
  };

  const handlePayload = (payload: string) => {
    if (!payload || payload === '[DONE]') return;
    let obj: unknown;
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    const o = obj as {
      error?: { message?: string } | string;
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
      type?: string;
      delta?: string;
      output_text?: string;
      response?: { output_text?: string };
    };

    if (o.error) {
      apiError = typeof o.error === 'string' ? o.error : o.error.message || 'API stream error';
      return;
    }

    if (provider === 'openai-compatible') {
      const choice = o.choices?.[0];
      emit(choice?.delta?.content ?? choice?.message?.content ?? '');
      return;
    }

    // OpenAI Responses API streaming events.
    if (o.type === 'response.output_text.delta') {
      emit(o.delta ?? '');
      return;
    }
    if (o.type === 'response.completed') {
      emit(o.response?.output_text ?? '');
      return;
    }
    if (o.output_text) emit(o.output_text);
  };

  const processBuffer = (flush = false) => {
    const lines = buf.split(/\r?\n/);
    buf = flush ? '' : lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
      if (line.startsWith('data:')) {
        handlePayload(line.slice(5).trim());
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    processBuffer(false);
  }
  buf += decoder.decode();
  processBuffer(true);

  if (apiError) throw new Error(`API 返回错误：${apiError}`);
  if (!assembledText) throw new Error('API 已结束但没有返回文本');
  return assembledText;
}

async function streamOpenAiApi(
  prompt: string,
  options: StreamClaudeOptions,
  provider: Exclude<LlmProvider, 'claude-cli'>,
): Promise<string> {
  const { onChunk, signal, timeoutMs = DEFAULT_TIMEOUT_MS, model: requestedModel } = options;
  const config = resolveApiConfig(provider, requestedModel);
  const timeout = makeTimeoutSignal(signal, timeoutMs);

  const endpoint =
    provider === 'openai-responses'
      ? `${config.baseUrl}/responses`
      : `${config.baseUrl}/chat/completions`;
  const body =
    provider === 'openai-responses'
      ? {
          model: config.model,
          input: prompt,
          stream: true,
        }
      : {
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(config.apiKey),
      body: JSON.stringify(body),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw new Error(
        `API 请求失败：${response.status} ${response.statusText}${detail ? ` | ${detail}` : ''}`,
      );
    }

    return await readSseTextStream(response, provider, onChunk);
  } catch (err) {
    if (timeout.didTimeout()) {
      throw new Error(`API timed out after ${timeoutMs}ms`);
    }
    if (signal?.aborted) {
      throw new Error('streamClaude aborted');
    }
    throw err;
  } finally {
    timeout.cleanup();
  }
}

function resolveCodexModel(requestedModel?: string): string | null {
  const modelFromRequest =
    requestedModel && requestedModel !== ARTICLE_MODEL ? requestedModel : '';
  return (
    modelFromRequest ||
    (requestedModel === ARTICLE_MODEL
      ? envStr(...AGENT_ARTICLE_MODEL_KEYS) ?? envStr(...CODEX_ARTICLE_MODEL_KEYS) ?? ''
      : '') ||
    envStr(...AGENT_MODEL_KEYS) ||
    envStr(...CODEX_MODEL_KEYS) ||
    null
  );
}

function normalizeCodexOutput(text: string): string {
  return text
    .replace(/^\s*Ethan[，,:：]\s*/i, '')
    .replace(/^\s*Ethan\s+/i, '')
    .trim();
}

function streamCodexCli(
  prompt: string,
  options: StreamClaudeOptions = {},
): Promise<string> {
  const { onChunk, signal, timeoutMs = DEFAULT_TIMEOUT_MS, model: requestedModel } = options;

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('streamClaude aborted before start'));
      return;
    }

    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--json',
      '--sandbox',
      'read-only',
      '-C',
      envStr(...CODEX_CWD_KEYS) || '/tmp',
    ];
    const model = resolveCodexModel(requestedModel);
    if (model) args.push('--model', model);
    args.push('-');

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(envStr(...CODEX_BIN_KEYS) || 'codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (err) {
      reject(new Error(`Failed to spawn codex: ${(err as Error).message}`));
      return;
    }

    let assembledText = '';
    let finalText = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const killProc = () => {
      try { proc.kill('SIGTERM'); } catch {/* ignore */}
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {/* ignore */}
      }, 5_000);
      killTimer.unref();
      proc.once('close', () => clearTimeout(killTimer));
    };

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) signal.removeEventListener('abort', onAbort);
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

    const emitFinal = (text: string) => {
      const normalized = normalizeCodexOutput(text);
      if (!normalized || normalized === assembledText) return;
      assembledText = normalized;
      try {
        onChunk?.(normalized);
      } catch {
        // 调用方回调异常不影响模型结果。
      }
    };

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (!obj || typeof obj !== 'object') return;
      const o = obj as {
        type?: string;
        item?: { type?: string; text?: string };
        message?: string;
        error?: string | { message?: string };
      };

      if (o.type === 'error' || o.type === 'turn.failed') {
        const message =
          typeof o.error === 'string'
            ? o.error
            : o.error?.message || o.message || 'codex exec failed';
        settleReject(new Error(`codex 返回错误：${message}`));
        return;
      }

      if (o.type === 'item.completed' && o.item?.type === 'agent_message' && o.item.text) {
        finalText = normalizeCodexOutput(o.item.text);
        emitFinal(finalText);
      }
    };

    const onAbort = () => {
      killProc();
      settleReject(new Error('streamClaude aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      killProc();
      settleReject(
        new Error(`codex timed out after ${timeoutMs}ms. stderr=${stderrBuf.slice(-500)}`),
      );
    }, timeoutMs);

    proc.stdin.on('error', () => {/* surfaced by process close/error */});
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });
    proc.stderr.on('data', (chunk: string) => {
      if (stderrBuf.length < 8000) stderrBuf += chunk;
    });
    proc.on('error', (err) => {
      settleReject(new Error(`codex process error: ${err.message}`));
    });
    proc.on('close', (code, sigtype) => {
      if (stdoutBuf.trim()) {
        processLine(stdoutBuf);
        stdoutBuf = '';
      }
      if (code === 0) {
        const text = finalText || assembledText;
        if (!text) {
          settleReject(
            new Error(`codex exited 0 but produced no text. stderr=${stderrBuf.slice(-500)}`),
          );
          return;
        }
        settleResolve(text);
        return;
      }
      settleReject(
        new Error(
          `codex exited with code=${code} signal=${sigtype ?? 'none'}${
            stderrBuf ? ` | stderr=${stderrBuf.slice(-1000)}` : ''
          }`,
        ),
      );
    });

    const guardedPrompt = [
      '你是 AutoArticle 的纯文本写作/分析模型。只完成用户给出的写作、改写、JSON 生成或评分任务。',
      '这是应用内部模型调用，不是直接回复用户；不要称呼 Ethan，不要寒暄，不要输出与任务无关的解释。',
      '不要调用工具，不要读取或修改本机文件，不要执行命令。',
      '如果任务要求 JSON，只输出可被 JSON.parse 解析的 JSON，不要 Markdown 围栏。',
      '',
      prompt,
    ].join('\n');
    proc.stdin.write(guardedPrompt, 'utf8');
    proc.stdin.end();
  });
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
  const provider = normalizeProvider();
  if (provider === 'codex-cli') {
    return streamCodexCli(prompt, options);
  }
  if (provider !== 'claude-cli') {
    return streamOpenAiApi(prompt, options, provider);
  }
  return streamClaudeCli(prompt, options);
}

function streamClaudeCli(
  prompt: string,
  options: StreamClaudeOptions = {},
): Promise<string> {
  const {
    onChunk,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    claudeBin,
    model,
  } = options;

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('streamClaude aborted before start'));
      return;
    }

    let proc: ChildProcessWithoutNullStreams;
    /**
     * 已尝试过的 CLI 命令。原来是「primary + 1 个硬编码 fallback」，
     * 现在改成遍历 CLAUDE_BIN_CANDIDATES（含 $HOME 推导的路径），
     * 这样换电脑/换安装方式都能自动找到，不需要改代码。
     */
    const triedCmds = new Set<string>();
    /** 下一个尚未尝试的候选；没有则返回 null。 */
    const nextCandidate = (): string | null => {
      for (const c of [claudeBin, ...CLAUDE_BIN_CANDIDATES]) {
        if (c && !triedCmds.has(c)) return c;
      }
      return null;
    };

    const cliArgs = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--verbose', // required by CLI when output-format is stream-json
    ];
    // 指定模型时插 --model（文章产出走 Sonnet 4.6 降 AI 味；不传则用 CLI 订阅默认 = Opus 4.8）
    if (model) {
      cliArgs.push('--model', model);
    }

    const trySpawn = (cmd: string): ChildProcessWithoutNullStreams => {
      return spawn(cmd, cliArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env, // subscription token discovery lives in env
      });
    };

    const primaryCmd = claudeBin ?? CLAUDE_BIN_CANDIDATES.find((c) => c === 'claude' || existsSync(c)) ?? 'claude';
    triedCmds.add(primaryCmd);
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
    // CLI 偶尔 exit 0 但 result 事件带 is_error（限速/拦截等）——记录下来在 close 时转 reject
    let resultError: string | null = null;

    /**
     * 杀子进程：先 SIGTERM；5 秒没退出再 SIGKILL 兜底。
     * 不升级的话，CLI 若挂在网络请求上不理 SIGTERM，会滞留并继续烧订阅额度。
     */
    const killProc = (p: ChildProcessWithoutNullStreams) => {
      try { p.kill('SIGTERM'); } catch {/* ignore */}
      const killTimer = setTimeout(() => {
        try { p.kill('SIGKILL'); } catch {/* ignore */}
      }, 5_000);
      killTimer.unref();
      p.once('close', () => clearTimeout(killTimer));
    };

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
      killProc(proc);
      settleReject(new Error('streamClaude aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      killProc(proc);
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
      const o = obj as {
        type?: string;
        subtype?: string;
        is_error?: boolean;
        result?: unknown;
        event?: { type?: string; delta?: { type?: string; text?: string } };
      };
      // result 事件带 is_error（限速/内容拦截等，CLI 仍可能 exit 0）→ 记下来，close 时 reject
      // 而不是静默 resolve 空串（那会让上层报"输出不像 JSON"这种误导性错误）
      if (o.type === 'result' && o.is_error) {
        resultError = typeof o.result === 'string' && o.result
          ? o.result.slice(0, 500)
          : `result subtype=${o.subtype ?? 'unknown'}`;
        return;
      }
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

      // stdin 必须挂 error 监听：子进程若在读完 prompt 前退出（鉴权失败/限速秒退），
      // 大 prompt（>64KB 管道缓冲）的异步 flush 会报 EPIPE/ERR_STREAM_DESTROYED——
      // 没有监听的话是 uncaughtException，直接崩整个 Next 进程。
      // 错误本身不用处理：进程层面的 error/close 事件会统一收敛结果。
      p.stdin.on('error', () => {/* swallowed; surfaced via process error/close */});

      p.stdout.on('data', (chunk: string) => {
        if (p !== proc) return; // 已切到 fallback 进程，旧进程的事件一律作废
        lineBuf += chunk;
        const parts = lineBuf.split('\n');
        lineBuf = parts.pop() ?? '';
        for (const line of parts) {
          processLine(line.trim());
        }
      });

      p.stderr.on('data', (chunk: string) => {
        if (p !== proc) return;
        // 防止极端情况下 stderr 无限增长
        if (stderrBuf.length < 8000) {
          stderrBuf += chunk;
        }
      });

      p.on('error', (err: NodeJS.ErrnoException) => {
        if (p !== proc) return; // 已切到 fallback，旧进程事件作废
        // ENOENT -> 按 CLAUDE_BIN_CANDIDATES 顺序继续试下一个候选
        if (err.code === 'ENOENT') {
          const next = nextCandidate();
          if (next) {
            triedCmds.add(next);
            try {
              proc = trySpawn(next);
              attachHandlers(proc);
              writePromptAsJsonLine(proc);
              return;
            } catch (fallbackErr) {
              settleReject(
                new Error(
                  `claude 启动失败：已试过 ${[...triedCmds].join(', ')}，最后一个报错 ${(fallbackErr as Error).message}`,
                ),
              );
              return;
            }
          }
          settleReject(
            new Error(
              `找不到 claude CLI。已试过：${[...triedCmds].join(', ')}。` +
                `请安装 Claude Code CLI，或在 .env.local 里用 BYTRACE_CLAUDE_BIN 指定完整路径。`,
            ),
          );
          return;
        }
        settleReject(
          new Error(
            `claude process error: ${err.message}${stderrBuf ? ` | stderr=${stderrBuf.slice(-500)}` : ''}`,
          ),
        );
      });

      p.on('close', (code: number | null, sigtype: NodeJS.Signals | null) => {
        // 关键守卫：spawn 失败(ENOENT)的进程在 error 之后仍会发一次 close（Node 文档
        // 明确行为）。不挡掉的话，旧进程的 close(null) 会把刚起的 fallback 结果击穿
        // —— Promise 提前 reject，fallback 进程沦为无人回收的孤儿继续烧配额。
        if (p !== proc) return;
        // flush 末尾未换行的行
        if (lineBuf.trim()) {
          processLine(lineBuf.trim());
          lineBuf = '';
        }
        if (code === 0) {
          if (resultError) {
            settleReject(new Error(`claude result error: ${resultError}`));
            return;
          }
          if (!assembledText) {
            settleReject(
              new Error(
                `claude exited 0 but produced no text. stderr=${stderrBuf.slice(-500)}`,
              ),
            );
            return;
          }
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
