import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude';
import { buildOutlinePrompt, normalizeOutline } from '@/lib/prompts/outline';
import { buildFingerprintMetaMap, type Composition, type FingerprintMeta } from '@/lib/composition';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';
import { createSseStream, stripJsonFence } from '@/lib/sse';
import { isValidPlatformKey, type PlatformKey } from '@/lib/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingPayload {
  idea?: string;
  composition?: Composition;
  target_platform?: string;
  /** 可选：用户在 Step 1 选了具体站点画像时传，prompt 会注入画像的结构/深度/类比偏好 */
  target_site_id?: string;
  /**
   * v3.5：codex 联网搜集的素材包（事实/数据/反方/来源）。
   * 由前端从 /api/compose/gather 拿到后透传过来。空 = 用户跳过 / 没等到，prompt 自动降级。
   */
  research_material?: string;
}

interface SiteProfileRow {
  id: string;
  site_name: string;
  section: string | null;
  profile_json: string;
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
    return jsonError(`题材思路至少 ${MIN_IDEA_CHARS} 字`);
  }
  const composition: Composition = body.composition ?? { selected_authors: [] };

  let targetPlatform: PlatformKey | null = null;
  if (typeof body.target_platform === 'string' && body.target_platform.trim()) {
    const tp = body.target_platform.trim();
    if (!isValidPlatformKey(tp)) {
      return jsonError(`目标平台 "${tp}" 不在允许列表里`);
    }
    targetPlatform = tp;
  }

  // 拉指纹（按 composition 里 fingerprint_id 集合查；空 composition 也允许，
  // 走通用风格分支）
  try {
    ensureComposeColumns();
  } catch (err) {
    return jsonError(`数据库结构升级失败：${(err as Error).message}`, 500);
  }

  let fpMap = new Map<string, FingerprintMeta>();
  let siteProfile: Record<string, unknown> | null = null;
  let siteLabel: string | null = null;
  try {
    const db = getDb();
    const ids = composition.selected_authors.map((a) => a.fingerprint_id);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT f.id, f.author_id, f.fingerprint_json,
                  a.name AS author_name, a.platform
           FROM fingerprints f
           JOIN authors a ON a.id = f.author_id
           WHERE f.id IN (${placeholders})`,
        )
        .all(...ids) as Array<{
          id: string;
          fingerprint_json: string;
          author_name: string;
          platform: string | null;
        }>;
      fpMap = buildFingerprintMetaMap(rows);
    }

    if (body.target_site_id) {
      const row = db
        .prepare(`SELECT id, site_name, section, profile_json FROM sites WHERE id = ?`)
        .get(body.target_site_id) as SiteProfileRow | undefined;
      if (row) {
        try { siteProfile = JSON.parse(row.profile_json); } catch { /* keep null */ }
        siteLabel = row.section ? `${row.site_name} · ${row.section}` : row.site_name;
      }
    }
  } catch (err) {
    return jsonError(`数据库读取失败：${(err as Error).message}`, 500);
  }

  return createSseStream(async (send, _close, abortSignal) => {
    send('open', { ok: true });

    const researchMaterial = typeof body.research_material === 'string'
      ? body.research_material
      : undefined;

    const prompt = buildOutlinePrompt(
      idea,
      composition,
      fpMap,
      targetPlatform,
      { siteLabel, siteProfile },
      researchMaterial,
    );

    let raw = '';
    try {
      raw = await streamClaude(prompt, {
        signal: abortSignal,
        onChunk: (text) => send('chunk', { text }),
      });
    } catch (err) {
      send('error', { message: (err as Error).message || '模型那边没回来', phase: 'claude' });
      return;
    }

    const cleaned = stripJsonFence(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      send('error', {
        message: '模型输出了不太像 JSON 的东西，再试一次',
        phase: 'parse',
        detail: (err as Error).message,
        sample: cleaned.slice(0, 280),
      });
      return;
    }
    const outline = normalizeOutline(parsed);
    if (!outline) {
      send('error', {
        message: '大纲结构看起来不对，换个角度的题材描述再试一次',
        phase: 'normalize',
        sample: cleaned.slice(0, 280),
      });
      return;
    }
    send('done', { outline });
  }, req.signal);
}
