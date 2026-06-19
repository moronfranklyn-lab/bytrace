import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 本机 Codex CLI 封装。spawn `codex exec` —— 走楠的 ChatGPT 会员订阅，**不接 API、不带 key**
 * （与 lib/claude.ts 同一条铁律）。分工：claude 负责起草/润色，codex 负责联网搜集 + 审查。
 *
 * 为什么用 `codex exec`：非交互(headless)模式，一次性喂 prompt、拿最终答案。
 * 两个实测必踩的坑：
 *   - `--skip-git-repo-check`：否则 codex 拒绝在非受信任目录运行（报 "Not inside a trusted directory"）
 *   - stdin 必须关掉（stdio[0]='ignore'）：否则 codex 卡在 "Reading additional input from stdin"
 * 用 `--output-last-message <file>` 把最终回答写到临时文件，省得去解析那串夹着工具日志的 stdout。
 * 默认模型是 gpt-5.5（codex 登录态决定），调用方不用指定。
 */

const FALLBACK_CODEX_PATH = '/Users/nan/.npm-global/bin/codex';
const DEFAULT_TIMEOUT_MS = 300_000; // 联网搜集 / 审查较慢，默认 5 分钟

export interface RunCodexOptions {
  /** 外部中止信号，触发时 SIGTERM 杀掉子进程 */
  signal?: AbortSignal;
  /** 硬超时，默认 300_000（5 分钟） */
  timeoutMs?: number;
  /** stdout 增量回调（codex 的过程日志，给前端"它正在干活"的进度感；**不是**最终答案） */
  onProgress?: (text: string) => void;
  /** 覆盖 codex 二进制路径（测试用） */
  codexBin?: string;
  /** codex 运行目录（--skip-git-repo-check 后的 cwd）。默认项目根。 */
  cwd?: string;
}

/**
 * 跑一次 codex exec，resolve 出它的最终文本答案。
 * 契约与 streamClaude 对称：失败 reject(Error)，成功 resolve(完整答案字符串)。
 */
export function runCodex(prompt: string, options: RunCodexOptions = {}): Promise<string> {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onProgress,
    codexBin,
    cwd = process.cwd(),
  } = options;

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('runCodex aborted before start'));
      return;
    }

    const outFile = join(
      tmpdir(),
      `codex-out-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`,
    );
    const cliArgs = ['exec', '--skip-git-repo-check', '--output-last-message', outFile, prompt];

    let proc: ChildProcess;
    let usedFallback = false;
    let stderrBuf = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const removeOut = () => {
      try { if (existsSync(outFile)) rmSync(outFile); } catch {/* ignore */}
    };

    const finalize = (kind: 'resolve' | 'reject', value: string | Error) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (signal) signal.removeEventListener('abort', onAbort);
      removeOut();
      if (kind === 'resolve') resolve(value as string);
      else reject(value as Error);
    };

    const onAbort = () => {
      try { proc?.kill('SIGTERM'); } catch {/* ignore */}
      finalize('reject', new Error('runCodex aborted'));
    };

    function trySpawn(cmd: string): ChildProcess {
      return spawn(cmd, cliArgs, {
        stdio: ['ignore', 'pipe', 'pipe'], // 关 stdin
        cwd,
        env: process.env, // 订阅凭据在 ~/.codex，靠 env/HOME 发现
      });
    }

    const attach = (p: ChildProcess) => {
      p.stdout?.setEncoding('utf8');
      p.stderr?.setEncoding('utf8');
      p.stdout?.on('data', (chunk: string) => {
        if (onProgress) { try { onProgress(chunk); } catch {/* 回调异常不影响流 */} }
      });
      p.stderr?.on('data', (chunk: string) => {
        if (stderrBuf.length < 8000) stderrBuf += chunk;
      });
      p.on('error', (err: NodeJS.ErrnoException) => {
        // ENOENT → codex 不在 PATH，回退到已知路径试一次
        if (err.code === 'ENOENT' && !usedFallback && !codexBin && existsSync(FALLBACK_CODEX_PATH)) {
          usedFallback = true;
          try {
            proc = trySpawn(FALLBACK_CODEX_PATH);
            attach(proc);
            return;
          } catch (e) {
            finalize('reject', new Error(`codex not found in PATH and fallback failed: ${(e as Error).message}`));
            return;
          }
        }
        finalize('reject', new Error(`codex process error: ${err.message}${stderrBuf ? ` | stderr=${stderrBuf.slice(-500)}` : ''}`));
      });
      p.on('close', (code: number | null) => {
        if (settled) return;
        if (code === 0) {
          let answer = '';
          try { if (existsSync(outFile)) answer = readFileSync(outFile, 'utf8').trim(); } catch {/* ignore */}
          if (!answer) {
            finalize('reject', new Error(`codex exited 0 but produced no output. stderr=${stderrBuf.slice(-500)}`));
            return;
          }
          finalize('resolve', answer);
          return;
        }
        finalize('reject', new Error(`codex exited code=${code}${stderrBuf ? ` | stderr=${stderrBuf.slice(-800)}` : ''}`));
      });
    };

    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      try { proc?.kill('SIGTERM'); } catch {/* ignore */}
      finalize('reject', new Error(`runCodex timed out after ${timeoutMs}ms. stderr=${stderrBuf.slice(-500)}`));
    }, timeoutMs);

    const primaryCmd = codexBin ?? 'codex';
    try {
      proc = trySpawn(primaryCmd);
    } catch (err) {
      finalize('reject', new Error(`Failed to spawn '${primaryCmd}': ${(err as Error).message}`));
      return;
    }
    attach(proc);
  });
}
