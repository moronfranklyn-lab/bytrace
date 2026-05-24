import { NextRequest, NextResponse } from 'next/server';
import { searchLocalAssets, type LocalAsset } from '@/lib/images/local';
import { searchUnsplash, isUnsplashConfigured, type UnsplashPhoto } from '@/lib/images/unsplash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ImageSearchHit {
  source: 'local' | 'unsplash';
  id: string;
  preview_url: string;       // local: file:// path or /api stream; unsplash: thumb
  full_url: string;          // article-body sized
  alt: string | null;
  caption: string | null;
  author: string | null;
  author_url: string | null;
}

function localAssetToHit(a: LocalAsset): ImageSearchHit {
  // 本地文件没法直接用 file:// — 浏览器会拒。前端会把 file_path 用 /api/assets/file
  // 流出去；此处先返回原 absolute path，前端组件自己加 prefix。
  return {
    source: 'local',
    id: a.id,
    preview_url: a.file_path,
    full_url: a.file_path,
    alt: a.file_name,
    caption: a.tags.join(' · ') || null,
    author: null,
    author_url: null,
  };
}

function unsplashToHit(p: UnsplashPhoto): ImageSearchHit {
  return {
    source: 'unsplash',
    id: p.id,
    preview_url: p.thumb_url,
    full_url: p.url,
    alt: p.alt,
    caption: null,
    author: p.author,
    author_url: p.author_url,
  };
}

/**
 * GET /api/images/search?q=工作场景&en=quiet+desk&limit=5&sources=local,unsplash
 *
 * Hybrid search:
 *   - local:    keyword scoring against folder/filename/tags
 *   - unsplash: only used when source list includes 'unsplash' AND a key is set
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const qZh = (sp.get('q') ?? '').trim();
  const qEn = (sp.get('en') ?? '').trim();
  const limit = Math.max(1, Math.min(parseInt(sp.get('limit') ?? '6', 10) || 6, 20));
  const sourcesRaw = sp.get('sources') ?? 'local,unsplash';
  const sources = new Set(
    sourcesRaw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const hits: ImageSearchHit[] = [];

  if (sources.has('local')) {
    // Use the union of both fields as local keywords.
    const keywords = [qZh, qEn].filter((s) => s.length > 0);
    const flat = keywords.flatMap((k) => k.split(/[\s,，、]+/)).filter(Boolean);
    const local = searchLocalAssets(flat, limit);
    for (const a of local) hits.push(localAssetToHit(a));
  }

  if (sources.has('unsplash') && isUnsplashConfigured()) {
    const q = qEn || qZh;
    const photos = await searchUnsplash(q, limit);
    for (const p of photos) hits.push(unsplashToHit(p));
  }

  return NextResponse.json({
    ok: true,
    query: { q_zh: qZh, q_en: qEn, sources: [...sources], limit },
    unsplash_configured: isUnsplashConfigured(),
    hits,
  });
}
