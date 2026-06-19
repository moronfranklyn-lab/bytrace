import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { streamClaude, ARTICLE_MODEL } from '@/lib/claude';
import { runCodex } from '@/lib/codex';
import { stripJsonFence, stripMarkdownFence, type SseSend } from '@/lib/sse';
import { getDb } from '@/lib/db';
import {
  buildGatherPrompt,
  buildDraftPrompt,
  buildReviewPrompt,
  buildReviseHintBlock,
  type ResearchPrefs,
  type ResearchReview,
  type ResearchIssue,
} from '@/lib/prompts/research';

/**
 * 深度调研编排器。一条链路、全程订阅 CLI、零 API：
 *   codex 联网搜集 → claude 4.6 起草 → codex 审查 → (revise) claude 4.6 回炉 → codex 再审
 * 复用 critic 的 reflection loop 思路：≤ MAX_ATTEMPTS 轮，达标即停，否则 best-of-N 兜底。
 */

const MAX_ATTEMPTS = 2;
const GATHER_TIMEOUT_MS = 360_000; // codex 联网搜集，6 分钟
const DRAFT_TIMEOUT_MS = 240_000;  // claude 起草，4 分钟
const REVIEW_TIMEOUT_MS = 300_000; // codex 联网审查，5 分钟

interface RunRecord {
  attempt: number;
  draft_md: string;
  review: ResearchReview | null;
  elapsed_ms: number;
}

function normalizeIssues(arr: unknown): ResearchIssue[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const o = x as Record<string, unknown>;
      const sev = o.severity;
      return {
        severity: sev === 'high' || sev === 'low' ? sev : 'medium',
        where: String(o.where ?? ''),
        problem: String(o.problem ?? ''),
        suggestion: String(o.suggestion ?? ''),
      } as ResearchIssue;
    });
}

function parseReview(raw: string): ResearchReview | null {
  try {
    const obj = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return null;
    return {
      issues: normalizeIssues(obj.issues),
      verdict: obj.verdict === 'pass' ? 'pass' : 'revise',
      score: typeof obj.score === 'number' ? Math.max(0, Math.min(100, obj.score)) : 50,
      summary: typeof obj.summary === 'string' ? obj.summary : '',
    };
  } catch {
    return null;
  }
}

function highCount(review: ResearchReview): number {
  return review.issues.filter((i) => i.severity === 'high').length;
}

/** 通过标准（放宽 v2）：codex 判 pass，或没有任何 high 危问题。 */
function isPass(review: ResearchReview): boolean {
  return review.verdict === 'pass' || highCount(review) === 0;
}

/** 达标(isPass)的优先；其中 score 最高；平手 high 最少、再取 attempt 大的。 */
function pickBest(runs: RunRecord[]): RunRecord | null {
  if (runs.length === 0) return null;
  const passed = runs.filter((r) => r.review && isPass(r.review));
  const pool = passed.length ? passed : runs;
  return [...pool].sort((a, b) => {
    const sa = a.review?.score ?? -1;
    const sb = b.review?.score ?? -1;
    if (sa !== sb) return sb - sa; // score 高优先
    const ha = a.review ? highCount(a.review) : 99;
    const hb = b.review ? highCount(b.review) : 99;
    if (ha !== hb) return ha - hb;
    return b.attempt - a.attempt;
  })[0];
}

