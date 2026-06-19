/**
 * Critic Loop · Reflection Pattern 编排层
 * ------------------------------------------------------------
 * 把"生成草稿 → critic 评分 → 不及格则带 hint 重写 → 再评 → 直到达标或用完次数"
 * 这条流程封装在这里。
 *
 * 设计决策（面试讲法）：
 *
 *   1. 「全文重写」而不是「按节修补」
 *      原因：按节修补需要做章节边界识别、改完后再做章节拼接 + 一致性校验，
 *      代码复杂度高，而且 LLM 输出的章节边界并不总是清晰的（小标题写法会变）。
 *      全文重写带 hint 是更可靠的兜底，代价是 token × 重试次数。
 *      Trade-off 数据会在评测阶段补：跑 20 篇 / 20 篇对比"按节修补"实现的胜负率。
 *
 *   2. 「最多 2 次重写 = 3 次 critic」
 *      Reflection pattern 的业界共识是上限 3 次（LangGraph Supervisor 默认）。
 *      首版定为 3 次，避免无限循环把 token 烧光。
 *      用完仍不达标时：从 3 次草稿里挑 total 最高的那一稿落库（best-of-N 兜底）。
 *
 *   3. 「critic 失败 fail-open，不阻塞主流程」
 *      critic 本身也是一次 LLM 调用，会失败（JSON 解析错 / 超时 / 模型抽风）。
 *      失败时把当次 critic 视为"未评估"（passed=false 但不计入重试），直接返回
 *      原稿，不让用户因为 critic 故障写不出文章。
 *
 *   4. 「critic 用更短超时（90s）」
 *      草稿用 240s 超时是因为要写 5000+ 字。critic 只输出几百字 JSON，
 *      90s 足够。这也是降低"critic 比写作还慢"的体验问题。
 */

import { streamClaude } from '@/lib/claude';
import { stripJsonFence } from '@/lib/sse';
import {
  buildCriticPrompt,
  CRITIC_MAX_ATTEMPTS,
  CRITIC_PASS_THRESHOLD,
  type CriticResult,
  type CriticDimension,
} from '@/lib/prompts/critic';
import type { Composition, FingerprintMeta } from '@/lib/composition';
import type { Outline } from '@/lib/prompts/outline';

/** Critic 单次调用的硬超时（毫秒） */
const CRITIC_TIMEOUT_MS = 90_000;

/** 一次 Critic 评分的完整记录（用于 SSE 上行 + 落库） */
export interface CriticRunRecord {
  /** 第几次尝试（1-based，对应 critic_runs.attempt） */
  attempt: number;
  /** 该次评分对应的草稿 markdown（落 best-of-N 兜底用） */
  draft_md: string;
  /** critic 评分结果 */
  result: CriticResult;
  /** critic LLM 本次耗时（毫秒），用于性能复盘 */
  elapsed_ms: number;
}

/**
 * 跑一次 critic，把模型输出的 JSON 安全解析成 CriticResult。
 * JSON 解析失败时回 null，调用方按"未评估"处理。
 *
 * 为什么不让 critic 失败就 retry：critic 本身是质量门，让它链路上越短越稳。
 * 它自己挂了就让主流程把当次 draft 作为"未评估稿"返回，比起死循环更好。
 */
export async function runSingleCritic(
  draftMd: string,
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
  outline: Outline,
  signal?: AbortSignal,
): Promise<{ result: CriticResult | null; elapsed_ms: number; error?: string }> {
  const start = Date.now();
  const prompt = buildCriticPrompt(draftMd, composition, fingerprints, outline);

  let raw = '';
  try {
    raw = await streamClaude(prompt, {
      signal,
      timeoutMs: CRITIC_TIMEOUT_MS,
    });
  } catch (err) {
    return {
      result: null,
      elapsed_ms: Date.now() - start,
      error: `critic 调用失败：${(err as Error).message}`,
    };
  }

  const result = parseCriticResult(raw);
  if (!result) {
    return {
      result: null,
      elapsed_ms: Date.now() - start,
      error: 'critic 输出无法解析为合法评分 JSON',
    };
  }
  return { result, elapsed_ms: Date.now() - start };
}

/**
 * 解析 critic 输出的 JSON。
 * 容错点：
 *   - 模型可能加了 ```json 围栏，stripJsonFence 处理
 *   - 模型可能漏掉 total / passed / weakest，我们这边按 scores 重新算一遍
 *     （而不是相信模型自己算的——LLM 不擅长算术）
 *   - scores 必须 5 维齐全，否则视为非法
 */
function parseCriticResult(raw: string): CriticResult | null {
  const cleaned = stripJsonFence(raw);
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const scoresRaw = o.scores;
  if (!scoresRaw || typeof scoresRaw !== 'object') return null;

  const expectedDims: CriticDimension[] = ['structure', 'depth', 'analogy', 'punchline', 'taboo'];
  const scoresMap = scoresRaw as Record<string, unknown>;

  const scores = {} as Record<CriticDimension, { score: number; reason: string }>;
  for (const dim of expectedDims) {
    const v = scoresMap[dim];
    if (!v || typeof v !== 'object') return null;
    const vo = v as Record<string, unknown>;
    const score = clampInt(vo.score);
    if (score === null) return null;
    const reason = typeof vo.reason === 'string' ? vo.reason : '';
    scores[dim] = { score, reason };
  }

  // 自己算 total / passed / weakest，不信模型
  const total = expectedDims.reduce((sum, d) => sum + scores[d].score, 0);
  const passed = total >= CRITIC_PASS_THRESHOLD;

  // weakest = 最低分维度。如果都满分，weakest=null。
  let weakest: CriticDimension | null = null;
  let weakestScore = 6;
  for (const dim of expectedDims) {
    if (scores[dim].score < weakestScore) {
      weakestScore = scores[dim].score;
      weakest = dim;
    }
  }
  if (weakestScore === 5) weakest = null;

  const rewrite_hint =
    typeof o.rewrite_hint === 'string' ? o.rewrite_hint.trim() : '';

  return {
    scores,
    total,
    passed,
    weakest,
    rewrite_hint,
  };
}

function clampInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < 0) return 0;
  if (n > 5) return 5;
  return n;
}

/**
 * 从一组 critic runs 里挑出 "总分最高 + attempt 最小" 的那一次。
 * Best-of-N 兜底：3 次都没过阈值时，挑最优的那稿落库。
 */
export function pickBestRun(runs: CriticRunRecord[]): CriticRunRecord | null {
  if (runs.length === 0) return null;
  let best = runs[0];
  for (const r of runs) {
    if (r.result.total > best.result.total) {
      best = r;
      continue;
    }
    if (r.result.total === best.result.total && r.attempt < best.attempt) {
      best = r;
    }
  }
  return best;
}

/** 重导出常量给 route 用，避免它直接 import prompt 文件 */
export { CRITIC_MAX_ATTEMPTS, CRITIC_PASS_THRESHOLD };
