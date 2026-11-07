import { NextRequest, NextResponse } from 'next/server';
import { streamClaude } from '@/lib/claude';
import {
  buildImageKeywordsPrompt,
  stripJsonFence,
  type ImageKeywordSlot,
} from '@/lib/prompts/image-keywords';
import { getDb } from '@/lib/db';
import { searchLocalAssets, type LocalAsset } from '@/lib/images/local';
import {
  searchUnsplash,
  isUnsplashConfigured,
  type UnsplashPhoto,
} from '@/lib/images/unsplash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AutoRequest {
  article_content?: string;
  fingerprint_id?: string;
  slot_count?: number;
  sources?: ('local' | 'unsplash')[];
}

interface FingerprintRow {
  fingerprint_json: string;
}

interface SlotCandidate {
  source: 'local' | 'unsplash';
  id: string;                  // local_asset id or unsplash photo id
  preview_url: string;
  full_url: string;
  alt: string | null;
  author?: string | null;
  author_url?: string | null;
}

interface SlotResult {
  slot_index: number;
  position_anchor: string;
  intent_zh: string;
  intent_en: string;
  caption: string;
  candidates: SlotCandidate[];
}

interface ParsedKeywords {
  slots?: ImageKeywordSlot[];
}

function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function localToCandidate(a: LocalAsset): SlotCandidate {
  return {
    source: 'local',
    id: a.id,
    // 浏览器走 /api/assets/file?id=... 流出
    preview_url: `/api/assets/file?id=${encodeURIComponent(a.id)}`,
    full_url: `/api/assets/file?id=${encodeURIComponent(a.id)}`,
    alt: a.file_name,
  };
}

function unsplashToCandidate(p: UnsplashPhoto): SlotCandidate {
  return {
    source: 'unsplash',
    id: p.id,
    preview_url: p.thumb_url,
    full_url: p.url,
    alt: p.alt,
    author: p.author,
    author_url: p.author_url,
  };
}

function tokenize(s: string): string[] {
  // 先按标点符号分词
  const chunks = s
    .split(/[\s,，、·/|]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // 对中文短语进一步拆分成 2-4 字的 n-gram（适合搜索）
  const result: string[] = [];
  for (const chunk of chunks) {
    result.push(chunk); // 保留原始词

    // 如果是纯中文且长度 > 2，生成 2-3 字的子串
    if (/^[一-龥]+$/.test(chunk) && chunk.length > 2) {
      for (let i = 0; i < chunk.length; i++) {
        // 2字词
        if (i + 2 <= chunk.length) {
          result.push(chunk.slice(i, i + 2));
        }
        // 3字词
        if (i + 3 <= chunk.length) {
          result.push(chunk.slice(i, i + 3));
        }
      }
    }
  }

  return [...new Set(result)]; // 去重
}

function loadVisualStyle(fingerprintId: string | undefined): string | null {
  if (!fingerprintId) return null;
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT fingerprint_json FROM fingerprints WHERE id = ?')
      .get(fingerprintId) as FingerprintRow | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.fingerprint_json) as {
      visual?: { image_style?: string };
    };
    return parsed?.visual?.image_style?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/images/auto
 * Body: { article_content, fingerprint_id?, slot_count?, sources? }
 *
 * 流程：
 *   1. 取 fingerprint.visual.image_style 作为风格关键词（可空）
 *   2. 让 Claude 输出 N 个图意 slot（中文 + 英文关键词）
 *   3. 每个 slot：先查本地，再查 Unsplash，凑齐候选
 *   4. 返回结构化结果给前端 ImagePanel
 *
 * 故意不做 SSE —— 整个流程通常 < 1 分钟，前端用 loading 态足够。
 */
export async function POST(req: NextRequest) {
  let body: AutoRequest;
  try {
    body = (await req.json()) as AutoRequest;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const articleContent = (body.article_content ?? '').trim();
  if (articleContent.length < 50) {
    return jsonError('文章内容太短了（不足 50 字），自动配图需要先有正文');
  }

  const slotCount = Math.max(1, Math.min(body.slot_count ?? 3, 8));
  const sources = new Set(
    (body.sources && body.sources.length > 0 ? body.sources : ['local', 'unsplash']).map(
      (s) => s.toLowerCase(),
    ),
  );

  const visualStyle = loadVisualStyle(body.fingerprint_id);

  // ---- Phase 1: ask Claude for slot keywords ----
  const prompt = buildImageKeywordsPrompt(articleContent, slotCount, visualStyle);
  let raw: string;
  try {
    raw = await streamClaude(prompt, { timeoutMs: 120_000, model: 'sonnet' });
  } catch (err) {
    return jsonError(
      `模型那边没回来：${(err as Error).message}`,
      502,
      { phase: 'claude' },
    );
  }

  const cleaned = stripJsonFence(raw);
  let parsed: ParsedKeywords;
  try {
    parsed = JSON.parse(cleaned) as ParsedKeywords;
  } catch (err) {
    console.error('[auto] JSON parse failed. Raw output:', raw.slice(0, 500));
    console.error('[auto] Cleaned output:', cleaned.slice(0, 500));
    console.error('[auto] Parse error:', (err as Error).message);
    return jsonError(
      '模型这次输出不是合法 JSON，再点一次自动配图大概率就好',
      502,
      {
        phase: 'parse',
        detail: (err as Error).message,
        sample: cleaned.slice(0, 240),
      },
    );
  }

  const slots = Array.isArray(parsed.slots) ? parsed.slots : [];
  if (slots.length === 0) {
    return jsonError('模型没给出有效的图意 slot', 502, { phase: 'parse' });
  }

  // ---- Phase 2: per-slot candidate search ----
  const results: SlotResult[] = [];

  for (const s of slots) {
    const intentZh = (s.intent_zh ?? '').toString().trim();
    const intentEn = (s.intent_en ?? '').toString().trim();
    const caption = (s.caption ?? '').toString().trim();
    const anchor = (s.position_anchor ?? '').toString().trim();

    const candidates: SlotCandidate[] = [];

    if (sources.has('local')) {
      // 优先使用中文关键词搜索本地资源（本地标签主要是中文）
      const kw = [...tokenize(intentZh)];
      if (visualStyle) kw.push(...tokenize(visualStyle));
      console.log(`[auto] slot ${s.slot_index}: intentZh="${intentZh}", intentEn="${intentEn}", keywords=`, kw);
      const local = searchLocalAssets(kw, 3);
      console.log(`[auto] slot ${s.slot_index}: found ${local.length} local assets`);
      for (const a of local) candidates.push(localToCandidate(a));
    }

    // Top up with Unsplash if we still want more.
    if (sources.has('unsplash') && isUnsplashConfigured() && candidates.length < 3) {
      const need = 3 - candidates.length;
      const q = [intentEn, visualStyle].filter(Boolean).join(' ');
      const photos = await searchUnsplash(q || intentZh, Math.max(need, 3));
      for (const p of photos.slice(0, need)) candidates.push(unsplashToCandidate(p));
    }

    results.push({
      slot_index: s.slot_index ?? results.length + 1,
      position_anchor: anchor,
      intent_zh: intentZh,
      intent_en: intentEn,
      caption,
      candidates,
    });
  }

  return NextResponse.json({
    ok: true,
    visual_style: visualStyle,
    unsplash_configured: isUnsplashConfigured(),
    slot_count: results.length,
    slots: results,
  });
}