export async function runResearchLoop(opts: {
  topic: string;
  prefs: ResearchPrefs;
  signal: AbortSignal;
  send: SseSend;
}): Promise<{ reportId: string; finalMd: string; passed: boolean }> {
  const { topic, prefs, signal, send } = opts;
  const reportId = nanoid(14);
  const now = Date.now();

  // ---- 1. 搜集(codex 联网) ----
  send('gather_start', {});
  let material = '';
  try {
    material = await runCodex(buildGatherPrompt(topic, prefs), {
      signal,
      timeoutMs: GATHER_TIMEOUT_MS,
      cwd: tmpdir(), // 中性目录：别让 codex 读到项目 AGENTS.md 而跑偏
      onProgress: () => send('gather_progress', {}), // 心跳:codex 在干活
    });
  } catch (err) {
    send('error', { phase: 'gather', message: (err as Error).message || 'codex 搜集失败' });
    throw err;
  }
  send('gather_done', { preview: material.slice(0, 600), chars: material.length });

  // ---- 2. 起草 → 审查 → 回炉 循环 ----
  const runs: RunRecord[] = [];
  let reviseHint: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) break;
    const t0 = Date.now();

    if (attempt > 1) send('revise_start', { attempt });

    // 起草 / 回炉(claude 4.6)
    send('draft_start', { attempt });
    let draftRaw = '';
    try {
      draftRaw = await streamClaude(buildDraftPrompt(topic, material, prefs, reviseHint), {
        model: ARTICLE_MODEL,
        signal,
        timeoutMs: DRAFT_TIMEOUT_MS,
        onChunk: (t) => send('draft_delta', { attempt, delta: t }),
      });
    } catch (err) {
      send('error', { phase: 'draft', attempt, message: (err as Error).message || 'claude 起草失败' });
      throw err;
    }
    const draftMd = stripMarkdownFence(draftRaw);
    send('draft_done', { attempt, chars: draftMd.length });

    // 审查(codex)
    send('review_start', { attempt });
    let review: ResearchReview | null = null;
    try {
      const reviewRaw = await runCodex(buildReviewPrompt(draftMd), {
        signal,
        timeoutMs: REVIEW_TIMEOUT_MS,
        cwd: tmpdir(), // 中性目录，同上
      });
      review = parseReview(reviewRaw);
      if (!review) send('review_error', { attempt, message: 'codex 审查输出不是合法 JSON，本稿按未评估处理' });
    } catch (err) {
      send('review_error', { attempt, message: (err as Error).message || 'codex 审查失败' });
    }

    runs.push({ attempt, draft_md: draftMd, review, elapsed_ms: Date.now() - t0 });

    if (review) {
      send('review_done', {
        attempt,
        verdict: review.verdict,
        score: review.score,
        summary: review.summary,
        issues: review.issues,
        high: highCount(review),
      });
    }

    // 通过(无高危)、审查失败、或已到上限 → 停;否则带 hint 回炉
    if (!review || isPass(review)) break;
    if (attempt < MAX_ATTEMPTS) reviseHint = buildReviseHintBlock(review, attempt + 1);
  }

  // ---- 3. 选最终稿 ----
  const best = pickBest(runs);
  const finalMd = best?.draft_md ?? '';
  const passed = best?.review ? isPass(best.review) : false;
  const finalAttempt = best?.attempt ?? runs.length;

  // ---- 4. 落库 ----
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO research_reports
        (id, topic, source_hint, gathered_md, final_report_md, final_attempt, passed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      reportId,
      topic,
      prefs.sourceHint ?? null,
      material,
      finalMd,
      finalAttempt,
      passed ? 1 : 0,
      now,
    );
    const insRun = db.prepare(
      `INSERT INTO research_runs
        (report_id, attempt, draft_md, review_json, verdict, total_score, issue_count, high_count, elapsed_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id, attempt) DO UPDATE SET
         draft_md = excluded.draft_md,
         review_json = excluded.review_json,
         verdict = excluded.verdict,
         total_score = excluded.total_score,
         issue_count = excluded.issue_count,
         high_count = excluded.high_count,
         elapsed_ms = excluded.elapsed_ms`,
    );
    for (const r of runs) {
      insRun.run(
        reportId,
        r.attempt,
        r.draft_md,
        r.review ? JSON.stringify(r.review) : null,
        r.review?.verdict ?? null,
        r.review?.score ?? null,
        r.review?.issues.length ?? 0,
        r.review ? highCount(r.review) : 0,
        r.elapsed_ms,
        now,
      );
    }
  } catch (err) {
    send('error', { phase: 'db', message: (err as Error).message || '落库失败（报告已在内存里）' });
  }

  send('done', {
    report_id: reportId,
    final_md: finalMd,
    passed,
    final_attempt: finalAttempt,
    total_attempts: runs.length,
  });
  return { reportId, finalMd, passed };
}
