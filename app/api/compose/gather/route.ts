/**
 * POST /api/compose/gather
 * ------------------------------------------------------------
 * compose 主流程的"信息搜集"环节。idea 一确认就在后台 fire-and-forget 调起本端点，
 * codex 联网搜集素材包；用户在 Step 3-4 选风格的同时素材包在后台跑，到 Step 5
 * outline 时大概率已就绪，立刻拿来给 outline / draft prompt 喂事实弹药。
 *
 * 为什么不复用 /api/research：
 *   - /research 跑完整的 reflection loop（搜集 → 起草报告 → codex 审查 → 回炉），15-20 分钟
 *   - compose 主流程只需要"原始素材包"，不需要"经审查的成稿报告"——所以只跑 1/4 的链路
 *   - 复用了同一份 codex prompt（buildGatherPrompt），保持事实抓取口径一致
 *
 * 缓存：按 idea_hash 幂等。同一 idea 已搜过 → 秒返缓存，不烧 codex 配额。
 *
 * SSE 协议：
 *   event: cached     data: { material_md, chars, created_at, idea_hash, cache_age_sec }
 *   event: started    data: { idea_hash, estimated_seconds }
 *   event: progress   data: { tick }  ——心跳，codex 在干活
 *   event: done       data: { material_md, chars, elapsed_ms, idea_hash }
 *   event: error      data: { message, phase }
 */

import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { runCodex } from '@/lib/codex';
import { buildGatherPrompt } from '@/lib/prompts/research';
import { getDb } from '@/lib/db';
import { createSseStream } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_IDEA_CHARS = 30;
const GATHER_TIMEOUT_MS = 360_000; // 6 分钟，与 /research 保持一致

interface IncomingPayload {
  idea?: string;
  /** 可选取材偏好（与 ResearchPrefs.sourceHint 同语义） */
  source_hint?: string;
  /** 强制重跑：忽略缓存。默认 false。 */
  force?: boolean;
}

interface GatherRunRow {
  idea_hash: string;
  idea: string;
  material_md: string;
  chars: number;
  elapsed_ms: number | null;
  created_at: number;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * idea_hash 的构造：sha256(trim(idea) + '\n' + (source_hint ?? '')) 前 16 字符。
 * 之所以同时纳入 source_hint：用户若改了取材偏好，缓存应天然失效。
 */
function computeIdeaHash(idea: string, sourceHint: string): string {
  const normalized = idea.trim() + '\n' + sourceHint.trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

export async function POST(req: NextRequest) {
  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const idea = (body.idea ?? '').trim();
  if (idea.length < MIN_IDEA_CHARS) {
    return jsonError(`题材思路至少 ${MIN_IDEA_CHARS} 字`);
  }
  const sourceHint = (body.source_hint ?? '').trim();
  const force = body.force === true;
  const ideaHash = computeIdeaHash(idea, sourceHint);

  return createSseStream(async (send, _close, abortSignal) => {
    // ---- 1. 命中缓存 ----
    if (!force) {
      try {
        const db = getDb();
        const row = db
          .prepare(`SELECT idea_hash, idea, material_md, chars, elapsed_ms, created_at FROM gather_runs WHERE idea_hash = ?`)
          .get(ideaHash) as GatherRunRow | undefined;
        if (row) {
          const cacheAgeSec = Math.round((Date.now() - row.created_at) / 1000);
          send('cached', {
            idea_hash: row.idea_hash,
            material_md: row.material_md,
            chars: row.chars,
            created_at: row.created_at,
            cache_age_sec: cacheAgeSec,
          });
          send('done', {
            idea_hash: row.idea_hash,
            material_md: row.material_md,
            chars: row.chars,
            elapsed_ms: 0, // 缓存命中视为 0ms
            from_cache: true,
          });
          return;
        }
      } catch (err) {
        // 缓存读失败不阻塞，继续走 codex
        // eslint-disable-next-line no-console
        console.warn('[gather] cache lookup failed:', (err as Error).message);
      }
    }

    // ---- 2. 跑 codex 联网搜集 ----
    send('started', {
      idea_hash: ideaHash,
      estimated_seconds: Math.round(GATHER_TIMEOUT_MS / 1000),
    });

    const t0 = Date.now();
    let material = '';
    try {
      material = await runCodex(
        buildGatherPrompt(idea, sourceHint ? { sourceHint } : {}),
        {
          signal: abortSignal,
          timeoutMs: GATHER_TIMEOUT_MS,
          // 中性目录：别让 codex 读到项目根 AGENTS.md 跑偏（与 /research 同一约束）
          cwd: tmpdir(),
          onProgress: () => send('progress', { tick: Date.now() }),
        },
      );
    } catch (err) {
      send('error', {
        message: (err as Error).message || 'codex 搜集失败',
        phase: 'codex',
      });
      return;
    }

    const elapsed = Date.now() - t0;
    const chars = material.length;
    const created_at = Date.now();

    // ---- 3. 落库（UPSERT 语义） ----
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO gather_runs (idea_hash, idea, material_md, chars, elapsed_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(idea_hash) DO UPDATE SET
          material_md = excluded.material_md,
          chars = excluded.chars,
          elapsed_ms = excluded.elapsed_ms,
          created_at = excluded.created_at
      `).run(ideaHash, idea, material, chars, elapsed, created_at);
    } catch (err) {
      // 落库失败不影响主流程：素材已在内存里给前端用
      // eslint-disable-next-line no-console
      console.warn('[gather] persist failed:', (err as Error).message);
    }

    send('done', {
      idea_hash: ideaHash,
      material_md: material,
      chars,
      elapsed_ms: elapsed,
      from_cache: false,
    });
  }, req.signal);
}

/**
 * GET /api/compose/gather?idea_hash=xxx
 * ------------------------------------------------------------
 * 让 outline / draft route（或 UI 重新挂载）能按 hash 拉素材包，
 * 不必把整段 material 透在前端 state 里来回传。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ideaHash = (url.searchParams.get('idea_hash') ?? '').trim();
  if (!ideaHash) return jsonError('idea_hash 不能为空');

  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT idea_hash, idea, material_md, chars, elapsed_ms, created_at FROM gather_runs WHERE idea_hash = ?`)
      .get(ideaHash) as GatherRunRow | undefined;
    if (!row) {
      return new Response(JSON.stringify({ found: false }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    return new Response(
      JSON.stringify({
        found: true,
        idea_hash: row.idea_hash,
        material_md: row.material_md,
        chars: row.chars,
        elapsed_ms: row.elapsed_ms,
        created_at: row.created_at,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  } catch (err) {
    return jsonError(`查询失败：${(err as Error).message}`, 500);
  }
}
