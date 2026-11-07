import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude';
import {
  buildRecommendPrompt,
  normalizeRecommendations,
  type RecommendFingerprintItem,
} from '@/lib/prompts/recommend';
import { getDb } from '@/lib/db';
import { createSseStream, stripJsonFence } from '@/lib/sse';
import type { FingerprintShape } from '@/lib/composition';
import { isValidPlatformKey, type PlatformKey } from '@/lib/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingPayload {
  idea?: string;
  target_platform?: string;
}

const MIN_IDEA_CHARS = 30;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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
    return jsonError(`题材思路至少 ${MIN_IDEA_CHARS} 字（当前 ${idea.length}）`);
  }

  // v3 新增：目标平台。允许为空（旧调用方兼容），但传了就必须合法。
  let targetPlatform: PlatformKey | null = null;
  if (typeof body.target_platform === 'string' && body.target_platform.trim()) {
    const tp = body.target_platform.trim();
    if (!isValidPlatformKey(tp)) {
      return jsonError(`目标平台 "${tp}" 不在允许列表里`);
    }
    targetPlatform = tp;
  }

  // ----- 拉所有指纹 -----
  let fingerprints: RecommendFingerprintItem[] = [];
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT f.id, f.author_id, f.fingerprint_json,
                a.name AS author_name, a.platform
         FROM fingerprints f
         JOIN authors a ON a.id = f.author_id
         ORDER BY COALESCE(a.last_used_at, f.created_at) DESC`,
      )
      .all() as Array<{
        id: string;
        author_id: string;
        fingerprint_json: string;
        author_name: string;
        platform: string | null;
      }>;

    fingerprints = rows.map((r) => {
      let fp: FingerprintShape = {};
      try { fp = JSON.parse(r.fingerprint_json) as FingerprintShape; } catch {/* ignore */}
      return {
        fingerprint_id: r.id,
        author_id: r.author_id,
        author_name: r.author_name,
        platform: r.platform,
        fingerprint: fp,
      };
    });
  } catch (err) {
    return jsonError(`数据库读取失败：${(err as Error).message}`, 500);
  }

  // 指纹库为空：返回一个特殊状态，让前端跳过推荐步骤
  if (fingerprints.length === 0) {
    return new Response(
      JSON.stringify({
        empty: true,
        recommendations: [],
      }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  const validIds = new Set(fingerprints.map((f) => f.fingerprint_id));

  return createSseStream(async (send, close, abortSignal) => {
    send('open', { count: fingerprints.length });

    const prompt = buildRecommendPrompt(idea, fingerprints, targetPlatform);

    let raw = '';
    try {
      raw = await streamClaude(prompt, {
        signal: abortSignal,
        onChunk: (text) => {
          send('chunk', { text });
        },
      });
    } catch (err) {
      send('error', {
        message: (err as Error).message || '模型那边没回来',
        phase: 'claude',
      });
      return;
    }

    const cleaned = stripJsonFence(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      send('error', {
        message: '模型输出了一段不太像 JSON 的东西，再试一次大概率就好',
        phase: 'parse',
        detail: (err as Error).message,
        sample: cleaned.slice(0, 280),
      });
      return;
    }

    // 构造 fingerprintsById 给 normalize 用，便于反向校正 platform_match_quality
    const fpById = new Map<string, FingerprintShape>();
    for (const f of fingerprints) fpById.set(f.fingerprint_id, f.fingerprint);
    const recs = normalizeRecommendations(parsed, validIds, fpById, targetPlatform);
    if (recs.length === 0) {
      send('error', {
        message: '模型这次没给出可用推荐，换个角度的题材描述再试一次',
        phase: 'normalize',
        sample: cleaned.slice(0, 280),
      });
      return;
    }

    send('done', { recommendations: recs });
  }, req.signal);
}
