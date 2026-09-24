/**
 * OpenCLI 客户端：spawn 子进程调本机 opencli，统一 JSON 输出 + 超时 + 错误处理。
 *
 * 设计原则（跟 lib/claude.ts spawn 一样的模式）：
 * - 复用 PATH 里的 opencli 命令，找不到走 fallback 路径
 * - 默认 60s 超时（OpenCLI 需要等浏览器加载，比直接 fetch 慢）
 * - 统一 -f json 输出 + 全量 stdout 缓冲到结束再 JSON.parse
 * - 失败信息保留 stderr 前 400 字给上层 debug
 *
 * 这是 lib/crawler 层的"通道"——任何 adapter 都可以调它跑 opencli 命令，
 * 不暴露 spawn 细节。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Mac 上 npm -g 默认装到的两个位置，PATH 不通时兜底
const FALLBACK_PATHS = [
  '/usr/local/bin/opencli',
  '/opt/homebrew/bin/opencli',
  process.env.HOME ? `${process.env.HOME}/.local/bin/opencli` : null, // 2026-07 机器重装后 CLI 的新家
  process.env.HOME ? `${process.env.HOME}/.npm-global/bin/opencli` : null,
].filter((p): p is string => !!p);

const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunOpenCliOptions {
  /** 总超时，毫秒。默认 60s。 */
  timeoutMs?: number;
  /** 强制走某个 opencli 二进制路径（测试用） */
  bin?: string;
  /** 信号传入即取消 */
  signal?: AbortSignal;
}

/**
 * 按平台限制最小调用间隔（毫秒）。跟 CLAUDE.md「反爬与账号边界 v2」对齐：
 *   公众号 1s / B 站 5s / 知乎 8s / 小红书 15s / 抖音 30s
 *
 * 单进程内的全局 throttle——同一进程多个 adapter 调用同平台时排队等待。
 * 实现思路：每个 platform key 记上一次完成时间戳，下次调用前 sleep 到间隔满足。
 */
const RATE_LIMIT_MS: Record<string, number> = {
  weixin: 1_000,
  bilibili: 5_000,
  zhihu: 8_000,
  xiaohongshu: 15_000,
  douyin: 30_000,
};

const lastCallTs: Map<string, number> = new Map();
// 每个平台一条 promise 链队列：并发调用按排队序串行等待。
// 不能只靠时间戳——并发时会同时读到旧时间戳后一起放行，平台强制间隔就失效了
const throttleQueues: Map<string, Promise<void>> = new Map();

function throttle(platformKey: string): Promise<void> {
  const minGap = RATE_LIMIT_MS[platformKey];
  if (!minGap) return Promise.resolve();
  const prev = throttleQueues.get(platformKey) ?? Promise.resolve();
  const mine = prev.then(async () => {
    const last = lastCallTs.get(platformKey);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < minGap) {
        await new Promise((r) => setTimeout(r, minGap - elapsed));
      }
    }
    lastCallTs.set(platformKey, Date.now());
  });
  // 链尾吞掉异常，防止一次失败把整条队列打断（防御性，等待逻辑本身不会抛）
  throttleQueues.set(platformKey, mine.catch(() => undefined));
  return mine;
}

export interface OpenCliRawResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
}

export class OpenCliNotAvailable extends Error {
  constructor(message = 'OpenCLI binary not found in PATH or fallbacks') {
    super(message);
    this.name = 'OpenCliNotAvailable';
  }
}

export class OpenCliTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`OpenCLI 子进程 ${timeoutMs / 1000}s 没回应，已强制结束`);
    this.name = 'OpenCliTimeout';
  }
}

export class OpenCliError extends Error {
  exitCode: number;
  stderr: string;
  /** 部分 OpenCLI 错误会附带 code（如 AUTH_REQUIRED）—— 从 stderr 解析 */
  authRequired: boolean;
  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = 'OpenCliError';
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.authRequired = /AUTH_REQUIRED|Please log in/i.test(message + stderr);
  }
}

function resolveOpenCliBin(override?: string): string | null {
  if (override) {
    if (existsSync(override)) return override;
    return null;
  }
  for (const p of FALLBACK_PATHS) {
    if (existsSync(p)) return p;
  }
  return 'opencli'; // 信任 PATH，spawn 会再爆 ENOENT
}

/**
 * 跑一个 opencli 子命令，强制 -f json 输出，整段 stdout 解析为 JSON 返回。
 *
 * 示例：runOpenCliJson(['weixin', 'download', '--url', url, '--download-images', 'false'])
 *
 * 错误语义：
 * - OpenCliNotAvailable：opencli 命令找不到（用户没装或没在 PATH）
 * - OpenCliTimeout：超时
 * - OpenCliError：exitCode != 0，含 authRequired 标志位
 * - SyntaxError：stdout 不是合法 JSON（极少；命令拼错 / opencli 版本不匹配）
 */
export async function runOpenCliJson<T = unknown>(
  args: string[],
  options: RunOpenCliOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, bin: binOverride, signal } = options;
  const bin = resolveOpenCliBin(binOverride);
  if (!bin) throw new OpenCliNotAvailable();

  // 强制 json 输出（除非调用方自己已经传了 -f / --format）
  const hasFormat = args.some((a) => a === '-f' || a === '--format' || a.startsWith('-f=') || a.startsWith('--format='));
  const finalArgs = hasFormat ? args : [...args, '-f', 'json'];

  // 按平台节奏控（args[0] 是 platform key：weixin/bilibili/zhihu/...）
  const platformKey = args[0];
  if (platformKey && RATE_LIMIT_MS[platformKey] !== undefined) {
    await throttle(platformKey);
  }

  const start = Date.now();
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('OpenCLI 调用前已 abort'));

    const proc = spawn(bin, finalArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();
    };
    const settle = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      cb();
    };

    proc.stdout?.on('data', (b: Buffer) => stdoutChunks.push(b));
    proc.stderr?.on('data', (b: Buffer) => stderrChunks.push(b));

    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {/* ignore */}
      // SIGTERM 后 5s 还没退出就补 SIGKILL，防止子进程吞信号一直挂着
      killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {/* ignore */}
      }, 5_000);
      killTimer.unref?.();
      settle(() => reject(new OpenCliTimeout(timeoutMs)));
    }, timeoutMs);

    const onAbort = () => {
      try { proc.kill('SIGTERM'); } catch {/* ignore */}
      settle(() => reject(new Error('OpenCLI 子进程被外部 abort')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      if (err.code === 'ENOENT') {
        settle(() => reject(new OpenCliNotAvailable(`spawn ENOENT: ${bin}`)));
      } else {
        settle(() => reject(err));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const ms = Date.now() - start;

      if (code !== 0) {
        // OpenCLI 失败时通常 stdout 也是 yaml 错误信息（ok: false / error: ...）
        // 把它带进 message，便于上层判断
        const msg = stdout.trim() || stderr.trim() || `exit ${code}`;
        settle(() => reject(new OpenCliError(msg, code ?? -1, stderr)));
        return;
      }

      // JSON.parse 失败抛 SyntaxError，调用方判断
      try {
        const parsed = JSON.parse(stdout) as T;
        settle(() => {
          // 附属时间在错误对象里没法塞，由调用方在 then 里自己测
          void ms;
          resolve(parsed);
        });
      } catch (e) {
        settle(() =>
          reject(
            new OpenCliError(
              'OpenCLI 输出不是合法 JSON：' + (e as Error).message,
              0,
              stdout.slice(0, 400),
            ),
          ),
        );
      }
    });
  });
}

/**
 * 检查 opencli 是否可用（不调网，仅看二进制 + daemon 存活）。
 * 用于启动时探测，决定 adapter 通道顺序。
 */
export async function isOpenCliAvailable(): Promise<boolean> {
  const bin = resolveOpenCliBin();
  if (!bin || (bin !== 'opencli' && !existsSync(bin))) return false;
  try {
    // doctor 失败也算可用（doctor exit code 由 daemon/extension 状态决定，
    // 这里只看二进制能不能启动）
    await runOpenCliJson<unknown[]>(['--version'].slice(0, 1), { timeoutMs: 5_000 });
    return true;
  } catch (err) {
    // --version 没 -f json，会 SyntaxError——只要不是 NotAvailable 就当能用
    if (err instanceof OpenCliNotAvailable) return false;
    return true;
  }
}
